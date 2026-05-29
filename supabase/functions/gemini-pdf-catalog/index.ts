import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * gemini-pdf-catalog  (V7 — Skip Server-Side Cropping + 150s Idle Timeout Fix)
 * ──────────────────────────────────────────────────────────────────────────────
 * Two modes:
 *  A) BATCH MODE (preferred for large PDFs):
 *     Frontend sends { files, model, tags_list, start_page, end_page, upload_session_id }
 *     Edge function processes ONLY the specified page range, extracts bounding boxes,
 *     and returns products with bbox coordinates for frontend to crop.
 *     Server-side cropping is SKIPPED when frontend handles it (page_images not sent).
 *
 *  B) LEGACY MODE (backward compat):
 *     Frontend sends { files, model, tags_list } without page range.
 *     Edge function auto-chunks internally (V3 behavior).
 */

// ─── Constants ───────────────────────────────────────────────
const PAGES_PER_CHUNK = 5; // legacy internal chunking
const MAX_RETRIES = 2;
const MAX_SINGLE_PAYLOAD_BYTES = 10 * 1024 * 1024;
const RETRY_BASE_DELAY_MS = 2000;
// V7: Reduced from 60s to 100s — Supabase enforces a 150s idle timeout, so we need
// the entire request (parse + Gemini call + response build) to complete within 150s.
// 100s for Gemini + ~10s overhead = ~110s worst case, well under 150s.
const GEMINI_FETCH_TIMEOUT_MS = 100_000;
const INTER_CHUNK_DELAY_MS = 1000;
const WALL_CLOCK_LIMIT_MS = 360_000;
const WALL_CLOCK_BUFFER_MS = 30_000;

// ─── Helpers ─────────────────────────────────────────────────

/** Estimate base64 decoded byte size (≈ 75% of string length) */
function estimateBase64Bytes(b64: string): number {
  return Math.ceil((b64.length * 3) / 4);
}

/** Format bytes for logging */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Log memory usage at a checkpoint */
function logMemory(label: string): void {
  try {
    // deno-lint-ignore no-explicit-any
    const mem = (Deno as any).memoryUsage?.();
    if (mem) {
      console.log(
        `[gemini-pdf-catalog] Memory [${label}]: rss=${formatBytes(mem.rss)}, heapUsed=${formatBytes(mem.heapUsed)}`
      );
    }
  } catch {
    // memoryUsage not available
  }
}

