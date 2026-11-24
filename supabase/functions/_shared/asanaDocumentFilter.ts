/**
 * Pure filtering & classification helpers for Asana supplier attachments.
 * Shared between `sync-asana-documents` edge function and offline unit tests.
 */

export const SUPPORTED_ASANA_DOC_EXTS = ["pdf", "xlsx", "xls"] as const;
export type SupportedAsanaDocExt = (typeof SUPPORTED_ASANA_DOC_EXTS)[number];

export const SUPPLIER_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024;
export const EDGE_HASH_BUFFER_MAX_BYTES = 60 * 1024 * 1024;

export interface AsanaAttachmentMeta {
  gid: string;
  name?: string | null;
  host?: string | null;
  size?: number | null;
  created_at?: string | null;
  download_url?: string | null;
}

export type AttachmentDecision =
  | {
      action: "sync";
      ext: SupportedAsanaDocExt;
      mimeType: string;
      docType: "quote" | "catalog";
      streamUpload: boolean;
    }
  | {
      action: "ignore";
      reason: "unsupported_ext" | "external_host";
    }
  | {
      action: "skip";
      ext: SupportedAsanaDocExt;
      docType: "quote" | "catalog";
      reason: "oversized";
    };

export function extractDocExt(fileName: string | null | undefined): SupportedAsanaDocExt | null {
  const cleaned = String(fileName ?? "").trim().toLowerCase();
  const match = cleaned.match(/\.([a-z0-9]{2,5})$/);
  if (!match) return null;
  const ext = match[1];
  if (ext === "pdf" || ext === "xlsx" || ext === "xls") return ext;
  return null;
}

export function mimeTypeForExt(ext: SupportedAsanaDocExt): string {
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
  }
}

const QUOTE_PATTERN = /報價|报价|quote|quotation|price|價目|价目|價格表|价格表|清單|清单|cost/i;
const CATALOG_PATTERN = /圖冊|图册|畫冊|画册|目錄|目录|catalog|catalogue|手冊|手册|產品資料|产品资料|产品介绍|介紹|介绍|花色|色板|樣本|样本|系列|綜合冊|综合册|色卡|折頁|折页|宣傳冊|宣传册|彩頁|彩页|型錄|型录|選型|选型|series|brochure|lookbook|portfolio|collection/i;

export function classifyAsanaDocType(
  fileName: string | null | undefined,
  ext: SupportedAsanaDocExt,
): "quote" | "catalog" {
  const name = String(fileName ?? "").trim();
  if (ext === "xlsx" || ext === "xls") return "quote";
  if (QUOTE_PATTERN.test(name)) return "quote";
  if (CATALOG_PATTERN.test(name)) return "catalog";
  return "quote";
}

/**
 * Extract document year from filename first (e.g. 2026-3-26, 202505, 2025报价表),
 * falling back to remote_created_at year or current year.
 */
export function extractAsanaDocumentYear(
  fileName: string | null | undefined,
  remoteCreatedAt?: string | null,
  fallbackYear = new Date().getUTCFullYear(),
): number {
  const name = String(fileName ?? "");
  const matches = [...name.matchAll(/(?<!\d)(20[0-3]\d)(?!\d)/g)].map((m) => Number(m[1]));
  if (matches.length > 0) {
    // Prefer the latest plausible 4-digit year in filename (e.g. 2025/2026).
    return Math.max(...matches);
  }
  // Compact YYYYMM / YYYYMMDD such as 202505 or 20260326
  const compact = name.match(/(?<!\d)(20[0-3]\d)(?:0[1-9]|1[0-2])/);
  if (compact) return Number(compact[1]);

  if (remoteCreatedAt) {
    const parsed = new Date(remoteCreatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getUTCFullYear();
      if (y >= 1990 && y <= 2100) return y;
    }
  }
  return fallbackYear;
}

export function hasExplicitQuoteKeyword(fileName: string | null | undefined): boolean {
  return QUOTE_PATTERN.test(String(fileName ?? ""));
}

/**
 * Normalize an attachment filename to its series/document stem so distinct
 * catalogs or floor/series quotes in the same year do NOT supersede each other,
 * while duplicate copies `(1)` / `(2)` or revision suffixes (`-v2`, `-R2`, dates)
 * still group together and keep only the latest version.
 */
