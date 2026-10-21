import { runTripoJob, TripoStop } from "./tripo.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getDocumentProxy } from "npm:unpdf@1.9.0";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "npm:pdf-lib@1.17.1";

/**
 * FDS 2.1 背景任務 worker（Edge 過渡版，C-09）。
 * 呼叫來源：pg_cron（x-worker-secret）、前端 admin / uploader（使用者 JWT）、
 * 以及自己觸發下一批（service role）。
 * 任務狀態一律經 fds_processing_job_* RPC 流轉。超過 60MB 的 PDF 不在這裡拆，
 * 改排 needs_split。有待拆任務時 POST 到 Vercel Function（PDF_SPLIT_URL），
 * header x-pdf-split-secret = PDF_SPLIT_SECRET。未設定時略過，不影響 parse_pdf。
 *
 * parse_pdf 分批跑（Edge 每次請求只有很短的 CPU 時間）：
 *   extract  — 逐頁抽文字；文字太少的掃描頁抽出內嵌 JPEG 交 Grok OCR
 *   classify — Gemini 判斷頁面類型，以及是否延續上一頁（語意分段依據）
 *   最後建 supplier_document_segments，文件轉 review。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WORKER_NAME = "edge:process-jobs";
const JOB_TYPES = ["parse_pdf", "generate_tripo"];
const EDGE_MAX_PDF_BYTES = 60 * 1024 * 1024;
const EXTRACT_BATCH = 8;
const CLASSIFY_BATCH = 20;
const OCR_CONCURRENCY = 4;
// Pages with less real text than this are treated as scanned and sent to OCR.
const MIN_TEXT_CHARS = 40;
const CLASSIFY_TEXT_CHARS = 1500;
const STRUCTURE_MAX_PAGES = 5;
const STRUCTURE_MAX_IMAGES = 10;
const MIN_IMAGE_PX = 200;
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
// Edge CPU budget: base64-encoding inline images is the expensive part of a structure batch.
const MAX_INLINE_TOTAL_BYTES = 12 * 1024 * 1024;
// The same picture on this many pages is a logo / decoration, not a product photo.
const LOGO_PAGE_OCCURRENCES = 3;
const STRUCTURE_KINDS = ["product", "price_table", "other"];
const IMAGE_TYPES = ["main", "detail", "dimension", "fabric", "logo", "other"] as const;
const ATTENTION_CONFIDENCE = 0.7;

const PDFJS_ASSETS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299";
const GEMINI_MODEL = "gemini-2.5-flash";
const XAI_URL = "https://api.x.ai/v1/chat/completions";
const PAGE_TYPES = ["cover", "toc", "product", "price_table", "terms", "other"] as const;

type PageType = typeof PAGE_TYPES[number];
type OcrStatus = "not_needed" | "done" | "failed" | "skipped" | "unsupported";

type Job = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  document_id: string | null;
  attempts: number;
  max_attempts: number;
};

type StructureUnit = { segment_id: string; start: number; end: number };

type ParseState = {
  phase: "extract" | "classify" | "structure";
  cursor: number;
  page_count: number;
  tokens: number;
  ocr_pages: number;
  /** structure phase: cursor indexes into units. */
  units?: StructureUnit[];
  segments?: number;
  currencies?: Record<string, number>;
};

type PageRow = {
  document_id: string;
  job_id: string;
  page_no: number;
  text_source: "text" | "ocr" | "none";
  content: string;
  char_count: number;
  image_count: number;
  ocr_status: OcrStatus;
  ocr_error: string | null;
  updated_at: string;
};

class NonRetryableError extends Error {}
class JobCancelledError extends Error {}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function realCharCount(text: string): number {
  return text.replace(/\s+/g, "").length;
}

async function isAuthorized(
  req: Request,
  admin: SupabaseClient,
  url: string,
  anonKey: string,
  serviceKey: string,
): Promise<boolean> {
  const secret = req.headers.get("x-worker-secret");
  if (secret) {
    const { data } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    return data === true;
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim() ?? "";
  if (bearer && bearer === serviceKey) return true;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user?.id) return false;
  const { data } = await userClient.rpc("bwf_has_role", { p_roles: ["admin", "uploader"] });
  return data === true;
}