/** Build the catalog prompt for a specific page range */
function buildCatalogPrompt(
  tagsList: string,
  pageStart?: number,
  pageEnd?: number
): string {
  const pageContext =
    pageStart !== undefined && pageEnd !== undefined
      ? `\nYou are analyzing PAGES ${pageStart}–${pageEnd} of this catalog. ONLY extract products that appear on these pages. Ignore products on other pages.\n`
      : "";

  return `You are a JSON-only extraction engine and SPATIAL SURVEYOR. Never include apologies, conversational text, or markdown code blocks. Start your response with { and end with }. Do NOT wrap output in \`\`\`json or any other markers.

You are a senior product analyst for BrandingWorks, a premium Hong Kong furniture & office equipment distributor. You are given a PDF catalog (and/or product images) that may contain MULTIPLE individual furniture products per page (commonly 6–16 items per page in a grid layout).
${pageContext}
YOUR TASK: Follow this 3-step process for EVERY page${pageContext ? " in the specified range" : ""}:

═══════════════════════════════════════════════════════════════
STEP 1: GRID STRUCTURE SCAN (MANDATORY FIRST STEP)
═══════════════════════════════════════════════════════════════

Before extracting any products, you MUST first analyze the page layout:
1. Identify the grid structure of the page (e.g., "3x3", "3x4", "4x4", "2x3", "irregular").
2. Count the total number of DISTINCT product cells visible. Product layouts vary widely:
   - Small catalogs: 2×2 (4 products), 2×3 (6 products), 3×3 (9 products)
   - Medium catalogs: 3×4 (12 products), 4×3 (12 products)
   - Dense catalogs: 4×4 (16 products), 4×5 (20 products)
3. Report this in the "grid_structure" field of your response (e.g. "3x4" for 3 columns × 4 rows).
4. The grid may have a header/banner row — do NOT count header/banner areas as product cells.
5. ALSO report "grid_cols" (number of columns) and "grid_rows" (number of rows) as separate integer fields.

═══════════════════════════════════════════════════════════════
STEP 2: PER-CELL BOUNDING BOX MAPPING — YOU ARE A SPATIAL SURVEYOR
═══════════════════════════════════════════════════════════════

CRITICAL INSTRUCTION: For EACH product identified in the grid, you MUST provide a bounding_box in the format [ymin, xmin, ymax, xmax] using a 0-1000 scale. DO NOT SKIP THIS. Every product MUST have a bounding_box array.

The bounding_box must strictly encircle the product IMAGE ONLY, excluding the model number text below it.

For EACH product cell identified in Step 1, define a bounding_box that:
- Tightly encompasses ONLY the furniture item and its immediate white space
- Does NOT include text labels, model numbers, or price tags below/beside the product
- Focuses on the PRODUCT IMAGE area only
- All coordinates are on a 0–1000 normalized scale relative to the FULL PAGE regardless of grid density

MANDATORY GRID COORDINATE FORMULA — USE THIS FOR EVERY PRODUCT:
For a grid with C columns and R rows, each cell's bounding_box MUST be:
  - Cell at row r (0-indexed), column c (0-indexed):
    ymin = Math.round((r / R) * 1000) + 20
    xmin = Math.round((c / C) * 1000) + 20
    ymax = Math.round(((r + 1) / R) * 1000) - 40
    xmax = Math.round(((c + 1) / C) * 1000) - 20
  
  The -40 on ymax accounts for text/labels below the product image.
  The 20 unit margins exclude cell borders.

WORKED EXAMPLES — MEMORIZE THESE PATTERNS:

  3×4 grid (3 cols × 4 rows = 12 products):
    Cell size: ~333 wide × 250 tall
    r0c0: [20, 20, 210, 313]    r0c1: [20, 353, 210, 646]    r0c2: [20, 686, 210, 980]
    r1c0: [270, 20, 460, 313]   r1c1: [270, 353, 460, 646]   r1c2: [270, 686, 460, 980]
    r2c0: [520, 20, 710, 313]   r2c1: [520, 353, 710, 646]   r2c2: [520, 686, 710, 980]
    r3c0: [770, 20, 960, 313]   r3c1: [770, 353, 960, 646]   r3c2: [770, 686, 960, 980]

  3×3 grid (9 products):
    Cell size: ~333 × 333
    r0c0: [20, 20, 293, 313]    r0c1: [20, 353, 293, 646]    r0c2: [20, 686, 293, 980]
    r1c0: [353, 20, 626, 313]   r1c1: [353, 353, 626, 646]   r1c2: [353, 686, 626, 980]
    r2c0: [686, 20, 960, 313]   r2c1: [686, 353, 960, 646]   r2c2: [686, 686, 960, 980]

  4×4 grid (16 products):
    Cell size: ~250 × 250
    r0c0: [20, 20, 210, 230]    r0c1: [20, 270, 210, 480]    r0c2: [20, 520, 210, 730]    r0c3: [20, 770, 210, 980]
    r1c0: [270, 20, 460, 230]   r1c1: [270, 270, 460, 480]   r1c2: [270, 520, 460, 730]   r1c3: [270, 770, 460, 980]
    ...etc

ABSOLUTE RULES:
1. Your ENTIRE response must be a single valid JSON object starting with { and ending with }.
2. NEVER include any text outside the JSON object — no greetings, no apologies, no explanations, no markdown.
3. If the catalog page has N items in a grid, you MUST return N separate product objects with N DIFFERENT bounding boxes. Do NOT merge or skip items.
4. Each product in the catalog that has its own image/listing is a SEPARATE item.
5. If an item appears in multiple colorways/variants on the same page, treat it as ONE product with noted variants.
6. For items where you can see a model number, include it in the title.
7. If you cannot extract any products, return: {"products": [], "total_items_found": 0, "catalog_summary": "No products found", "grid_structure": "none", "grid_cols": 0, "grid_rows": 0}
8. EVERY product MUST have a bounding_box with 4 integers — do NOT return null unless image_type is "lifestyle_only".

═══════════════════════════════════════════════════════════════
STEP 3: COORDINATE ACCURACY VERIFICATION (SELF-CHECK)
═══════════════════════════════════════════════════════════════

Before finalizing, verify EACH bounding_box:
✓ Format is [ymin, xmin, ymax, xmax] — exactly 4 integers, 0–1000 scale
✓ ymin < ymax AND xmin < xmax (not inverted)
✓ NO two products share the same bounding_box
✓ Each box width (xmax-xmin) and height (ymax-ymin) is proportional to 1000/cols and 1000/rows respectively
✓ For 3x4 grid: each box should be roughly 250-333 wide and 200-250 tall
✓ For 4x4 grid: each box should be roughly 200-250 wide and 200-250 tall
✓ NEVER return a box wider than 500 units or taller than 400 units for grids with 3+ columns/rows
✓ NEVER return a string for bounding_box — ONLY [int, int, int, int] or null

BOUNDING BOX FORMAT — ABSOLUTE REQUIREMENT:
- The bounding_box field MUST be an array of exactly 4 INTEGERS: [ymin, xmin, ymax, xmax].
- NEVER return text descriptions like "top left", "center of page", "top lifestyle image", or any string in the bounding_box field.
- If you cannot determine the exact position, USE THE GRID FORMULA above with the product's row and column.
- If you truly cannot find any clear product photo, set bounding_box to null AND image_type to "lifestyle_only".
- VALID examples: [20, 353, 210, 646], [270, 20, 460, 313], null (only for lifestyle_only)
- INVALID examples: "top left", "center", "row 2 col 1", "top lifestyle image", [0, 0, 1000, 1000]

BACKGROUND DISCRIMINATION — IMAGE SELECTION RULES:
- ONLY select photos that show a SINGLE product unit on a clean, solid-color background (white, gray, transparent, or any uniform backdrop).
- Product cutouts, studio shots, and catalog-style product-on-white-background photos are IDEAL.
- STRICTLY EXCLUDE these types of images:
  * Lifestyle/scene photos showing products in real rooms, offices, classrooms, or any furnished environment
  * Group photos with multiple different product types arranged together
  * Photos where the product is placed in a complex scene with other furniture, people, plants, or decorations
  * Photos where the background contains visible walls, floors, windows, or other environmental elements
  * Marketing/hero banners with text overlays and composited backgrounds
- If a product has BOTH a lifestyle photo AND an individual product-on-solid-background photo on the same page, ALWAYS select the solid-background version.
- If a product ONLY appears in lifestyle/scene photos with NO clean individual product image available, you MUST set "bounding_box" to null and "image_type" to "lifestyle_only".
- The bounding box should tightly enclose ONLY the product image area (not surrounding text, prices, or labels).

For EACH product, extract:

TITLE FORMAT: [Chinese Name] [English Name] | [Marketing Slogan]
Examples:
  高級學生課桌椅 Advanced Student Desks and Chairs | 為學習環境提升舒適與效率
  智慧教室多功能培訓椅 Smart Classroom Multifunctional Training Chair | 專為現代教學環境而設的靈活學習方案

DESCRIPTION: Generate valid HTML with <h3>, <p>, <ul>, <li>, <strong> tags. Include:
- Section 1: 引言 (Intro) — 2-3 sentences about the product
- Section 2: 產品核心特色 (Core Features) — 3-5 bullet points with bold titles
- Section 3: 功能與設計細節 (Design Details)
- Section 4: 應用場景 (Application Scenarios)
- Section 5: 結語 (Conclusion)

MODEL NUMBER: Extract the exact model number visible in the catalog (e.g., "ZY-2512", "HY-K35"). This is used to match each product to its specific bounding box.

MATERIALS: Identify from image — E1環保板材, 實木, PP塑膠, ABS工程塑膠, 岩板, 鋼製框架, PU皮革, 透氣網布 etc.

DIMENSIONS: If visible in the catalog, extract Width × Depth × Height in cm/mm.

ESTIMATED PRICE (HKD): Based on quality/materials. Office chairs: 800-8000. Desks: 3000-15000. Training: 400-2500. Storage: 1000-6000. Dining: 300-2500.

COLLECTION: One of: "Office Furniture", "Education Furniture", "Conference Furniture", "Training Furniture", "Storage Solutions", "Reception & Lounge", "Industrial Furniture", "Outdoor Furniture", "School Furniture", "F&B Furniture", "Accessories"

TAGS: Select from this official list ONLY: ${tagsList}

IMAGE REGION: For each product, describe where on the page the product image is located (e.g. "top-left quadrant", "center of page 3", "row 2 column 3"). This helps identify which product you're referring to.

PAGE NUMBER: Which page of the PDF this product appears on (1-indexed).

OUTPUT FORMAT — Return ONLY valid JSON (no markdown fences):
{
  "grid_structure": "3x4",
  "grid_cols": 3,
  "grid_rows": 4,
  "products": [
    {
      "model_number": "ZY-2512",
      "title": "中文名 English Name | 中文標語",
      "description": "<h3>引言</h3><p>...</p>...",
      "tags": ["tag1", "tag2"],
      "price": 2880.00,
      "collection": "Collection Name",
      "material": "主要材質",
      "dimensions": "W x D x H cm (if visible)",
      "image_region": "row 1, column 2 of the product grid",
      "page_number": 1,
      "bounding_box": [20, 353, 210, 646],
      "image_type": "individual_product",
      "grid_position": "r0c1"
    }
  ],
  "total_items_found": 12,
  "catalog_summary": "Page contains 12 products in a 3×4 grid layout"
}

BOUNDING_BOX: MUST be an array of exactly 4 integers [ymin, xmin, ymax, xmax] on a 0–1000 normalized scale, OR null ONLY if image_type is "lifestyle_only". NEVER return text descriptions — ONLY numeric arrays [y1, x1, y2, x2] or null. Must tightly enclose ONLY that specific product's individual image. Each product MUST have a DIFFERENT bounding_box. Use the grid formula: for row r, col c in an R×C grid: ymin=round(r/R*1000)+20, xmin=round(c/C*1000)+20, ymax=round((r+1)/R*1000)-40, xmax=round((c+1)/C*1000)-20. Boxes should be proportional to cell size.

⚠️ CRITICAL BOUNDING BOX FAILURE WARNING ⚠️
You are currently FAILING to provide the [ymin, xmin, ymax, xmax] coordinates for products. This is a TECHNICAL REQUIREMENT — the cropping engine CANNOT function without numeric bounding boxes. Every product JSON object MUST include "bounding_box": [int, int, int, int]. If you are unsure of exact pixel positions, USE THE GRID FORMULA ABOVE — it is always correct. Returning null or omitting bounding_box will cause the product image to be BLANK in the UI. This is unacceptable. EVERY product MUST have coordinates.

IMAGE_TYPE: One of "individual_product" (clean single item on solid/plain background), "product_cutout" (transparent/white bg studio shot), "lifestyle_only" (no clean single-product image available on this page — set bounding_box to null).
GRID_STRUCTURE: Report the detected grid layout (e.g., "3x4", "4x4", "2x3", "irregular"). This is MANDATORY.
GRID_COLS: Integer number of columns in the grid. MANDATORY.
GRID_ROWS: Integer number of rows in the grid. MANDATORY.`;
}

