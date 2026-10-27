/**
 * Canva Design Generation (preview): brief + presentation outline.
 * No brand template and no Autofill.
 */

export const GENERATION_SCOPES = [
  "design:content:write",
  "design:content:read",
  "profile:read",
] as const;

export const CREDIT_QUOTA_MESSAGE =
  "Canva AI 點數已用完，暫時無法再生成簡報。請稍後再試，或到 Canva 查看點數與方案。";

export const DESIGN_GENERATION_MISSING_MESSAGE =
  "此 Canva 帳戶沒有 AI 設計生成權限（design_generation）。請在 Canva 開啟 Canva AI 與 Magic Design，或改用有該功能的帳戶。";

export const RECONNECT_PROFILE_MESSAGE =
  "目前的 Canva 授權缺少 profile:read，無法確認 AI 生成權限。請解除連接後重新連接 Canva。";

const BRIEF_MAX = 5000;
const SECTION_MAX = 100;
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 2000;
const POINT_MAX = 500;
const POINTS_MAX = 50;

export interface ProductRow {
  id: string;
  title: string | null;
  model: string | null;
  sku: string | null;
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

export interface OutlineSection {
  title: string;
  description: string;
  points?: string[];
}

export function missingScopes(scope: string | null | undefined, required: readonly string[]): string[] {
  const have = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  return required.filter((item) => !have.has(item));
}

function clip(text: string, max: number): string {
  const value = text.trim();
  return value.length <= max ? value : value.slice(0, max);
}

function moneyLabel(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return `HK$${Math.round(n).toLocaleString("en-HK")}`;
}

export function productSpecLines(product: ProductRow): string[] {
  const lines: string[] = [];
  const name = (product.title ?? "").trim();
  if (name) lines.push(`名稱：${name}`);
  const model = (product.model ?? "").trim() || (product.sku ?? "").trim();
  if (model) lines.push(`型號：${model}`);
  const size = [product.dimension_l_mm, product.dimension_w_mm, product.dimension_h_mm]
    .filter((value) => value != null && value > 0);
  if (size.length > 0) lines.push(`尺寸：${size.join(" × ")} mm`);
  if (product.material?.trim()) lines.push(`材質：${product.material.trim()}`);
  if (product.color?.trim()) lines.push(`顏色：${product.color.trim()}`);
  const category = (product.level2_category ?? product.level1_category ?? "").trim();
  if (category) lines.push(`分類：${category}`);
  if (product.factories_display_name?.trim()) lines.push(`供應商：${product.factories_display_name.trim()}`);
  const price = moneyLabel(product.sale_price) ?? moneyLabel(product.price);
  if (price) lines.push(`參考價：${price}`);
  return lines;
}

function section(title: string, description: string, points: string[] = []): OutlineSection {
  const safeTitle = clip(title, TITLE_MAX) || "簡報";
  const safeDescription = clip(description, DESCRIPTION_MAX) || safeTitle;
  const safePoints = points.map((point) => clip(point, POINT_MAX)).filter(Boolean).slice(0, POINTS_MAX);
  const row: OutlineSection = { title: safeTitle, description: safeDescription };
  if (safePoints.length > 0) row.points = safePoints;
  return row;
}

/** Turn the confirmed outline into slide sections. Headings start a new slide. */
export function sectionsFromOutline(text: string, fallbackTitle: string): OutlineSection[] {
  const raw = text.trim();
  if (!raw) return [];
  const blocks: { title: string; body: string[]; points: string[] }[] = [];
  const ensure = () => {
    if (blocks.length === 0) blocks.push({ title: "", body: [], points: [] });
    return blocks[blocks.length - 1];
  };
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = /^(?:#{1,3}\s+|\d+[.、)]\s+)(.+)$/.exec(trimmed);
    const bullet = /^(?:[-*•]\s+)(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({ title: heading[1].trim(), body: [], points: [] });
      continue;
    }
    const current = ensure();
    if (bullet) current.points.push(bullet[1].trim());
    else current.body.push(trimmed);
  }
  return blocks.map((block, index) => {
    const title = block.title || (index === 0 ? fallbackTitle : "") || block.body[0] || `第 ${index + 1} 部分`;
    const body = block.title ? block.body : block.body.slice(block.body[0] === title ? 1 : 0);
    const description = body.join("\n") || block.points.join("；") || title;
    return section(title, description, block.points);
  });
}

export function buildGenerationRequest(
  brief: Record<string, unknown>,
  products: ProductRow[],
): {
  brief: string;
  design_type: { type: "preset"; name: "presentation" };
  outline: { sections: OutlineSection[] };
  report: Record<string, unknown>;
} {
  const title = clip(String(brief.title ?? brief.project ?? brief.client ?? "客戶簡報"), TITLE_MAX) || "客戶簡報";
  const client = String(brief.client ?? "").trim();
  const project = String(brief.project ?? "").trim();
  const purpose = String(brief.purpose ?? "").trim();
  const language = String(brief.language ?? "").trim();
  const style = String(brief.style ?? "").trim();
  const pageCount = Number(brief.pageCount);
  const content = String(brief.content ?? "").trim();
  const outlineText = String(brief.outline ?? "").trim();

  const header = [
    `標題：${title}`,
    client ? `客戶：${client}` : "",
    project ? `專案：${project}` : "",
    purpose ? `目的：${purpose}` : "",
    language ? `語言：${language}` : "",
    style ? `風格：${style}` : "",
    Number.isFinite(pageCount) && pageCount > 0 ? `期望頁數：${pageCount}` : "",
    "參考案例：大綱裡每一個案例標題各做一頁，只寫品牌與用過的傢俬，不要寫項目名稱、項目編號或地址。",
  ].filter(Boolean).join("\n");

  const productBlock = products.length
    ? `產品：\n${products.map((product, index) => {
      const specs = productSpecLines(product);
      return `${index + 1}. ${specs.join("；") || (product.title ?? "產品")}`;
    }).join("\n")}`
    : "";

  const fixed = [header, productBlock].filter(Boolean).join("\n\n");
  const narrative = [outlineText ? `確認大綱：\n${outlineText}` : "", content ? `原文：\n${content}` : ""]
    .filter(Boolean)
    .join("\n\n");
  let briefText = fixed;
  if (narrative) {
    const room = BRIEF_MAX - fixed.length - 2;
    briefText = room > 20 ? `${fixed}\n\n${narrative.slice(0, room)}` : fixed.slice(0, BRIEF_MAX);
  }
  briefText = clip(briefText, BRIEF_MAX) || title;

  const coverPoints = [
    client ? `客戶：${client}` : "",
    project ? `專案：${project}` : "",
    purpose ? `目的：${purpose}` : "",
    language ? `語言：${language}` : "",
    style ? `風格：${style}` : "",
  ].filter(Boolean);
  const outlineSections = sectionsFromOutline(outlineText, title);
  const sections: OutlineSection[] = [];
  if (outlineSections.length === 0) {
    sections.push(section(title, purpose || content || "客戶簡報", coverPoints));
  } else {
    sections.push(...outlineSections);
  }
  let productsIncluded = 0;
  for (const product of products) {
    if (sections.length >= SECTION_MAX) break;
    const specs = productSpecLines(product);
    sections.push(section(
      (product.title ?? "").trim() || (product.model ?? "").trim() || `產品 ${productsIncluded + 1}`,
      specs.join("\n") || "產品資料",
      specs,
    ));
    productsIncluded += 1;
  }

  return {
    brief: briefText,
    design_type: { type: "preset", name: "presentation" },
    outline: { sections: sections.slice(0, SECTION_MAX) },
    report: {
      brief_length: briefText.length,
      section_count: Math.min(sections.length, SECTION_MAX),
      products_selected: products.length,
      products_included: productsIncluded,
      sections_truncated: sections.length > SECTION_MAX || products.length > productsIncluded,
    },
  };
}