async function heartbeat(admin: SupabaseClient, jobId: string, progress: number) {
  const { data, error } = await admin.rpc("fds_processing_job_heartbeat", {
    p_job_id: jobId,
    p_progress: progress,
  });
  if (error) throw new Error(`heartbeat failed: ${error.message}`);
  if (data !== "running") throw new JobCancelledError(String(data));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── PDF helpers ─────────────────────────────────────────────────────────

async function downloadDocument(admin: SupabaseClient, documentId: string) {
  const { data: doc, error } = await admin
    .from("supplier_documents")
    .select("id, storage_path, file_size")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(`document lookup failed: ${error.message}`);
  if (!doc) throw new NonRetryableError("document_not_found");
  if (doc.file_size && doc.file_size > EDGE_MAX_PDF_BYTES) {
    throw new NonRetryableError(
      `檔案 ${(doc.file_size / 1024 / 1024).toFixed(1)}MB 超過 Edge 處理上限（${EDGE_MAX_PDF_BYTES / 1024 / 1024}MB），需先拆成較小的分段`,
    );
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from("supplier-documents")
    .download(doc.storage_path);
  if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message ?? "empty"}`);
  return new Uint8Array(await blob.arrayBuffer());
}

async function openPdfText(bytes: Uint8Array) {
  try {
    return await getDocumentProxy(bytes.slice(), {
      cMapUrl: `${PDFJS_ASSETS}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/`,
      disableFontFace: true,
      useSystemFonts: false,
      isEvalSupported: false,
    });
  } catch (err) {
    throw new NonRetryableError(`無法讀取 PDF：${err instanceof Error ? err.message : String(err)}`);
  }
}

async function closePdf(pdf: unknown) {
  const p = pdf as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> | void };
  try {
    if (typeof p.destroy === "function") await p.destroy();
    else if (typeof p.cleanup === "function") await p.cleanup();
  } catch {
    // releasing pdf.js memory is best-effort
  }
}

type TextContentItem = { str?: string; hasEOL?: boolean };

async function extractPageText(
  pdf: Awaited<ReturnType<typeof openPdfText>>,
  pageNo: number,
): Promise<string> {
  const page = await pdf.getPage(pageNo);
  const content = await page.getTextContent();
  let out = "";
  for (const item of content.items as TextContentItem[]) {
    if (typeof item.str !== "string") continue;
    out += item.str;
    out += item.hasEOL ? "\n" : " ";
  }
  page.cleanup();
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

type EmbeddedImage = { bytes: Uint8Array; width: number; height: number; area: number; jpeg: boolean };

function collectImages(doc: PDFDocument, resources: PDFDict | undefined, depth: number, out: EmbeddedImage[]) {
  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return;
  for (const [, ref] of xobjects.entries()) {
    const obj = doc.context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.lookup(PDFName.of("Subtype"));
    if (subtype === PDFName.of("Image")) {
      const filter = obj.dict.lookup(PDFName.of("Filter"));
      const filters = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
      const w = obj.dict.lookup(PDFName.of("Width"));
      const h = obj.dict.lookup(PDFName.of("Height"));
      const width = w instanceof PDFNumber ? w.asNumber() : 0;
      const height = h instanceof PDFNumber ? h.asNumber() : 0;
      out.push({
        bytes: obj.contents,
        width,
        height,
        area: width * height,
        jpeg: filters.length === 1 && filters[0] === PDFName.of("DCTDecode"),
      });
    } else if (subtype === PDFName.of("Form") && depth < 2) {
      collectImages(doc, obj.dict.lookupMaybe(PDFName.of("Resources"), PDFDict), depth + 1, out);
    }
  }
}

/** A scanned page is normally one big embedded JPEG; its raw stream is a valid .jpg. */
function pageImages(doc: PDFDocument, pageNo: number): EmbeddedImage[] {
  const page = doc.getPage(pageNo - 1);
  const out: EmbeddedImage[] = [];
  collectImages(doc, page.node.Resources(), 0, out);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── AI calls ────────────────────────────────────────────────────────────

const OCR_PROMPT = [
  "This is one page of a furniture supplier catalogue or price quotation (scanned).",
  "Transcribe ALL text on the page in natural reading order.",
  "Render tables as Markdown tables using | separators, one row per line.",
  "Keep model numbers, dimensions, units, prices and currency symbols exactly as printed.",
  "Keep Chinese text in its original characters; do not translate.",
  "Output only the transcription, no commentary.",
  "If the page has no readable text (e.g. only a photo), output exactly: NO_TEXT",
].join("\n");

/** Models sometimes describe an empty page instead of returning nothing. */
function isNoTextReply(text: string): boolean {
  const t = text.trim();
  return t === "" || /^NO_TEXT\.?$/i.test(t) ||
    (t.length < 80 && /\b(no|without)\b.*\b(text|readable)\b/i.test(t));
}

async function grokOcr(apiKey: string, model: string, jpeg: Uint8Array): Promise<{ text: string; tokens: number }> {
  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(jpeg)}`, detail: "high" } },
          { type: "text", text: OCR_PROMPT },
        ],
      }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Grok ${res.status}: ${body?.error?.message ?? body?.error ?? res.statusText}`);
  }
  const text = String(body?.choices?.[0]?.message?.content ?? "").trim();
  return { text: isNoTextReply(text) ? "" : text, tokens: Number(body?.usage?.total_tokens ?? 0) };
}

type Classification = {
  page: number;
  type: PageType;
  title: string | null;
  continues_previous: boolean;
  confidence: number | null;
};

const CLASSIFY_PROMPT = `You classify pages of a furniture supplier PDF (catalogue or price quotation).
For every page in "pages" return:
- page: the page number
- type: one of cover | toc | product | price_table | terms | other
  (product = product photos/specs; price_table = tabular price list; terms = payment/delivery/warranty conditions)
- title: short heading of the page (series name, product name or section) in the page's original language, or null
- continues_previous: true when this page continues the SAME product, series, table or section as the page before it
  (e.g. a price table that runs onto the next page, or one product spread over two pages). Use "previous_page" for the first page.
