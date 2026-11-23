import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import JSZip from "npm:jszip@3.10.1";
import { geminiThinkingConfig, resolveGeminiModel } from "../_shared/geminiModel.ts";
import { mapOfficialColors } from "../../../src/lib/officialColor.ts";

const BATCH_ROWS = 15;
const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 600;
const MIN_IMAGE_BYTES = 1500;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES_PER_BATCH = 15;
const PRODUCT_IMAGES_BUCKET = "product-images";

export type ExcelParseState = {
  phase: "structure";
  sheet_index: number;
  row_cursor: number;
  total_sheets: number;
  total_rows: number;
  tokens: number;
  images_uploaded?: boolean;
  currencies?: Record<string, number>;
};

type JobInput = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  document_id: string | null;
};

type ExtractedRow = {
  row_no: number;
  cells: string[];
};

type SheetData = {
  name: string;
  sheetIndex: number;
  headers: string[];
  rows: ExtractedRow[];
};

type GeminiExcelItem = {
  row_no: number;
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
  lead_time_days: number | null;
  confidence: number;
  uncertain_fields: string[];
};

const EXCEL_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    currency_detected: { type: "STRING", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          row_no: { type: "INTEGER" },
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
          lead_time_days: { type: "NUMBER", nullable: true },
          confidence: { type: "NUMBER" },
          uncertain_fields: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["row_no", "name", "confidence"],
      },
    },
  },
  required: ["items"],
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[^\d.\-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseWorkbook(bytes: Uint8Array): SheetData[] {
  const wb = XLSX.read(bytes, { type: "array", cellDates: false });
  const sheets: SheetData[] = [];

  for (let sIdx = 0; sIdx < Math.min(wb.SheetNames.length, MAX_SHEETS); sIdx += 1) {
    const name = wb.SheetNames[sIdx];
    const ws = wb.Sheets[name];
    if (!ws) continue;

    const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    if (rawMatrix.length === 0) continue;

    // Pick the first row with >= 2 non-empty cells as header context.
    let headerIdx = 0;
    for (let i = 0; i < Math.min(rawMatrix.length, 15); i += 1) {
      const nonEmpty = (rawMatrix[i] ?? []).filter((c) => String(c ?? "").trim().length > 0).length;
      if (nonEmpty >= 2) {
        headerIdx = i;
        break;
      }
    }

    const headers = (rawMatrix[headerIdx] ?? []).map((c) => String(c ?? "").trim().slice(0, 80));
    const rows: ExtractedRow[] = [];
    for (let i = headerIdx + 1; i < Math.min(rawMatrix.length, headerIdx + 1 + MAX_ROWS_PER_SHEET); i += 1) {
      const cells = (rawMatrix[i] ?? []).map((c) => String(c ?? "").trim().slice(0, 300));
      const nonEmpty = cells.filter((c) => c.length > 0);
      if (nonEmpty.length < 2) continue;
      rows.push({ row_no: i + 1, cells });
    }

    if (rows.length > 0) {
      sheets.push({ name, sheetIndex: sIdx + 1, headers, rows });
    }
  }
  return sheets;
}

/**
 * Extract embedded product images ONLY for the current sheet and row range
 * `[minRow, maxRow]` so large multi-sheet .xlsx workbooks stay well within
 * Edge Function CPU & memory limits. Uploads to public Storage (never base64).
 */
async function extractXlsxImagesForBatch(
  admin: SupabaseClient,
  documentId: string,
  bytes: Uint8Array,
  sheetNo: number,
  minRow: number,
  maxRow: number,
): Promise<Map<string, string[]>> {
  const rowImageMap = new Map<string, string[]>();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return rowImageMap;
  }

  // Resolve the exact drawing XML via xl/worksheets/_rels/sheet{sheetNo}.xml.rels first,
  // falling back to sorted xl/drawings/drawing*.xml when rels are absent.
  let drawingPath: string | null = null;
  const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetNo}.xml.rels`;
  if (zip.files[sheetRelsPath]) {
    const sheetRelsXml = await zip.files[sheetRelsPath].async("string");
    const drawMatch = sheetRelsXml.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/i);
    if (drawMatch) {
      drawingPath = drawMatch[1].replace(/^\.\.\//, "xl/");
    }
  }
  if (!drawingPath || !zip.files[drawingPath]) {
    const drawingFiles = Object.keys(zip.files)
      .filter((p) => /^xl\/drawings\/drawing\d+\.xml$/i.test(p))
      .sort();
    drawingPath = drawingFiles[sheetNo - 1] ?? null;
  }
  if (!drawingPath || !zip.files[drawingPath]) return rowImageMap;

  const drawingNumMatch = drawingPath.match(/drawing(\d+)\.xml$/i);
  const relsPath = drawingNumMatch
    ? `xl/drawings/_rels/drawing${drawingNumMatch[1]}.xml.rels`
    : null;
  const relsXml = relsPath && zip.files[relsPath] ? await zip.files[relsPath].async("string") : "";

  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
    const target = m[2].replace(/^\.\.\//, "xl/");
    relTargets.set(m[1], target);
  }

  const drawingXml = await zip.files[drawingPath].async("string");
  const anchorBlocks =
    drawingXml.match(/<xdr:(?:twoCellAnchor|oneCellAnchor)[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g) ?? [];

  const uploadedCache = new Map<string, string>();
  let uploadedCount = 0;

  for (const block of anchorBlocks) {
    if (uploadedCount >= MAX_IMAGES_PER_BATCH) break;
    const fromRowMatch = block.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    const embedMatch = block.match(/r:embed="(rId\d+)"/);
    if (!fromRowMatch || !embedMatch) continue;
    const row1Based = Number(fromRowMatch[1]) + 1;
    if (row1Based < minRow - 1 || row1Based > maxRow + 1) continue;

    const mediaPath = relTargets.get(embedMatch[1]);
    if (!mediaPath || !zip.files[mediaPath]) continue;

    const extMatch = mediaPath.match(/\.(jpe?g|png|webp)$/i);
    if (!extMatch) continue;
    const ext = extMatch[1].toLowerCase() === "jpeg" ? "jpg" : extMatch[1].toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

    const imgBytes = await zip.files[mediaPath].async("uint8array");
    if (imgBytes.byteLength < MIN_IMAGE_BYTES || imgBytes.byteLength > MAX_IMAGE_BYTES) continue;

    const hash = await sha256Hex(imgBytes);
    let imageId = uploadedCache.get(hash);
    if (!imageId) {
      const storagePath = `supplier-extracts/${documentId}/${hash}.${ext}`;
      const { error: upErr } = await admin.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(storagePath, imgBytes, { contentType: mime, upsert: true });
      if (upErr) continue;

      const { data: pub } = admin.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(storagePath);
      const { data: recId, error: recErr } = await admin.rpc("fds_supplier_document_image_record", {
        p_document_id: documentId,
        p_page_no: sheetNo,
        p_storage_path: storagePath,
        p_public_url: pub.publicUrl,
        p_width: null,
        p_height: null,
        p_byte_size: imgBytes.byteLength,
        p_content_hash: hash,
        p_image_type: "main",
      });
      if (recErr || !recId) continue;
      imageId = String(recId);
      uploadedCache.set(hash, imageId);
      uploadedCount += 1;
    }

    const key = `${sheetNo}:${row1Based}`;
    const list = rowImageMap.get(key) ?? [];
    if (!list.includes(imageId)) list.push(imageId);
    rowImageMap.set(key, list);
  }

  return rowImageMap;
}

async function structureExcelRowsWithGemini(input: {
  apiKey: string;
  factoryName: string;
  docType: string;
  sheetName: string;
  headers: string[];
  rows: ExtractedRow[];
}): Promise<{ items: GeminiExcelItem[]; currency: string | null; tokens: number }> {
  const model = resolveGeminiModel();
  const prompt = [
    "你是傢俬供應商報價單／產品清單結構化抽取助手。",
    "請將以下 Excel 工作表的資料列轉為標準傢俬產品 JSON（items）。",
    "規則：",
    "1. 只抽取真正的傢俬產品／報價行；跳過匯總、運費說明、備註、分類標題行。",
    "2. row_no 必須對應輸入的 row_no。",
    "3. 尺寸請統一換算為 mm（width_mm, depth_mm, height_mm），同時保留原文於 dimensions_text。",
    "4. price 必須是數字單價（成本價／出廠價），currency 統一用 RMB / HKD / USD（CNY 轉 RMB）。",
    "5. 不可憑空編造未出現的型號或價格；不確定欄位放入 uncertain_fields 並降低 confidence（0~1）。",
  ].join("\n");

  const payloadText = JSON.stringify({
    factory: input.factoryName,
    doc_type: input.docType,
    sheet_name: input.sheetName,
    headers: input.headers,
    rows: input.rows,
  });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${prompt}\n\n${payloadText}` }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: EXCEL_RESPONSE_SCHEMA,
          ...geminiThinkingConfig(model),
        },
      }),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${body?.error?.message ?? res.statusText}`);
  }
  const raw = String(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  let parsed: { items?: unknown[]; currency_detected?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini invalid JSON: ${raw.slice(0, 200)}`);
  }

  const items: GeminiExcelItem[] = (parsed.items ?? [])
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        row_no: Number(rec.row_no) || 0,
        name: str(rec.name) ?? "",
        model: str(rec.model),
        series: str(rec.series),
        category: str(rec.category),
        width_mm: num(rec.width_mm),
        depth_mm: num(rec.depth_mm),
        height_mm: num(rec.height_mm),
        dimensions_text: str(rec.dimensions_text),
        material: str(rec.material),
        colors: Array.isArray(rec.colors) ? rec.colors.map(str).filter((c): c is string => !!c) : [],
        description: str(rec.description),
        unit: str(rec.unit),
        moq: num(rec.moq),
        price: num(rec.price),
        price_text: str(rec.price_text),
        currency: str(rec.currency)?.toUpperCase().replace("CNY", "RMB") ?? null,
        lead_time_days: num(rec.lead_time_days),
        confidence: Math.min(1, Math.max(0, num(rec.confidence) ?? 0.6)),
        uncertain_fields: Array.isArray(rec.uncertain_fields) ? rec.uncertain_fields.map(String).slice(0, 20) : [],
      };
    })
    .filter((i) => i.name.length > 0);

  return {
    items,
    currency: str(parsed.currency_detected)?.toUpperCase().replace("CNY", "RMB") ?? null,
    tokens: Number(body?.usageMetadata?.totalTokenCount ?? 0),
  };
}

