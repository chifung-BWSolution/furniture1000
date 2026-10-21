/**
 * T-902 — Canva Brand Template Autofill (Connect API).
 * Field names must match the published brand template dataset (Bulk Create labels).
 */

export const FDS_CANVA_FIELD = {
  COVER_TITLE: "FDS_COVER_TITLE",
  COVER_SUBTITLE: "FDS_COVER_SUBTITLE",
  COVER_CLIENT: "FDS_COVER_CLIENT",
  COVER_PURPOSE: "FDS_COVER_PURPOSE",
  COVER_DATE: "FDS_COVER_DATE",
  OUTLINE_FULL: "FDS_OUTLINE",
  outlineChunk: (n: number) => `FDS_OUTLINE_${n}`,
  productTitle: (n: number) => `FDS_PROD_${pad2(n)}_TITLE`,
  productDetails: (n: number) => `FDS_PROD_${pad2(n)}_DETAILS`,
  productImage: (n: number) => `FDS_PROD_${pad2(n)}_IMAGE`,
} as const;

export const AUTOFILL_SCOPES = [
  "design:content:write",
  "design:content:read",
  "design:meta:read",
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "asset:read",
  "asset:write",
] as const;

const MAX_OUTLINE_CHUNKS = 5;
const OUTLINE_CHUNK_SIZE = 900;
/** Example length for the unmatched-field list. Runtime slots come from the template dataset. */
const DOCUMENTED_PRODUCT_SLOTS = 12;

const PRODUCT_SLOT_PATTERNS = [
  /^(?:fds_)?prod_(\d+)_(?:title|details|image)$/,
  /^product_(\d+)_(?:title|details|image|name|description)$/,
  /^(?:title|details|image)_(\d+)$/,
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseScopes(scope: string | null | undefined): Set<string> {
  if (!scope) return new Set();
  return new Set(scope.split(/\s+/).filter(Boolean));
}

export function missingAutofillScopes(scope: string | null | undefined): string[] {
  const have = parseScopes(scope);
  return AUTOFILL_SCOPES.filter((s) => !have.has(s));
}

export type AutofillDataValue =
  | { type: "text"; text: string }
  | { type: "image"; asset_id: string };

/** Columns that exist on public.products. middle_price / size_* / factory are not columns. */
export interface ProductRow {
  id: string;
  title: string | null;
  model: string | null;
  sku: string | null;
  image_url: string | null;
  image_url_2: string | null;
  image_url_3: string | null;
  sale_price: number | null;
  price: number | null;
  material: string | null;
  color: string | null;
  dimension_l_mm: number | null;
  dimension_w_mm: number | null;
  dimension_h_mm: number | null;
  level1_category: string | null;
  level2_category: string | null;
  factories_display_name: string | null;
}

export const PRODUCT_SELECT_COLUMNS = [
  "id",
  "title",
  "model",
  "sku",
  "image_url",
  "image_url_2",
  "image_url_3",
  "sale_price",
  "price",
  "material",
  "color",
  "dimension_l_mm",
  "dimension_w_mm",
  "dimension_h_mm",
  "level1_category",
  "level2_category",
  "factories_display_name",
].join(",");

/** Reject hosts Canva would fetch that are loopback, link-local, or private. */
function isBlockedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host === "169.254.169.254") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const n = [ipv4[1], ipv4[2], ipv4[3], ipv4[4]].map((part) => Number(part));
    if (n.some((part) => part > 255)) return true;
    const [a, b] = n;
    if (a === 0 || a === 10 || a === 127 || a === 255) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (/^f[cd]/i.test(host) || /^fe[89ab]/i.test(host)) return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
    if (mapped) return isBlockedImageHost(mapped[1]);
  }
  return false;
}

/** Public HTTPS only. Canva's URL upload fetches this host, so private targets are skipped. */
export function isPublicHttpsImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return !isBlockedImageHost(url.hostname);
}