Pages marked "image_only" contain pictures but no readable text; in a catalogue they usually show the product
of the neighbouring pages, so judge them from their neighbours.
- confidence: 0 to 1
Return JSON: {"pages":[...]} with exactly one entry per input page.`;

async function geminiClassify(
  apiKey: string,
  pages: { page: number; text: string; imageOnly: boolean }[],
  previous: { page: number; type: string | null; title: string | null; text: string } | null,
): Promise<{ items: Classification[]; tokens: number }> {
  const input = {
    previous_page: previous,
    pages: pages.map((p) => (p.imageOnly
      ? { page: p.page, image_only: true }
      : { page: p.page, text: p.text.slice(0, CLASSIFY_TEXT_CHARS) })),
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CLASSIFY_PROMPT }] },
        contents: [{ parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body?.error?.message ?? res.statusText}`);

  const raw = String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  let parsed: { pages?: unknown[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const items: Classification[] = [];
  for (const entry of parsed.pages ?? []) {
    const e = entry as Record<string, unknown>;
    const page = Number(e.page);
    if (!Number.isInteger(page)) continue;
    const type = PAGE_TYPES.includes(e.type as PageType) ? e.type as PageType : "other";
    const confidence = Number(e.confidence);
    items.push({
      page,
      type,
      title: typeof e.title === "string" && e.title.trim() ? e.title.trim().slice(0, 300) : null,
      continues_previous: e.continues_previous === true,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
    });
  }
  return { items, tokens: Number(body?.usageMetadata?.totalTokenCount ?? 0) };
}

// ── parse_pdf phases ────────────────────────────────────────────────────

async function extractBatch(admin: SupabaseClient, job: Job, documentId: string, state: ParseState) {
  const bytes = await downloadDocument(admin, documentId);
  const pdf = await openPdfText(bytes);
  const last = Math.min(state.page_count, state.cursor + EXTRACT_BATCH - 1);
  const now = new Date().toISOString();

  const rows: PageRow[] = [];
  for (let pageNo = state.cursor; pageNo <= last; pageNo++) {
    const text = await extractPageText(pdf, pageNo);
    const chars = realCharCount(text);
    rows.push({
      document_id: documentId,
      job_id: job.id,
      page_no: pageNo,
      text_source: chars > 0 ? "text" : "none",
      content: text,
      char_count: chars,
      image_count: 0,
      ocr_status: "not_needed",
      ocr_error: null,
      updated_at: now,
    });
  }
  await closePdf(pdf);

  const scanned = rows.filter((r) => r.char_count < MIN_TEXT_CHARS);
  if (scanned.length > 0) {
    await heartbeat(admin, job.id, 0.05 + 0.75 * ((state.cursor - 1) / state.page_count));
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch (err) {
      throw new NonRetryableError(`無法讀取 PDF 圖片：${err instanceof Error ? err.message : String(err)}`);
    }
    const apiKey = Deno.env.get("XAI_API_KEY") ?? "";
    const model = Deno.env.get("XAI_OCR_MODEL") || "grok-4.7";

    await mapLimit(scanned, OCR_CONCURRENCY, async (row) => {
      const images = pageImages(doc, row.page_no);
      row.image_count = images.length;
      if (images.length === 0) return;

      const jpeg = images.filter((i) => i.jpeg).sort((a, b) => b.area - a.area)[0];
      if (!jpeg) {
        row.ocr_status = "unsupported";
        row.ocr_error = "掃描頁不是 JPEG 圖片，待 Python Worker 處理";
        return;
      }
      if (!apiKey) {
        row.ocr_status = "skipped";
        row.ocr_error = "XAI_API_KEY 未設定";
        return;
      }
      try {
        const { text, tokens } = await grokOcr(apiKey, model, jpeg.bytes);
        state.tokens += tokens;
        state.ocr_pages += 1;
        row.ocr_status = "done";
        if (realCharCount(text) > row.char_count) {
          row.content = text;
          row.char_count = realCharCount(text);
          row.text_source = "ocr";
        }
      } catch (err) {
        row.ocr_status = "failed";
        row.ocr_error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      }
    });
  }

  const { error } = await admin
    .from("supplier_document_pages")
    .upsert(rows, { onConflict: "document_id,page_no" });
  if (error) throw new Error(`page upsert failed: ${error.message}`);

  state.cursor = last + 1;
  if (state.cursor > state.page_count) {
    state.phase = "classify";
    state.cursor = 1;
  }
}

async function classifyBatch(admin: SupabaseClient, documentId: string, state: ParseState) {
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!apiKey) throw new NonRetryableError("GEMINI_API_KEY 未設定");

  const first = state.cursor;
  // Fold a short tail into this batch: a 1–4 page batch has little context to segment with.
  const tail = state.page_count - (first + CLASSIFY_BATCH - 1);
  const last = tail > 0 && tail < 5 ? state.page_count : Math.min(state.page_count, first + CLASSIFY_BATCH - 1);
  const { data: pages, error } = await admin
    .from("supplier_document_pages")
    .select("page_no, content, char_count, image_count, page_type, page_title")
    .eq("document_id", documentId)
    .gte("page_no", Math.max(1, first - 1))
    .lte("page_no", last)
    .order("page_no");
  if (error) throw new Error(`page read failed: ${error.message}`);

  const prevRow = first > 1 ? pages?.find((p) => p.page_no === first - 1) : undefined;
  const batch = (pages ?? []).filter((p) => p.page_no >= first);
  const previous = prevRow
    ? {
      page: prevRow.page_no,
      type: prevRow.page_type,
      title: prevRow.page_title,
      text: String(prevRow.content).slice(-500),
    }
    : null;

  const { items, tokens } = await geminiClassify(
    apiKey,
    batch.map((p) => ({
      page: p.page_no,
      text: String(p.content ?? ""),
      imageOnly: Number(p.char_count) < MIN_TEXT_CHARS && Number(p.image_count) > 0,
    })),
    previous,
  );
  state.tokens += tokens;

  const byPage = new Map(items.map((i) => [i.page, i]));
  const now = new Date().toISOString();
  await Promise.all(batch.map(async (p) => {
    const c = byPage.get(p.page_no);
    const { error: upErr } = await admin
      .from("supplier_document_pages")
      .update({
        page_type: c?.type ?? "other",
        page_title: c?.title ?? null,
        continues_previous: p.page_no === 1 ? false : (c?.continues_previous ?? false),
        classify_confidence: c?.confidence ?? null,
        updated_at: now,
      })
      .eq("document_id", documentId)
      .eq("page_no", p.page_no);
    if (upErr) throw new Error(`page classify update failed: ${upErr.message}`);
  }));

  state.cursor = last + 1;
}

