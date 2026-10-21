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
const MAX_PRODUCTS = Number(Deno.env.get("CANVA_AUTOFILL_MAX_PRODUCTS") ?? "12");

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

export interface ProductRow {
  id: string;
  title: string | null;
  model: string | null;
  sku: string | null;
  image_url: string | null;
  image_url_2: string | null;
  image_url_3: string | null;
  sale_price: number | null;
  middle_price: number | null;
  material: string | null;
  color: string | null;
  size_l: number | null;
  size_w: number | null;
  size_h: number | null;
  level1_category: string | null;
  level2_category: string | null;
  factory: string | null;
}

function firstHttpImage(p: ProductRow): string | undefined {
  for (const url of [p.image_url, p.image_url_2, p.image_url_3]) {
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return undefined;
}

function sizeLabel(p: ProductRow): string | null {
  const parts = [p.size_l, p.size_w, p.size_h].filter((v) => v != null && v > 0);
  if (parts.length === 0) return null;
  return parts.map((v) => String(v)).join(" × ") + " mm";
}

function moneyLabel(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
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
  if (p.factory?.trim()) lines.push(`供應商：${p.factory.trim()}`);
  const discount = moneyLabel(p.middle_price);
  const original = moneyLabel(p.sale_price);
  if (discount) lines.push(`參考價：${discount}`);
  else if (original) lines.push(`參考價：${original}`);
  return lines.join("\n");
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
  datasetKeys: Set<string>,
): { data: Record<string, AutofillDataValue>; report: Record<string, unknown> } {
  const data: Record<string, AutofillDataValue> = {};
  const used: string[] = [];
  const warnings: string[] = [];

  const title = String(brief.title ?? brief.project ?? brief.client ?? "客戶簡報").trim();
  const subtitle = [brief.project, brief.client].filter(Boolean).map(String).join(" · ");
  const outline = String(brief.outline ?? brief.content ?? "").trim();
  const purpose = String(brief.purpose ?? "").trim();
  const dateLabel =
    String(brief.dateLabel ?? "").trim() ||
    `${new Date().getFullYear()}年${new Date().getMonth() + 1}月`;

  const setText = (key: string, text: string) => {
    if (!datasetKeys.has(key) || !text.trim()) return;
    data[key] = { type: "text", text: text.slice(0, 4000) };
    used.push(key);
  };

  setText(FDS_CANVA_FIELD.COVER_TITLE, title);
  setText(FDS_CANVA_FIELD.COVER_SUBTITLE, subtitle);
  setText(FDS_CANVA_FIELD.COVER_CLIENT, String(brief.client ?? ""));
  setText(FDS_CANVA_FIELD.COVER_PURPOSE, purpose);
  setText(FDS_CANVA_FIELD.COVER_DATE, dateLabel);

  if (outline) {
    if (datasetKeys.has(FDS_CANVA_FIELD.OUTLINE_FULL)) {
      setText(FDS_CANVA_FIELD.OUTLINE_FULL, outline);
    } else {
      const chunks = splitOutline(outline);
      chunks.forEach((chunk, i) => {
        setText(FDS_CANVA_FIELD.outlineChunk(i + 1), chunk);
      });
      if (chunks.length === 0) warnings.push("outline_not_mapped");
    }
  }

  const ordered = products.slice(0, MAX_PRODUCTS);
  ordered.forEach((p, idx) => {
    const n = idx + 1;
    const pTitle = (p.title ?? "").trim() || (p.model ?? "").trim() || "產品";
    setText(FDS_CANVA_FIELD.productTitle(n), pTitle);
    setText(FDS_CANVA_FIELD.productDetails(n), productDetailsLine(p));
    if (!firstHttpImage(p) && datasetKeys.has(FDS_CANVA_FIELD.productImage(n))) {
      warnings.push(`missing_image_${pad2(n)}`);
    }
  });

  if (products.length > MAX_PRODUCTS) {
    warnings.push(`products_truncated_${MAX_PRODUCTS}`);
  }

  return {
    data,
    report: {
      fields_sent: used,
      products_included: ordered.length,
      outline_length: outline.length,
      warnings,
    },
  };
}

export function productImageFieldNeeds(
  products: ProductRow[],
  datasetKeys: Set<string>,
): { index: number; url: string; field: string }[] {
  const out: { index: number; url: string; field: string }[] = [];
  products.slice(0, MAX_PRODUCTS).forEach((p, idx) => {
    const n = idx + 1;
    const field = FDS_CANVA_FIELD.productImage(n);
    if (!datasetKeys.has(field)) return;
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