function firstHttpImage(p: ProductRow): string | undefined {
  for (const url of [p.image_url, p.image_url_2, p.image_url_3]) {
    if (url && isPublicHttpsImageUrl(url)) return url;
  }
  return undefined;
}

function sizeLabel(p: ProductRow): string | null {
  const parts = [p.dimension_l_mm, p.dimension_w_mm, p.dimension_h_mm].filter((v) => v != null && v > 0);
  if (parts.length === 0) return null;
  return parts.map((v) => String(v)).join(" × ") + " mm";
}

function moneyLabel(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return `HK$${Math.round(n).toLocaleString("en-HK")}`;
}

function productDetailsLine(p: ProductRow): string {
  const lines: string[] = [];
  const model = (p.model ?? "").trim() || (p.sku ?? "").trim();
  if (model) lines.push(`型號：${model}`);
  const size = sizeLabel(p);
  if (size) lines.push(`尺寸：${size}`);
  if (p.material?.trim()) lines.push(`材質：${p.material.trim()}`);
  if (p.color?.trim()) lines.push(`顏色：${p.color.trim()}`);
  const cat = (p.level2_category ?? p.level1_category ?? "").trim();
  if (cat) lines.push(`分類：${cat}`);
  if (p.factories_display_name?.trim()) lines.push(`供應商：${p.factories_display_name.trim()}`);
  const selling = moneyLabel(p.sale_price);
  const list = moneyLabel(p.price);
  if (selling) lines.push(`參考價：${selling}`);
  else if (list) lines.push(`參考價：${list}`);
  return lines.join("\n");
}

export function canonicalAutofillFields(): string[] {
  const names = [
    FDS_CANVA_FIELD.COVER_TITLE,
    FDS_CANVA_FIELD.COVER_SUBTITLE,
    FDS_CANVA_FIELD.COVER_CLIENT,
    FDS_CANVA_FIELD.COVER_PURPOSE,
    FDS_CANVA_FIELD.COVER_DATE,
    FDS_CANVA_FIELD.OUTLINE_FULL,
  ];
  for (let i = 1; i <= MAX_OUTLINE_CHUNKS; i++) names.push(FDS_CANVA_FIELD.outlineChunk(i));
  for (let n = 1; n <= DOCUMENTED_PRODUCT_SLOTS; n++) {
    names.push(
      FDS_CANVA_FIELD.productTitle(n),
      FDS_CANVA_FIELD.productDetails(n),
      FDS_CANVA_FIELD.productImage(n),
    );
  }
  return names;
}

/** Compare dataset labels without case or spacing differences. */
export function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Canonical FDS_* name plus common Bulk Create labels. FDS_* stays the name we document. */
export function fieldAliases(canonical: string): string[] {
  const aliases = new Set<string>([canonical, canonical.replace(/^FDS_/, "")]);
  const fixed: Record<string, string[]> = {
    [FDS_CANVA_FIELD.COVER_TITLE]: ["title", "cover_title", "cover title"],
    [FDS_CANVA_FIELD.COVER_SUBTITLE]: ["subtitle", "cover_subtitle", "cover subtitle"],
    [FDS_CANVA_FIELD.COVER_CLIENT]: ["client", "cover_client", "client_name", "customer"],
    [FDS_CANVA_FIELD.COVER_PURPOSE]: ["purpose", "cover_purpose"],
    [FDS_CANVA_FIELD.COVER_DATE]: ["date", "cover_date", "date_label"],
    [FDS_CANVA_FIELD.OUTLINE_FULL]: ["outline", "content", "agenda"],
  };
  for (const alias of fixed[canonical] ?? []) aliases.add(alias);
  const outline = /^FDS_OUTLINE_(\d+)$/.exec(canonical);
  if (outline) {
    aliases.add(`outline_${outline[1]}`);
    aliases.add(`outline${Number(outline[1])}`);
  }
  const product = /^FDS_PROD_(\d+)_(TITLE|DETAILS|IMAGE)$/.exec(canonical);
  if (product) {
    const pad = product[1];
    const n = String(Number(pad));
    const kind = product[2].toLowerCase();
    for (const prefix of ["prod", "product"]) {
      aliases.add(`${prefix}_${pad}_${kind}`);
      aliases.add(`${prefix}_${n}_${kind}`);
    }
    aliases.add(`${kind}_${pad}`);
    aliases.add(`${kind}_${n}`);
    if (kind === "title") {
      aliases.add(`product_${pad}_name`);
      aliases.add(`product_${n}_name`);
    }
    if (kind === "details") {
      aliases.add(`product_${pad}_description`);
      aliases.add(`product_${n}_description`);
    }
  }
  return [...aliases];
}