// ── structure phase（T-301 / T-302 / T-303）──────────────────────────────

const ITEM_SCHEMA = {
  type: "OBJECT",
  properties: {
    page: { type: "INTEGER" },
    name: { type: "STRING" },
    model: { type: "STRING", nullable: true },
    series: { type: "STRING", nullable: true },
    category: { type: "STRING", nullable: true },
    width_mm: { type: "NUMBER", nullable: true },
    depth_mm: { type: "NUMBER", nullable: true },
    height_mm: { type: "NUMBER", nullable: true },
    dimensions_text: { type: "STRING", nullable: true },
    material: { type: "STRING", nullable: true },
    colors: { type: "ARRAY", items: { type: "STRING" } },
    description: { type: "STRING", nullable: true },
    unit: { type: "STRING", nullable: true },
    moq: { type: "NUMBER", nullable: true },
    price: { type: "NUMBER", nullable: true },
    price_text: { type: "STRING", nullable: true },
    currency: { type: "STRING", nullable: true },
    other_prices: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, price: { type: "NUMBER" } },
        required: ["label", "price"],
      },
    },
    valid_from: { type: "STRING", nullable: true },
    valid_to: { type: "STRING", nullable: true },
    lead_time_days: { type: "INTEGER", nullable: true },
    images: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { index: { type: "INTEGER" }, type: { type: "STRING", enum: [...IMAGE_TYPES] } },
        required: ["index", "type"],
      },
    },
    confidence: { type: "NUMBER" },
    uncertain_fields: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["page", "name", "confidence"],
};

const STRUCTURE_SCHEMA = {
  type: "OBJECT",
  properties: {
    currency_detected: { type: "STRING", nullable: true },
    items: { type: "ARRAY", items: ITEM_SCHEMA },
  },
  required: ["items"],
};

const STRUCTURE_PROMPT = `You extract furniture products from pages of a supplier PDF (catalogue or price quotation).
Rules:
- Extract only products that appear on the target "pages". "previous_page" is context only.
- One item per distinct model / SKU. If one model has several prices (finish, size, grade), put the first one in price
  and the others in other_prices with a short label.
- Never invent values: anything not printed is null. price must be a number printed on the page, and price_text must
  be copied exactly as printed (e.g. "¥3,280", "USD 199.00").
- currency: RMB for Chinese yuan (¥, 元, 人民幣), HKD, USD, EUR, etc. Use symbols or headers on these pages or the
  document context; null if unknown.
- Dimensions in millimetres: width_mm (W/L), depth_mm (D), height_mm (H). Convert cm or m to mm. Copy the printed
  size into dimensions_text.
- name and material in the original language. category in English (desk, meeting table, chair, sofa, cabinet, bookcase, ...).
- valid_from / valid_to as YYYY-MM-DD when printed here or in the document context.
- images: for each picture "IMAGE n" that shows this product give its index and type (main = clean product photo,
  detail, dimension = drawing with measurements, fabric = swatch, logo, other). A picture belongs to at most one product.
- confidence 0-1 for the whole item; list field names you are unsure about in uncertain_fields.`;

type StructuredItem = {
  page: number;
  name: string;
  model: string | null;
  series: string | null;
  category: string | null;
  width_mm: number | null;
  depth_mm: number | null;
  height_mm: number | null;
  dimensions_text: string | null;
  material: string | null;
  colors: string[];
  description: string | null;
  unit: string | null;
  moq: number | null;
  price: number | null;
  price_text: string | null;
  currency: string | null;
  other_prices: { label: string; price: number }[];
  valid_from: string | null;
  valid_to: string | null;
  lead_time_days: number | null;
  images: { index: number; type: typeof IMAGE_TYPES[number] }[];
  confidence: number;
  uncertain_fields: string[];
};

type UnitImage = { id: string; page_no: number; bytes: Uint8Array; area: number };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.\-]/g, "")) : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeItem(raw: Record<string, unknown>): StructuredItem {
  return {
    page: Number(raw.page) || 0,
    name: str(raw.name) ?? "",
    model: str(raw.model),
    series: str(raw.series),
    category: str(raw.category),
    width_mm: num(raw.width_mm),
    depth_mm: num(raw.depth_mm),
    height_mm: num(raw.height_mm),
    dimensions_text: str(raw.dimensions_text),
    material: str(raw.material),
    colors: Array.isArray(raw.colors) ? raw.colors.map(str).filter((c): c is string => !!c) : [],
    description: str(raw.description),
    unit: str(raw.unit),
    moq: num(raw.moq),
    price: num(raw.price),
    price_text: str(raw.price_text),
    currency: str(raw.currency)?.toUpperCase().replace("CNY", "RMB") ?? null,
    other_prices: Array.isArray(raw.other_prices)
      ? raw.other_prices
        .map((p) => ({ label: str((p as Record<string, unknown>).label) ?? "", price: num((p as Record<string, unknown>).price) }))
        .filter((p): p is { label: string; price: number } => p.price !== null)
      : [],
    valid_from: isoDate(raw.valid_from),
    valid_to: isoDate(raw.valid_to),
    lead_time_days: num(raw.lead_time_days),
    images: Array.isArray(raw.images)
      ? raw.images
        .map((i) => i as Record<string, unknown>)
        .filter((i) => Number.isInteger(Number(i.index)))
        .map((i) => ({
          index: Number(i.index),
          type: IMAGE_TYPES.includes(i.type as typeof IMAGE_TYPES[number]) ? i.type as typeof IMAGE_TYPES[number] : "other",
        }))
      : [],
    confidence: Math.min(1, Math.max(0, num(raw.confidence) ?? 0.5)),
    uncertain_fields: Array.isArray(raw.uncertain_fields) ? raw.uncertain_fields.map(String).slice(0, 20) : [],
  };
}