/** Call Gemini API with retries and per-request timeout */
async function callGemini(
  geminiUrl: string,
  payload: Record<string, unknown>,
  chunkLabel: string
): Promise<
  { ok: true; text: string } | { ok: false; error: string; status: number }
> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[gemini-pdf-catalog] ${chunkLabel} — Attempt ${attempt + 1}/${MAX_RETRIES + 1}`
      );
      logMemory(`${chunkLabel} pre-fetch attempt ${attempt + 1}`);

      const payloadJson = JSON.stringify(payload);
      console.log(
        `[gemini-pdf-catalog] ${chunkLabel} — Request body size: ${formatBytes(payloadJson.length)}`
      );

      // Use AbortController with timeout to prevent hanging on slow Gemini responses
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error(
          `[gemini-pdf-catalog] ${chunkLabel} — ⏰ Fetch timeout after ${GEMINI_FETCH_TIMEOUT_MS / 1000}s, aborting...`
        );
        controller.abort();
      }, GEMINI_FETCH_TIMEOUT_MS);

      const fetchStart = Date.now();
      let geminiResponse: Response;

      try {
        geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payloadJson,
          signal: controller.signal,
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        const isAbort =
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError";
        const isTimeout =
          fetchError instanceof Error &&
          (fetchError.message.includes("timed out") ||
            fetchError.message.includes("aborted") ||
            fetchError.message.includes("signal"));

        if (isAbort || isTimeout) {
          const elapsed = ((Date.now() - fetchStart) / 1000).toFixed(1);
          console.error(
            `[gemini-pdf-catalog] ${chunkLabel} — ⏰ Request timed out after ${elapsed}s (limit: ${GEMINI_FETCH_TIMEOUT_MS / 1000}s)`
          );
          if (attempt < MAX_RETRIES) {
            const delay = (attempt + 1) * RETRY_BASE_DELAY_MS;
            console.warn(
              `[gemini-pdf-catalog] ${chunkLabel} — Timeout retry in ${delay / 1000}s...`
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          return {
            ok: false,
            error: `Gemini request timed out after ${elapsed}s. The PDF may be too large.`,
            status: 504,
          };
        }
        // Re-throw non-timeout fetch errors to be caught by outer catch
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }

      const fetchElapsed = ((Date.now() - fetchStart) / 1000).toFixed(1);
      console.log(
        `[gemini-pdf-catalog] ${chunkLabel} — Gemini responded: status=${geminiResponse.status} in ${fetchElapsed}s`
      );

      // Read response body with error handling
      let geminiData: Record<string, unknown>;
      try {
        geminiData = await geminiResponse.json();
      } catch (jsonErr) {
        console.error(
          `[gemini-pdf-catalog] ${chunkLabel} — Failed to parse Gemini response as JSON: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return {
          ok: false,
          error: `Gemini returned non-JSON response (status ${geminiResponse.status})`,
          status: geminiResponse.status,
        };
      }

      if (!geminiResponse.ok) {
        const errMsg = JSON.stringify(geminiData);
        console.error(
          `[gemini-pdf-catalog] ${chunkLabel} — Gemini API error (${geminiResponse.status}): ${errMsg.substring(0, 500)}`
        );

        // Retry on rate limit (429), server errors (5xx), quota exhaustion, or overload
        const isRetryable =
          geminiResponse.status === 429 ||
          geminiResponse.status >= 500 ||
          errMsg.toLowerCase().includes("quota") ||
          errMsg.toLowerCase().includes("resource has been exhausted") ||
          errMsg.toLowerCase().includes("overloaded");

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = (attempt + 1) * RETRY_BASE_DELAY_MS;
          console.warn(
            `[gemini-pdf-catalog] ${chunkLabel} — Retryable error (${geminiResponse.status}). Retrying in ${delay / 1000}s...`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        return { ok: false, error: errMsg, status: geminiResponse.status };
      }

      // deno-lint-ignore no-explicit-any
      const candidates = (geminiData as any)?.candidates;
      const responseText = candidates?.[0]?.content?.parts?.[0]?.text;

      if (!responseText) {
        const finishReason = candidates?.[0]?.finishReason || "unknown";
        const safetyRatings = JSON.stringify(
          candidates?.[0]?.safetyRatings || []
        );
        console.error(
          `[gemini-pdf-catalog] ${chunkLabel} — Empty response. Finish reason: ${finishReason}. Safety: ${safetyRatings}`
        );
        console.error(
          `[gemini-pdf-catalog] ${chunkLabel} — Response keys: ${Object.keys(geminiData).join(", ")}`
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return {
          ok: false,
          error: `AI returned empty response (finishReason: ${finishReason})`,
          status: 500,
        };
      }

      logMemory(`${chunkLabel} post-fetch`);
      console.log(
        `[gemini-pdf-catalog] ${chunkLabel} — Got response text (${formatBytes(responseText.length)})`
      );
      return { ok: true, text: responseText };
    } catch (fetchErr) {
      const errMessage =
        fetchErr instanceof Error
          ? `${fetchErr.name}: ${fetchErr.message}${fetchErr.stack ? "\n" + fetchErr.stack.split("\n").slice(0, 3).join("\n") : ""}`
          : String(fetchErr);
      console.error(
        `[gemini-pdf-catalog] ${chunkLabel} — Unhandled error on attempt ${attempt + 1}: ${errMessage}`
      );
      logMemory(`${chunkLabel} error`);
      if (attempt >= MAX_RETRIES) {
        return {
          ok: false,
          error: `Failed after ${MAX_RETRIES + 1} attempts: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
          status: 500,
        };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { ok: false, error: "Exhausted retries", status: 500 };
}

/** Parse Gemini JSON response with aggressive repair: strip markdown fences,
 *  strip conversational text before/after JSON, and regex extraction fallback */
function parseGeminiJson(raw: string):
  | {
      ok: true;
      data: {
        // deno-lint-ignore no-explicit-any
        products: any[];
        total_items_found: number;
        catalog_summary: string;
        grid_structure?: string;
        grid_cols?: number;
        grid_rows?: number;
      };
    }
  | { ok: false; error: string; preview: string } {
  let cleaned = raw.trim();

  // Step 1: Strip markdown fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/, "")
      .replace(/```\s*$/, "")
      .trim();
  }

  // Step 2: Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    return { ok: true, data: parsed };
  } catch (e) {
    console.warn(
      `[gemini-pdf-catalog] Direct JSON parse failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Step 3: Strip text before first { or [ and after last } or ]
  // This handles cases where Gemini returns conversational text around the JSON
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  let jsonStart = -1;

  if (firstBrace === -1 && firstBracket === -1) {
    return {
      ok: false,
      error: `No JSON structure found in AI response (no { or [ detected)`,
      preview: raw.substring(0, 300),
    };
  }

  if (firstBrace === -1) jsonStart = firstBracket;
  else if (firstBracket === -1) jsonStart = firstBrace;
  else jsonStart = Math.min(firstBrace, firstBracket);

  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");
  let jsonEnd = Math.max(lastBrace, lastBracket);

  if (jsonEnd <= jsonStart) {
    return {
      ok: false,
      error: `Malformed JSON structure in AI response`,
      preview: raw.substring(0, 300),
    };
  }

  const stripped = cleaned.substring(jsonStart, jsonEnd + 1);
  console.log(
    `[gemini-pdf-catalog] Attempting JSON repair — stripped ${jsonStart} chars from start, ${cleaned.length - jsonEnd - 1} chars from end`
  );

  try {
    const parsed = JSON.parse(stripped);
    console.log(
      `[gemini-pdf-catalog] ✅ Recovered JSON via text stripping`
    );
    // If we got an array, wrap it in the expected format
    if (Array.isArray(parsed)) {
      return {
        ok: true,
        data: {
          products: parsed,
          total_items_found: parsed.length,
          catalog_summary: "Recovered from array response",
        },
      };
    }
    return { ok: true, data: parsed };
  } catch (e2) {
    console.warn(
      `[gemini-pdf-catalog] Text stripping failed: ${e2 instanceof Error ? e2.message : String(e2)}`
    );
  }

  // Step 4: Try regex extraction for {"products": [...]} pattern
  console.warn(
    `[gemini-pdf-catalog] Trying regex extraction for products array...`
  );
  const jsonMatch = stripped.match(/\{[\s\S]*"products"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(
        `[gemini-pdf-catalog] ✅ Recovered JSON via regex extraction`
      );
      return { ok: true, data: parsed };
    } catch {
      // fall through
    }
  }

  // Step 5: Last resort — try to find a JSON array and wrap it
  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        console.log(
          `[gemini-pdf-catalog] ✅ Recovered JSON array, wrapping in products object`
        );
        return {
          ok: true,
          data: {
            products: parsed,
            total_items_found: parsed.length,
            catalog_summary: "Recovered from raw array",
          },
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    ok: false,
    error: `Invalid JSON from AI after all repair attempts`,
    preview: raw.substring(0, 500),
  };
}

/**
 * VALIDATION LAYER: Sanitize products returned by Gemini.
 * Forces bounding_box to null if it's not an array of exactly 4 numbers.
 * This prevents the frontend from trying to "crop" based on textual coordinates
 * like "top lifestyle image" or "center of page".
 */
function sanitizeProducts(products: any[]): any[] {
  if (!Array.isArray(products)) return [];

  return products.map((product: any) => {
    const bbox = product.bounding_box;

    // If bounding_box is not present, leave as-is
    if (bbox === null || bbox === undefined) {
      return product;
    }

    // REJECT: string descriptions (e.g. "top left", "top lifestyle image", "center of page")
    if (typeof bbox === 'string') {
      console.warn(
        `[gemini-pdf-catalog] SANITIZE: Rejected text bounding_box "${bbox}" for product "${(product.title || product.model_number || '').substring(0, 50)}"`
      );
      return { ...product, bounding_box: null };
    }

    // REJECT: not an array
    if (!Array.isArray(bbox)) {
      console.warn(
        `[gemini-pdf-catalog] SANITIZE: Rejected non-array bounding_box (${typeof bbox}) for product "${(product.title || product.model_number || '').substring(0, 50)}"`
      );
      return { ...product, bounding_box: null };
    }

    // REJECT: array but not exactly 4 elements
    if (bbox.length !== 4) {
      console.warn(
        `[gemini-pdf-catalog] SANITIZE: Rejected bounding_box with ${bbox.length} elements (expected 4) for product "${(product.title || product.model_number || '').substring(0, 50)}"`
      );
      return { ...product, bounding_box: null };
    }

    // COERCE: each element must be a number
    const nums = bbox.map((v: any) => {
      if (typeof v === 'number' && !isNaN(v)) return Math.round(v);
      if (typeof v === 'string') {
        const parsed = parseFloat(v);
        if (!isNaN(parsed)) return Math.round(parsed);
      }
      return NaN;
    });

    // REJECT: any element is NaN (couldn't be parsed as a number)
    if (nums.some((n: number) => isNaN(n))) {
      console.warn(
        `[gemini-pdf-catalog] SANITIZE: Rejected bounding_box with non-numeric values [${bbox.join(', ')}] for product "${(product.title || product.model_number || '').substring(0, 50)}"`
      );
      return { ...product, bounding_box: null };
    }

    // REJECT: full-page bounding boxes (likely not useful)
    const [ymin, xmin, ymax, xmax] = nums;
    if (ymin <= 5 && xmin <= 5 && ymax >= 995 && xmax >= 995) {
      console.warn(
        `[gemini-pdf-catalog] SANITIZE: Rejected full-page bounding_box [${nums.join(', ')}] for product "${(product.title || product.model_number || '').substring(0, 50)}"`
      );
      return { ...product, bounding_box: null };
    }

    // REJECT: inverted or zero-size boxes
    if (ymin >= ymax || xmin >= xmax) {
      console.warn(
        `[gemini-pdf-catalog] SANITIZE: Rejected inverted bounding_box [${nums.join(', ')}] for product "${(product.title || product.model_number || '').substring(0, 50)}"`
      );
      return { ...product, bounding_box: null };
    }

    // WARN: too-thin boxes (width or height < 50 units — likely failed grid read)
    const bboxWidth = xmax - xmin;
    const bboxHeight = ymax - ymin;
    if (bboxWidth < 50 || bboxHeight < 50) {
      console.warn(
        `[gemini-pdf-catalog] SANITIZE: ⚠️ Very thin bounding_box [${nums.join(', ')}] (w=${bboxWidth}, h=${bboxHeight}) for "${(product.title || product.model_number || '').substring(0, 50)}" — possible grid misread`
      );
      // Still pass through — frontend Red Border Debug will flag it
    }

    // WARN: too-wide boxes (>600 units — spans >60% of page, likely multi-product)
    if (bboxWidth > 600 || bboxHeight > 600) {
      console.warn(
        `[gemini-pdf-catalog] SANITIZE: ⚠️ Very wide bounding_box [${nums.join(', ')}] (w=${bboxWidth}, h=${bboxHeight}) for "${(product.title || product.model_number || '').substring(0, 50)}" — possible multi-product capture`
      );
      // Still pass through — frontend Red Border Debug will flag it
    }

    // All good — use the coerced integer values
    return { ...product, bounding_box: nums };
  });
}

/** Normalize title for dedup comparison */
function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "")
    .trim();
}

/** Deduplicate products across chunks by title similarity */
function deduplicateProducts(products: any[]): any[] {
  const seen = new Map<string, any>();

  for (const product of products) {
    const key = normalizeForCompare(product.title || "");
    if (!key) {
      seen.set(`untitled_${seen.size}`, product);
      continue;
    }

    let isDuplicate = false;
    for (const [existingKey] of seen) {
      if (existingKey === key) {
        isDuplicate = true;
        console.log(
          `[gemini-pdf-catalog] Dedup — Skipping duplicate: "${(product.title || "").substring(0, 50)}"`
        );
        break;
      }
      if (
        key.length > 10 &&
        (existingKey.includes(key) || key.includes(existingKey))
      ) {
        isDuplicate = true;
        console.log(
          `[gemini-pdf-catalog] Dedup — Skipping similar: "${(product.title || "").substring(0, 50)}"`
        );
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(key, product);
    }
  }

  return Array.from(seen.values());
}

/**
 * SAFETY_PADDING_RATIO: 5% extra padding around bounding boxes to prevent edge cutoff.
 */
const SAFETY_PADDING_RATIO = 0.05;

/**
 * Crop a region from a base64-encoded image using bounding box coordinates.
 * Bounding box is [ymin, xmin, ymax, xmax] on a 0–1000 normalized scale.
 * Returns a base64-encoded JPEG of the cropped region as a 1:1 SQUARE with white padding.
 * Applies 5% safety padding around the bounding box to prevent edge cutoff.
 *
 * Uses OffscreenCanvas (available in Deno Deploy's V8 runtime).
 * Falls back to returning null if cropping is not possible.
 */
async function cropImageFromBase64(
  base64Data: string,
  mimeType: string,
  boundingBox: [number, number, number, number] // [ymin, xmin, ymax, xmax] normalized 0-1000
): Promise<string | null> {
  try {
    const [ymin, xmin, ymax, xmax] = boundingBox;

    // Validate bounding box
    if (ymin >= ymax || xmin >= xmax || ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) {
      console.warn(`[gemini-pdf-catalog] Invalid bounding box: [${boundingBox.join(",")}]`);
      return null;
    }

    // Apply 5% safety padding (in normalized 0-1000 space)
    const bboxW = xmax - xmin;
    const bboxH = ymax - ymin;
    const padX = Math.round(bboxW * SAFETY_PADDING_RATIO);
    const padY = Math.round(bboxH * SAFETY_PADDING_RATIO);
    const paddedYmin = Math.max(0, ymin - padY);
    const paddedXmin = Math.max(0, xmin - padX);
    const paddedYmax = Math.min(1000, ymax + padY);
    const paddedXmax = Math.min(1000, xmax + padX);

    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType || "image/jpeg" });

    // Create ImageBitmap from blob
    const imageBitmap = await createImageBitmap(blob);
    const imgWidth = imageBitmap.width;
    const imgHeight = imageBitmap.height;

    // Convert padded normalized coords (0-1000) to pixel coords
    const cropX = Math.round((paddedXmin / 1000) * imgWidth);
    const cropY = Math.round((paddedYmin / 1000) * imgHeight);
    const cropW = Math.round(((paddedXmax - paddedXmin) / 1000) * imgWidth);
    const cropH = Math.round(((paddedYmax - paddedYmin) / 1000) * imgHeight);

    // Ensure minimum crop size
    if (cropW < 10 || cropH < 10) {
      console.warn(`[gemini-pdf-catalog] Crop too small: ${cropW}x${cropH}`);
      imageBitmap.close();
      return null;
    }

    // Create 1:1 SQUARE output with white padding
    const squareSize = Math.max(cropW, cropH);
    const offsetX = Math.round((squareSize - cropW) / 2);
    const offsetY = Math.round((squareSize - cropH) / 2);

    // Use OffscreenCanvas to crop into a square
    const canvas = new OffscreenCanvas(squareSize, squareSize);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      imageBitmap.close();
      return null;
    }

    // Fill with white background for square padding
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, squareSize, squareSize);

    // Draw the cropped region centered in the square
    ctx.drawImage(imageBitmap, cropX, cropY, cropW, cropH, offsetX, offsetY, cropW, cropH);
    imageBitmap.close();

    // Convert to JPEG blob then base64
    const croppedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const arrayBuffer = await croppedBlob.arrayBuffer();
    const croppedBytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < croppedBytes.length; i++) {
      binary += String.fromCharCode(croppedBytes[i]);
    }
    const croppedBase64 = btoa(binary);
    console.log(
      `[gemini-pdf-catalog] ✅ Square crop: bbox=[${boundingBox.join(",")}] +5%pad → ${squareSize}x${squareSize}px (from ${cropW}x${cropH}, ${formatBytes(croppedBase64.length)})`
    );
    return croppedBase64;
  } catch (err) {
    console.warn(
      `[gemini-pdf-catalog] Image cropping failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Process products returned by Gemini: crop individual product images
 * from the page image using bounding box coordinates.
 */
async function enrichProductsWithCroppedImages(
  products: any[],
  pageImages: Array<{ data: string; mimeType: string; page: number }> | undefined
): Promise<any[]> {
  if (!pageImages || pageImages.length === 0) {
    console.log("[gemini-pdf-catalog] No page_images provided — skipping cropping");
    return products;
  }

  // Build a map of page number → image data
  const pageImageMap = new Map<number, { data: string; mimeType: string }>();
  for (const pi of pageImages) {
    pageImageMap.set(pi.page, { data: pi.data, mimeType: pi.mimeType });
  }

  // Track used bounding boxes per page to detect duplicates
  const usedBoxes = new Map<number, Set<string>>();

  const enriched = [];
  for (const product of products) {
    const pageNum = product.page_number || 1;
    const bbox = product.bounding_box;
    const imageType = product.image_type || "individual_product";

    // Get the page image
    const pageImage = pageImageMap.get(pageNum);

    if (!pageImage) {
      console.warn(`[gemini-pdf-catalog] No page image for page ${pageNum}`);
      enriched.push(product);
      continue;
    }

    // Skip if no bounding box or lifestyle-only
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4 || imageType === "lifestyle_only") {
      console.log(
        `[gemini-pdf-catalog] Product "${(product.title || "").substring(0, 40)}" — no bbox (${imageType})`
      );
      enriched.push(product);
      continue;
    }

    // Dedup check: skip if this exact bbox was already used for this page
    const bboxKey = bbox.join(",");
    if (!usedBoxes.has(pageNum)) {
      usedBoxes.set(pageNum, new Set());
    }
    const pageBoxes = usedBoxes.get(pageNum)!;
    if (pageBoxes.has(bboxKey)) {
      console.warn(
        `[gemini-pdf-catalog] DUPLICATE bbox [${bboxKey}] on page ${pageNum} — product "${(product.title || "").substring(0, 40)}" will not have a cropped image`
      );
      enriched.push(product);
      continue;
    }
    pageBoxes.add(bboxKey);

    // Crop the image
    const croppedBase64 = await cropImageFromBase64(
      pageImage.data,
      pageImage.mimeType,
      bbox as [number, number, number, number]
    );

    if (croppedBase64) {
      enriched.push({
        ...product,
        cropped_image: croppedBase64, // base64 JPEG of the cropped product
        cropped_image_mime: "image/jpeg",
      });
    } else {
      enriched.push(product);
    }
  }

  const croppedCount = enriched.filter((p) => p.cropped_image).length;
  console.log(
    `[gemini-pdf-catalog] Cropping complete: ${croppedCount}/${enriched.length} products got unique images`
  );

  return enriched;
}

// ─── Main Handler ────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  const startTime = Date.now();

  try {
    console.log("[gemini-pdf-catalog] ═══════════════════════════════════════");
    console.log("[gemini-pdf-catalog] ═══ V8 Request received (V18 frontend) ═══");
    logMemory("request-start");

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          error:
            "GEMINI_API_KEY is not configured in Edge Function secrets.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // ─── Parse request body ────────────────────
    let body: Record<string, unknown>;
    try {
      const rawBody = await req.text();
      const bodySizeBytes = rawBody.length;
      console.log(
        `[gemini-pdf-catalog] Raw request body size: ${formatBytes(bodySizeBytes)}`
      );
      
      // Guard against extremely large payloads that may crash during parse
      if (bodySizeBytes > 50 * 1024 * 1024) {
        console.error(`[gemini-pdf-catalog] Request body too large: ${formatBytes(bodySizeBytes)}`);
        return new Response(
          JSON.stringify({
            error: `Request body too large (${formatBytes(bodySizeBytes)}). Maximum is 50MB. Try sending fewer pages or smaller images.`,
            hint: "The PDF file base64 data exceeds processing limits. Use page-by-page batch mode for large PDFs."
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 413,
          }
        );
      }
      
      body = JSON.parse(rawBody);
    } catch (parseErr) {
      const errMessage = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.error(`[gemini-pdf-catalog] Body parse error: ${errMessage}`);
      return new Response(
        JSON.stringify({
          error: `Failed to parse request body: ${errMessage}`,
          hint: "Request body may be malformed JSON, contain invalid characters, or be too large for available memory.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    logMemory("post-body-parse");

    // deno-lint-ignore no-explicit-any
    const files = body.files as any[];
    const model = body.model as string | undefined;
    const tags_list = body.tags_list as string | undefined;
    const startPage = body.start_page as number | undefined;
    const endPage = body.end_page as number | undefined;
    const uploadSessionId = body.upload_session_id as string | undefined;
    const totalPagesHint = body.total_pages as number | undefined;
    // V5: page_images — base64 screenshots of individual PDF pages for cropping
    const pageImages = body.page_images as Array<{ data: string; mimeType: string; page: number }> | undefined;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            'Invalid request. Expected { files: [...], model?, tags_list?, start_page?, end_page? }',
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const modelName = model || "gemini-2.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`;
    const tagsList = tags_list || "";

    // ─── Analyze incoming files ────────────────────
    let totalBytes = 0;
    const pdfFiles: Array<{ data: string; mimeType: string; sizeBytes: number }> = [];
    const imageFiles: Array<{ data: string; mimeType: string; sizeBytes: number }> = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const sizeBytes = estimateBase64Bytes(f.data);
      totalBytes += sizeBytes;
      if (f.mimeType === "application/pdf") {
        pdfFiles.push({ ...f, sizeBytes });
      } else {
        imageFiles.push({ ...f, sizeBytes });
      }
    }

    console.log(
      `[gemini-pdf-catalog] Total payload: ${formatBytes(totalBytes)} | PDFs: ${pdfFiles.length} | Images: ${imageFiles.length}`
    );

    // ═══════════════════════════════════════════════════════
    // MODE A: FRONTEND-DRIVEN BATCH (start_page & end_page provided)
    // ═══════════════════════════════════════════════════════
    const isBatchMode = startPage !== undefined && endPage !== undefined;

    if (isBatchMode) {
      const isSinglePage = startPage === endPage;
      console.log(
        `[gemini-pdf-catalog] BATCH MODE — ${isSinglePage ? 'SINGLE PAGE' : 'pages'} ${startPage}${isSinglePage ? '' : `-${endPage}`}` +
          (uploadSessionId ? ` | session: ${uploadSessionId}` : "") +
          (totalPagesHint ? ` | total pages hint: ${totalPagesHint}` : "")
      );

      const fileParts = files.map(
        (f: { data: string; mimeType: string }) => ({
          inlineData: { mimeType: f.mimeType, data: f.data },
        })
      );

      const prompt = buildCatalogPrompt(tagsList, startPage, endPage);

      // For single-page requests with multi-object segmentation, use larger token limit
      // A page with 12 products each needing model_number + bounding_box needs ~16K tokens
      const maxTokens = isSinglePage ? 24576 : 49152;

      const systemText = `You are a JSON-only extraction engine with MULTI-OBJECT SEGMENTATION capabilities. Never include apologies, conversational text, explanations, or markdown code blocks. Your entire response must be a single valid JSON object. Start with { and end with }.

CRITICAL MULTI-OBJECT RULES:
- Catalog pages typically contain 6–12 products arranged in a grid layout.
- You MUST identify EVERY individual product on the page.
- For EVERY product found, provide its UNIQUE bounding_box [ymin, xmin, ymax, xmax] (normalized 0–1000).
- bounding_box MUST be an array of 4 integers or null. NEVER return text strings like "top left", "center", "top lifestyle image".
- Each product MUST have a DIFFERENT bounding_box. NEVER reuse the same coordinates for two products.
- Think of the page as a grid — divide it into cells and assign each product its own cell's coordinates.
- ONLY select photos with clean, solid-color backgrounds (white, gray, transparent).
- EXCLUDE lifestyle/scene photos. If only lifestyle photo exists, set bounding_box to null.
- Include model_number for each product when visible.
- VALID bounding_box: [50, 30, 300, 480] or null. INVALID: "top left", "center of page".`;

      const geminiPayload = {
        systemInstruction: {
          parts: [{ text: systemText }],
        },
        contents: [
          {
            parts: [{ text: prompt }, ...fileParts],
          },
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      };

      logMemory("pre-batch-call");
      const result = await callGemini(
        geminiUrl,
        geminiPayload,
        isSinglePage ? `PAGE ${startPage}` : `BATCH pages ${startPage}-${endPage}`
      );

      // Help GC by releasing the large payload
      // @ts-ignore
      geminiPayload.contents = null;

      logMemory("post-batch-call");

      if (!result.ok) {
        console.error(
          `[gemini-pdf-catalog] BATCH pages ${startPage}-${endPage} — FAILED: ${result.error.substring(0, 200)}`
        );
        return new Response(
          JSON.stringify({
            error: result.error,
            start_page: startPage,
            end_page: endPage,
            upload_session_id: uploadSessionId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: result.status >= 400 ? result.status : 500,
          }
        );
      }

      const parsed = parseGeminiJson(result.text);
      if (!parsed.ok) {
        return new Response(
          JSON.stringify({
            error: parsed.error,
            raw_preview: parsed.preview,
            start_page: startPage,
            end_page: endPage,
            upload_session_id: uploadSessionId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      const rawProducts = parsed.data.products || [];
      const products = sanitizeProducts(rawProducts);

      // V7: Skip server-side cropping entirely when page_images are provided.
      // The frontend does cropping more reliably (browser Canvas API is universally supported
      // vs Deno Deploy's flaky OffscreenCanvas), and skipping it saves 10-30s per request,
      // which is critical to stay under the 150s idle timeout.
      let enrichedProducts = products;
      if (!pageImages || pageImages.length === 0) {
        // Only attempt server-side cropping if NO page_images were sent (legacy mode)
        try {
          enrichedProducts = await enrichProductsWithCroppedImages(products, pageImages);
        } catch (cropErr) {
          console.warn(
            `[gemini-pdf-catalog] Server-side cropping failed, returning raw bounding boxes: ${cropErr instanceof Error ? cropErr.message : String(cropErr)}`
          );
          enrichedProducts = products;
        }
      } else {
        console.log(
          `[gemini-pdf-catalog] Skipping server-side cropping — frontend will crop using ${pageImages.length} page image(s)`
        );
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Log bounding box uniqueness for debugging
      const bboxes = enrichedProducts.filter((p: any) => p.bounding_box).map((p: any) => JSON.stringify(p.bounding_box));
      const uniqueBboxes = new Set(bboxes);
      console.log(
        `[gemini-pdf-catalog] BATCH pages ${startPage}-${endPage} — Extracted ${enrichedProducts.length} products (${uniqueBboxes.size} unique bboxes out of ${bboxes.length}) in ${elapsed}s`
      );

      // Extract grid dimensions from parsed data for frontend hard-grid fallback
      const gridCols = parsed.data.grid_cols || 0;
      const gridRows = parsed.data.grid_rows || 0;
      const gridStructure = parsed.data.grid_structure || "";

      return new Response(
        JSON.stringify({
          products: enrichedProducts,
          total_items_found: enrichedProducts.length,
          catalog_summary: parsed.data.catalog_summary || "",
          grid_structure: gridStructure,
          grid_cols: gridCols,
          grid_rows: gridRows,
          processing_mode: "batch",
          start_page: startPage,
          end_page: endPage,
          upload_session_id: uploadSessionId,
          elapsed_seconds: parseFloat(elapsed),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // ═══════════════════════════════════════════════════════
    // MODE B: LEGACY — Auto single-shot or internal chunking
    // ═══════════════════════════════════════════════════════

    const shouldChunk = totalBytes > MAX_SINGLE_PAYLOAD_BYTES;

    // ─── SINGLE-SHOT ──────────────────────
    if (!shouldChunk) {
      console.log("[gemini-pdf-catalog] LEGACY SINGLE-SHOT MODE");

      const fileParts = files.map(
        (f: { data: string; mimeType: string }) => ({
          inlineData: { mimeType: f.mimeType, data: f.data },
        })
      );

      const prompt = buildCatalogPrompt(tagsList);

      const geminiPayload = {
        systemInstruction: {
          parts: [{ text: "You are a JSON-only extraction engine with MULTI-OBJECT SEGMENTATION capabilities. Never include apologies, conversational text, explanations, or markdown code blocks. Your entire response must be a single valid JSON object. Start with { and end with }. CRITICAL: bounding_box MUST be an array of 4 integers [ymin, xmin, ymax, xmax] on 0-1000 scale, or null. NEVER return text descriptions like 'top left' or 'center' for bounding_box." }],
        },
        contents: [{ parts: [{ text: prompt }, ...fileParts] }],
        generationConfig: { maxOutputTokens: 65536, temperature: 0.1, responseMimeType: "application/json" },
      };

      const result = await callGemini(geminiUrl, geminiPayload, "SINGLE");

      if (!result.ok) {
        return new Response(
          JSON.stringify({ error: result.error }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: result.status,
          }
        );
      }

      const parsed = parseGeminiJson(result.text);
      if (!parsed.ok) {
        return new Response(
          JSON.stringify({ error: parsed.error, raw_preview: parsed.preview }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      // Sanitize bounding boxes before returning
      const sanitizedData = {
        ...parsed.data,
        products: sanitizeProducts(parsed.data.products || []),
      };
      
      return new Response(
        JSON.stringify({
          ...sanitizedData,
          processing_mode: "single",
          elapsed_seconds: parseFloat(elapsed),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // ─── LEGACY CHUNKED ──────────────────────
    console.log("[gemini-pdf-catalog] LEGACY CHUNKED MODE");

    const largestPdf = pdfFiles.sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
    const estimatedTotalPages = Math.max(
      1,
      Math.ceil(largestPdf.sizeBytes / (400 * 1024))
    );

    const chunks: Array<{ start: number; end: number }> = [];
    for (let page = 1; page <= estimatedTotalPages; page += PAGES_PER_CHUNK) {
      chunks.push({
        start: page,
        end: Math.min(page + PAGES_PER_CHUNK - 1, estimatedTotalPages),
      });
    }

    const fileParts = files.map(
      (f: { data: string; mimeType: string }) => ({
        inlineData: { mimeType: f.mimeType, data: f.data },
      })
    );

    // deno-lint-ignore no-explicit-any
    const allProducts: any[] = [];
    const chunkSummaries: string[] = [];
    const chunkErrors: Array<{ chunk: string; error: string }> = [];
    let successfulChunks = 0;

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const chunkLabel = `CHUNK ${ci + 1}/${chunks.length} (pages ${chunk.start}-${chunk.end})`;

      const elapsedMs = Date.now() - startTime;
      const remainingMs = WALL_CLOCK_LIMIT_MS - elapsedMs - WALL_CLOCK_BUFFER_MS;
      if (remainingMs < GEMINI_FETCH_TIMEOUT_MS * 0.5) {
        for (let ri = ci; ri < chunks.length; ri++) {
          chunkErrors.push({
            chunk: `CHUNK ${ri + 1}/${chunks.length}`,
            error: `Skipped — wall clock budget exhausted`,
          });
        }
        break;
      }

      const prompt = buildCatalogPrompt(tagsList, chunk.start, chunk.end);

      const geminiPayload = {
        systemInstruction: {
          parts: [{ text: "You are a JSON-only extraction engine with MULTI-OBJECT SEGMENTATION capabilities. Never include apologies, conversational text, explanations, or markdown code blocks. Your entire response must be a single valid JSON object. Start with { and end with }. CRITICAL: bounding_box MUST be an array of 4 integers [ymin, xmin, ymax, xmax] on 0-1000 scale, or null. NEVER return text descriptions like 'top left' or 'center' for bounding_box." }],
        },
        contents: [{ parts: [{ text: prompt }, ...fileParts] }],
        generationConfig: { maxOutputTokens: 32768, temperature: 0.1, responseMimeType: "application/json" },
      };

      const result = await callGemini(geminiUrl, geminiPayload, chunkLabel);

      if (!result.ok) {
        chunkErrors.push({ chunk: chunkLabel, error: result.error.substring(0, 200) });
        continue;
      }

      const parsed = parseGeminiJson(result.text);

      if (!parsed.ok) {
        chunkErrors.push({ chunk: chunkLabel, error: parsed.error });
        continue;
      }

      const chunkProducts = sanitizeProducts(parsed.data.products || []);
      successfulChunks++;
      allProducts.push(...chunkProducts);
      if (parsed.data.catalog_summary) {
        chunkSummaries.push(parsed.data.catalog_summary);
      }

      if (ci < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, INTER_CHUNK_DELAY_MS));
      }
    }

    const deduped = deduplicateProducts(allProducts);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const hasPartialResults = chunkErrors.length > 0 && allProducts.length > 0;

    return new Response(
      JSON.stringify({
        products: deduped,
        total_items_found: deduped.length,
        catalog_summary: chunkSummaries.join(" | "),
        processing_mode: "chunked",
        chunks_total: chunks.length,
        chunks_successful: successfulChunks,
        chunk_errors: chunkErrors.length > 0 ? chunkErrors : undefined,
        partial_results: hasPartialResults,
        elapsed_seconds: parseFloat(elapsed),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logMemory("fatal-error");
    console.error(
      `[gemini-pdf-catalog] FATAL ERROR after ${elapsed}s:`,
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        elapsed_seconds: parseFloat(elapsed),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
