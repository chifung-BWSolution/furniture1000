import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * visual-match-images — Global Sheet Visual Search via Gemini Vision
 * ────────────────────────────────────────────────────────────────────
 * Uses PDF product thumbnails as "Visual Feature Templates" and compares
 * them against ALL images from the Excel sheet (no column restrictions).
 *
 * Gemini analyzes visual similarity between each PDF thumbnail and all
 * Excel candidate images, returning the best match with a confidence score.
 *
 * Input:
 * {
 *   pdf_products: Array<{
 *     index: number;
 *     model_number: string;
 *     dimensions: string;
 *     thumbnail: string;        // base64 of the PDF product thumbnail
 *     thumbnail_mime: string;   // e.g. "image/jpeg"
 *   }>,
 *   excel_images: Array<{
 *     image_index: number;
 *     base64: string;
 *     mime_type: string;
 *     from_row?: number;
 *     from_col?: number;
 *     to_row?: number;
 *     to_col?: number;
 *   }>,
 *   model?: string;             // Gemini model to use
 *   batch_size?: number;        // Products per batch (default: 3)
 * }
 *
 * Output:
 * {
 *   matches: Array<{
 *     product_index: number;
 *     model_number: string;
 *     matched_excel_image_index: number;
 *     similarity_score: number;    // 0-100
 *     excel_image_row: number;
 *     excel_image_col: number;
 *     status: "VERIFIED" | "LOW_CONFIDENCE" | "NO_MATCH";
 *   }>,
 *   processing_info: { total_products: number; total_excel_images: number; matched: number; unmatched: number }
 * }
 */