function priceAppearsInText(price: number, normalizedText: string): boolean {
  const candidates = new Set([String(price), price.toFixed(2), price.toFixed(0)]);
  for (const c of candidates) if (normalizedText.includes(c)) return true;
  return false;
}

/** T-302: rule checks on top of the model's own confidence. */
function assessItem(item: StructuredItem, pageText: string, docCurrency: string | null, isCatalog: boolean) {
  const flags: string[] = [];
  let confidence = item.confidence;
  const normalized = pageText.replace(/[,\s，]/g, "");

  if (!item.model) {
    flags.push("missing_model");
    confidence = Math.min(confidence, 0.6);
  }
  if (item.price === null) {
    // Catalogues often carry no prices; that is expected, not an extraction error.
    if (isCatalog) {
      flags.push("catalog_no_price");
    } else {
      flags.push("missing_price");
      confidence = Math.min(confidence, 0.5);
    }
  } else {
    if (!priceAppearsInText(item.price, normalized)) {
      flags.push("price_not_in_source");
      confidence = Math.min(confidence, 0.4);
    }
    if (!item.currency) flags.push(docCurrency ? "currency_from_document" : "currency_missing");
  }
  const dims = [item.width_mm, item.depth_mm, item.height_mm].filter((d): d is number => d !== null);
  if (dims.some((d) => d < 50 || d > 6000)) {
    flags.push("dimension_suspicious");
    confidence *= 0.8;
  }
  if (item.uncertain_fields.length > 0) flags.push("ai_uncertain");
  if (confidence < ATTENTION_CONFIDENCE) flags.push("low_confidence");

  const attention = confidence < ATTENTION_CONFIDENCE ||
    flags.some((f) => ["missing_price", "price_not_in_source", "missing_model", "currency_missing", "dimension_suspicious"].includes(f));
  return { flags, confidence: Math.round(confidence * 1000) / 1000, attention };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** T-303: store product-sized JPEGs from the unit's pages once per document; skip logos. */
async function collectUnitImages(
  admin: SupabaseClient,
  documentId: string,
  bytes: Uint8Array,
  textPages: number[],
): Promise<UnitImage[]> {
  if (textPages.length === 0) return [];
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return [];
  }

  const found = new Map<string, { page_no: number; pages: Set<number>; img: EmbeddedImage }>();
  for (const pageNo of textPages) {
    for (const img of pageImages(doc, pageNo)) {
      if (!img.jpeg || img.width < MIN_IMAGE_PX || img.height < MIN_IMAGE_PX) continue;
      if (img.bytes.length > MAX_INLINE_IMAGE_BYTES) continue;
      const hash = await sha256Hex(img.bytes);
      const seen = found.get(hash);
      if (seen) seen.pages.add(pageNo);
      else found.set(hash, { page_no: pageNo, pages: new Set([pageNo]), img });
    }
  }
  if (found.size === 0) return [];

  const hashes = [...found.keys()];
  const { data: existing, error } = await admin
    .from("supplier_document_images")
    .select("id, content_hash, page_no, page_occurrences, storage_path, public_url")
    .eq("document_id", documentId)
    .in("content_hash", hashes);
  if (error) throw new Error(`image lookup failed: ${error.message}`);
  const byHash = new Map((existing ?? []).map((r) => [r.content_hash as string, r]));

  const out: UnitImage[] = [];
  for (const [hash, { page_no, pages, img }] of found) {
    const row = byHash.get(hash);
    let storagePath = (row?.storage_path as string | undefined) ?? null;
    let publicUrl = (row?.public_url as string | undefined) ?? null;
    if (!row) {
      storagePath = `supplier-extracts/${documentId}/${hash}.jpg`;
      const { error: upErr } = await admin.storage
        .from("product-images")
        .upload(storagePath, img.bytes, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw new Error(`image upload failed: ${upErr.message}`);
      publicUrl = admin.storage.from("product-images").getPublicUrl(storagePath).data.publicUrl;
    }
    // The RPC merges these pages into the stored set (document + hash + page).
    // Replaying the same unit after a failed Gemini call adds nothing new, so
    // the occurrence count stays the same and a real product photo is never
    // promoted to a logo.
    const { data: recorded, error: recErr } = await admin.rpc("fds_supplier_document_image_record", {
      p_document_id: documentId,
      p_content_hash: hash,
      p_pages: [...pages],
      p_page_no: page_no,
      p_storage_path: storagePath,
      p_public_url: publicUrl,
      p_width: img.width,
      p_height: img.height,
      p_byte_size: img.bytes.length,
    });
    if (recErr) throw new Error(`image record failed: ${recErr.message}`);
    const rec = (recorded ?? {}) as { id?: string; page_occurrences?: number };
    if (!rec.id) throw new Error(`image record failed: no row for ${hash}`);
    const occurrences = Number(rec.page_occurrences ?? 0);
    if (occurrences >= LOGO_PAGE_OCCURRENCES) continue;
    out.push({ id: rec.id, page_no, bytes: img.bytes, area: img.area });
  }

  let budget = MAX_INLINE_TOTAL_BYTES;
  return out
    .sort((a, b) => a.page_no - b.page_no || b.area - a.area)
    .filter((img) => (budget -= img.bytes.length) >= 0)
    .slice(0, STRUCTURE_MAX_IMAGES);
}

async function geminiStructure(
  apiKey: string,
  input: unknown,
  images: UnitImage[],
): Promise<{ items: StructuredItem[]; currency: string | null; tokens: number }> {
  const parts: Record<string, unknown>[] = [{ text: JSON.stringify(input) }];
  images.forEach((img, i) => {
    parts.push({ text: `IMAGE ${i} (page ${img.page_no})` });
    parts.push({ inline_data: { mime_type: "image/jpeg", data: toBase64(img.bytes) } });
  });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: STRUCTURE_PROMPT }] },
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: STRUCTURE_SCHEMA,
          maxOutputTokens: 65536,
        },
      }),
      signal: AbortSignal.timeout(140_000),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body?.error?.message ?? res.statusText}`);
  if (body?.candidates?.[0]?.finishReason === "MAX_TOKENS") {
    throw new Error("Gemini output truncated (MAX_TOKENS)");
  }

  const raw = String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  let parsed: { items?: unknown[]; currency_detected?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${raw.slice(0, 200)}`);
  }
  return {
    items: (parsed.items ?? []).map((i) => normalizeItem(i as Record<string, unknown>)).filter((i) => i.name),
    currency: str(parsed.currency_detected)?.toUpperCase().replace("CNY", "RMB") ?? null,
    tokens: Number(body?.usageMetadata?.totalTokenCount ?? 0),
  };
}