/**
 * Handles one batch of a `parse_excel` job.
 * Returns true when finished, false when checkpointed for another batch.
 */
export async function handleParseExcel(
  admin: SupabaseClient,
  job: JobInput,
  workerName: string,
): Promise<boolean> {
  const documentId = job.document_id ?? String(job.payload.document_id ?? "");
  if (!documentId) throw new Error("parse_excel job has no document_id");

  const apiKey = (Deno.env.get("GEMINI_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY 未設定");

  const { data: doc, error: docErr } = await admin
    .from("supplier_documents")
    .select("id, storage_path, factory_id, factory_name, currency, doc_type, document_year")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr) throw new Error(`document lookup failed: ${docErr.message}`);
  if (!doc?.storage_path) throw new Error("document_not_found");

  const { data: blob, error: dlErr } = await admin.storage
    .from("supplier-documents")
    .download(doc.storage_path);
  if (dlErr || !blob) throw new Error(`excel download failed: ${dlErr?.message ?? "empty"}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const sheets = parseWorkbook(bytes);
  let state = job.payload.state as ExcelParseState | undefined;

  if (!state) {
    await admin.from("extraction_items").delete().eq("document_id", documentId).eq("status", "pending");
    await admin.rpc("fds_supplier_document_images_reset", { p_document_id: documentId });
    const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
    state = {
      phase: "structure",
      sheet_index: 0,
      row_cursor: 0,
      total_sheets: sheets.length,
      total_rows: totalRows,
      tokens: 0,
      images_uploaded: false,
      currencies: {},
    };
    await admin.from("supplier_documents").update({ page_count: Math.max(1, sheets.length) }).eq("id", documentId);
  }

  job.payload.state = state;

  const sheet = sheets[state.sheet_index];
  if (sheet) {
    const batch = sheet.rows.slice(state.row_cursor, state.row_cursor + BATCH_ROWS);
    if (batch.length > 0) {
      let rowImageMap = new Map<string, string[]>();
      const isXlsx = String(doc.storage_path).toLowerCase().endsWith(".xlsx");
      if (isXlsx) {
        const minRow = batch[0].row_no;
        const maxRow = batch[batch.length - 1].row_no;
        rowImageMap = await extractXlsxImagesForBatch(admin, documentId, bytes, sheet.sheetIndex, minRow, maxRow);
      }

      const { items, currency, tokens } = await structureExcelRowsWithGemini({
        apiKey,
        factoryName: String(doc.factory_name ?? ""),
        docType: String(doc.doc_type ?? "quote"),
        sheetName: sheet.name,
        headers: sheet.headers,
        rows: batch,
      });
      state.tokens += tokens;

      const now = new Date().toISOString();
      const rowsToUpsert = items.map((item, i) => {
        const cur = item.currency ?? currency ?? (doc.currency as string | null) ?? null;
        if (cur) {
          state!.currencies = { ...state!.currencies, [cur]: (state!.currencies?.[cur] ?? 0) + 1 };
        }
        const mappedColors = mapOfficialColors(item.colors);
        // Match embedded image anchored on this row (or ±1 row tolerance for merged cells).
        const imgIds =
          rowImageMap.get(`${sheet.sheetIndex}:${item.row_no}`) ??
          rowImageMap.get(`${sheet.sheetIndex}:${item.row_no - 1}`) ??
          rowImageMap.get(`${sheet.sheetIndex}:${item.row_no + 1}`) ??
          [];

        const flags: string[] = [];
        let confidence = item.confidence;
        if (item.price === null || item.price <= 0) {
          flags.push(doc.doc_type === "catalog" ? "catalog_no_price" : "missing_price");
          confidence -= doc.doc_type === "catalog" ? 0.25 : 0.30;
        }
        if (!item.model) {
          flags.push("missing_model");
          confidence -= 0.25;
        }
        if (imgIds.length === 0) {
          flags.push("missing_image");
          confidence -= 0.25;
        }
        const missingDims =
          (item.width_mm === null ? 1 : 0) +
          (item.depth_mm === null ? 1 : 0) +
          (item.height_mm === null ? 1 : 0);
        if (missingDims > 0) {
          flags.push("missing_dimension");
          confidence -= missingDims === 1 ? 0.10 : missingDims === 2 ? 0.15 : 0.20;
        }
        if (item.uncertain_fields.length > 0) {
          flags.push("ai_uncertain");
          confidence -= 0.05;
        }
        if (mappedColors.unmapped.length > 0) {
          flags.push("color_unmapped");
          confidence -= 0.05;
        }
        confidence = Math.max(0.10, Math.min(1, confidence));
        if (confidence < 0.7) flags.push("low_confidence");
        const needsAttention = confidence < 0.7 || flags.length > 0;

        return {
          job_id: job.id,
          document_id: documentId,
          segment_id: null,
          seq: state!.sheet_index * 10000 + state!.row_cursor + i,
          unit_item_key: `${documentId}:excel:${sheet.sheetIndex}:${item.row_no}:${i}`,
          page_no: sheet.sheetIndex,
          raw_json: {
            page: sheet.sheetIndex,
            sheet_name: sheet.name,
            row_no: item.row_no,
            name: item.name,
            model: item.model,
            series: item.series,
            category: item.category,
            width_mm: item.width_mm,
            depth_mm: item.depth_mm,
            height_mm: item.height_mm,
            dimensions_text: item.dimensions_text,
            material: item.material,
            colors: mappedColors.colors,
            original_colors: mappedColors.original_colors,
            custom_order: mappedColors.custom_order,
            description: item.description,
            unit: item.unit,
            moq: item.moq,
            price: item.price,
            price_text: item.price_text,
            currency: cur,
            other_prices: [],
            valid_from: null,
            valid_to: null,
            lead_time_days: item.lead_time_days,
            images: [],
            confidence: item.confidence,
            uncertain_fields: item.uncertain_fields,
          },
          confidence: Math.round(confidence * 1000) / 1000,
          flags,
          needs_attention: needsAttention,
          image_ids: imgIds,
          main_image_id: imgIds[0] ?? null,
          updated_at: now,
        };
      });

      if (rowsToUpsert.length > 0) {
        const { error: insErr } = await admin.from("extraction_items").upsert(rowsToUpsert, {
          onConflict: "unit_item_key",
          ignoreDuplicates: true,
        });
        if (insErr) throw new Error(`excel extraction insert failed: ${insErr.message}`);
      }
    }

    state.row_cursor += BATCH_ROWS;
    if (state.row_cursor >= sheet.rows.length) {
      state.sheet_index += 1;
      state.row_cursor = 0;
    }
  }

  const finished = state.sheet_index >= sheets.length;
  if (!finished) {
    const doneRows =
      sheets.slice(0, state.sheet_index).reduce((sum, s) => sum + s.rows.length, 0) + state.row_cursor;
    const progress = Math.min(0.95, 0.1 + 0.85 * (doneRows / Math.max(1, state.total_rows)));
    const { data: ok, error } = await admin.rpc("fds_processing_job_checkpoint", {
      p_job_id: job.id,
      p_state: state,
      p_progress: progress,
    });
    if (error) throw new Error(`excel checkpoint failed: ${error.message}`);
    if (ok !== true) throw new Error("cancelled");
    return false;
  }

  const { data: summary, error: finErr } = await admin.rpc("fds_extraction_items_finalize", {
    p_document_id: documentId,
  });
  if (finErr) throw new Error(`finalize failed: ${finErr.message}`);

  const { data: autoImport, error: autoErr } = await admin.rpc("fds_auto_import_clear_extractions", {
    p_document_id: documentId,
  });
  if (autoErr) throw new Error(`auto import failed: ${autoErr.message}`);

  const currencySuggestion = Object.entries(state.currencies ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const pendingRemaining = Number((autoImport as { pending?: number } | null)?.pending ?? 1);
  const { data: done, error: doneErr } = await admin.rpc("fds_processing_job_complete", {
    p_job_id: job.id,
    p_result: {
      stage: "extracted",
      format: "excel",
      page_count: Math.max(1, sheets.length),
      items: Number(summary?.items ?? 0),
      needs_attention: Number(summary?.needsAttention ?? 0),
      auto_import: autoImport ?? null,
      currency_suggestion: currencySuggestion,
      worker: workerName,
    },
    p_document_status: pendingRemaining === 0 ? "ready" : "review",
    p_pages: Math.max(1, sheets.length),
    p_ocr_pages: 0,
    p_tokens: state.tokens,
  });
  if (doneErr) throw new Error(`complete failed: ${doneErr.message}`);
  if (done !== true) throw new Error("cancelled");
  return true;
}