const GEMINI_FETCH_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;
const SIMILARITY_THRESHOLD = 70; // Minimum similarity to consider a valid match
const MAX_EXCEL_IMAGES_PER_BATCH = 20; // Max Excel images to send per comparison batch

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Parse request body with size guard
    let body: any;
    try {
      const rawBody = await req.text();
      const bodySizeBytes = rawBody.length;
      const bodySizeMB = (bodySizeBytes / (1024 * 1024)).toFixed(1);
      console.log(`[visual-match] Request body size: ${bodySizeMB}MB (${bodySizeBytes} bytes)`);
      
      if (bodySizeBytes > 20 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ 
            error: `Request body too large: ${bodySizeMB}MB. Maximum is 20MB.`,
            hint: "Try sending fewer or smaller images per batch."
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 413 }
        );
      }
      
      body = JSON.parse(rawBody);
    } catch (parseErr: any) {
      console.error("[visual-match] Request body parse error:", parseErr.message);
      return new Response(
        JSON.stringify({ 
          error: "Failed to parse request body",
          detail: parseErr.message,
          hint: "Request body may be malformed or too large."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const {
      pdf_products,
      excel_images,
      model = "gemini-2.5-flash",
      batch_size = 3,
    } = body;

    if (!pdf_products || !Array.isArray(pdf_products) || pdf_products.length === 0) {
      return new Response(
        JSON.stringify({ error: "pdf_products array is required and must be non-empty" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (!excel_images || !Array.isArray(excel_images) || excel_images.length === 0) {
      return new Response(
        JSON.stringify({ error: "excel_images array is required and must be non-empty" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(
      `[visual-match] Starting visual match: ${pdf_products.length} PDF products vs ${excel_images.length} Excel images`
    );

    // Estimate payload going to Gemini — cap large images
    const estimateB64Bytes = (b64: string) => Math.ceil((b64.length * 3) / 4);
    const MAX_SINGLE_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB per image max for Gemini
    
    // Filter out oversized images and log
    const validExcelImages = excel_images.filter((img: any, i: number) => {
      const bytes = estimateB64Bytes(img.base64 || '');
      if (bytes > MAX_SINGLE_IMAGE_BYTES) {
        console.warn(`[visual-match] Skipping oversized Excel image[${i}]: ${(bytes / 1024 / 1024).toFixed(1)}MB (max ${MAX_SINGLE_IMAGE_BYTES / 1024 / 1024}MB)`);
        return false;
      }
      return true;
    });
    
    const validPdfProducts = pdf_products.filter((p: any, i: number) => {
      const bytes = estimateB64Bytes(p.thumbnail || '');
      if (bytes > MAX_SINGLE_IMAGE_BYTES) {
        console.warn(`[visual-match] Skipping oversized PDF thumbnail[${i}]: ${(bytes / 1024 / 1024).toFixed(1)}MB`);
        return false;
      }
      return true;
    });

    if (validPdfProducts.length === 0) {
      return new Response(
        JSON.stringify({ error: "All PDF thumbnails were too large. Try with smaller images.", matches: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(`[visual-match] After size filter: ${validPdfProducts.length} PDF products, ${validExcelImages.length} Excel images`);

    const allMatches: any[] = [];
    let matchedCount = 0;
    let unmatchedCount = 0;

    // Process in batches of pdf_products
    for (let batchStart = 0; batchStart < validPdfProducts.length; batchStart += batch_size) {
      const batch = validPdfProducts.slice(batchStart, batchStart + batch_size);

      // For each batch, determine nearby Excel images based on row proximity
      // But since we're doing GLOBAL search, include all images (up to limit)
      const excelImagesToCompare = validExcelImages.slice(0, MAX_EXCEL_IMAGES_PER_BATCH);

      const prompt = buildVisualMatchPrompt(batch, excelImagesToCompare);
      const contents = buildGeminiContents(batch, excelImagesToCompare, prompt);

      let result: any = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await callGemini(geminiApiKey, model, contents);
          break;
        } catch (err: any) {
          console.warn(
            `[visual-match] Batch ${batchStart}-${batchStart + batch.length} attempt ${attempt + 1} failed:`,
            err.message
          );
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          }
        }
      }

      if (result) {
        // Parse the Gemini response
        const batchMatches = parseVisualMatchResponse(result, batch, excelImagesToCompare);
        for (const match of batchMatches) {
          allMatches.push(match);
          if (match.status === "VERIFIED" || match.status === "LOW_CONFIDENCE") {
            matchedCount++;
          } else {
            unmatchedCount++;
          }
        }
      } else {
        // All retries failed for this batch
        for (const product of batch) {
          allMatches.push({
            product_index: product.index,
            model_number: product.model_number,
            matched_excel_image_index: -1,
            similarity_score: 0,
            excel_image_row: -1,
            excel_image_col: -1,
            status: "NO_MATCH",
          });
          unmatchedCount++;
        }
      }
    }

    console.log(
      `[visual-match] Complete: ${matchedCount} matched, ${unmatchedCount} unmatched out of ${validPdfProducts.length} products`
    );

    return new Response(
      JSON.stringify({
        matches: allMatches,
        processing_info: {
          total_products: validPdfProducts.length,
          total_excel_images: validExcelImages.length,
          matched: matchedCount,
          unmatched: unmatchedCount,
          skipped_oversized_excel: excel_images.length - validExcelImages.length,
          skipped_oversized_pdf: pdf_products.length - validPdfProducts.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    console.error("[visual-match] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

function buildVisualMatchPrompt(
  pdfProducts: any[],
  excelImages: any[]
): string {
  const productDescriptions = pdfProducts
    .map(
      (p, i) =>
        `  PDF_PRODUCT_${i}: index=${p.index}, model="${p.model_number}", dimensions="${p.dimensions}"`
    )
    .join("\n");

  const imageDescriptions = excelImages
    .map(
      (img, i) =>
        `  EXCEL_IMAGE_${i}: image_index=${img.image_index}, row=${img.from_row ?? "?"}, col=${img.from_col ?? "?"}`
    )
    .join("\n");

  return `You are a VISUAL SIMILARITY MATCHING ENGINE for product catalog images. Your task is to match each PDF product thumbnail to the most visually similar image from the Excel sheet.

CONTEXT:
- PDF thumbnails are clean product images extracted from a catalog PDF
- Excel images include both clean product images AND lifestyle/scene photos
- You must find which Excel image shows the SAME PRODUCT as each PDF thumbnail

PDF PRODUCTS TO MATCH:
${productDescriptions}

EXCEL CANDIDATE IMAGES:
${imageDescriptions}

RULES:
1. Compare each PDF product thumbnail against ALL Excel candidate images
2. Focus on the PRODUCT SHAPE, STRUCTURE, and DESIGN — ignore background differences
3. A PDF thumbnail shows a clean product (white/simple background). The matching Excel image may show the same product but possibly on a different background
4. REJECT lifestyle/room scene images that show the product in a staged environment — these have LOW similarity to clean product thumbnails
5. Only match if you are confident the same physical product is shown in both images
6. Similarity scoring: 95-100 = identical product, 80-94 = same product different angle/crop, 70-79 = likely same but uncertain, below 70 = no match

CRITICAL IMAGE VALIDATION RULES:
7. REJECT any Excel image that appears to be TEXT (addresses, company names, headers) — these are NOT product images
8. REJECT any Excel image that is a SOLID COLOR BLOCK (solid blue, white, gray rectangles) — these are NOT product images
9. Product images MUST contain a visible physical product (furniture, lighting, decor, etc.) with detail and texture
10. EACH Excel image can ONLY be matched to ONE PDF product — NO DUPLICATE ASSIGNMENTS
11. If multiple PDF products appear similar (e.g., variants of the same model like S999 in different dimensions), each variant MUST still receive a UNIQUE Excel image index. If you cannot find a unique image for each variant, return -1 for the ones without a unique match.

OUTPUT FORMAT (JSON only, no markdown):
{
  "matches": [
    {
      "pdf_product_index": <number>,
      "best_excel_image_index": <number or -1 if no match>,
      "similarity_score": <0-100>,
      "reasoning": "<brief explanation>"
    }
  ]
}

IMPORTANT:
- Each Excel image can only be matched to ONE PDF product (no duplicates)
- If two PDF products would match the same Excel image, assign it to the one with higher similarity
- Return -1 for best_excel_image_index if no Excel image matches above 70% similarity
- Return -1 if the "image" is actually text, a logo, or a solid color block
- Start with { and end with }. No markdown code blocks.`;
}

function buildGeminiContents(
  pdfProducts: any[],
  excelImages: any[],
  prompt: string
): any[] {
  const parts: any[] = [];

  // Add prompt text
  parts.push({ text: prompt });

  // Add PDF product thumbnails as labeled images
  for (let i = 0; i < pdfProducts.length; i++) {
    const product = pdfProducts[i];
    parts.push({
      text: `\n--- PDF_PRODUCT_${i} (model: "${product.model_number}", dims: "${product.dimensions}") ---`,
    });
    parts.push({
      inline_data: {
        mime_type: product.thumbnail_mime || "image/jpeg",
        data: product.thumbnail,
      },
    });
  }

  // Add Excel candidate images
  parts.push({ text: "\n\n--- EXCEL CANDIDATE IMAGES ---" });
  for (let i = 0; i < excelImages.length; i++) {
    const img = excelImages[i];
    parts.push({
      text: `\n--- EXCEL_IMAGE_${i} (index=${img.image_index}, row=${img.from_row ?? "?"}, col=${img.from_col ?? "?"}) ---`,
    });
    parts.push({
      inline_data: {
        mime_type: img.mime_type || "image/png",
        data: img.base64,
      },
    });
  }

  return [{ role: "user", parts }];
}

async function callGemini(
  apiKey: string,
  modelName: string,
  contents: any[]
): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorData}`);
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from the response
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timeout);
  }
}

function parseVisualMatchResponse(
  geminiResult: any,
  pdfProducts: any[],
  excelImages: any[]
): any[] {
  const results: any[] = [];
  const matches = geminiResult?.matches || [];

  // Track which Excel images have been claimed (no duplicates)
  const claimedExcelIndices = new Set<number>();

  // Sort by similarity score descending to resolve conflicts
  const sortedMatches = [...matches].sort(
    (a: any, b: any) => (b.similarity_score || 0) - (a.similarity_score || 0)
  );

  // First pass: assign matches (highest similarity first)
  const assignedProducts = new Map<number, any>();
  for (const match of sortedMatches) {
    const pdfIdx = match.pdf_product_index;
    const excelIdx = match.best_excel_image_index;
    const score = match.similarity_score || 0;

    if (assignedProducts.has(pdfIdx)) continue; // Already assigned
    if (excelIdx === -1 || excelIdx === undefined || excelIdx === null) {
      continue; // No match
    }
    if (claimedExcelIndices.has(excelIdx)) continue; // Already claimed by higher-score match

    const excelImg = excelImages[excelIdx];
    if (!excelImg) continue;

    const status =
      score >= 75
        ? "VERIFIED"
        : score >= SIMILARITY_THRESHOLD
        ? "LOW_CONFIDENCE"
        : "NO_MATCH";

    if (status === "NO_MATCH") continue;

    claimedExcelIndices.add(excelIdx);
    assignedProducts.set(pdfIdx, {
      product_index: pdfProducts.find((p: any) => p.index === pdfIdx)?.index ?? pdfIdx,
      model_number:
        pdfProducts.find((p: any) => p.index === pdfIdx)?.model_number ?? "",
      matched_excel_image_index: excelImg.image_index,
      similarity_score: score,
      excel_image_row: excelImg.from_row ?? -1,
      excel_image_col: excelImg.from_col ?? -1,
      status,
      reasoning: match.reasoning || "",
    });

    console.log(
      `[VISUAL MATCH] PDF Product ${pdfIdx} → Excel Image at [Col ${excelImg.from_col ?? "?"}, Row ${excelImg.from_row ?? "?"}] | Similarity: ${score}% | Status: ${status}`
    );
  }

  // Second pass: fill in all pdf products (including unmatched)
  for (const product of pdfProducts) {
    if (assignedProducts.has(product.index)) {
      results.push(assignedProducts.get(product.index));
    } else {
      results.push({
        product_index: product.index,
        model_number: product.model_number,
        matched_excel_image_index: -1,
        similarity_score: 0,
        excel_image_row: -1,
        excel_image_col: -1,
        status: "NO_MATCH",
        reasoning: "No visually similar Excel image found above threshold",
      });
      console.log(
        `[VISUAL MATCH] PDF Product ${product.index} → NO MATCH | Model: ${product.model_number}`
      );
    }
  }

  return results;
}