function modelKey(model: unknown): string {
  return String(model ?? "").replace(/\s+/g, "").toLowerCase();
}

async function buildStructureUnits(admin: SupabaseClient, documentId: string): Promise<StructureUnit[]> {
  const [{ data: segments, error: segErr }, { data: pages, error: pageErr }] = await Promise.all([
    admin.from("supplier_document_segments").select("id, start_page, end_page, kind").eq("document_id", documentId).order("seq"),
    admin.from("supplier_document_pages").select("page_no, char_count").eq("document_id", documentId),
  ]);
  if (segErr || pageErr) throw new Error(`unit lookup failed: ${(segErr ?? pageErr)!.message}`);
  const chars = new Map((pages ?? []).map((p) => [p.page_no as number, Number(p.char_count)]));

  const units: StructureUnit[] = [];
  for (const s of segments ?? []) {
    if (!STRUCTURE_KINDS.includes(s.kind)) continue;
    let total = 0;
    for (let p = s.start_page; p <= s.end_page; p++) total += chars.get(p) ?? 0;
    if (total < MIN_TEXT_CHARS) continue;
    for (let start = s.start_page; start <= s.end_page; start += STRUCTURE_MAX_PAGES) {
      units.push({ segment_id: s.id, start, end: Math.min(s.end_page, start + STRUCTURE_MAX_PAGES - 1) });
    }
  }
  return units;
}