export interface DatasetMatcher {
  resolve(canonical: string): string | undefined;
  has(canonical: string): boolean;
  keys(): string[];
}

export function createDatasetMatcher(datasetKeys: Iterable<string>): DatasetMatcher {
  const keys = [...datasetKeys];
  const claimed = new Set<string>();
  const find = (canonical: string): string | undefined => {
    const wanted = new Set(fieldAliases(canonical).map(normalizeFieldName));
    return keys.find((key) => !claimed.has(key) && wanted.has(normalizeFieldName(key)));
  };
  return {
    keys: () => [...keys],
    has(canonical: string) {
      return find(canonical) !== undefined;
    },
    resolve(canonical: string) {
      const hit = find(canonical);
      if (hit) claimed.add(hit);
      return hit;
    },
  };
}

/** Highest product index in the dataset. Slots are 1..that number, including gaps. */
export function productSlotCount(datasetKeys: Iterable<string>): number {
  let highest = 0;
  for (const key of datasetKeys) {
    const normalized = normalizeFieldName(key);
    for (const pattern of PRODUCT_SLOT_PATTERNS) {
      const match = pattern.exec(normalized);
      const n = match ? Number(match[1]) : 0;
      if (Number.isInteger(n) && n > highest) highest = n;
    }
  }
  return highest;
}

export function unusedProductSlots(slotCount: number, filled: number): number[] {
  const slots: number[] = [];
  for (let n = filled + 1; n <= slotCount; n++) slots.push(n);
  return slots;
}

export function unmatchedBrandTemplateMessage(templateFields: string[]): string {
  const shown = templateFields.slice(0, 40);
  const actual = shown.length
    ? shown.join("、") + (templateFields.length > shown.length ? "…" : "")
    : "（沒有 Data field）";
  return [
    "品牌模板的欄位名稱與 FDS 約定不符，沒有可填入的資料，已停止呼叫 Canva。",
    "請在模板 Data field 使用這些名稱（大小寫不拘）：FDS_COVER_TITLE、FDS_COVER_SUBTITLE、FDS_COVER_CLIENT、FDS_COVER_PURPOSE、FDS_COVER_DATE、FDS_OUTLINE、FDS_OUTLINE_1 至 FDS_OUTLINE_5、FDS_PROD_01_TITLE、FDS_PROD_01_DETAILS、FDS_PROD_01_IMAGE，產品欄位編號到 12。",
    "也接受常見別名，例如 title 或 cover_title、subtitle 或 cover_subtitle、client、purpose、date、outline、product_01_title、product_01_details、product_01_image。",
    `模板目前的欄位：${actual}。`,
  ].join("");
}

