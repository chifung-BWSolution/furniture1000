import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * 報價單「AI 生成參考圖」。
 *
 * 用 Grok（xAI）或 Gemini（Google）按文字描述生成一張室內示意圖，可帶最多 5 張
 * 產品圖的公開 URL 作參考（referenceUrls，AI 會把產品如實放進場景）；生成結果
 * 直接寫入公開 bucket `quote-photos` 與 `quote_photo_assets`（is_generated = true），
 * 前端再放進排版素材區。仍相容舊的 referenceAssetIds（圖片庫 asset id）。
 *
 * 兩個模型都走同一個 slug，前端用 { model: "grok" | "gemini" } 切換。
 * 權限跟圖片庫一致：只有 admin / uploader 可以生成（RLS 同樣會擋）。
 *
 * 注意：函數刻意不 import `_shared/*`，單檔上傳（scripts/deploy-edge-functions.ps1）
 * 也部署得起來，不必依賴 CLI 打包。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "quote-photos";
const LIBRARY_LIMIT = 60;
const MAX_BYTES = 15 * 1024 * 1024;
const PROMPT_MAX = 500;
const MAX_REFERENCES = 5;
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

const RATIOS = new Set(["1:1", "3:4", "4:3", "16:9", "9:16"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** Host allowlist for referenceUrls — only this project's public Storage buckets. */
function isAllowedReferenceUrl(raw: string, supabaseUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password) return false;
  let base: URL;
  try {
    base = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (parsed.host.toLowerCase() !== base.host.toLowerCase()) return false;
  // Only public object paths for product / quote photo buckets (no SSRF to other hosts).
  const path = parsed.pathname.replace(/\/+/g, "/");
  return /^\/storage\/v1\/object\/public\/(product-images|quote-photos)\//i.test(path);
}


/** xAI 圖像模型。可用 Edge secret XAI_IMAGE_MODEL 覆寫，不必重新部署。 */
const DEFAULT_XAI_IMAGE_MODEL = "grok-imagine-image-2.0";
/**
 * Gemini 圖像模型。Edge secret GEMINI_IMAGE_MODEL 優先；否則先試下面幾個已知 id，
 * 再退到 ListModels 找到的第一個 gemini 圖像模型。
 */
const DEFAULT_GEMINI_IMAGE_MODELS = [
  "gemini-3.8-flash-image",
  "gemini-3.8-image",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
];

type ModelId = "grok" | "gemini";

type GenerateBody = {
  model?: string;
  prompt?: string;
  aspectRatio?: string;
  /** 產品圖的公開 URL（product-images bucket 等），優先於 referenceAssetIds。 */
  referenceUrls?: string[];
  /** 舊參數：圖片庫 quote_photo_assets 的 asset id。 */
  referenceAssetIds?: string[];
};

type LibraryRow = { id: string; object_path: string | null; sort_order: number | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, status = 400, detail?: string) {
  if (detail) console.error(`[generate-quote-reference-image] ${code}: ${detail}`);
  return json({ error: code }, status);
}

function decodeBase64(value: string): Uint8Array {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(raw.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(bytes.subarray(from, to)));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** 分塊轉 base64：8MB 的圖一次 spread 會爆 call stack。 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function extensionFor(mimeType: string) {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

/** 由 ListModels 找可用的 Gemini 圖像模型，排在已知 id 之後當後備。 */
async function probeGeminiImageModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1000`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return [];
    const body = await response.json().catch(() => null) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    } | null;
    const names = (body?.models ?? [])
      .filter((model) => {
        const methods = model?.supportedGenerationMethods;
        return !Array.isArray(methods) || methods.includes("generateContent");
      })
      .map((model) => String(model?.name ?? "").replace(/^models\//, ""))
      // imagen-* 走 :predict，不是 generateContent。
      .filter((name) => /^gemini/i.test(name) && /image/i.test(name));
    const score = (name: string) =>
      (name.includes("3.8") ? 100 : 0) +
      (name.includes("flash-image") ? 20 : 0) +
      (/pro-image/.test(name) ? 10 : 0);
    return names.sort((a, b) => score(b) - score(a));
  } catch {
    return [];
  }
}

/** 生成一張圖，回傳原始 bytes。 */
async function generateWithGrok(
  apiKey: string,
  model: string,
  prompt: string,
  aspectRatio: string,
  referenceUrls: string[],
): Promise<Uint8Array> {
  const requestBody: Record<string, unknown> = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    resolution: "1k",
    quality: "low",
    response_format: "b64_json",
  };
  let endpoint = "https://api.x.ai/v1/images/generations";
  const references = referenceUrls.map((url) => ({ type: "image_url", url }));
  if (references.length === 1) {
    endpoint = "https://api.x.ai/v1/images/edits";
    requestBody.image = references[0];
  } else if (references.length > 1) {
    endpoint = "https://api.x.ai/v1/images/edits";
    requestBody.images = references;
  } else {
    requestBody.n = 1;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || /timed out/i.test(error.message));
    throw new Error(timedOut ? "quote_photo_generate_timeout" : "quote_photo_generate_failed");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const modelMissing = response.status === 404 || /model.*not found|does not exist/i.test(text);
    throw new Error(modelMissing ? "quote_photo_generate_no_model" : "quote_photo_generate_failed");
  }
  const body = await response.json().catch(() => null) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  } | null;
  const first = body?.data?.[0];
  if (first?.b64_json) return decodeBase64(first.b64_json);
  if (first?.url) {
    const file = await fetch(first.url, { signal: AbortSignal.timeout(30_000) });
    if (!file.ok) throw new Error("quote_photo_generate_failed");
    return new Uint8Array(await file.arrayBuffer());
  }
  throw new Error("quote_photo_generate_failed");
}

/** Gemini：generateContent + responseModalities IMAGE，回傳使用的模型與 inlineData 的 bytes。 */
async function generateWithGemini(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  references: Array<{ mimeType: string; data: string }>,
): Promise<{ bytes: Uint8Array; model: string }> {
  const override = (Deno.env.get("GEMINI_IMAGE_MODEL") ?? "").trim();
  const probed = override ? [] : await probeGeminiImageModels(apiKey);
  const candidates = [...new Set([override, ...DEFAULT_GEMINI_IMAGE_MODELS, ...probed].filter(Boolean))].slice(0, 5);

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const reference of references) {
    parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.data } });
  }

  let lastError = "quote_photo_generate_failed";
  for (const model of candidates) {
    // 3.x 用 imageConfig.aspectRatio；舊模型不認得就退回只帶 responseModalities。
    for (const withImageConfig of [true, false]) {
      const generationConfig: Record<string, unknown> = { responseModalities: ["TEXT", "IMAGE"] };
      if (withImageConfig) generationConfig.imageConfig = { aspectRatio };
      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
            signal: AbortSignal.timeout(120_000),
          },
        );
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || /timed out/i.test(error.message));
        throw new Error(timedOut ? "quote_photo_generate_timeout" : "quote_photo_generate_failed");
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const retryable =
          response.status === 404 ||
          /not found|not supported|does not support|imageConfig|responseModalities|INVALID_ARGUMENT/i.test(text);
        lastError = /imageConfig|responseModalities/i.test(text)
          ? "quote_photo_generate_config_retry"
          : response.status === 404
            ? "quote_photo_generate_no_model"
            : "quote_photo_generate_failed";
        if (withImageConfig && retryable) continue;
        if (retryable) break;
        throw new Error("quote_photo_generate_failed");
      }

      const body = await response.json().catch(() => null) as {
        candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
      } | null;
      const returned = body?.candidates?.[0]?.content?.parts ?? [];
      for (const part of returned) {
        const inline = (part?.inlineData ?? part?.inline_data) as { data?: string } | undefined;
        if (inline?.data) return { bytes: decodeBase64(inline.data), model };
      }
      lastError = "quote_photo_generate_failed";
      break;
    }
  }
  throw new Error(lastError === "quote_photo_generate_config_retry" ? "quote_photo_generate_no_model" : lastError);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!supabaseUrl || !anonKey || !authHeader) return json({ error: "unauthorized" }, 401);

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData } = await client.auth.getUser();
  if (!userData.user?.id) return json({ error: "unauthorized" }, 401);
  const { data: allowed } = await client.rpc("bwf_has_role", { p_roles: ["admin", "uploader"] });
  if (allowed !== true) return fail("quote_photo_generate_permission_denied", 403);

  let raw: GenerateBody;
  try {
    raw = await req.json();
  } catch {
    return fail("quote_photo_generate_invalid", 400, "invalid json");
  }
  if (!raw || typeof raw !== "object") return fail("quote_photo_generate_invalid", 400, "invalid body");

  const model: ModelId = raw.model === "gemini" ? "gemini" : "grok";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.replace(/\s+/g, " ").trim() : "";
  const aspectRatio = typeof raw.aspectRatio === "string" ? raw.aspectRatio : "";
  const referenceIds = Array.isArray(raw.referenceAssetIds)
    ? raw.referenceAssetIds.filter((id): id is string => typeof id === "string")
    : [];
  const rawReferenceUrls = Array.isArray(raw.referenceUrls)
    ? raw.referenceUrls.filter((url): url is string => typeof url === "string")
    : [];

  if (!prompt || prompt.length > PROMPT_MAX) return fail("quote_photo_generate_invalid", 400, "prompt");
  if (!RATIOS.has(aspectRatio)) return fail("quote_photo_generate_invalid", 400, "ratio");
  if (referenceIds.length > MAX_REFERENCES || rawReferenceUrls.length > MAX_REFERENCES) {
    return fail("quote_photo_generate_reference_limit", 400);
  }
  if (new Set(referenceIds).size !== referenceIds.length || referenceIds.some((id) => !UUID_PATTERN.test(id))) {
    return fail("quote_photo_generate_invalid", 400, "reference id");
  }

  // 參考圖片：產品圖直接用公開 URL；舊參數就由圖片庫 object path 組 URL。
  // xAI 可以直接拉 URL；Gemini 需要 inline base64。
  let referenceUrls: string[] = [];
  let referenceInline: Array<{ mimeType: string; data: string }> = [];
  if (rawReferenceUrls.length > 0) {
    if (
      new Set(rawReferenceUrls).size !== rawReferenceUrls.length ||
      rawReferenceUrls.some((url) => !isAllowedReferenceUrl(url, supabaseUrl))
    ) {
      return fail("quote_photo_generate_invalid", 400, "reference url");
    }
    referenceUrls = rawReferenceUrls.map((url) => url.trim());
  } else if (referenceIds.length > 0) {
    const { data: rows, error } = await client
      .from("quote_photo_assets")
      .select("id,object_path")
      .in("id", referenceIds);
    if (error) return fail("quote_photo_generate_reference_invalid", 400, error.message);
    const byId = new Map(((rows ?? []) as LibraryRow[]).map((row) => [row.id, row]));
    const urls: string[] = [];
    for (const id of referenceIds) {
      const row = byId.get(id);
      const path = (row?.object_path ?? "").trim();
      if (!path) return fail("quote_photo_generate_reference_invalid", 400, `unknown asset ${id}`);
      urls.push(`${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`);
    }
    referenceUrls = urls;
  }
  if (referenceUrls.length > 0 && model === "gemini") {
    for (const url of referenceUrls) {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!response?.ok) return fail("quote_photo_generate_reference_invalid", 400, "reference download failed");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_BYTES) {
        return fail("quote_photo_generate_reference_invalid", 400, "reference size");
      }
      referenceInline.push({
        mimeType: sniffImageType(bytes) ?? "image/jpeg",
        data: toBase64(bytes),
      });
    }
  }

  // 有產品圖時補上指令，令模型如實把參考圖中的產品放進場景。
  const composedPrompt =
    referenceUrls.length > 0
      ? `${prompt}。參考圖是產品圖：如實保留參考圖中每件產品的外觀、比例與顏色，把它們自然擺放進場景，不要改動產品設計，也不要加插參考圖以外的文字或商標`
      : prompt;

  // 生成
  let bytes: Uint8Array;
  let modelLabel: string;
  try {
    if (model === "grok") {
      const apiKey = (Deno.env.get("XAI_API_KEY") ?? "").trim();
      if (!apiKey) return fail("quote_photo_generate_unavailable", 500, "XAI_API_KEY missing");
      const modelId = (Deno.env.get("XAI_IMAGE_MODEL") ?? "").trim() || DEFAULT_XAI_IMAGE_MODEL;
      modelLabel = modelId;
      bytes = await generateWithGrok(apiKey, modelId, composedPrompt, aspectRatio, referenceUrls);
    } else {
      const apiKey = (Deno.env.get("GEMINI_API_KEY") ?? "").trim();
      if (!apiKey) return fail("quote_photo_generate_unavailable", 500, "GEMINI_API_KEY missing");
      const result = await generateWithGemini(apiKey, composedPrompt, aspectRatio, referenceInline);
      bytes = result.bytes;
      modelLabel = result.model;
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "quote_photo_generate_failed";
    if (code === "quote_photo_generate_no_model" || code === "quote_photo_generate_config_retry") {
      return fail("quote_photo_generate_unavailable", 502, code);
    }
    if (code === "quote_photo_generate_timeout") return fail(code, 504);
    console.error("[generate-quote-reference-image] provider error", code);
    return fail("quote_photo_generate_failed", 502, code);
  }

  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_BYTES) {
    return fail("quote_photo_generate_failed", 502, `bad image size ${bytes.byteLength}`);
  }
  const mimeType = sniffImageType(bytes);
  if (!mimeType) return fail("quote_photo_generate_failed", 502, "unsupported image bytes");

  // 入庫：跟手動上載走同一個 bucket／表，RLS 一樣生效。
  const { count } = await client
    .from("quote_photo_assets")
    .select("id", { count: "exact", head: true });
  if (typeof count === "number" && count >= LIBRARY_LIMIT) return fail("quote_photo_library_limit", 409);

  const objectPath = `library/${crypto.randomUUID()}.${extensionFor(mimeType)}`;
  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(objectPath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) return fail("quote_photo_generate_failed", 502, `upload: ${uploadError.message}`);

  const { data: top } = await client
    .from("quote_photo_assets")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSortOrder = (((top ?? []) as Array<{ sort_order: number | null }>)[0]?.sort_order ?? 0) + 1;

  // 標題取描述的第一個短語，避免把整句 prompt 當成圖片名稱顯示。
  const firstPhrase = prompt.split(/[。，、,.;；！？!?]/)[0].trim();
  const title = (firstPhrase || prompt).slice(0, 24) || "AI 參考圖";
  const { data: inserted, error: insertError } = await client
    .from("quote_photo_assets")
    .insert({
      title: title || "AI 參考圖",
      object_path: objectPath,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      sort_order: nextSortOrder,
      created_by: userData.user.id,
      is_generated: true,
    })
    .select("id,title,object_path,mime_type,size_bytes,sort_order,placement,is_active,is_generated")
    .single();

  if (insertError || !inserted) {
    await client.storage.from(BUCKET).remove([objectPath]);
    return fail("quote_photo_record_failed", 502, insertError?.message);
  }

  const row = inserted as Record<string, unknown>;
  return json({
    model: model === "gemini" ? "gemini" : "grok",
    modelId: modelLabel,
    asset: {
      id: row.id,
      title: row.title,
      objectPath: row.object_path,
      url: `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${row.object_path}`,
      sortOrder: row.sort_order,
      sizeBytes: row.size_bytes,
      placement: row.placement ?? "content",
      isActive: row.is_active !== false,
      isGenerated: true,
    },
  });
});