export function normalizeAttachmentSeriesKey(fileName: string | null | undefined): string {
  const withoutExt = String(fileName ?? "")
    .trim()
    .replace(/\.(pdf|xlsx|xls)$/i, "");
  if (!withoutExt) return "unnamed";

  let stem = withoutExt
    // Copy/revision tags in parentheses anywhere: (1), （2）, (v2), (高清), (电子版)
    .replace(/[（(]\s*(?:\d+|v\d+(?:\.\d+)*|r\d+|copy|final|latest|最新|高清|電子版|电子版|副本)\s*[)）]/gi, " ")
    // Dotted or dashed dates like 2026-3-26, 2026/03/26, 22.3.11
    .replace(/(?<!\d)(?:20\d{2}|\d{2})[-./]\d{1,2}(?:[-./]\d{1,2})?(?!\d)/g, " ")
    // Compact 6-8 digit dates like 20260730, 231006, 202505
    .replace(/(?<!\d)(?:20\d{2}(?:0[1-9]|1[0-2])(?:[0-3]\d)?|\d{2}(?:0[1-9]|1[0-2])[0-3]\d)(?!\d)/g, " ")
    // Version / revision suffixes at token boundaries
    .replace(/(?:^|[\s\-_])(?:v\d+(?:\.\d+)*|r\d+)(?=$|[\s\-_])/gi, " ")
    // Trailing edition words
    .replace(/(?:[\s\-_]*(?:final|latest|copy|最新|高清|電子版|电子版|副本))+$/gi, "");

  stem = stem.replace(/[\s\-_.,，。、·()（）[\]【】]+/g, "").toLowerCase();
  if (stem) return stem;
  return withoutExt.replace(/\s+/g, "").toLowerCase() || "unnamed";
}

/**
 * For a single factory task's syncable attachments, group by (docType, documentYear, seriesKey)
 * and keep only the latest version per group.
 * Within `quote` groups, explicitly quote-named files (containing 報價/报价/quote/price)
 * take priority over unnamed fallback files in the same series group.
 */
export function selectLatestVersionPerYear<
  T extends { gid: string; name?: string | null; created_at?: string | null },
>(
  candidates: Array<{ att: T; docType: "quote" | "catalog"; year: number }>,
): {
  latest: Array<{ att: T; docType: "quote" | "catalog"; year: number }>;
  superseded: Array<{ att: T; docType: "quote" | "catalog"; year: number }>;
} {
  const groups = new Map<string, Array<{ att: T; docType: "quote" | "catalog"; year: number }>>();
  for (const item of candidates) {
    const seriesKey = normalizeAttachmentSeriesKey(item.att.name);
    const key = `${item.docType}:${item.year}:${seriesKey}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const latest: Array<{ att: T; docType: "quote" | "catalog"; year: number }> = [];
  const superseded: Array<{ att: T; docType: "quote" | "catalog"; year: number }> = [];

  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => {
      if (a.docType === "quote") {
        const aExplicit = hasExplicitQuoteKeyword(a.att.name) ? 1 : 0;
        const bExplicit = hasExplicitQuoteKeyword(b.att.name) ? 1 : 0;
        if (aExplicit !== bExplicit) return bExplicit - aExplicit;
      }
      const dateCmp = String(b.att.created_at ?? "").localeCompare(String(a.att.created_at ?? ""));
      if (dateCmp !== 0) return dateCmp;
      return String(b.att.gid).localeCompare(String(a.att.gid));
    });
    latest.push(sorted[0]);
    for (let i = 1; i < sorted.length; i += 1) {
      superseded.push(sorted[i]);
    }
  }
  return { latest, superseded };
}

export function decideAsanaAttachment(att: AsanaAttachmentMeta): AttachmentDecision {
  const ext = extractDocExt(att.name);
  if (!ext) {
    return { action: "ignore", reason: "unsupported_ext" };
  }
  const host = String(att.host ?? "").trim().toLowerCase();
  if (host && host !== "asana") {
    return { action: "ignore", reason: "external_host" };
  }
  const docType = classifyAsanaDocType(att.name, ext);
  const size = typeof att.size === "number" && Number.isFinite(att.size) ? att.size : 0;
  if (size > SUPPLIER_DOCUMENT_MAX_BYTES) {
    return { action: "skip", ext, docType, reason: "oversized" };
  }
  return {
    action: "sync",
    ext,
    mimeType: mimeTypeForExt(ext),
    docType,
    // PDFs > 60MB are streamed directly into Storage and routed to needs_split
    // so the Edge Function does not buffer 70–200MB in memory.
    streamUpload: ext === "pdf" && size > EDGE_HASH_BUFFER_MAX_BYTES,
  };
}

export function storageKeySegment(value: string | null | undefined): string {
  const cleaned = String(value ?? "").trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 60) || "unassigned";
}

export function buildAsanaStoragePath(input: {
  factoryId: string;
  docType: "quote" | "catalog";
  ext: SupportedAsanaDocExt;
  contentHash?: string | null;
  attachmentGid: string;
}): string {
  const folder = storageKeySegment(input.factoryId);
  const name = input.contentHash
    ? `${input.contentHash}.${input.ext}`
    : `asana_${storageKeySegment(input.attachmentGid)}.${input.ext}`;
  return `${folder}/${input.docType}/${name}`;
}