async function structureBatch(admin: SupabaseClient, job: Job, documentId: string, state: ParseState) {
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  if (!apiKey) throw new NonRetryableError("GEMINI_API_KEY 未設定");
  const unit = state.units![state.cursor];

  const [{ data: doc }, { data: pages, error: pageErr }, { data: contextPages }, { data: reviewed }] = await Promise.all([
    admin.from("supplier_documents").select("factory_name, currency, doc_type").eq("id", documentId).single(),
    admin.from("supplier_document_pages")
      .select("page_no, content, text_source")
      .eq("document_id", documentId)
      .gte("page_no", Math.max(1, unit.start - 1))
      .lte("page_no", unit.end)
      .order("page_no"),
    admin.from("supplier_document_pages")
      .select("content")
      .eq("document_id", documentId)
      .in("page_type", ["cover", "terms"])
      .order("page_no")
      .limit(4),
    admin.from("extraction_items").select("raw_json->>model").eq("document_id", documentId).neq("status", "pending"),
  ]);
  if (pageErr) throw new Error(`page read failed: ${pageErr.message}`);

  const target = (pages ?? []).filter((p) => p.page_no >= unit.start);
  const prev = (pages ?? []).find((p) => p.page_no === unit.start - 1);
  const docCurrency = (doc?.currency as string | null) ?? null;

  const textPages = target.filter((p) => p.text_source === "text").map((p) => p.page_no as number);
  const images = await collectUnitImages(admin, documentId, await downloadDocument(admin, documentId), textPages);
  await heartbeat(admin, job.id, progressOf(state));

  const { items, currency, tokens } = await geminiStructure(apiKey, {
    document: { factory: doc?.factory_name ?? "", doc_type: doc?.doc_type ?? "quote", currency: docCurrency },
    document_context: (contextPages ?? []).map((p) => String(p.content)).join("\n---\n").slice(0, 2500),
    previous_page: prev ? { page: prev.page_no, text: String(prev.content).slice(-800) } : null,
    pages: target.map((p) => ({ page: p.page_no, text: String(p.content).slice(0, 6000) })),
  }, images);
  state.tokens += tokens;

  const reviewedModels = new Set((reviewed ?? []).map((r) => modelKey((r as Record<string, unknown>).model)).filter(Boolean));
  const textByPage = new Map(target.map((p) => [p.page_no as number, String(p.content)]));
  const allText = target.map((p) => String(p.content)).join("\n");
  const now = new Date().toISOString();

  const rows = items
    .filter((item) => !item.model || !reviewedModels.has(modelKey(item.model)))
    .map((item, i) => {
      const page = item.page >= unit.start && item.page <= unit.end ? item.page : unit.start;
      const { flags, confidence, attention } = assessItem(
        item,
        textByPage.get(page) ?? allText,
        docCurrency,
        doc?.doc_type === "catalog",
      );
      const imageIds = item.images.map((ref) => images[ref.index]?.id).filter((id): id is string => !!id);
      const mainRef = item.images.find((ref) => ref.type === "main" && images[ref.index]);
      const cur = item.currency ?? currency;
      if (cur) state.currencies = { ...state.currencies, [cur]: (state.currencies?.[cur] ?? 0) + 1 };
      return {
        job_id: job.id,
        document_id: documentId,
        segment_id: unit.segment_id,
        seq: state.cursor * 1000 + i,
        // Same slot on a retry hits the unique key instead of inserting again.
        // The checkpoint is saved only after this write, so a failed batch repeats the unit.
        unit_item_key: `${documentId}:${unit.segment_id}:${unit.start}-${unit.end}:${i}`,
        page_no: page,
        raw_json: item,
        confidence,
        flags,
        needs_attention: attention,
        image_ids: [...new Set(imageIds)],
        main_image_id: mainRef ? images[mainRef.index].id : imageIds[0] ?? null,
        updated_at: now,
      };
    });

  if (rows.length > 0) {
    const { error } = await admin.from("extraction_items").upsert(rows, {
      onConflict: "unit_item_key",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`extraction insert failed: ${error.message}`);
  }

  const typed = items.flatMap((item) => item.images)
    .filter((ref) => images[ref.index] && ref.type !== "other");
  await Promise.all(typed.map((ref) =>
    admin.from("supplier_document_images").update({ image_type: ref.type }).eq("id", images[ref.index].id)
  ));

  state.cursor += 1;
}

/** Returns true when the job is finished, false when another batch is queued. */
async function handleParsePdf(admin: SupabaseClient, job: Job): Promise<boolean> {
  const documentId = job.document_id ?? String(job.payload.document_id ?? "");
  if (!documentId) throw new NonRetryableError("parse_pdf job has no document_id");

  const { data: head, error: headErr } = await admin
    .from("supplier_documents")
    .select("file_size, parent_document_id")
    .eq("id", documentId)
    .maybeSingle();
  if (headErr) throw new Error(`document lookup failed: ${headErr.message}`);
  if (!head) throw new NonRetryableError("document_not_found");
  if (head.file_size && Number(head.file_size) > EDGE_MAX_PDF_BYTES) {
    if (head.parent_document_id) {
      throw new NonRetryableError(
        `分段 ${(Number(head.file_size) / 1024 / 1024).toFixed(1)}MB 仍超過 Edge 上限（${EDGE_MAX_PDF_BYTES / 1024 / 1024}MB），無法再拆`,
      );
    }
    const { error: redirErr } = await admin.rpc("fds_supplier_document_redirect_to_split", {
      p_job_id: job.id,
    });
    if (redirErr) throw new NonRetryableError(redirErr.message);
    return true;
  }

  let state = job.payload.state as ParseState | undefined;
  if (!state) {
    const { error: delErr } = await admin.from("supplier_document_pages").delete().eq("document_id", documentId);
    if (delErr) throw new Error(`reset pages failed: ${delErr.message}`);
    await admin.from("supplier_document_segments").delete().eq("document_id", documentId);
    // Reviewed items stay; only unreviewed AI output is regenerated.
    const { error: itemErr } = await admin
      .from("extraction_items").delete().eq("document_id", documentId).eq("status", "pending");
    if (itemErr) throw new Error(`reset extraction items failed: ${itemErr.message}`);
    // Images stay (reviewed items point at them); occurrence counts are rebuilt by this run.
    const { error: imgErr } = await admin.rpc("fds_supplier_document_images_reset", {
      p_document_id: documentId,
    });
    if (imgErr) throw new Error(`reset document images failed: ${imgErr.message}`);

    const pdf = await openPdfText(await downloadDocument(admin, documentId));
    state = { phase: "extract", cursor: 1, page_count: pdf.numPages, tokens: 0, ocr_pages: 0 };
    await closePdf(pdf);
    await admin.from("supplier_documents").update({ page_count: state.page_count }).eq("id", documentId);
  }

  await heartbeat(admin, job.id, progressOf(state));

  if (state.phase === "extract") {
    await extractBatch(admin, job, documentId, state);
  } else if (state.phase === "classify") {
    await classifyBatch(admin, documentId, state);
    if (state.cursor > state.page_count) {
      const { data: segmentCount, error: segErr } = await admin.rpc("fds_supplier_document_build_segments", {
        p_document_id: documentId,
        p_job_id: job.id,
      });
      if (segErr) throw new Error(`build segments failed: ${segErr.message}`);
      state.segments = Number(segmentCount ?? 0);
      state.units = await buildStructureUnits(admin, documentId);
      state.phase = "structure";
      state.cursor = 0;
    }
  } else {
    await structureBatch(admin, job, documentId, state);
  }

  const finished = state.phase === "structure" && state.cursor >= (state.units?.length ?? 0);
  if (!finished) {
    const { data: ok, error } = await admin.rpc("fds_processing_job_checkpoint", {
      p_job_id: job.id,
      p_state: state,
      p_progress: progressOf(state),
    });
    if (error) throw new Error(`checkpoint failed: ${error.message}`);
    if (ok !== true) throw new JobCancelledError("not running");
    return false;
  }

  const { data: summary, error: finErr } = await admin.rpc("fds_extraction_items_finalize", {
    p_document_id: documentId,
  });
  if (finErr) throw new Error(`finalize failed: ${finErr.message}`);
  if (head.parent_document_id) {
    const { error: mergeErr } = await admin.rpc("fds_supplier_document_merge_part", {
      p_child_id: documentId,
    });
    if (mergeErr) throw new Error(`merge part failed: ${mergeErr.message}`);
  }
  const currencySuggestion = Object.entries(state.currencies ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const { data: pageStats } = await admin
    .from("supplier_document_pages")
    .select("ocr_status, text_source")
    .eq("document_id", documentId);
  const ocr: Record<string, number> = {};
  let emptyPages = 0;
  for (const p of pageStats ?? []) {
    if (p.ocr_status !== "not_needed") ocr[p.ocr_status] = (ocr[p.ocr_status] ?? 0) + 1;
    if (p.text_source === "none") emptyPages += 1;
  }

  const { data: done, error: doneErr } = await admin.rpc("fds_processing_job_complete", {
    p_job_id: job.id,
    p_result: {
      stage: "extracted",
      page_count: state.page_count,
      segments: state.segments ?? 0,
      units: state.units?.length ?? 0,
      items: Number(summary?.items ?? 0),
      needs_attention: Number(summary?.needsAttention ?? 0),
      currency_suggestion: currencySuggestion,
      ocr,
      empty_pages: emptyPages,
      worker: WORKER_NAME,
    },
    p_document_status: "review",
    p_pages: state.page_count,
    p_ocr_pages: state.ocr_pages,
    p_tokens: state.tokens,
  });
  if (doneErr) throw new Error(`complete failed: ${doneErr.message}`);
  if (done !== true) throw new JobCancelledError("not running");
  return true;
}

function progressOf(state: ParseState): number {
  if (state.phase === "structure") {
    const ratio = Math.min(1, state.cursor / Math.max(1, state.units?.length ?? 0));
    return 0.75 + 0.23 * ratio;
  }
  const ratio = Math.min(1, (state.cursor - 1) / Math.max(1, state.page_count));
  return state.phase === "extract" ? 0.05 + 0.55 * ratio : 0.6 + 0.15 * ratio;
}

async function runJob(admin: SupabaseClient, job: Job) {
  try {
    if (job.job_type === "generate_tripo") {
      try {
        const status = await runTripoJob(admin, job as Parameters<typeof runTripoJob>[1]);
        return { id: job.id, status };
      } catch (error) {
        if (error instanceof TripoStop) throw new NonRetryableError(error.message);
        throw error;
      }
    }
    if (job.job_type !== "parse_pdf") {
      throw new NonRetryableError(`unsupported job_type: ${job.job_type}`);
    }
    const finished = await handleParsePdf(admin, job);
    return { id: job.id, status: finished ? "succeeded" : "continued" };
  } catch (err) {
    if (err instanceof JobCancelledError) {
      return { id: job.id, status: "cancelled" };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process-jobs] job ${job.id} failed`, message);
    const { data } = await admin.rpc("fds_processing_job_fail", {
      p_job_id: job.id,
      p_error: message,
      p_retryable: !(err instanceof NonRetryableError),
    });
    return { id: job.id, status: String(data ?? "failed"), error: message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !anonKey || !serviceKey) {
    return jsonResponse({ error: "Supabase not configured" }, 500);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!(await isAuthorized(req, admin, url, anonKey, serviceKey))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // One batch per request keeps each invocation inside the Edge CPU budget.
  const { data: claimed, error } = await admin.rpc("fds_processing_jobs_claim", {
    p_job_types: JOB_TYPES,
    p_limit: 1,
    p_worker: WORKER_NAME,
  });
  if (error) {
    console.error("[process-jobs] claim failed", error.message);
    return jsonResponse({ error: error.message }, 500);
  }
  const job = (claimed as Job[] | null)?.[0];
  if (!job) {
    kickPdfSplit(admin);
    return jsonResponse({ processed: 0, results: [] });
  }

  const result = await runJob(admin, job);

  if (result.status === "continued") {
    // Chain the next batch now; pg_cron picks it up within a minute if this call is lost.
    EdgeRuntime.waitUntil(
      fetch(`${url}/functions/v1/supabase-functions-process-jobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ source: "chain" }),
      }).then((r) => r.body?.cancel()).catch((err) => console.warn("[process-jobs] chain failed", err)),
    );
  }

  kickPdfSplit(admin);
  return jsonResponse({ processed: 1, results: [result] });
});

