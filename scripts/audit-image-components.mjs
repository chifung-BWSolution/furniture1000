#!/usr/bin/env node
/**
 * Audit the image + modal contract of the app.
 *
 * Three rules, all about "reuse the shared component instead of hand-rolling":
 *
 *  A) raw-img-dynamic  — a dynamic <img src={...}> that is not the shared
 *     `LoadingImage`. Storage object URLs then load the ORIGINAL file
 *     (a PMS completion photo is ~1.6MB) instead of the 320px webp twin.
 *  B) custom-dialog     — a <Dialog> instead of the shared <Modal>.
 *  C) lightbox-originals — <ImageLightbox> without `thumbWidth`: the strip
 *     thumbnails pull full-size files.
 *
 * Plus the "don't hand-roll a control" rules added after the report/quote
 * screens grew bespoke shells:
 *
 *  E) custom-dialog-shell — `role="dialog"` / `aria-modal` written by hand
 *     instead of the shared <Modal> (no focus trap, no ESC, no scroll lock,
 *     and nested dialogs land under the wrong z-index).
 *  F) custom-switch       — a `<button role="switch">` instead of <Switch>.
 *  G) advisories          — native <select> / <input type=checkbox|radio> and
 *     window.confirm/alert/prompt where the shared component exists.
 *
 * Usage:
 *   node scripts/audit-image-components.mjs
 *   node scripts/audit-image-components.mjs --json
 *
 * Exit code 1 when a rule fails, so CI can gate on it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SRC = join(ROOT, "src");
const jsonOut = process.argv.includes("--json");

/** Files allowed to render a raw <img>. */
const RAW_IMG_ALLOW = [
  "components/ui/loading-image.tsx", // the shared component itself
  "components/ui/image-lightbox.tsx", // the viewer itself (main image + strip)
  "components/ui/empty-state.tsx", // static illustration
  "components/ui/error-state.tsx", // static illustration
  "components/brand/FdsLogo.tsx", // static logo
];

/**
 * Raw <img> that cannot use the shared component.
 * [path, needle, reason] — needle null = whole file; otherwise the <img> whose
 * source contains `needle`. Every entry needs a reason, so an exception is a
 * decision, not a habit.
 */
const RAW_IMG_EXCEPTIONS = [
  ["components/dashboard/QuotationPDFPreview.tsx", "page.dataUrl", "pdf.js page data URL, needs its natural ratio"],
  ["components/dashboard/RemarksRichEditor.tsx", "block.src", "image inside contenteditable, must stay a native <img>"],
  ["components/dashboard/SourcePageDialog.tsx", "src={imageUrl}", "blob: object URL of an already downloaded page, natural ratio"],
  ["components/dashboard/customers/CustomerPortalExtraViews.tsx", "src={imagePreview}", "local blob: preview of the just-picked file"],
  ["components/dashboard/ProductWorkbench.tsx", "src={qr}", "QR code data URL generated in the browser"],
  ["components/dashboard/QuotationDraftEditor.tsx", "qrserver", "QR code from an external QR service"],
  [
    "components/dashboard/QuotePhotoLayoutEditor.tsx",
    null,
    "crop dialog positions the bitmap with pixel math (natural size × scale × offset); the shared 320px thumb would be too soft to crop",
  ],
  [
    "components/dashboard/QuotePhotoLayoutView.tsx",
    null,
    "printed layout needs object-position / scale transforms on the full-size photo; a 320px thumb would blur the canvas and the A4 output",
  ],
];

/** Files allowed to use the raw <Dialog> (not the app-wide <Modal>). */
const DIALOG_ALLOW = [
  "components/ui/command.tsx", // shadcn CommandDialog
];