export function splitOutline(text: string): string[] {
  const raw = text.trim();
  if (!raw) return [];
  const chunks: string[] = [];
  let rest = raw;
  while (rest.length > 0 && chunks.length < MAX_OUTLINE_CHUNKS) {
    if (rest.length <= OUTLINE_CHUNK_SIZE) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n", OUTLINE_CHUNK_SIZE);
    if (cut < OUTLINE_CHUNK_SIZE / 2) cut = OUTLINE_CHUNK_SIZE;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return chunks;
}

export function buildAutofillPayload(
  brief: Record<string, unknown>,
  products: ProductRow[],
  matcher: DatasetMatcher,
): { data: Record<string, AutofillDataValue>; report: Record<string, unknown> } {
  const data: Record<string, AutofillDataValue> = {};
  const used: string[] = [];
  const canonicalUsed: string[] = [];
  const warnings: Array<string | { code: string; slot_count: number; selected: number }> = [];

  const title = String(brief.title ?? brief.project ?? brief.client ?? "客戶簡報").trim();
  const subtitle = [brief.project, brief.client].filter(Boolean).map(String).join(" · ");
  const outline = String(brief.outline ?? brief.content ?? "").trim();
  const purpose = String(brief.purpose ?? "").trim();
  const dateLabel =
    String(brief.dateLabel ?? "").trim() ||
    `${new Date().getFullYear()}年${new Date().getMonth() + 1}月`;

  const setText = (canonical: string, text: string) => {
    if (!text.trim()) return;
    const key = matcher.resolve(canonical);
    if (!key) return;
    data[key] = { type: "text", text: text.slice(0, 4000) };
    used.push(key);
    canonicalUsed.push(canonical);
  };

  setText(FDS_CANVA_FIELD.COVER_TITLE, title);
  setText(FDS_CANVA_FIELD.COVER_SUBTITLE, subtitle);
  setText(FDS_CANVA_FIELD.COVER_CLIENT, String(brief.client ?? ""));
  setText(FDS_CANVA_FIELD.COVER_PURPOSE, purpose);
  setText(FDS_CANVA_FIELD.COVER_DATE, dateLabel);

  if (outline) {
    const full = matcher.resolve(FDS_CANVA_FIELD.OUTLINE_FULL);
    if (full) {
      data[full] = { type: "text", text: outline.slice(0, 4000) };
      used.push(full);
      canonicalUsed.push(FDS_CANVA_FIELD.OUTLINE_FULL);
    } else {
      const chunks = splitOutline(outline);
      chunks.forEach((chunk, i) => {
        setText(FDS_CANVA_FIELD.outlineChunk(i + 1), chunk);
      });
      if (chunks.length === 0) warnings.push("outline_not_mapped");
    }
  }

  const slotCount = productSlotCount(matcher.keys());
  const ordered = products.slice(0, slotCount);
  ordered.forEach((p, idx) => {
    const n = idx + 1;
    const pTitle = (p.title ?? "").trim() || (p.model ?? "").trim() || "產品";
    setText(FDS_CANVA_FIELD.productTitle(n), pTitle);
    setText(FDS_CANVA_FIELD.productDetails(n), productDetailsLine(p));
    if (!firstHttpImage(p) && matcher.has(FDS_CANVA_FIELD.productImage(n))) {
      warnings.push(`missing_image_${pad2(n)}`);
    }
  });

  const unusedSlots = unusedProductSlots(slotCount, ordered.length);
  if (products.length > slotCount) {
    warnings.push({ code: "products_truncated", slot_count: slotCount, selected: products.length });
  }

  return {
    data,
    report: {
      fields_sent: used,
      canonical_fields: canonicalUsed,
      products_selected: products.length,
      products_included: ordered.length,
      product_slot_count: slotCount,
      unused_slots: unusedSlots,
      outline_length: outline.length,
      warnings,
    },
  };
}

export function productImageFieldNeeds(
  products: ProductRow[],
  matcher: DatasetMatcher,
): { index: number; url: string; field: string }[] {
  const out: { index: number; url: string; field: string }[] = [];
  const slotCount = productSlotCount(matcher.keys());
  products.slice(0, slotCount).forEach((p, idx) => {
    const n = idx + 1;
    const field = matcher.resolve(FDS_CANVA_FIELD.productImage(n));
    if (!field) return;
    const url = firstHttpImage(p);
    if (url) out.push({ index: n, url, field });
  });
  return out;
}

export function attachImageAssets(
  data: Record<string, AutofillDataValue>,
  uploads: { field: string; asset_id: string }[],
): void {
  for (const { field, asset_id } of uploads) {
    data[field] = { type: "image", asset_id };
  }
}