const PDF_SPLIT_STALE_MS = 10 * 60 * 1000;

/** Notify the Vercel splitter when a needs_split job can be claimed. Does not claim it here. */
function kickPdfSplit(admin: SupabaseClient) {
  const splitUrl = (Deno.env.get("PDF_SPLIT_URL") ?? "").trim();
  const splitSecret = (Deno.env.get("PDF_SPLIT_SECRET") ?? "").trim();
  if (!splitUrl || !splitSecret) return;
  EdgeRuntime.waitUntil((async () => {
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - PDF_SPLIT_STALE_MS).toISOString();
    const queued = await admin
      .from("processing_jobs")
      .select("id")
      .eq("job_type", "needs_split")
      .eq("status", "queued")
      .lte("run_after", now)
      .limit(1);
    if (queued.error) {
      console.warn("[process-jobs] needs_split lookup failed", queued.error.message);
      return;
    }
    let ready = (queued.data?.length ?? 0) > 0;
    if (!ready) {
      const running = await admin
        .from("processing_jobs")
        .select("id")
        .eq("job_type", "needs_split")
        .eq("status", "running")
        .lt("heartbeat_at", stale)
        .limit(1);
      if (running.error) {
        console.warn("[process-jobs] needs_split lookup failed", running.error.message);
        return;
      }
      ready = (running.data?.length ?? 0) > 0;
    }
    if (!ready) return;
    const res = await fetch(splitUrl, {
      method: "POST",
      headers: {
        "x-pdf-split-secret": splitSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "process-jobs" }),
    });
    await res.body?.cancel();
  })().catch((err) => console.warn("[process-jobs] pdf-split kick failed", err)));
}