function rawImgAllowed(rel, tag) {
  if (RAW_IMG_ALLOW.some((f) => rel === f)) return true;
  return RAW_IMG_EXCEPTIONS.some(([file, needle]) => {
    if (file !== rel) return false;
    if (!needle) return true;
    return tag.includes(needle);
  });
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const violations = [];
const advisories = [];

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, "/");
  if (rel.startsWith("stories/")) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const source = lines.join("\n");

  // Every <img .../> tag, including multi-line ones.
  const imgTags = [...source.matchAll(/<img\b[\s\S]{0,400}?\/>/g)];

  for (const tag of imgTags) {
    const before = source.slice(0, tag.index);
    const lineNo = before.split("\n").length;
    const at = `${rel}:${lineNo}`;
    const dynamic = /src\s*=\s*\{/.test(tag[0]);
    const allowed = rawImgAllowed(rel, tag[0]);
    if (dynamic && !allowed) {
      violations.push({
        rule: "raw-img-dynamic",
        file: at,
        code: tag[0].replace(/\s+/g, " ").trim().slice(0, 120),
        fix: "use <LoadingImage> from @/components/ui/loading-image (it rewrites storage URLs to a 320px webp), or wrap the src with toThumbUrl()/productThumbUrl()",
      });
    }
  }

  for (const [i, line] of lines.entries()) {
    const at = `${rel}:${i + 1}`;
    const isPrimitive = rel.startsWith("components/ui/");

    // B) raw <Dialog> instead of the shared <Modal>
    if (/<Dialog\b/.test(line) && !DIALOG_ALLOW.some((f) => rel === f)) {
      violations.push({
        rule: "custom-dialog",
        file: at,
        code: line.trim().slice(0, 120),
        fix: "use <Modal> from @/components/ui/modal (canonical modal: overlay, focus trap, ESC, same chrome everywhere)",
      });
    }

    // E) a dialog shell written by hand: backdrop + role="dialog"/aria-modal.
    //    Only <Modal> owns that markup, so focus trap / ESC / scroll lock /
    //    layer stacking stay consistent (nested dialogs included).
    if (!isPrimitive && /role="dialog"|aria-modal=/.test(line)) {
      violations.push({
        rule: "custom-dialog-shell",
        file: at,
        code: line.trim().slice(0, 120),
        fix: 'use <Modal variant="fullscreen"> for a window-sized surface, or <Modal> + footer for a normal dialog — never a bare fixed inset-0 + role="dialog"',
      });
    }

    // F) a switch drawn by hand instead of <Switch>.
    if (!isPrimitive && /role="switch"/.test(line)) {
      violations.push({
        rule: "custom-switch",
        file: at,
        code: line.trim().slice(0, 120),
        fix: "use <Switch> from @/components/ui/switch (Radix: real thumb, focus ring, aria-checked)",
      });
    }

    // C) <ImageLightbox> without thumbWidth -> strip loads originals.
    //    Only the shared viewer matters, and only when it can show a strip
    //    (a single image or `simple` has no thumbnails).
    if (
      /<ImageLightbox\b/.test(line) &&
      /from\s+['"]@\/components\/ui\/image-lightbox['"]/.test(source) &&
      // a local wrapper of the same name is not the shared viewer
      !/function\s+ImageLightbox\b/.test(source)
    ) {
      const block = lines.slice(i, i + 12).join("\n");
      if (!/thumbWidth=/.test(block) && !/\bsimple\b/.test(block)) {
        advisories.push({
          rule: "lightbox-originals",
          file: at,
          fix: "pass thumbWidth={160} so the strip uses compressed thumbnails",
        });
      }
    }
  }

  // G) native controls where the shared primitive already exists. Advisory:
  //    most of these sit in dense tables/filters, so they are migrated in
  //    batches instead of blocking every commit.
  const count = (re) => (source.match(re) || []).length;
  const nativeSelects = count(/<select\b/g);
  if (nativeSelects) {
    advisories.push({
      rule: "native-select",
      file: `${rel} (${nativeSelects})`,
      fix: "use <Select> from @/components/ui/select so the trigger matches the rest of the app",
    });
  }
  const nativeChoices = count(/type="checkbox"/g) + count(/type="radio"/g);
  if (nativeChoices) {
    advisories.push({
      rule: "native-checkbox",
      file: `${rel} (${nativeChoices})`,
      fix: "use <Checkbox> / <RadioGroup> from @/components/ui",
    });
  }
  const nativeConfirm = count(/window\.(confirm|alert|prompt)\(/g);
  if (nativeConfirm && rel !== "components/ui/confirm-dialog.tsx") {
    advisories.push({
      rule: "native-confirm",
      file: `${rel} (${nativeConfirm})`,
      fix: "use <AlertDialog> for a yes/no and sonner toast() for a notice — window.confirm blocks the paint and cannot be styled",
    });
  }

  // D) the transform trap: a bleed modal whose children are absolutely
  //    positioned. `Modal` centres its card with a translate, and a
  //    transform turns `absolute` children into card-relative ones, so a
  //    close button meant for the window corner lands mid-screen.
  const modalIndex = lines.findIndex((l) => /<Modal\b/.test(l));
  if (modalIndex >= 0) {
    const block = lines.slice(modalIndex, modalIndex + 14).join("\n");
    if (/variant="bleed"/.test(block) && /className="[^"]*\babsolute\b/.test(block)) {
      advisories.push({
        rule: "modal-transform-trap",
        file: `${rel}:${modalIndex + 1}`,
        fix: 'a translate on the modal card makes `absolute` children card-relative; use variant="fullscreen" for window-pinned chrome',
      });
    }
  }
}

const report = {
  scanned: "src/**/*.tsx",
  violations: violations.length,
  advisories: advisories.length,
  violations_detail: violations,
  advisories_detail: advisories,
};

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(violations.length ? 1 : 0);
}

console.log("=== Image / modal component audit ===");
console.log(`Violations (blocking): ${violations.length}`);
for (const v of violations) {
  console.log(`  [${v.rule}] ${v.file}`);
  console.log(`      ${v.code}`);
  console.log(`      → ${v.fix}`);
}
console.log(`\nAdvisories: ${advisories.length}`);
for (const a of advisories) {
  console.log(`  [${a.rule}] ${a.file}`);
  console.log(`      → ${a.fix}`);
}
if (!violations.length) console.log("\nOK — every dynamic image and modal goes through the shared components.");
process.exit(violations.length ? 1 : 0);
