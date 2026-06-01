import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * gemini-excel-catalog
 * ────────────────────────────────────────────────────────────────────
 * Accepts images extracted from Excel spreadsheet cells and uses Gemini
 * vision to identify/describe products in those images, returning
 * structured product data that can be merged with parsed Excel rows.
 *
 * v2: Added chunked processing, retry resilience, and detailed error reporting.
 *
 * Input:
 * {
 *   images: Array<{ data: string; mimeType: string; sheetName?: string; rowHint?: number }>,
 *   model?: string,
 *   factory_name?: string,
 *   factory_code?: string,
 *   products_context?: Array<{ title: string; modelNumber: string; rowIndex: number; material?: string }>,
 *   text_only_naming?: boolean
 * }
 *
 * Output:
 * {
 *   image_matches: Array<{...}>,
 *   processing_info?: { chunks_processed: number; total_images: number; errors?: string[] }
 * }
 */

const GEMINI_FETCH_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_IMAGES_PER_CHUNK = 8; // Process images in chunks to avoid payload limits
const MAX_RETRIES = 2;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  let requestBody: any = null;

  try {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Parse request body with size guard
    try {
      const contentLength = req.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 30 * 1024 * 1024) {
        console.error(`[gemini-excel-catalog] Content-Length too large: ${contentLength}`);
        return new Response(
          JSON.stringify({ 
            error: "Request body too large",
            detail: `Content-Length: ${contentLength} bytes exceeds 30MB limit.`,
            hint: "Send fewer images per batch. Max recommended: 8 images per request."
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 413 }
        );
      }
      requestBody = await req.json();
    } catch (parseErr: any) {
      console.error("[gemini-excel-catalog] Request body parse error:", parseErr.message);
      return new Response(
        JSON.stringify({ 
          error: "Failed to parse request body",
          detail: parseErr.message,
          hint: "Request body may exceed size limits or contain invalid JSON. Try sending fewer images."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const { images, model, factory_name, factory_code, products_context, text_only_naming } = requestBody;

    if (!images || !Array.isArray(images)) {
      return new Response(
        JSON.stringify({ error: "images field missing or invalid" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const hasImages = images.length > 0;
    const modelName = model || "gemini-2.5-flash";
    const isPJSMode = factory_code === 'PJS' || (factory_name && (factory_name.includes('爵尚') || factory_name.includes('PJS')));
    const isTextOnly = text_only_naming === true || !hasImages;

    console.log(`[gemini-excel-catalog] Processing ${images.length} images with ${modelName}, factory: ${factory_name || 'unknown'} (code: ${factory_code || 'none'}) PJS: ${isPJSMode} textOnly: ${isTextOnly}`);

    // Estimate payload size for diagnostics
    const estimatedPayloadKB = Math.round(JSON.stringify(images).length / 1024);
    console.log(`[gemini-excel-catalog] Estimated images payload: ${estimatedPayloadKB}KB`);

    // Build context about existing products from Excel parsing
    let productsContextStr = "";
    if (products_context && Array.isArray(products_context) && products_context.length > 0) {
      productsContextStr = `\n\nHere are the products extracted from the Excel spreadsheet:\n${products_context.map((p: any, i: number) => `  ${i + 1}. Model: "${p.modelNumber}" | Title: "${p.title}" | Row: ${p.rowIndex}${p.material ? ` | Material: "${p.material}"` : ''}`).join("\n")}\n`;
    }

    // Build prompts
    const bilingualNote = isPJSMode ? `
CRITICAL NAMING RULES (PJS/爵尚家具 — MANDATORY):
1. The title_en MUST start with the model number, followed by a dash and an English name.
   CORRECT:   "095 - Luxury Velvet Armchair"
   INCORRECT: "Luxury Velvet Armchair" (missing model prefix)
   INCORRECT: "2024年休閒配套明細 - Row 5" (NEVER use sheet/row references)
2. The title_zh must also start with the model number.
   CORRECT:   "095 - 奢華絨布休閒椅"
3. Use the material description to generate a descriptive, professional name.
4. The description should reference the material in natural language.
` : '';

    // ═══════════════════════════════════════════════════════════════════
    // TEXT-ONLY MODE: Generate bilingual names from material descriptions
    // ═══════════════════════════════════════════════════════════════════
    if (isTextOnly) {
      const textOnlyPrompt = `You are a product naming expert for a furniture/home goods company.
${bilingualNote}
You are given a list of products with model numbers and material descriptions.
Generate professional bilingual product names for EACH product.
${productsContextStr}

Return a JSON object with this EXACT structure:
{
  "image_matches": [
    {
      "image_index": -1,
      "matched_model_number": "095",
      "matched_product_title": "095 - Luxury Velvet Sofa",
      "title_en": "095 - Luxury Velvet Armchair",
      "title_zh": "095 - 奢華絨布休閒椅",
      "description": "A premium velvet armchair with solid wood frame",
      "tags": ["furniture", "sofa", "velvet"],
      "confidence": 0.9
    }
  ]
}

Rules:
- Generate one entry per product in the products list above
- image_index should be -1 for text-only mode
- title_en MUST start with the model number for PJS products
- Respond ONLY with the JSON object, no markdown or extra text
- Start with { and end with }`;

      const result = await callGeminiWithRetry(geminiApiKey, modelName, [{ text: textOnlyPrompt }], MAX_RETRIES);
      
      if (result.error) {
        return new Response(
          JSON.stringify({ error: result.error, detail: result.detail }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: result.status || 502 }
        );
      }

      return new Response(
        JSON.stringify({
          ...result.data,
          processing_info: { chunks_processed: 1, total_images: 0, mode: 'text_only' }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // VISION MODE: Process images in chunks to avoid payload/timeout limits
    // ═══════════════════════════════════════════════════════════════════
    const allImageMatches: any[] = [];
    const chunkErrors: string[] = [];
    const chunks: any[][] = [];

    // Split images into manageable chunks
    for (let i = 0; i < images.length; i += MAX_IMAGES_PER_CHUNK) {
      chunks.push(images.slice(i, i + MAX_IMAGES_PER_CHUNK));
    }

    console.log(`[gemini-excel-catalog] Splitting ${images.length} images into ${chunks.length} chunks of max ${MAX_IMAGES_PER_CHUNK}`);

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];
      const chunkStartIndex = chunkIdx * MAX_IMAGES_PER_CHUNK;

      console.log(`[gemini-excel-catalog] Processing chunk ${chunkIdx + 1}/${chunks.length} (images ${chunkStartIndex} to ${chunkStartIndex + chunk.length - 1})`);

      // Build context string for this chunk's products only
      let chunkProductsContext = "";
      if (products_context && Array.isArray(products_context)) {
        const relevantProducts = products_context.slice(chunkStartIndex, chunkStartIndex + chunk.length);
        if (relevantProducts.length > 0) {
          chunkProductsContext = `\n\nHere are the products for THIS batch of images (indices ${chunkStartIndex} to ${chunkStartIndex + chunk.length - 1}):\n${relevantProducts.map((p: any, i: number) => `  Image[${chunkStartIndex + i}] → Model: "${p.modelNumber}" | Title: "${p.title}" | Row: ${p.rowIndex}${p.material ? ` | Material: "${p.material}"` : ''}`).join("\n")}\n`;
        }
      }

      const visionPrompt = `You are a product image analyst for a furniture/home goods catalog. You are given product images (白底產品圖 — white-background product shots) extracted from an Excel spreadsheet.
${bilingualNote}
For EACH image, identify what product it shows and provide structured data.
${chunkProductsContext || productsContextStr}

IMPORTANT MATCHING RULES:
- Each image is a white-background product image (產品圖片) extracted from the product image column of the spreadsheet.
- Image index ${chunkStartIndex} = first image in this batch, maps to product at position ${chunkStartIndex} in the full product list.
- Match each image to the corresponding product by order.
- If you can identify the model number from the image itself, use that to override the order.
- Do NOT describe lifestyle/effect images (效果圖) — those are separate and not provided here.

Return a JSON object with this EXACT structure:
{
  "image_matches": [
    {
      "image_index": ${chunkStartIndex},
      "matched_model_number": "095",
      "matched_product_title": "095 - Luxury Velvet Armchair",
      "title_en": "095 - Luxury Velvet Armchair",
      "title_zh": "095 - 奢華絨布休閒椅",
      "description": "Brief bilingual product description based on what you see and the material description",
      "tags": ["furniture", "sofa", "leather"],
      "color": "Brown",
      "material": "Leather",
      "confidence": 0.85
    }
  ]
}

Rules:
- image_index corresponds to the GLOBAL position (0-based) — starts at ${chunkStartIndex} for this batch
- For title_en: MUST follow format "[ModelNumber] - [English Name]" — NEVER omit the model prefix
- For title_zh: MUST follow format "[ModelNumber] - [中文名稱]"
- Use the model number from the products context list above for each image
- Respond ONLY with the JSON object, no markdown or extra text
- Start with { and end with }`;

      // Build parts with images
      const parts: any[] = [{ text: visionPrompt }];
      for (const img of chunk) {
        if (img.data && img.mimeType) {
          parts.push({
            inline_data: {
              mime_type: img.mimeType,
              data: img.data,
            },
          });
        }
      }

      try {
        const result = await callGeminiWithRetry(geminiApiKey, modelName, parts, MAX_RETRIES);
        
        if (result.error) {
          const errMsg = `Chunk ${chunkIdx + 1} failed: ${result.error} (images ${chunkStartIndex}-${chunkStartIndex + chunk.length - 1})`;
          console.error(`[gemini-excel-catalog] ${errMsg}`);
          chunkErrors.push(errMsg);
          continue; // Continue with next chunk instead of failing entirely
        }

        if (result.data?.image_matches && Array.isArray(result.data.image_matches)) {
          allImageMatches.push(...result.data.image_matches);
          console.log(`[gemini-excel-catalog] Chunk ${chunkIdx + 1}: got ${result.data.image_matches.length} matches`);
        }
      } catch (chunkErr: any) {
        const errMsg = `Chunk ${chunkIdx + 1} exception: ${chunkErr.message} (images ${chunkStartIndex}-${chunkStartIndex + chunk.length - 1})`;
        console.error(`[gemini-excel-catalog] ${errMsg}`);
        chunkErrors.push(errMsg);
      }
    }

    console.log(`[gemini-excel-catalog] All chunks done: ${allImageMatches.length} total matches, ${chunkErrors.length} chunk errors`);

    // If ALL chunks failed, return error
    if (allImageMatches.length === 0 && chunkErrors.length > 0) {
      return new Response(
        JSON.stringify({ 
          error: "All image processing chunks failed",
          detail: chunkErrors.join("; "),
          chunks_attempted: chunks.length,
          hint: "Try reducing the number of images or check if the images are too large."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
      );
    }

    return new Response(
      JSON.stringify({
        image_matches: allImageMatches,
        processing_info: {
          chunks_processed: chunks.length - chunkErrors.length,
          chunks_failed: chunkErrors.length,
          total_images: images.length,
          errors: chunkErrors.length > 0 ? chunkErrors : undefined,
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: any) {
    console.error("[gemini-excel-catalog] Unhandled error:", error);
    // Provide as much diagnostic info as possible
    const imageCount = requestBody?.images?.length ?? 'unknown';
    const productCount = requestBody?.products_context?.length ?? 'unknown';
    return new Response(
      JSON.stringify({ 
        error: error.message || "Internal error",
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        context: {
          images_count: imageCount,
          products_count: productCount,
          factory: requestBody?.factory_code || requestBody?.factory_name || 'unknown',
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

/**
 * Call Gemini API with retry logic and exponential backoff.
 */
async function callGeminiWithRetry(
  apiKey: string,
  modelName: string,
  parts: any[],
  maxRetries: number
): Promise<{ data?: any; error?: string; detail?: string; status?: number }> {
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`[gemini-excel-catalog] Retry attempt ${attempt}/${maxRetries} after ${backoffMs}ms backoff`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_FETCH_TIMEOUT_MS);

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
      });

      clearTimeout(timeout);

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error(`[gemini-excel-catalog] Gemini API error (attempt ${attempt + 1}): ${geminiRes.status}`, errText.substring(0, 500));
        
        // Don't retry on 4xx errors (client error, won't help)
        if (geminiRes.status >= 400 && geminiRes.status < 500) {
          return { error: `Gemini API error: ${geminiRes.status}`, detail: errText.substring(0, 1000), status: 502 };
        }
        
        // Retry on 5xx (server error)
        if (attempt === maxRetries) {
          return { error: `Gemini API error after ${maxRetries + 1} attempts: ${geminiRes.status}`, detail: errText.substring(0, 1000), status: 502 };
        }
        continue;
      }

      const geminiData = await geminiRes.json();
      const textContent = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        if (attempt === maxRetries) {
          return { error: "No response text from Gemini", detail: JSON.stringify(geminiData).substring(0, 500), status: 502 };
        }
        continue;
      }

      // Parse the JSON response
      try {
        const cleaned = textContent.replace(/```json\s*|```\s*/g, "").trim();
        const parsed = JSON.parse(cleaned);
        return { data: parsed };
      } catch (parseErr: any) {
        console.error(`[gemini-excel-catalog] JSON parse error (attempt ${attempt + 1}):`, parseErr.message);
        console.error(`[gemini-excel-catalog] Raw response (first 500 chars):`, textContent.substring(0, 500));
        
        if (attempt === maxRetries) {
          return { error: "Failed to parse Gemini response as JSON", detail: textContent.substring(0, 1000), status: 500 };
        }
        continue;
      }

    } catch (fetchErr: any) {
      clearTimeout(timeout);
      
      if (fetchErr.name === "AbortError") {
        console.error(`[gemini-excel-catalog] Timeout on attempt ${attempt + 1}`);
        if (attempt === maxRetries) {
          return { error: `Gemini API timeout after ${maxRetries + 1} attempts`, status: 504 };
        }
        continue;
      }

      console.error(`[gemini-excel-catalog] Fetch error on attempt ${attempt + 1}:`, fetchErr.message);
      if (attempt === maxRetries) {
        return { error: `Network error: ${fetchErr.message}`, status: 502 };
      }
      continue;
    }
  }

  return { error: "Exhausted all retry attempts", status: 502 };
}
