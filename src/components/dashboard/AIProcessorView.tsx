import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  FileImage,
  FileText,
  X,
  Sparkles,
  Tag,
  DollarSign,
  FolderOpen,
  Check,
  Loader2,
  Eye,
  AlertTriangle,
  FileStack,
  Grid3X3,
  ChevronDown,
  ChevronUp,
  Ruler,
  Layers,
  CheckCircle2,
  RotateCcw,
  BarChart3,
  Factory,
  ChevronsUpDown,
  FileSpreadsheet,
  Play,
} from 'lucide-react';
import { Product } from '@/types/product';
import { OFFICIAL_PRODUCT_TAGS } from '@/constants/product-tags';
import { MANUFACTURERS } from '@/constants/manufacturers';
import { COLOR_MAP } from '@/constants/color-map';
import { TagSelector } from './TagSelector';
import { ColorSelector } from './ColorSelector';
import { CascadingCategorySelector } from './CascadingCategorySelector';
import { supabase } from '@/lib/supabase';
import { fetchFactories, fetchFactoriesWithIds, FactoryItem } from '@/lib/factorySupabase';
import { parseExcelFile, extractImagesFromWorkbook, extractRawExcelTable, ExcelProduct, ExcelImage, getFactoryRule, RawTableExtraction, cleanPrice, parseSmartDimensions, parseDeliveryTerm } from '@/lib/excelParser';
import { ExcelPreviewTable, ExcelPreviewData, ColumnMappingState, StandardHeaderValue, MultiSheetColumnMapping, MultiSheetDimUnits, DimUnit, PreviewAction } from '@/components/dashboard/ExcelPreviewTable';
import { simplifiedToTraditional, convertRowToTraditional } from '@/lib/chineseConverter';
import { useFactoryLearning, CorrectableField } from '@/hooks/use-factory-learning';
import { toast } from 'sonner';
import { saveSession, loadSession, clearSession, clearMappings } from '@/lib/sessionStore';

// LAZY LOAD: pdfjs-dist is loaded dynamically only when needed to avoid blocking initial render
let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let pdfjsLoadPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  if (!pdfjsLoadPromise) {
    pdfjsLoadPromise = import('pdfjs-dist').then((mod) => {
      pdfjsLib = mod;
      mod.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${mod.version}/pdf.worker.min.mjs`;
      return mod;
    });
  }
  return pdfjsLoadPromise;
}

// ─── PDF Page Rendering ───────────────────────────────────────────

/** Render a single PDF page to a base64 JPEG image */
// V20 FIX 2: Increased scale from 2.0 → 3.0 for high-quality rendering
// Low scale causes bounding_box math to fall into empty sub-pixels → blank crops
// 2.0x balances clarity vs memory. At 3.0x a single A4 canvas is ~35MB and
// rendering many pages can OOM the browser tab/window. 2.0x ≈ 55% less memory.
const PDF_RENDER_SCALE = 2.0;
const PDF_JPEG_QUALITY = 0.88;

async function renderPdfPageToImage(
  pdfData: ArrayBuffer,
  pageNumber: number,
): Promise<{ data: string; mimeType: string; page: number } | null> {
  try {
    const pdfjs = await getPdfjs();
    const clonedData = new Uint8Array(new Uint8Array(pdfData)).buffer;
    const pdf = await pdfjs.getDocument({ data: clonedData }).promise;
    if (pageNumber > pdf.numPages || pageNumber < 1) return null;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // V20: Properly await the render promise — this ensures PDF.js finishes painting all vectors/text
    console.log(`[AIProcessor] 🖨️ V20 Rendering page ${pageNumber} at ${PDF_RENDER_SCALE}x scale (${viewport.width}×${viewport.height}px)...`);
    const renderTask = page.render({ canvasContext: ctx, viewport });
    await renderTask.promise;

    // V20: After render().promise resolves, wait for browser compositing pipeline to flush
    await new Promise(r => setTimeout(r, 500));
    console.log(`[AIProcessor] ✅ V20 Page ${pageNumber} render complete + 500ms flush delay`);

    // Convert to JPEG base64 (strip the data:image/jpeg;base64, prefix)
    const dataUrl = canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY);
    const base64 = dataUrl.split(',')[1] || '';

    // V20: Validate canvas isn't blank before returning
    if (base64.length < 1000) {
      console.warn(`[AIProcessor] ⚠️ V20 Page ${pageNumber} base64 suspiciously small (${base64.length} chars) — might be blank`);
    }

    // V20 FIX 2: Properly clean up PDF document AFTER extracting the data
    // Cleanup canvas immediately (GC), then destroy the PDF doc to release memory
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    pdf.destroy();

    return { data: base64, mimeType: 'image/jpeg', page: pageNumber };
  } catch (err) {
    console.warn(`[AIProcessor] Failed to render PDF page ${pageNumber}:`, err);
    return null;
  }
}

/** Get actual page count from a PDF ArrayBuffer */
async function getPdfPageCount(pdfData: ArrayBuffer): Promise<number> {
  try {
    // V20: Clone buffer to prevent detachment — same as renderPdfPageToImage
    const pdfjs = await getPdfjs();
    const clonedData = new Uint8Array(new Uint8Array(pdfData)).buffer;
    const pdf = await pdfjs.getDocument({ data: clonedData }).promise;
    const numPages = pdf.numPages;
    pdf.destroy(); // V20: Explicitly destroy after use
    return numPages;
  } catch {
    return 0;
  }
}

// ─── Types ────────────────────────────────────────────────────────

interface AIProcessorViewProps {
  onAddProduct: (product: Omit<Product, 'id' | 'createdAt' | 'status' | 'source'>) => void;
  onNavigateToPublish: () => void;
  selectedModel?: string;
  geminiProxyUrl?: string;
}

interface UploadedFile {
  id: string;
  file: File;
  name: string;
  type: string;
  thumbnail: string;
  base64Data: string;
  mimeType: string;
}

interface AIFields {
  title: string;
  description: string;
  tags: string[];
  price: number;
  collection: string;
}

interface CatalogProduct {
  id: string;
  title: string;
  titleEn?: string; // AI-generated English title
  titleZh?: string; // AI-generated Chinese title
  description: string;
  tags: string[];
  price: number;
  collection: string;
  material: string;
  dimensions: string;
  image_region: string;
  page_number: number;
  selected: boolean;
  expanded: boolean;
  cropped_image_url?: string; // unique per-product cropped image data URL
  bounding_box?: number[] | null;
  image_type?: string;
  factoriesDisplayName?: string;
  costPrice?: number | null;
  productionLeadTime?: number | null;
  productionTime?: string | null;
  deliveryDays?: number | null;
  shippingDays?: number | null;
  shippingFee?: number | null;
  remarks?: string | null;
  specifications?: string | null;
  imageUrl2?: string | null;
  imageUrl3?: string | null;
  color?: string | null;
  bbox_quality?: 'ok' | 'too_thin' | 'too_wide' | 'too_tall' | 'failed' | 'invalid'; // Red Border Debug quality flag
  grid_position?: string; // e.g. "r0c1" from Gemini's grid detection
  // Excel-specific dimension fields (in MM)
  dimensionLMm?: number | null;
  dimensionWMm?: number | null;
  dimensionHMm?: number | null;
  modelNumber?: string;
  // Image slots
  lifestyleImageUrl?: string;        // 效果圖 (lifestyle/scene shot, Column B)
  additional_images?: string[];      // Additional images for Shopify (includes lifestyle)
  // Delivery term (parsed from 參考貨期 column for CYZ)
  deliveryTermId?: string | null;
  deliveryTermName?: string | null;
  // Cross-reference source tracking (PDF+Excel merge mode)
  imageSource?: 'pdf' | 'excel' | 'ai' | null;   // Where the product image came from
  dataSource?: 'pdf' | 'excel' | 'ai' | null;    // Where the spec data came from
  imageValidated?: boolean; // Whether the image was validated (correct column)
}

type ProcessingMode = 'idle' | 'single-image' | 'pdf-catalog' | 'excel-catalog' | 'excel-pdf-crossref';

interface ProcessingProgress {
  phase: 'uploading' | 'analyzing' | 'extracting' | 'complete' | 'error';
  message: string;
  detail?: string;
}

interface BatchProgress {
  currentBatch: number;
  totalBatches: number;
  startPage: number;
  endPage: number;
  totalPages: number;
  pagesPerBatch: number;
  productsFoundSoFar: number;
  batchErrors: Array<{ batch: number; error: string }>;
  successfulBatches: number;
  isLargeFile: boolean;
  uploadSessionId: string;
  elapsedSeconds: number;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Downscale an image file to max width/height, compress as JPEG for smaller payload */
const MAX_IMAGE_DIMENSION = 1024;
const IMAGE_JPEG_QUALITY = 0.75;

async function downsampleImage(file: File): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  // PDFs cannot be downsampled in the browser — pass through
  if (file.type === 'application/pdf') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1] || '';
        resolve({ dataUrl, base64, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // For images — use OffscreenCanvas if available (non-blocking), fallback to regular canvas
  const imageBitmap = await createImageBitmap(file);
  let { width, height } = imageBitmap;

  // Only downscale if larger than MAX_IMAGE_DIMENSION
  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
    imageBitmap.close();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1] || '';
        resolve({ dataUrl, base64, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);

  // Prefer OffscreenCanvas (off-main-thread rendering) when available
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const offscreen = new OffscreenCanvas(newWidth, newHeight);
      const ctx = offscreen.getContext('2d');
      if (ctx) {
        ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
        imageBitmap.close();
        const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: IMAGE_JPEG_QUALITY });
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        // Use chunk-based approach to avoid O(n²) string concatenation
        const CHUNK_SIZE = 8192;
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
          chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
        }
        const base64 = btoa(chunks.join(''));
        const dataUrl = `data:image/jpeg;base64,${base64}`;
        console.log(
          `[AIProcessor] Downsampled (OffscreenCanvas): ${width}×${height} → ${newWidth}×${newHeight} ` +
          `(${(file.size / 1024).toFixed(0)}KB → ~${((base64.length * 3) / 4 / 1024).toFixed(0)}KB)`
        );
        return { dataUrl, base64, mimeType: 'image/jpeg' };
      }
    } catch (e) {
      console.warn('[AIProcessor] OffscreenCanvas failed, falling back to regular canvas', e);
    }
  }

  // Fallback: regular canvas
  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    imageBitmap.close();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1] || '';
        resolve({ dataUrl, base64, mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  ctx.drawImage(imageBitmap, 0, 0, newWidth, newHeight);
  imageBitmap.close();
  const compressedDataUrl = canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
  const compressedBase64 = compressedDataUrl.split(',')[1] || '';
  console.log(
    `[AIProcessor] Downsampled (canvas): ${width}×${height} → ${newWidth}×${newHeight} ` +
    `(${(file.size / 1024).toFixed(0)}KB → ~${((compressedBase64.length * 3) / 4 / 1024).toFixed(0)}KB)`
  );
  return { dataUrl: compressedDataUrl, base64: compressedBase64, mimeType: 'image/jpeg' };
}

function readFileAsBase64(file: File): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  // Use downsampling for all files (PDFs pass through, images get resized)
  return downsampleImage(file);
}

// ─── Vision Prompt (single image mode) ───────────────────────────

const VISION_ANALYSIS_PROMPT = `You are a senior product copywriter for BrandingWorks, a premium Hong Kong furniture & office equipment distributor specializing in School, F&B/Hotel, and Office sectors.

Analyze the uploaded image(s) in detail — identify the furniture type, visible materials, build quality, design style, intended environment, and any distinctive features. Then determine the PRIMARY SECTOR this product serves:
• SCHOOL — desks, chairs, storage for classrooms, tutorial centers
• F&B / HOTEL — dining chairs, tables, booths, café furniture
• OFFICE — executive chairs, desks, conference tables, workstations

PRODUCT TITLE — Follow this EXACT naming pattern:
  [Chinese Name] [English Name] | [Slogan]

PRODUCT DESCRIPTION — Generate valid HTML using h3, p, ul, li, strong tags with 5 sections:
SECTION 1: Intro, SECTION 2: Core Features (3-5 bullet points), SECTION 3: Design Details, SECTION 4: Application Scenarios, SECTION 5: Conclusion

TAGS — Select ALL relevant tags from this official list ONLY:
${OFFICIAL_PRODUCT_TAGS.join(', ')}

PRICE — Suggest a retail price in HKD.

COLLECTION — Assign to one: "Office Furniture", "Education Furniture", "Conference Furniture", "Training Furniture", "Storage Solutions", "Reception & Lounge", "Industrial Furniture", "Outdoor Furniture", "School Furniture", "F&B Furniture", or "Accessories".

OUTPUT FORMAT — Return ONLY a valid JSON object (no markdown fences):
{
  "title": "Chinese English | Slogan",
  "description": "<h3>...</h3><p>...</p>...",
  "tags": ["tag1", "tag2"],
  "price": 2880.00,
  "collection": "Collection Name"
}`;

// ─── Single Image AI Analysis ─────────────────────────────────────

async function analyzeImageWithAI(
  imageFiles: UploadedFile[],
  _modelName: string = 'gemini-2.5-flash',
): Promise<AIFields> {
  const imageParts = imageFiles
    .filter(f => f.base64Data && f.mimeType.startsWith('image/'))
    .map(f => {
      let cleanBase64 = f.base64Data.replace(/^data:image\/\w+;base64,/, '');
      cleanBase64 = cleanBase64.replace(/\s/g, '');
      const dynamicMimeType = f.mimeType === 'image/jpg' ? 'image/jpeg' : f.mimeType;
      return { inlineData: { mimeType: dynamicMimeType, data: cleanBase64 } };
    });

  if (imageParts.length === 0) {
    throw new Error('No valid image files found. Please upload at least one image (JPG, PNG, or WEBP).');
  }

  const MAX_RETRIES = 2;
  let responseText: string | undefined;

  const edgeFunctionPayload = {
    model: 'gemini-2.5-flash',
    contents: [{ parts: [{ text: VISION_ANALYSIS_PROMPT }, ...imageParts] }],
  };

  // ALWAYS use direct fetch to bypass Supabase relay's ~6MB body limit
  // The relay (supabase.functions.invoke) frequently fails with "Failed to send request to functions-relay"
  const payloadJson = JSON.stringify(edgeFunctionPayload);
  const payloadSizeBytes = payloadJson.length;
  
  console.log(`[analyzeImageWithAI] Payload size: ${(payloadSizeBytes / 1024 / 1024).toFixed(2)}MB — using direct fetch (relay bypass)`);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. Check project settings.');
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      let data: any;
      let error: any;

      // Direct fetch bypasses the Supabase relay's body limit entirely
      const fnUrl = `${supabaseUrl}/functions/v1/supabase-functions-gemini-proxy`;
      console.log(`[analyzeImageWithAI] Attempt ${attempt + 1}/${MAX_RETRIES + 1} → POST ${fnUrl} (${(payloadSizeBytes / 1024).toFixed(0)}KB)`);
      
      const response = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'apikey': supabaseAnonKey,
        },
        body: payloadJson,
      });

      if (!response.ok) {
        let errorBody: string;
        try { const ed = await response.json(); errorBody = ed?.error || JSON.stringify(ed); }
        catch { errorBody = `HTTP ${response.status} ${response.statusText}`; }
        console.error(`[analyzeImageWithAI] HTTP ${response.status} error:`, errorBody);
        error = { message: `Edge Function error (${response.status}): ${errorBody}` };
      } else {
        data = await response.json();
      }

      if (error) {
        const errMsg = error.message || String(error);
        // Detect network/payload errors
        if (errMsg.includes('relay') || errMsg.includes('Failed to send') || errMsg.includes('FunctionsFetchError') || errMsg.includes('Failed to fetch')) {
          throw new Error(`Network request failed (~${(payloadSizeBytes / 1024 / 1024).toFixed(1)}MB payload). Try uploading a smaller image or check your internet connection.`);
        }
        if (errMsg.includes('GEMINI_API_KEY')) {
          throw new Error('GEMINI_API_KEY is not configured in Supabase Edge Function secrets.');
        }
        throw new Error(`Edge Function error: ${errMsg}`);
      }

      if (data?.error) {
        const geminiError = data.error?.message || JSON.stringify(data.error);
        const is429 = geminiError.includes('429') || geminiError.toLowerCase().includes('quota');
        if (is429 && attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
          continue;
        }
        throw new Error(`Gemini API error: ${geminiError}`);
      }

      responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) throw new Error('AI returned an empty response.');
      break;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const is429 = errMsg.includes('429') || errMsg.toLowerCase().includes('quota');
      if (is429 && attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
        continue;
      }
      if (attempt >= MAX_RETRIES) throw err;
    }
  }

  if (!responseText) throw new Error('AI analysis failed after retries.');

  let cleanedText = responseText.trim();
  if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleanedText);
  } catch {
    throw new Error('AI returned an invalid response format.');
  }

  const validTags = (parsed.tags || []).filter((t: string) => OFFICIAL_PRODUCT_TAGS.includes(t));

  return {
    title: parsed.title || 'Untitled Product',
    description: parsed.description || '<p>No description generated.</p>',
    tags: validTags,
    price: typeof parsed.price === 'number' ? parsed.price : 0,
    collection: parsed.collection || 'General',
  };
}

// ─── PDF Catalog: Batch Processing Constants ─────────────────
// ONE page per request — absolute safest for high-res furniture catalogs
const PAGES_PER_BATCH = 1;
// How many single-page requests to send in parallel. Lowered 3→2 to cap how
// many large page canvases live in memory at once (avoids browser OOM crashes).
const PARALLEL_CONCURRENCY = 2;
const INTER_BATCH_DELAY_MS = 500; // shorter delay since requests are tiny now

function estimatePDFPages(fileSizeBytes: number): number {
  return Math.max(1, Math.ceil(fileSizeBytes / (300 * 1024)));
}

function generateUploadSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Normalize a raw production-time cell into one of the 4 allowed options:
 * 'in stock' | 'within 7days' | '7-22days' | '23days or above'.
 * Accepts plain numbers (days), Chinese/English keywords, or "X天/天/日/days".
 * Returns null when nothing usable is found.
 */
function normalizeProductionTime(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();

  // 現貨 / in stock
  if (/現貨|现货|stock|spot/.test(lower) || /現貨|现货/.test(s)) return 'in stock';

  // pull the largest number of days from the string (handles ranges like "7-22天")
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => !isNaN(n));
  const days = nums.length ? Math.max(...nums) : NaN;

  if (!isNaN(days)) {
    if (days <= 0) return 'in stock';
    if (days <= 7) return 'within 7days';
    if (days <= 22) return '7-22days';
    return '23days or above';
  }

  // keyword fallbacks
  if (/within\s*7|7\s*days?\s*內|一週|一周/.test(lower)) return 'within 7days';
  if (/23|above|以上|個月|个月|month/.test(lower)) return '23days or above';
  return null;
}

// ─── PDF Catalog AI Analysis (V6 — Multi-Object Segmentation + Frontend Cropping) ──

async function analyzePDFCatalogBatched(
  pdfFiles: UploadedFile[],
  imageFiles: UploadedFile[],
  modelName: string = 'gemini-2.5-flash',
  onProgress: (p: ProcessingProgress) => void,
  onBatchProgress: (bp: BatchProgress) => void,
  manufacturerName: string = '',
): Promise<CatalogProduct[]> {
  const uploadSessionId = generateUploadSessionId();
  const startTime = Date.now();

  onProgress({ phase: 'uploading', message: 'Preparing files and rendering PDF pages...' });

  const files: { data: string; mimeType: string }[] = [];
  let totalFileSizeBytes = 0;
  // V20 FIX: Store the PDF data as a Uint8Array (not ArrayBuffer) so it stays stable.
  // ArrayBuffer can be detached/transferred by PDF.js or structured cloning.
  // We always create FRESH copies from this source when passing to PDF.js.
  let pdfSourceBytes: Uint8Array | null = null; // Stable source — NEVER pass directly to PDF.js

  for (const pf of pdfFiles) {
    let cleanBase64 = pf.base64Data.replace(/^data:[^;]+;base64,/, '');
    cleanBase64 = cleanBase64.replace(/\s/g, '');
    files.push({ data: cleanBase64, mimeType: 'application/pdf' });
    totalFileSizeBytes += Math.ceil((cleanBase64.length * 3) / 4);

    // Convert base64 to Uint8Array for pdfjs rendering (stored as stable source)
    if (!pdfSourceBytes) {
      const binaryString = atob(cleanBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      pdfSourceBytes = bytes; // Store the Uint8Array, NOT bytes.buffer
      console.log(`[AIProcessor] 📦 V20: PDF source bytes stored (${bytes.length} bytes) — will clone for each PDF.js call`);
    }
  }

  for (const img of imageFiles) {
    let cleanBase64 = img.base64Data.replace(/^data:[^;]+;base64,/, '');
    cleanBase64 = cleanBase64.replace(/\s/g, '');
    const mimeType = img.mimeType === 'image/jpg' ? 'image/jpeg' : img.mimeType;
    files.push({ data: cleanBase64, mimeType });
    totalFileSizeBytes += Math.ceil((cleanBase64.length * 3) / 4);
  }

  if (files.length === 0) throw new Error('No valid files to process.');

  // Use actual PDF page count if possible, fallback to estimation
  let estimatedPages = estimatePDFPages(totalFileSizeBytes);
  if (pdfSourceBytes) {
    // V20: Create a fresh ArrayBuffer copy for getPdfPageCount (avoids detachment)
    const actualPageCount = await getPdfPageCount(new Uint8Array(pdfSourceBytes).buffer);
    if (actualPageCount > 0) {
      console.log(`[AIProcessor] Actual PDF page count: ${actualPageCount} (estimate was ${estimatedPages})`);
      estimatedPages = actualPageCount;
    }
  }

  // V17: ALWAYS use page-by-page batch processing to stay under Supabase's 150s idle timeout.
  // The old single-shot path sent the entire PDF + all page images in one request, which
  // regularly exceeded the 150s limit for dense catalogs, causing 504 IDLE_TIMEOUT errors.
  const isLargeFile = true; // Force batch mode for all files
  const totalBatches = Math.ceil(estimatedPages / PAGES_PER_BATCH);
  const estimatedMB = (totalFileSizeBytes / (1024 * 1024)).toFixed(1);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  /** Helper: build a cropped_image_url data URL from base64 */
  function buildCroppedImageUrl(base64: string, mime: string = 'image/jpeg'): string {
    return `data:${mime};base64,${base64}`;
  }

  /**
   * FRONTEND-SIDE PER-PRODUCT CROPPING (Dynamic Grid Perception v2)
   * Layout-agnostic: only cares about the 4 bounding box numbers it receives.
   * Works identically for 3×3, 3×4, 4×4, or any grid density.
   * bounding_box = [ymin, xmin, ymax, xmax] normalized to 0–1000 scale.
   * Returns a data URL of the cropped image, or null if cropping fails.
   */
  /**
   * SAFETY_PADDING_RATIO: 5% extra padding around bounding boxes to avoid edge cutoff.
   * Critical for dense grids (4×4) where cells are smaller and chair legs can get clipped.
   */
  const SAFETY_PADDING_RATIO = 0.05;

  /**
   * Bounding box quality flags for Red Border Debug mode.
   * 'ok' = valid crop, 'too_thin' = suspiciously narrow, 'too_wide' = suspiciously wide,
   * 'too_tall' = suspiciously tall, 'failed' = crop failed entirely
   */
  type BboxQuality = 'ok' | 'too_thin' | 'too_wide' | 'too_tall' | 'failed' | 'invalid';

  function assessBboxQuality(bbox: [number, number, number, number]): BboxQuality {
    const [ymin, xmin, ymax, xmax] = bbox;
    const bboxWidth = xmax - xmin;
    const bboxHeight = ymax - ymin;

    // Too thin: width or height < 50 units on 0-1000 scale (indicates failed grid read)
    if (bboxWidth < 50 || bboxHeight < 50) return 'too_thin';
    // Too wide: width > 600 units (spans more than 60% of page — likely multi-product)
    if (bboxWidth > 600) return 'too_wide';
    // Too tall: height > 600 units (spans more than 60% of page — likely multi-product)
    if (bboxHeight > 600) return 'too_tall';
    // Extreme aspect ratio: one dimension is 5x the other (likely wrong grid cell)
    const aspectRatio = bboxWidth / bboxHeight;
    if (aspectRatio > 5 || aspectRatio < 0.2) return 'too_thin';

    return 'ok';
  }

  /**
   * V20 FIX 3: Check if a canvas crop is a solid color (blank/white/gray).
   * Samples pixels at strategic positions. If >95% of sampled pixels are the same color (±5),
   * the crop is considered "solid" (blank).
   */
  function isSolidColorCrop(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
  ): boolean {
    try {
      // Sample a grid of points across the image
      const sampleCount = 25; // 5×5 grid
      const stepX = Math.max(1, Math.floor(width / 6));
      const stepY = Math.max(1, Math.floor(height / 6));
      const samples: { r: number; g: number; b: number }[] = [];

      for (let sy = 1; sy <= 5; sy++) {
        for (let sx = 1; sx <= 5; sx++) {
          const px = Math.min(sx * stepX, width - 1);
          const py = Math.min(sy * stepY, height - 1);
          const pixel = ctx.getImageData(px, py, 1, 1).data;
          samples.push({ r: pixel[0], g: pixel[1], b: pixel[2] });
        }
      }

      if (samples.length === 0) return true;

      // Check if all sampled pixels are within ±5 of the first pixel (solid color)
      const ref = samples[0];
      const tolerance = 5;
      const uniformCount = samples.filter(
        s => Math.abs(s.r - ref.r) <= tolerance &&
             Math.abs(s.g - ref.g) <= tolerance &&
             Math.abs(s.b - ref.b) <= tolerance
      ).length;

      const uniformRatio = uniformCount / samples.length;
      const isSolid = uniformRatio > 0.95;

      if (isSolid) {
        console.warn(`[AIProcessor] ⚠️ V20 SOLID COLOR DETECTED: ${Math.round(uniformRatio * 100)}% uniform (ref: rgb(${ref.r},${ref.g},${ref.b}))`);
      }

      return isSolid;
    } catch (err) {
      console.warn('[AIProcessor] V20 solid color check failed:', err);
      return false; // Assume not solid if check fails
    }
  }

  async function cropProductFromPageImage(
    pageImageBase64: string,
    pageMimeType: string,
    boundingBox: [number, number, number, number],
    _retryAttempt: number = 0, // V20: retry parameter for solid-color retry
  ): Promise<{ dataUrl: string | null; quality: BboxQuality }> {
    try {
      const [ymin, xmin, ymax, xmax] = boundingBox;

      // Validate bounding box
      if (ymin >= ymax || xmin >= xmax || ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) {
        console.warn(`[AIProcessor] Invalid bounding box: [${boundingBox.join(',')}]`);
        return { dataUrl: null, quality: 'invalid' };
      }

      // Don't allow full-page bounding boxes (likely duplicates)
      if (ymin <= 5 && xmin <= 5 && ymax >= 995 && xmax >= 995) {
        console.warn(`[AIProcessor] Rejecting full-page bounding box: [${boundingBox.join(',')}]`);
        return { dataUrl: null, quality: 'too_wide' };
      }

      // Assess quality before cropping
      const quality = assessBboxQuality(boundingBox);
      if (quality !== 'ok') {
        console.warn(`[AIProcessor] ⚠️ Bbox quality issue [${quality}]: [${boundingBox.join(',')}] (w=${xmax-xmin}, h=${ymax-ymin})`);
        // Still attempt to crop — the Red Border Debug UI will flag it visually
      }

      // Apply 5% safety padding to the bounding box (in normalized 0-1000 space)
      // This is critical for dense grids (4×4) where cells are small
      const bboxWidth = xmax - xmin;
      const bboxHeight = ymax - ymin;
      const padX = Math.round(bboxWidth * SAFETY_PADDING_RATIO);
      const padY = Math.round(bboxHeight * SAFETY_PADDING_RATIO);
      const paddedYmin = Math.max(0, ymin - padY);
      const paddedXmin = Math.max(0, xmin - padX);
      const paddedYmax = Math.min(1000, ymax + padY);
      const paddedXmax = Math.min(1000, xmax + padX);

      // Create an image from the base64 data
      const imgSrc = `data:${pageMimeType};base64,${pageImageBase64}`;
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load page image for cropping'));
        img.src = imgSrc;
      });

      const imgWidth = img.naturalWidth;
      const imgHeight = img.naturalHeight;

      // Convert padded normalized coords (0-1000) to pixel coords
      const cropX = Math.round((paddedXmin / 1000) * imgWidth);
      const cropY = Math.round((paddedYmin / 1000) * imgHeight);
      const cropW = Math.round(((paddedXmax - paddedXmin) / 1000) * imgWidth);
      const cropH = Math.round(((paddedYmax - paddedYmin) / 1000) * imgHeight);

      // Ensure minimum crop size
      if (cropW < 20 || cropH < 20) {
        console.warn(`[AIProcessor] Crop too small: ${cropW}x${cropH}`);
        return { dataUrl: null, quality: 'too_thin' };
      }

      // Create 1:1 SQUARE output with white padding
      const squareSize = Math.max(cropW, cropH);
      const offsetX = Math.round((squareSize - cropW) / 2);
      const offsetY = Math.round((squareSize - cropH) / 2);

      // Use OffscreenCanvas if available, fallback to regular canvas
      let canvas: HTMLCanvasElement | OffscreenCanvas;
      let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

      if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(squareSize, squareSize);
        ctx = canvas.getContext('2d');
      } else {
        const htmlCanvas = document.createElement('canvas');
        htmlCanvas.width = squareSize;
        htmlCanvas.height = squareSize;
        canvas = htmlCanvas;
        ctx = htmlCanvas.getContext('2d');
      }

      if (!ctx) return { dataUrl: null, quality: 'failed' };

      // Fill with white background for square padding
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, squareSize, squareSize);

      // Draw the cropped region centered in the square
      ctx.drawImage(img, cropX, cropY, cropW, cropH, offsetX, offsetY, cropW, cropH);

      // V20 FIX 3: SOLID COLOR VALIDATION — check if the crop is just a blank/white/gray block
      // This catches the case where the canvas was read BEFORE PDF content was fully composited
      if (isSolidColorCrop(ctx, squareSize, squareSize)) {
        if (_retryAttempt < 1) {
          console.warn(`[AIProcessor] 🔄 V20 SOLID CROP RETRY: Crop is solid color, waiting 300ms and retrying (attempt ${_retryAttempt + 1})...`);
          await new Promise(r => setTimeout(r, 300));
          return cropProductFromPageImage(pageImageBase64, pageMimeType, boundingBox, _retryAttempt + 1);
        } else {
          console.warn(`[AIProcessor] ⚠️ V20 SOLID CROP PERSISTS after retry — returning anyway (may be a legitimately white product area)`);
        }
      }

      // Convert to data URL
      if (canvas instanceof OffscreenCanvas) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.90 });
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        // Use chunk-based approach to avoid O(n²) string concatenation
        const CHUNK = 8192;
        const parts: string[] = [];
        for (let i = 0; i < bytes.length; i += CHUNK) {
          parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
        }
        const base64 = btoa(parts.join(''));
        console.log(`[AIProcessor] ✅ V20 Square crop [${quality}]: bbox=[${boundingBox.join(',')}] +5%pad → ${squareSize}×${squareSize}px (from ${cropW}×${cropH}) ${imgWidth}×${imgHeight} source`);
        return { dataUrl: `data:image/jpeg;base64,${base64}`, quality };
      } else {
        const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.90);
        console.log(`[AIProcessor] ✅ V20 Square crop [${quality}] (canvas): bbox=[${boundingBox.join(',')}] +5%pad → ${squareSize}×${squareSize}px (from ${cropW}×${cropH}) ${imgWidth}×${imgHeight} source`);
        return { dataUrl, quality };
      }
    } catch (err) {
      console.warn(`[AIProcessor] Frontend cropping failed:`, err);
      return { dataUrl: null, quality: 'failed' };
    }
  }

  /**
   * Validate and coerce a bounding_box value into a numeric array.
   * Gemini sometimes returns text descriptions instead of coordinates — reject those.
   */
  function coerceBoundingBox(bbox: any): [number, number, number, number] | null {
    if (!bbox) return null;
    
    // If it's a string (e.g. "top left", "center of page"), reject it
    if (typeof bbox === 'string') {
      console.warn(`[AIProcessor] ⚠️ REJECTED text bounding_box: "${bbox}" — Gemini returned a description instead of coordinates`);
      return null;
    }
    
    // Must be an array of exactly 4 items
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      console.warn(`[AIProcessor] ⚠️ Invalid bounding_box format:`, bbox);
      return null;
    }
    
    // Coerce each value to a number
    const nums = bbox.map((v: any) => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const parsed = parseFloat(v);
        if (!isNaN(parsed)) return parsed;
      }
      return NaN;
    });
    
    // Check all values are valid numbers
    if (nums.some((n: number) => isNaN(n))) {
      console.warn(`[AIProcessor] ⚠️ Non-numeric bounding_box values:`, bbox);
      return null;
    }
    
    return nums as [number, number, number, number];
  }

  /**
   * Process products from the API and crop individual images for each one.
   * This runs on the frontend where Canvas APIs are reliable.
   * Layout-agnostic: loops over ALL products regardless of grid density (4, 9, 12, 16, 20+).
   * 
   * HARD-GRID FALLBACK: If Gemini fails to provide valid coordinates but identifies a grid
   * (e.g., 12 products found), we automatically divide the PDF page into a mathematical grid
   * and assign each product to its corresponding cell.
   */
  async function cropAllProductImages(
    products: any[],
    pageImages: { data: string; mimeType: string; page: number }[],
  ): Promise<any[]> {
    if (pageImages.length === 0) {
      console.log('[AIProcessor] No page images available for frontend cropping');
      return products;
    }

    // Build page → image map
    const pageImageMap = new Map<number, { data: string; mimeType: string }>();
    for (const pi of pageImages) {
      pageImageMap.set(pi.page, { data: pi.data, mimeType: pi.mimeType });
    }

    // Track used bounding boxes per page to detect/reject duplicates
    const usedBoxes = new Map<number, Set<string>>();

    // ─── HARD-GRID FALLBACK LOGIC ───
    // Detect how many products have valid bboxes vs null/invalid
    // If most bboxes are null but we know the grid structure, generate mathematical bboxes
    const productsWithValidBbox = products.filter(p => {
      const bbox = coerceBoundingBox(p.bounding_box);
      return bbox !== null && p.image_type !== 'lifestyle_only';
    }).length;
    const productsNeedingBbox = products.filter(p => p.image_type !== 'lifestyle_only').length;
    const bboxFailureRate = productsNeedingBbox > 0 ? 1 - (productsWithValidBbox / productsNeedingBbox) : 0;

    // Detect grid structure from the API response (first product that has it, or from the batch response)
    let gridCols = 0;
    let gridRows = 0;
    const firstProduct = products[0];
    if (firstProduct) {
      // Try grid_cols/grid_rows first (new fields)
      if (typeof firstProduct.grid_cols === 'number' && typeof firstProduct.grid_rows === 'number') {
        gridCols = firstProduct.grid_cols;
        gridRows = firstProduct.grid_rows;
      }
      // Fallback: parse grid_structure string like "3x4" or "3×4"
      if ((!gridCols || !gridRows) && typeof firstProduct.grid_structure === 'string') {
        const match = firstProduct.grid_structure.match(/(\d+)\s*[x×]\s*(\d+)/i);
        if (match) {
          gridCols = parseInt(match[1], 10);
          gridRows = parseInt(match[2], 10);
        }
      }
    }

    // Also check if grid info was passed at the batch level
    for (const p of products) {
      if (gridCols && gridRows) break;
      if (typeof p._batch_grid_cols === 'number') gridCols = p._batch_grid_cols;
      if (typeof p._batch_grid_rows === 'number') gridRows = p._batch_grid_rows;
    }

    // Auto-detect grid from product count if not explicitly provided
    if ((!gridCols || !gridRows) && productsNeedingBbox > 0) {
      const n = productsNeedingBbox;
      // Common grid patterns for furniture catalogs
      const gridPatterns: Record<number, [number, number]> = {
        4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3],
        10: [5, 2], 12: [3, 4], 15: [3, 5], 16: [4, 4], 20: [4, 5],
      };
      if (gridPatterns[n]) {
        [gridCols, gridRows] = gridPatterns[n];
        console.log(`[AIProcessor] 🧮 Auto-detected grid ${gridCols}×${gridRows} from ${n} products`);
      } else {
        // Best-fit: prefer wider grids (more cols than rows)
        gridCols = Math.ceil(Math.sqrt(n));
        gridRows = Math.ceil(n / gridCols);
        console.log(`[AIProcessor] 🧮 Estimated grid ${gridCols}×${gridRows} for ${n} products`);
      }
    }

    // FIX 1: ALWAYS activate hard-grid fallback when ANY bboxes are null/invalid
    // Previously threshold was 0.5 (50%) — now activates even if a single product has null bbox
    const useHardGridFallback = gridCols > 0 && gridRows > 0;
    if (useHardGridFallback) {
      console.warn(`[AIProcessor] 🔧 HARD-GRID FALLBACK ACTIVE (ALWAYS-ON): ${Math.round(bboxFailureRate * 100)}% of bboxes are null/invalid. Using mathematical ${gridCols}×${gridRows} grid for ALL null/invalid bboxes.`);
    }

    /** 
     * V20 FIX 4: Generate a mathematical bounding box for a grid cell with proper margin calibration.
     * 
     * Most PDF catalogs have:
     * - ~5-8% margin on left/right edges (white gutter)
     * - ~4-6% margin on top (header area)
     * - ~8-12% margin on bottom (footer/page numbers/text labels below products)
     * 
     * The "content area" is the region inside these margins where actual product images live.
     * We define the content area in 0-1000 normalized space, then subdivide it into the grid.
     */
    function generateGridBbox(index: number, cols: number, rows: number): [number, number, number, number] {
      // PDF margin estimates (in 0-1000 normalized space)
      const PAGE_MARGIN_TOP = 50;     // ~5% top margin (header)
      const PAGE_MARGIN_BOTTOM = 100; // ~10% bottom margin (footer/text labels)
      const PAGE_MARGIN_LEFT = 50;    // ~5% left gutter
      const PAGE_MARGIN_RIGHT = 50;   // ~5% right gutter
      
      // Inner cell padding (space between grid cells to avoid overlapping adjacent products)
      const CELL_PADDING = 15; // ~1.5% padding inside each cell
      
      // Content area dimensions
      const contentTop = PAGE_MARGIN_TOP;
      const contentBottom = 1000 - PAGE_MARGIN_BOTTOM;
      const contentLeft = PAGE_MARGIN_LEFT;
      const contentRight = 1000 - PAGE_MARGIN_RIGHT;
      
      const contentWidth = contentRight - contentLeft;   // ~900
      const contentHeight = contentBottom - contentTop;   // ~850
      
      const col = index % cols;
      const row = Math.floor(index / cols);
      
      const cellWidth = contentWidth / cols;
      const cellHeight = contentHeight / rows;
      
      const ymin = Math.round(contentTop + row * cellHeight + CELL_PADDING);
      const xmin = Math.round(contentLeft + col * cellWidth + CELL_PADDING);
      const ymax = Math.round(contentTop + (row + 1) * cellHeight - CELL_PADDING);
      const xmax = Math.round(contentLeft + (col + 1) * cellWidth - CELL_PADDING);
      
      console.log(`[AIProcessor] 🧮 V20 Grid cell [r${row}c${col}] (idx=${index}): bbox=[${ymin},${xmin},${ymax},${xmax}] (content area: ${contentWidth}×${contentHeight}, cell: ${Math.round(cellWidth)}×${Math.round(cellHeight)})`);
      
      return [ymin, xmin, ymax, xmax];
    }

    console.log(`[AIProcessor] ═══ V20 cropAllProductImages: Starting PARALLEL Promise.all cropping for ${products.length} products across ${pageImages.length} page(s)` +
      (useHardGridFallback ? ` [HARD-GRID FALLBACK: ${gridCols}×${gridRows}]` : '') +
      ` (${productsWithValidBbox}/${productsNeedingBbox} have valid bboxes) ═══`);

    // V20 FIX 1: Build ALL crop promises FIRST, then await Promise.all
    // This prevents any race condition where state is set before crops finish
    const croppingPromises: Promise<any>[] = products.map((product, productIndex) => {
      // Each product gets its own gridIndex based on its position
      const gridIndex = productIndex;

      return (async () => {
        const rawBbox = product.bounding_box;
        const imageType = product.image_type || 'individual_product';
        const productLabel = product.model_number || product.title?.substring(0, 30) || `idx${gridIndex}`;

        // V20: High-priority logging for EVERY product entering the crop loop
        console.log(`📸 [V20] Cropping in progress for: ${productLabel} (index=${gridIndex}, page=${product.page_number || 1}, imageType=${imageType})`);

        // Skip lifestyle-only products entirely
        if (imageType === 'lifestyle_only') {
          console.log(`📸 [V20] SKIP lifestyle_only: ${productLabel}`);
          return { ...product, bounding_box: null, bbox_quality: undefined };
        }

        // Get the page image early so we can use it for fallback
        const pageNum = product.page_number || 1;
        const pageImage = pageImageMap.get(pageNum);
        // Build a full-page data URL for fallback in case cropping fails
        const pageDataUrl = pageImage ? `data:${pageImage.mimeType};base64,${pageImage.data}` : undefined;

        // Validate and coerce bounding box (rejects text descriptions from Gemini)
        let bbox = coerceBoundingBox(rawBbox);
        let usedFallback = false;

        // HARD-GRID FALLBACK: If bbox is null/invalid and we have grid dimensions, ALWAYS compute mathematically
        if (!bbox && gridCols > 0 && gridRows > 0) {
          // Try to parse grid_position (e.g., "r0c1") for exact placement
          const gridPos = product.grid_position;
          if (typeof gridPos === 'string') {
            const posMatch = gridPos.match(/r(\d+)c(\d+)/);
            if (posMatch) {
              const r = parseInt(posMatch[1], 10);
              const c = parseInt(posMatch[2], 10);
              bbox = generateGridBbox(r * gridCols + c, gridCols, gridRows);
              console.log(`[AIProcessor] 🧮 HARD-GRID: Using grid_position "${gridPos}" → bbox=[${bbox.join(',')}]`);
              usedFallback = true;
            }
          }
          // Fallback: use sequential index
          if (!bbox) {
            bbox = generateGridBbox(gridIndex, gridCols, gridRows);
            console.log(`[AIProcessor] 🧮 HARD-GRID: Using index ${gridIndex} → bbox=[${bbox.join(',')}] for "${(product.title || '').substring(0, 30)}"`);
            usedFallback = true;
          }
        }
        // Also apply hard-grid for bboxes that are clearly wrong (too wide/tall)
        else if (bbox && !usedFallback) {
          const quality = assessBboxQuality(bbox);
          if ((quality === 'too_wide' || quality === 'too_tall') && gridCols > 0 && gridRows > 0) {
            const oldBbox = [...bbox];
            bbox = generateGridBbox(gridIndex, gridCols, gridRows);
            console.log(`[AIProcessor] 🧮 HARD-GRID OVERRIDE: Original bbox=[${oldBbox.join(',')}] (${quality}) → fallback bbox=[${bbox.join(',')}]`);
            usedFallback = true;
          }
        }

        if (!bbox) {
          if (rawBbox && typeof rawBbox === 'string') {
            console.warn(`[AIProcessor] Product "${(product.title || product.model_number || '').substring(0, 40)}" has text bbox "${rawBbox}" — no crop possible`);
          }
          console.log(`📸 [V20] NO BBOX for: ${productLabel} → returning without crop`);
          return { ...product, bounding_box: bbox, bbox_quality: bbox ? 'invalid' : undefined, _page_image_data_url: pageDataUrl };
        }

        // Check for duplicate bounding boxes on the same page
        // NOTE: usedBoxes is shared across all promises — but since Map/Set ops are sync and
        // JS is single-threaded, the check + add is atomic between awaits
        const bboxKey = bbox.join(',');
        if (!usedBoxes.has(pageNum)) usedBoxes.set(pageNum, new Set());
        const pageBoxes = usedBoxes.get(pageNum)!;

        if (pageBoxes.has(bboxKey)) {
          console.warn(`[AIProcessor] DUPLICATE bbox [${bboxKey}] on page ${pageNum} for "${(product.title || '').substring(0, 40)}" — skipping crop`);
          return { ...product, bounding_box: null, bbox_quality: 'invalid', _page_image_data_url: pageDataUrl };
        }
        pageBoxes.add(bboxKey);

        // Check page image availability
        if (!pageImage) {
          console.warn(`[AIProcessor] No page image for page ${pageNum}`);
          return { ...product, _page_image_data_url: undefined };
        }

        // If server already provided a cropped_image, use it; otherwise crop on frontend
        if (product.cropped_image) {
          const serverUrl = buildCroppedImageUrl(product.cropped_image, product.cropped_image_mime || 'image/jpeg');
          console.log(`📸 [V20] SERVER CROP for ${productLabel}: ${serverUrl.substring(0, 50)} (${serverUrl.length} chars)`);
          return {
            ...product,
            frontend_cropped_image: serverUrl,
            imageUrl: serverUrl,
            cropped_image_url: serverUrl,
            cropped_image_url_frontend: serverUrl,
            bbox_quality: 'ok',
            _page_image_data_url: pageDataUrl,
          };
        }

        // ─── CANVAS DEBUG OVERLAY ───
        try {
          await debugDrawBoundingBox(pageImage.data, pageImage.mimeType, bbox, productLabel);
        } catch (debugErr) {
          console.warn('[AIProcessor] Debug overlay error:', debugErr);
        }

        // FRONTEND CROP: use the bounding box to crop from the page image
        console.log(`📸 [V20] CANVAS CROP START for: ${productLabel} bbox=[${bbox.join(',')}]`);
        const { dataUrl: croppedDataUrl, quality: bboxQuality } = await cropProductFromPageImage(
          pageImage.data,
          pageImage.mimeType,
          bbox,
        );
        console.log(`📸 [V20] CANVAS CROP END for: ${productLabel} → ${croppedDataUrl ? `SUCCESS (${Math.round((croppedDataUrl.length || 0) / 1024)}KB)` : 'FAILED'}`);

        if (croppedDataUrl) {
          // ─── DATA URI VERIFICATION ───
          const isValidDataUri = croppedDataUrl.startsWith('data:image/') && croppedDataUrl.length > 100;
          if (!isValidDataUri) {
            console.error(`[AIProcessor] ❌ DATA URI VERIFICATION FAILED for "${productLabel}": URI length=${croppedDataUrl.length}, starts with="${croppedDataUrl.substring(0, 30)}"`);
            return { ...product, bbox_quality: 'failed', bounding_box: bbox, _page_image_data_url: pageDataUrl };
          }
          
          const qualityLabel = usedFallback ? `${bboxQuality}+grid_fallback` : bboxQuality;
          console.log(`📸 [V20] ✅ CROP CONFIRMED for ${productLabel}: [${qualityLabel}] ${croppedDataUrl.substring(0, 50)} (${Math.round(croppedDataUrl.length / 1024)}KB)`);
          return {
            ...product,
            frontend_cropped_image: croppedDataUrl,
            imageUrl: croppedDataUrl,
            cropped_image_url: croppedDataUrl,
            bbox_quality: usedFallback ? 'ok' : bboxQuality,
            bounding_box: bbox,
            _page_image_data_url: pageDataUrl,
          };
        } else {
          const reason = !bbox ? 'null_bbox' : 
            (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) ? 'zero_area' :
            (bbox.some(v => v < 0 || v > 1000)) ? 'out_of_bounds' :
            'crop_failed';
          console.warn(`[AIProcessor] ⚠️ CROP FAILED [${reason}] for ${productLabel} (bbox=[${bbox.join(',')}], quality=${bboxQuality})`);
          // V16 FIX 4: If crop failed but we have a page image, FORCIBLY use the grid crop as last resort
          if (pageDataUrl && gridCols > 0 && gridRows > 0) {
            const forceBbox = generateGridBbox(gridIndex, gridCols, gridRows);
            console.log(`[AIProcessor] 🔧 V20 FORCE GRID CROP: bbox failed → forcing grid crop at index ${gridIndex} with bbox=[${forceBbox.join(',')}]`);
            const { dataUrl: forceDataUrl } = await cropProductFromPageImage(pageImage!.data, pageImage!.mimeType, forceBbox);
            if (forceDataUrl && forceDataUrl.length > 100) {
              console.log(`📸 [V20] ✅ FORCE GRID CROP SUCCESS for ${productLabel}: ${forceDataUrl.length} chars`);
              return {
                ...product,
                frontend_cropped_image: forceDataUrl,
                imageUrl: forceDataUrl,
                cropped_image_url: forceDataUrl,
                bbox_quality: 'ok',
                bounding_box: forceBbox,
                _page_image_data_url: pageDataUrl,
              };
            }
          }
          return { ...product, bbox_quality: bboxQuality, bounding_box: bbox, _page_image_data_url: pageDataUrl };
        }
      })();
    });

    // V20: AWAIT ALL CROPS BEFORE RETURNING — this is the critical race condition fix
    console.log(`[AIProcessor] ⏳ V20: Awaiting Promise.all for ${croppingPromises.length} crop operations...`);
    const fullyProcessedProducts = await Promise.all(croppingPromises);
    console.log(`[AIProcessor] ✅ V20: Promise.all RESOLVED — all ${fullyProcessedProducts.length} products are fully cropped and in memory`);

    const croppedCount = fullyProcessedProducts.filter(p => p.frontend_cropped_image || p.cropped_image_url_frontend || p.cropped_image).length;
    const qualityIssues = fullyProcessedProducts.filter(p => p.bbox_quality && p.bbox_quality !== 'ok').length;
    console.log(`[AIProcessor] Frontend cropping complete: ${croppedCount}/${fullyProcessedProducts.length} products got unique images, ${qualityIssues} with bbox quality issues` +
      (useHardGridFallback ? ` [HARD-GRID FALLBACK was used]` : ''));

    return fullyProcessedProducts;
  }

  /**
   * CANVAS DEBUG OVERLAY: Draw detected bounding boxes as green rectangles on a hidden canvas.
   * This creates a visual debug record in the console for each page/product.
   */
  async function debugDrawBoundingBox(
    pageImageBase64: string,
    pageMimeType: string,
    bbox: [number, number, number, number],
    label: string,
  ): Promise<void> {
    const [ymin, xmin, ymax, xmax] = bbox;
    const imgSrc = `data:${pageMimeType};base64,${pageImageBase64}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Debug: Failed to load page image'));
      img.src = imgSrc;
    });

    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    // Convert normalized coords to pixel coords
    const px = Math.round((xmin / 1000) * imgWidth);
    const py = Math.round((ymin / 1000) * imgHeight);
    const pw = Math.round(((xmax - xmin) / 1000) * imgWidth);
    const ph = Math.round(((ymax - ymin) / 1000) * imgHeight);

    // Create a small debug canvas (1/4 size for memory efficiency)
    const scale = 0.25;
    const debugCanvas = document.createElement('canvas');
    debugCanvas.width = Math.round(imgWidth * scale);
    debugCanvas.height = Math.round(imgHeight * scale);
    const ctx = debugCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, debugCanvas.width, debugCanvas.height);

    // Draw green rectangle for the bounding box
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.round(px * scale),
      Math.round(py * scale),
      Math.round(pw * scale),
      Math.round(ph * scale),
    );

    // Draw label
    ctx.fillStyle = '#00FF00';
    ctx.font = '10px monospace';
    ctx.fillText(`${label} [${bbox.join(',')}]`, Math.round(px * scale) + 2, Math.round(py * scale) - 3);

    // Log the debug canvas as a data URL for inspection
    console.log(`[AIProcessor] 🟩 DEBUG BBOX "${label}": [${bbox.join(',')}] → pixel=[${px},${py},${pw},${ph}] on ${imgWidth}×${imgHeight} page`);
    // Uncomment the line below to see visual debug overlays in console:
    // console.log(`[AIProcessor] Debug canvas:`, debugCanvas.toDataURL('image/png', 0.5));
  }

  /** Helper: map raw API product to CatalogProduct with cropped image */
  function mapProductToCatalogProduct(p: any, idx: number, idPrefix: string): CatalogProduct {
    const validTags = (p.tags || []).filter((t: string) => OFFICIAL_PRODUCT_TAGS.includes(t));
    const productLabel = p.model_number || (p.title || '').substring(0, 30) || `Item ${idx + 1}`;

    // V16 FIX 2: FORCE PRIORITY — frontend_cropped_image is THE primary source, then cropped_image_url, then all others
    // The old code had too many conditionals that could reject valid data URLs
    let croppedImageUrl: string | undefined =
      // #1 HIGHEST PRIORITY: Frontend canvas crop (generated by cropProductFromPageImage)
      (p.frontend_cropped_image && typeof p.frontend_cropped_image === 'string' && p.frontend_cropped_image.length > 100 ? p.frontend_cropped_image : undefined) ||
      // #2: Already-assigned cropped_image_url (may come from prior processing)
      (p.cropped_image_url && typeof p.cropped_image_url === 'string' && p.cropped_image_url.length > 100 ? p.cropped_image_url : undefined) ||
      // #3: Frontend URL variant
      (p.cropped_image_url_frontend && typeof p.cropped_image_url_frontend === 'string' && p.cropped_image_url_frontend.length > 100 ? p.cropped_image_url_frontend : undefined) ||
      // #4: Server-provided raw base64 cropped_image
      (p.cropped_image && typeof p.cropped_image === 'string' && p.cropped_image.length > 50 ? buildCroppedImageUrl(p.cropped_image, p.cropped_image_mime || 'image/jpeg') : undefined) ||
      // #5: imageUrl field (may have been set during processing)
      (p.imageUrl && typeof p.imageUrl === 'string' && p.imageUrl.length > 100 ? p.imageUrl : undefined);

    // V16 FIX 2: Relaxed validation — only reject truly broken URIs (less than 50 chars or not a data URI / http URL)
    if (croppedImageUrl) {
      const isDataUri = croppedImageUrl.startsWith('data:image/');
      const isHttpUrl = croppedImageUrl.startsWith('http');
      if (!isDataUri && !isHttpUrl) {
        console.error(`[AIProcessor] ❌ DATA URI REJECTED for "${productLabel}": not a valid image URL (starts with "${croppedImageUrl.substring(0, 20)}")`);
        croppedImageUrl = undefined;
      }
    }

    // V16 LOG: ALWAYS log for every product — this MUST say "true"
    console.log('🔥 Final Image Injection:', productLabel, !!croppedImageUrl,
      `| sources: frontend_cropped=${!!p.frontend_cropped_image}(${(p.frontend_cropped_image || '').length}), cropped_url=${!!p.cropped_image_url}(${(p.cropped_image_url || '').length}), server_cropped=${!!p.cropped_image}(${(p.cropped_image || '').length}), imageUrl=${!!p.imageUrl}(${(p.imageUrl || '').length})`
    );

    // V18 FIX 4: Emergency image injection — detect and handle missing images
    if (!croppedImageUrl) {
      console.error(`🚨 [V18] MISSING IMAGE for "${productLabel}" — all 5 source fields are empty!`);
      console.error(`  Sources: frontend_cropped=${!!p.frontend_cropped_image}(${(p.frontend_cropped_image || '').length}), cropped_url=${!!p.cropped_image_url}(${(p.cropped_image_url || '').length}), cropped_url_frontend=${!!p.cropped_image_url_frontend}(${(p.cropped_image_url_frontend || '').length}), server_cropped=${!!p.cropped_image}(${(p.cropped_image || '').length}), imageUrl=${!!p.imageUrl}(${(p.imageUrl || '').length})`);
      
      // FALLBACK 1: Try full page image
      if (p._page_image_data_url && typeof p._page_image_data_url === 'string' && p._page_image_data_url.startsWith('data:image/')) {
        croppedImageUrl = p._page_image_data_url;
        console.log(`[AIProcessor] 🔧 FALLBACK 1: Assigned full page image as thumbnail for "${productLabel}" (${Math.round(croppedImageUrl!.length / 1024)}KB)`);
      } else {
        // FALLBACK 2 (V18 EMERGENCY): Generate a colored placeholder square so the UI can render SOMETHING
        // This proves the UI is capable of showing an image — if we see these colored squares, it means
        // the crop pipeline failed but the UI rendering works
        try {
          const placeholderCanvas = document.createElement('canvas');
          placeholderCanvas.width = 200;
          placeholderCanvas.height = 200;
          const pCtx = placeholderCanvas.getContext('2d');
          if (pCtx) {
            // Generate a unique color per product using index
            const hue = (idx * 47) % 360; // spread hues evenly
            pCtx.fillStyle = `hsl(${hue}, 70%, 50%)`;
            pCtx.fillRect(0, 0, 200, 200);
            pCtx.fillStyle = '#FFFFFF';
            pCtx.font = 'bold 14px monospace';
            pCtx.textAlign = 'center';
            pCtx.fillText('NO IMAGE', 100, 90);
            pCtx.fillText(productLabel.substring(0, 20), 100, 115);
            pCtx.fillText(`#${idx + 1}`, 100, 140);
            croppedImageUrl = placeholderCanvas.toDataURL('image/png');
            console.error(`🚨 [V18] EMERGENCY PLACEHOLDER generated for "${productLabel}" — colored square (${Math.round(croppedImageUrl.length / 1024)}KB)`);
          }
        } catch (placeholderErr) {
          console.error(`🚨 [V18] EMERGENCY PLACEHOLDER ALSO FAILED for "${productLabel}":`, placeholderErr);
        }
      }
    } else {
      console.log(`[AIProcessor] ✅ Product "${productLabel}" → image assigned (${croppedImageUrl.substring(0, 50)}..., ${Math.round(croppedImageUrl.length / 1024)}KB)`);
    }

    return {
      id: `catalog-${idPrefix}-${idx}`,
      title: p.title || `Item ${idx + 1}`,
      description: p.description || '<p>No description generated.</p>',
      tags: validTags,
      price: typeof p.price === 'number' ? p.price : 0,
      collection: p.collection || 'General',
      material: p.material || '',
      dimensions: p.dimensions || '',
      image_region: p.image_region || '',
      page_number: p.page_number || 1,
      selected: true,
      expanded: false,
      cropped_image_url: croppedImageUrl,
      bounding_box: p.bounding_box || null,
      image_type: p.image_type || 'individual_product',
      bbox_quality: p.bbox_quality || (croppedImageUrl ? 'ok' : undefined),
      grid_position: p.grid_position || undefined,
      factoriesDisplayName: manufacturerName || '',
    };
  }

  // ── Small file: single-shot with page image rendering ────────
  if (!isLargeFile) {
    onProgress({
      phase: 'analyzing',
      message: `Rendering ${estimatedPages} page(s) & sending to ${modelName} (~${estimatedMB} MB)...`,
      detail: 'AI is scanning every page to identify products. This may take 2-5 minutes.',
    });

    // Render all pages to images for bounding-box cropping
    const pageImages: { data: string; mimeType: string; page: number }[] = [];
    if (pdfSourceBytes) {
      for (let p = 1; p <= estimatedPages; p++) {
        // V20: Create a FRESH ArrayBuffer copy for each page render — prevents detachment
        const freshBuffer = new Uint8Array(pdfSourceBytes).buffer;
        const img = await renderPdfPageToImage(freshBuffer, p);
        if (img) pageImages.push(img);
      }
      console.log(`[AIProcessor] Rendered ${pageImages.length}/${estimatedPages} pages for cropping`);
    }

    onBatchProgress({
      currentBatch: 1, totalBatches: 1, startPage: 1, endPage: estimatedPages,
      totalPages: estimatedPages, pagesPerBatch: PAGES_PER_BATCH,
      productsFoundSoFar: 0, batchErrors: [], successfulBatches: 0,
      isLargeFile: false, uploadSessionId, elapsedSeconds: 0,
    });

    const controller = new AbortController();
    const CLIENT_TIMEOUT_MS = 360_000;
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    let data: any;

    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/supabase-functions-gemini-pdf-catalog`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'apikey': supabaseAnonKey,
          },
          body: JSON.stringify({
            files, model: modelName,
            tags_list: OFFICIAL_PRODUCT_TAGS.join(', '),
            upload_session_id: uploadSessionId,
            page_images: pageImages.length > 0 ? pageImages : undefined,
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorBody: string;
        try { const ed = await response.json(); errorBody = ed?.error || JSON.stringify(ed); }
        catch { errorBody = `HTTP ${response.status}`; }
        throw new Error(`Edge Function error (${response.status}): ${errorBody}`);
      }

      data = await response.json();
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr?.name === 'AbortError') {
        throw new Error(`PDF processing timed out after ${CLIENT_TIMEOUT_MS / 1000}s. Try splitting the PDF into smaller parts.`);
      }
      // Detect network/fetch payload failures
      console.error(`[AIProcessor] PDF catalog fetch error:`, fetchErr);
      console.error(`[AIProcessor] Error name:`, fetchErr?.name, `| Message:`, fetchErr?.message);
      const errMsg = fetchErr?.message || String(fetchErr);
      if (errMsg.includes('relay') || errMsg.includes('Failed to send') || errMsg.includes('FunctionsFetchError') || errMsg.includes('Failed to fetch')) {
        const payloadMB = (totalFileSizeBytes / (1024 * 1024)).toFixed(1);
        throw new Error(`Network request failed (~${payloadMB}MB payload). The PDF may be too large to process in a single request. Processing will auto-retry page-by-page.`);
      }
      throw fetchErr;
    }

    if (data?.error) throw new Error(data.error);

    const partialWarning = data?.partial_results ? ` (partial — ${data.chunks_successful}/${data.chunks_total} chunks succeeded)` : '';

    onProgress({
      phase: 'extracting',
      message: `AI analysis complete${partialWarning}. Cropping individual product images...`,
      detail: `Found ${data?.products?.length || 0} items in ${(data?.elapsed_seconds || 0).toFixed(1)}s. Now cropping each product...`,
    });

    // V6: Frontend-side cropping — crop each product individually from page images
    const rawProducts = (data?.products || []).map((p: any) => ({
      ...p,
      // Propagate grid dimensions from API response for hard-grid fallback
      grid_cols: p.grid_cols || data?.grid_cols || 0,
      grid_rows: p.grid_rows || data?.grid_rows || 0,
      grid_structure: p.grid_structure || data?.grid_structure || '',
    }));
    const croppedProducts = await cropAllProductImages(rawProducts, pageImages);

    const products: CatalogProduct[] = croppedProducts.map((p: any, idx: number) =>
      mapProductToCatalogProduct(p, idx, String(Date.now()))
    );

    // V18 VERIFICATION: Log every product's image state after Promise.all + map
    const withImages = products.filter(p => p.cropped_image_url);
    const uniqueImages = new Set(products.map(p => p.cropped_image_url).filter(Boolean));
    console.log(`[AIProcessor] 🔍 V18 IMAGE VERIFICATION (post-Promise.all): ${withImages.length}/${products.length} products have images, ${uniqueImages.size} unique`);
    
    for (const cp of products) {
      console.log(`[AIProcessor] V18 VERIFY: "${cp.title?.substring(0, 25)}" → cropped_image_url=${!!cp.cropped_image_url} (${cp.cropped_image_url?.length || 0} chars)`);
    }
    
    if (products.length > 0 && withImages.length === 0) {
      console.error('[AIProcessor] ❌ V18 CRITICAL: ALL products have NO images after Promise.all + mapProductToCatalogProduct! Dumping raw croppedProducts...');
      for (const cp of croppedProducts) {
        console.error(`  RAW: "${(cp.title || '').substring(0, 25)}" → frontend_cropped_image=${!!cp.frontend_cropped_image}(${(cp.frontend_cropped_image || '').length}), imageUrl=${!!cp.imageUrl}(${(cp.imageUrl || '').length}), cropped_image_url=${!!cp.cropped_image_url}(${(cp.cropped_image_url || '').length})`);
      }
    }

    onProgress({
      phase: 'complete',
      message: `Successfully extracted ${products.length} products (${withImages.length} with unique 1:1 square crops)${partialWarning}`,
      detail: data?.catalog_summary || '',
    });

    return products;
  }

  // ═══ Large file: Parallel One-Page-At-A-Time Processing ════════

  onProgress({
    phase: 'analyzing',
    message: `Large file detected (~${estimatedMB} MB, ~${estimatedPages} pages). Processing ${totalBatches} pages with ${PARALLEL_CONCURRENCY} parallel workers...`,
    detail: 'Each page is processed individually for maximum stability.',
  });

  const allProducts: CatalogProduct[] = [];
  const batchErrors: Array<{ batch: number; error: string }> = [];
  let successfulBatches = 0;
  let productIdCounter = 0;
  let completedPages = 0;

  /** Process a single page and return its products (with automatic retry for 5xx errors) */
  const PAGE_MAX_RETRIES = 2;
  
  async function processSinglePage(pageNum: number): Promise<{ products: CatalogProduct[]; error?: string }> {
    for (let attempt = 0; attempt <= PAGE_MAX_RETRIES; attempt++) {
      const PAGE_TIMEOUT_MS = 120_000; // 2 min per single page — very generous
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);

      try {
        // V17: Render page image LOCALLY for frontend cropping — do NOT send to edge function.
        // Sending page_images to the edge function bloats the request body by MBs and wastes
        // upload time. Server-side cropping is now skipped, so the edge function doesn't need them.
        let pageImages: { data: string; mimeType: string; page: number }[] | undefined;
        if (pdfSourceBytes) {
          // V20: Create a FRESH ArrayBuffer copy for each page render — prevents detachment
          const freshBuffer = new Uint8Array(pdfSourceBytes).buffer;
          const pageImg = await renderPdfPageToImage(freshBuffer, pageNum);
          if (pageImg) {
            pageImages = [pageImg];
          }
        }

        if (attempt > 0) {
          console.log(`[AIProcessor] 🔄 Retrying page ${pageNum} (attempt ${attempt + 1}/${PAGE_MAX_RETRIES + 1})...`);
        }

        const response = await fetch(
          `${supabaseUrl}/functions/v1/supabase-functions-gemini-pdf-catalog`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseAnonKey}`,
              'apikey': supabaseAnonKey,
            },
            body: JSON.stringify({
              files, model: modelName,
              tags_list: OFFICIAL_PRODUCT_TAGS.join(', '),
              start_page: pageNum,
              end_page: pageNum,
              upload_session_id: uploadSessionId,
              total_pages: estimatedPages,
              // V17: Don't send page_images to edge function — frontend crops locally
              // This dramatically reduces payload size and upload time
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorBody: string;
          try { const ed = await response.json(); errorBody = ed?.error || JSON.stringify(ed); }
          catch { errorBody = `HTTP ${response.status}`; }
          
          // Auto-retry on 5xx errors (500, 502, 503, 504)
          if (response.status >= 500 && attempt < PAGE_MAX_RETRIES) {
            const retryDelay = 2000 * (attempt + 1); // 2s, 4s
            console.warn(`[AIProcessor] ⚠️ Page ${pageNum} got ${response.status} — retrying in ${retryDelay}ms (attempt ${attempt + 1}/${PAGE_MAX_RETRIES + 1})...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue; // retry
          }
          
          return { products: [], error: `Page ${pageNum} failed (${response.status}): ${errorBody}` };
        }

        const data = await response.json();
        if (data?.error) {
          // Retry on server errors reported in JSON
          if (attempt < PAGE_MAX_RETRIES) {
            console.warn(`[AIProcessor] ⚠️ Page ${pageNum} returned error: ${data.error} — retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            continue;
          }
          return { products: [], error: `Page ${pageNum}: ${data.error}` };
        }

        // V6: Frontend-side cropping for large-file per-page processing
        const rawProducts = (data?.products || []).map((p: any) => ({
          ...p,
          grid_cols: p.grid_cols || data?.grid_cols || 0,
          grid_rows: p.grid_rows || data?.grid_rows || 0,
          grid_structure: p.grid_structure || data?.grid_structure || '',
        }));
        const croppedProducts = await cropAllProductImages(rawProducts, pageImages || []);

        const pageProducts: CatalogProduct[] = croppedProducts.map((p: any) => {
          productIdCounter++;
          return mapProductToCatalogProduct(p, productIdCounter, `${uploadSessionId}`);
        });

        if (attempt > 0) {
          console.log(`[AIProcessor] ✅ Page ${pageNum} succeeded on retry attempt ${attempt + 1}`);
        }

        return { products: pageProducts };
      } catch (err: any) {
        clearTimeout(timeoutId);
        let errorMsg: string;
        if (err?.name === 'AbortError') {
          errorMsg = `Page ${pageNum} timed out after ${PAGE_TIMEOUT_MS / 1000}s`;
        } else {
          const rawMsg = err?.message || `Page ${pageNum} failed`;
          // Detect relay failures and provide actionable message
          if (rawMsg.includes('relay') || rawMsg.includes('Failed to send') || rawMsg.includes('FunctionsFetchError') || rawMsg.includes('Failed to fetch')) {
            errorMsg = `Page ${pageNum}: Request too large for relay — PDF data exceeds Supabase limits. Try a smaller file.`;
          } else {
            errorMsg = rawMsg;
          }
        }
        
        // Retry on timeout or network errors
        if (attempt < PAGE_MAX_RETRIES) {
          const retryDelay = 2000 * (attempt + 1);
          console.warn(`[AIProcessor] ⚠️ Page ${pageNum}: ${errorMsg} — retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue; // retry
        }
        
        return { products: [], error: errorMsg };
      }
    }
    // Should never reach here, but TypeScript needs it
    return { products: [], error: `Page ${pageNum} failed after ${PAGE_MAX_RETRIES + 1} attempts` };
  }

  // Process pages in parallel waves of PARALLEL_CONCURRENCY
  const allPageNums = Array.from({ length: estimatedPages }, (_, i) => i + 1);

  for (let waveStart = 0; waveStart < allPageNums.length; waveStart += PARALLEL_CONCURRENCY) {
    const wave = allPageNums.slice(waveStart, waveStart + PARALLEL_CONCURRENCY);
    const elapsedSeconds = (Date.now() - startTime) / 1000;

    // Update progress before launching wave
    onBatchProgress({
      currentBatch: completedPages + 1, totalBatches: estimatedPages,
      startPage: wave[0], endPage: wave[wave.length - 1],
      totalPages: estimatedPages, pagesPerBatch: PAGES_PER_BATCH,
      productsFoundSoFar: allProducts.length, batchErrors, successfulBatches,
      isLargeFile: true, uploadSessionId, elapsedSeconds,
    });

    onProgress({
      phase: 'analyzing',
      message: `Processing Page ${wave[0]} of ${estimatedPages}...` + (wave.length > 1 ? ` (${wave.length} in parallel)` : ''),
      detail: `${allProducts.length} products found so far · ${successfulBatches} pages complete · ${elapsedSeconds.toFixed(0)}s elapsed`,
    });

    // Fire all pages in this wave concurrently
    const results = await Promise.all(wave.map(pageNum => processSinglePage(pageNum)));

    // Collect results
    for (let i = 0; i < results.length; i++) {
      const { products, error } = results[i];
      completedPages++;

      if (error) {
        console.error(`[AIProcessor] Page ${wave[i]} error:`, error);
        batchErrors.push({ batch: wave[i], error });
      } else {
        allProducts.push(...products);
        successfulBatches++;
        console.log(`[AIProcessor] Page ${wave[i]}: ${products.length} products (${allProducts.length} total)`);
      }

      // Update progress per-page for fast UI feedback
      const nowElapsed = (Date.now() - startTime) / 1000;
      onBatchProgress({
        currentBatch: completedPages, totalBatches: estimatedPages,
        startPage: wave[i], endPage: wave[i],
        totalPages: estimatedPages, pagesPerBatch: PAGES_PER_BATCH,
        productsFoundSoFar: allProducts.length, batchErrors, successfulBatches,
        isLargeFile: true, uploadSessionId, elapsedSeconds: nowElapsed,
      });
    }

    // Small delay between waves to avoid rate limiting
    if (waveStart + PARALLEL_CONCURRENCY < allPageNums.length) {
      await new Promise(resolve => setTimeout(resolve, INTER_BATCH_DELAY_MS));
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  onBatchProgress({
    currentBatch: estimatedPages, totalBatches: estimatedPages,
    startPage: estimatedPages, endPage: estimatedPages,
    totalPages: estimatedPages, pagesPerBatch: PAGES_PER_BATCH,
    productsFoundSoFar: allProducts.length, batchErrors, successfulBatches,
    isLargeFile: true, uploadSessionId, elapsedSeconds: parseFloat(totalElapsed),
  });

  if (allProducts.length === 0 && batchErrors.length > 0) {
    throw new Error(
      `All ${estimatedPages} pages failed. Errors:\n${batchErrors.map(e => `  Page ${e.batch}: ${e.error}`).join('\n')}`
    );
  }

  const partialWarning = batchErrors.length > 0 ? ` (partial — ${successfulBatches}/${estimatedPages} pages succeeded)` : '';

  onProgress({
    phase: 'complete',
    message: `Extracted ${allProducts.length} products in ${totalElapsed}s${partialWarning}`,
    detail: batchErrors.length > 0
      ? `${batchErrors.length} page(s) failed but ${allProducts.length} products were saved.`
      : `All ${estimatedPages} pages completed successfully.`,
  });

  return allProducts;
}

// ─── Cross-Reference Helper: Crop from PDF page image ─────────────
/**
 * Simplified frontend cropping for cross-reference mode.
 * Takes a page image base64 and bounding box, returns a data URL of the cropped product.
 */
async function cropProductFromPageImageForCrossRef(
  pageImageBase64: string,
  boundingBox: [number, number, number, number],
): Promise<string | null> {
  try {
    const [ymin, xmin, ymax, xmax] = boundingBox;

    // Validate
    if (ymin >= ymax || xmin >= xmax || ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) {
      return null;
    }

    // Apply 5% safety padding
    const bboxW = xmax - xmin;
    const bboxH = ymax - ymin;
    const padX = Math.round(bboxW * 0.05);
    const padY = Math.round(bboxH * 0.05);
    const paddedYmin = Math.max(0, ymin - padY);
    const paddedXmin = Math.max(0, xmin - padX);
    const paddedYmax = Math.min(1000, ymax + padY);
    const paddedXmax = Math.min(1000, xmax + padX);

    // Load image
    const imgSrc = `data:image/jpeg;base64,${pageImageBase64}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = imgSrc;
    });

    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    // Convert to pixel coords
    const cropX = Math.round((paddedXmin / 1000) * imgWidth);
    const cropY = Math.round((paddedYmin / 1000) * imgHeight);
    const cropW = Math.round(((paddedXmax - paddedXmin) / 1000) * imgWidth);
    const cropH = Math.round(((paddedYmax - paddedYmin) / 1000) * imgHeight);

    if (cropW < 20 || cropH < 20) return null;

    // Create 1:1 square output
    const squareSize = Math.max(cropW, cropH);
    const offsetX = Math.round((squareSize - cropW) / 2);
    const offsetY = Math.round((squareSize - cropH) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = squareSize;
    canvas.height = squareSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, squareSize, squareSize);
    ctx.drawImage(img, cropX, cropY, cropW, cropH, offsetX, offsetY, cropW, cropH);

    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('[CrossRef] Crop error:', err);
    return null;
  }
}

// ─── Spatial Exclusion Constants ────────────────────────────────────
/**
 * BANNED ZONE: The top 8% of any PDF page is the header/address area.
 * Product images ONLY exist below this threshold (in the "DATA ZONE").
 * Coordinates are in 0–1000 normalized space.
 * NOTE: Reduced from 15% (150) to 8% (80) — 15% was cutting into the first row of products.
 */
const PDF_HEADER_EXCLUSION_TOP = 80; // Top 8% of page = 0–80 in 1000-scale
const EXCEL_HEADER_ROW_EXCLUSION = 1; // Only row 0 is header zone in Excel (just the header row)

// ─── Pixel Variance Test (Image Quality Validation) ────────────────
/**
 * Validates that a base64 image is actually a product photo — NOT:
 *   - A solid color block (like the blue header block)
 *   - Mostly text characters on a white background
 *   - Extremely low complexity (e.g., a monochrome rectangle)
 *
 * Returns true if the image passes the complexity/variance threshold.
 * Returns false if the image should be DISCARDED.
 */
async function passesPixelVarianceTest(base64: string, mimeType: string = 'image/jpeg'): Promise<boolean> {
  try {
    const imgSrc = `data:${mimeType};base64,${base64}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = imgSrc;
    });

    // Sample at a small resolution to keep it fast
    const sampleSize = 64;
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return true; // Can't validate, allow through

    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    const pixels = imageData.data; // RGBA flat array

    // Calculate color variance across the image
    let totalR = 0, totalG = 0, totalB = 0;
    const pixelCount = sampleSize * sampleSize;

    for (let i = 0; i < pixels.length; i += 4) {
      totalR += pixels[i];
      totalG += pixels[i + 1];
      totalB += pixels[i + 2];
    }

    const avgR = totalR / pixelCount;
    const avgG = totalG / pixelCount;
    const avgB = totalB / pixelCount;

    // Calculate standard deviation of pixel values from the mean
    let varianceSum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const dR = pixels[i] - avgR;
      const dG = pixels[i + 1] - avgG;
      const dB = pixels[i + 2] - avgB;
      varianceSum += (dR * dR + dG * dG + dB * dB) / 3;
    }
    const stdDev = Math.sqrt(varianceSum / pixelCount);

    // Count unique color clusters (binned into 16-level buckets)
    const colorBuckets = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4) {
      const rBin = Math.floor(pixels[i] / 16);
      const gBin = Math.floor(pixels[i + 1] / 16);
      const bBin = Math.floor(pixels[i + 2] / 16);
      colorBuckets.add(`${rBin}_${gBin}_${bBin}`);
    }
    const uniqueColors = colorBuckets.size;

    // Check for "mostly white/single-color with thin text lines" pattern
    // This catches text-on-white-background header blocks
    let whitelikeCount = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 230 && pixels[i + 1] > 230 && pixels[i + 2] > 230) {
        whitelikeCount++;
      }
    }
    const whiteRatio = whitelikeCount / pixelCount;

    // Check for solid color blocks (e.g., the blue header block)
    // Thresholds REDUCED by 50% — product photos on white backgrounds were being incorrectly rejected
    const isSolidBlock = stdDev < 8; // Was 15 — now only rejects truly solid rectangles
    const isMostlyWhiteWithText = whiteRatio > 0.92 && uniqueColors < 15; // Was 0.85/30 — relaxed for product photos on white BG
    const isLowComplexity = uniqueColors < 8 || stdDev < 10; // Was 15/20 — halved to allow clean product shots

    if (isSolidBlock || isMostlyWhiteWithText || isLowComplexity) {
      console.log(`[PixelVariance] ✗ REJECTED: stdDev=${stdDev.toFixed(1)}, uniqueColors=${uniqueColors}, whiteRatio=${(whiteRatio * 100).toFixed(0)}%`);
      return false;
    }

    console.log(`[PixelVariance] ✓ PASSED: stdDev=${stdDev.toFixed(1)}, uniqueColors=${uniqueColors}, whiteRatio=${(whiteRatio * 100).toFixed(0)}%`);
    return true;
  } catch (err) {
    console.warn('[PixelVariance] Validation error (allowing through):', err);
    return true; // On error, don't block
  }
}

// ─── Main Component ───────────────────────────────────────────────

export function AIProcessorView({ onAddProduct, onNavigateToPublish, selectedModel }: AIProcessorViewProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('idle');

  // ── Factory Learning (must be declared before selectedFactoryId state below
  //    but the hook itself will re-initialise when selectedFactoryId changes) ──
  // We forward-declare refs here; actual hook call is placed after the state declarations.
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);

  const [aiFields, setAiFields] = useState<AIFields | null>(null);
  const [isFieldsRevealed, setIsFieldsRevealed] = useState(false);
  const [isAdded, setIsAdded] = useState(false);

  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const catalogProductsRef = useRef<CatalogProduct[]>([]);
  // Keep ref in sync with state so callbacks can read current values without stale closures
  const setCatalogProductsWithRef = useCallback((updater: CatalogProduct[] | ((prev: CatalogProduct[]) => CatalogProduct[])) => {
    setCatalogProducts(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      catalogProductsRef.current = next;
      return next;
    });
  }, []);  const [addedCount, setAddedCount] = useState(0);

  const [isDragOver, setIsDragOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Excel Preview Table (Human-in-the-loop workflow) ──
  // Persistent state: restored from IndexedDB asynchronously on mount
  const [excelPreviewData, setExcelPreviewData] = useState<ExcelPreviewData | null>(null);
  const [isGeneratingFromPreview, setIsGeneratingFromPreview] = useState(false);

  // Track whether the user intentionally cleared excelPreviewData (Cancel, or all rows processed).
  // This prevents the useEffect from wiping localStorage on component mount/navigation.
  const intentionalClearRef = useRef(false);

  // ── Step 1: Manufacturer Selection ──
  // Restored from IndexedDB asynchronously (see recovery effect below)
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('');
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>('');
  const [manufacturerOpen, setManufacturerOpen] = useState(false);
  const [manufacturerSearch, setManufacturerSearch] = useState('');
  const [manufacturerList, setManufacturerList] = useState<string[]>(MANUFACTURERS);
  const [factoryItemsList, setFactoryItemsList] = useState<FactoryItem[]>([]);
  const [manufacturerListLoading, setManufacturerListLoading] = useState(true);
  const [manufacturerListSource, setManufacturerListSource] = useState<'dynamic' | 'static' | null>(null);

  // ── Step 1b: Category Selection (syncs with bwf_product_categories) ──
  const [selectedProductCategory, setSelectedProductCategory] = useState<string>('');
  const [categoryList, setCategoryList] = useState<{ id: string; name: string; parent_id: string | null; level: number; sort_order: number }[]>([]);
  const [categoryListLoading, setCategoryListLoading] = useState(false);
  // raw 一級/二級 pairs from product_category — used to resolve level1/level2 on upload
  const [categoryPairs, setCategoryPairs] = useState<{ level1: string; level2: string }[]>([]);

  // Fetch categories from the product_category table (設定 > 產品分類) on mount.
  // Build the cascading-selector shape: level-1 = unique 一級分類, level-2 = 二級分類.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCategoryListLoading(true);
      try {
        const { data, error } = await supabase
          .from('product_category')
          .select('level1, level2, sort_order')
          .order('sort_order', { ascending: true });
        if (error) {
          console.warn('[AIProcessorView] Failed to fetch product_category:', error.message);
        }
        if (!cancelled && data) {
          const pairs = data.map((r: any) => ({ level1: String(r.level1 ?? '').trim(), level2: String(r.level2 ?? '').trim() }))
            .filter((p) => p.level1);
          setCategoryPairs(pairs);

          // build flat list for CascadingCategorySelector
          const built: { id: string; name: string; parent_id: string | null; level: number; sort_order: number }[] = [];
          const level1Ids = new Map<string, string>();
          let order = 0;
          for (const p of pairs) {
            if (!level1Ids.has(p.level1)) {
              const id = 'L1::' + p.level1;
              level1Ids.set(p.level1, id);
              built.push({ id, name: p.level1, parent_id: null, level: 1, sort_order: order++ });
            }
            if (p.level2) {
              built.push({ id: 'L2::' + p.level1 + '::' + p.level2, name: p.level2, parent_id: level1Ids.get(p.level1)!, level: 2, sort_order: order++ });
            }
          }
          setCategoryList(built);
        }
      } catch (err) {
        console.warn('[AIProcessorView] Category fetch error:', err);
      } finally {
        if (!cancelled) setCategoryListLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Resolve a selected category name (could be a 一級 or 二級 name) → { level1, level2 }
  const resolveCategoryLevels = useCallback((selected: string): { level1: string | null; level2: string | null } => {
    if (!selected) return { level1: null, level2: null };
    // match as 二級分類 first
    const asL2 = categoryPairs.find((p) => p.level2 === selected);
    if (asL2) return { level1: asL2.level1, level2: asL2.level2 };
    // else match as 一級分類
    const asL1 = categoryPairs.find((p) => p.level1 === selected);
    if (asL1) return { level1: asL1.level1, level2: null };
    return { level1: null, level2: null };
  }, [categoryPairs]);

  // ─── Session Recovery Guard (IndexedDB) ───────────────────────────────────
  // This runs on mount. Loads the full session (including images) from IndexedDB.
  // DEFERRED: We use requestIdleCallback / setTimeout to avoid blocking initial render.
  const hasAttemptedRecovery = useRef(false);
  useEffect(() => {
    if (hasAttemptedRecovery.current) return;
    hasAttemptedRecovery.current = true;

    const doRestore = async () => {
      const saved = await loadSession();
      if (!saved || !saved.headerLabels) {
        console.log('[IndexedDB] No saved session found');
        return;
      }

      console.log('[IndexedDB] Restore successful. Table is ready.', {
        rows: saved.rows?.length,
        images: saved.images?.length,
        hasProductImages: saved.rows?.some((r: any) => r.productImageData),
        manufacturer: saved._manufacturer,
      });

      // Set manufacturer first (lightweight state) before the heavy table data
      if (saved._manufacturer) {
        setSelectedManufacturer(saved._manufacturer);
      }
      if (saved._factoryId) {
        setSelectedFactoryId(saved._factoryId);
      }
      if (saved._category) {
        setSelectedProductCategory(saved._category);
      }

      // Defer heavy table state update to after initial paint
      requestAnimationFrame(() => {
        setExcelPreviewData(saved as ExcelPreviewData);
      });
    };

    // Use requestIdleCallback to avoid blocking the main thread during page load
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(doRestore, { timeout: 2000 });
    } else {
      setTimeout(doRestore, 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist excelPreviewData to IndexedDB whenever it changes.
  // IndexedDB has no size limit, so we preserve ALL image data (base64) for full restore on F5.
  useEffect(() => {
    if (excelPreviewData) {
      // Save full data including images to IndexedDB
      const { rawArrayBuffer, ...serializableData } = excelPreviewData as any;
      const toSave = {
        ...serializableData,
        _manufacturer: selectedManufacturer,
        _factoryId: selectedFactoryId,
        _category: selectedProductCategory,
      };
      saveSession(toSave);
    } else if (intentionalClearRef.current) {
      // ONLY clear when the user intentionally cancelled or all rows were processed.
      console.log('[IndexedDB] Clearing session (intentional clear)');
      clearSession();
      intentionalClearRef.current = false;
    } else {
      // Safeguard: if IndexedDB has data but state is null AND we haven't intentionally cleared,
      // RESTORE instead of doing nothing.
      if (!hasAttemptedRecovery.current) return; // Let the recovery effect handle it first
      (async () => {
        const saved = await loadSession();
        if (saved?.headerLabels) {
          console.log('[IndexedDB] ⚠️ State is null but IndexedDB has valid data — RESTORING (anti-clear safeguard)');
          setExcelPreviewData(saved as ExcelPreviewData);
          if (saved._manufacturer && !selectedManufacturer) {
            setSelectedManufacturer(saved._manufacturer);
          }
          if (saved._factoryId && !selectedFactoryId) {
            setSelectedFactoryId(saved._factoryId);
          }
          if (saved._category && !selectedProductCategory) {
            setSelectedProductCategory(saved._category);
          }
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelPreviewData, selectedManufacturer, selectedFactoryId, selectedProductCategory]);

  // Helper: Remove processed rows from excelPreviewData (burn-down logic)
  // Only removes targeted rows — does NOT reset the session.
  // Session completes ONLY when every row across ALL sheets has been processed.
  // ✅ Rows NOT in processedRowIndices are strictly preserved in their original sheet/index.
  const removeRowsFromPreview = useCallback((processedRowIndices: number[]) => {
    setExcelPreviewData(prev => {
      if (!prev) return null;
      const rowSet = new Set(processedRowIndices);

      // Step 1: Filter processed rows from per-sheet data
      const newSheets = prev.sheets?.map(s => ({
        ...s,
        rows: s.rows.filter(r => !rowSet.has(r.rowIndex)),
      }));

      // Step 2: Check if ALL actionable rows across ALL sheets have been processed
      const totalRemaining = newSheets
        ? newSheets.reduce((sum, s) => sum + s.rows.filter(r => r.hasMinimalData).length, 0)
        : prev.rows.filter(r => !rowSet.has(r.rowIndex) && r.hasMinimalData).length;

      if (totalRemaining === 0) {
        // ═══ SESSION COMPLETE: All products in ALL sheets processed ═══
        toast.success('✅ 所有產品已處理完成！', { description: '所有工作表的產品均已處理 — All products across all sheets processed' });
        clearMappings();
        intentionalClearRef.current = true;
        return null;
      }

      // Step 3: Aggressive sheet cleanup — remove sheets where NO rows have hasMinimalData
      const cleanedSheets = newSheets?.filter(s => s.rows.some(r => r.hasMinimalData));
      const finalSheets = cleanedSheets && cleanedSheets.length > 0 ? cleanedSheets : newSheets;
      const finalSheetNames = finalSheets
        ? finalSheets.map(s => s.sheetName)
        : prev.sheetNames;

      // Step 4: Sync top-level rows to only include rows from remaining sheets
      // This ensures top-level `rows` array is consistent with the cleaned sheets
      const finalRows = finalSheets
        ? finalSheets.flatMap(s => s.rows)
        : prev.rows.filter(r => !rowSet.has(r.rowIndex));

      console.log(`[BurnDown] Removed ${processedRowIndices.length} rows. Remaining: ${totalRemaining} actionable rows across ${finalSheets?.length || 1} sheet(s)`);

      return {
        ...prev,
        rows: finalRows,
        sheets: finalSheets,
        sheetNames: finalSheetNames,
      };
    });
  }, []);

  // ── Edit a preview cell in place — updates both top-level rows and per-sheet rows
  // so the edited value flows through to upload. ──
  const handleCellEdit = useCallback((sheetName: string, rowIndex: number, colIdx: number, value: string) => {
    setExcelPreviewData(prev => {
      if (!prev) return prev;
      const patchRows = (rows: typeof prev.rows) =>
        rows.map(r => {
          if (r.rowIndex !== rowIndex) return r;
          const cells = [...r.cells];
          cells[colIdx] = value;
          return { ...r, cells };
        });
      const newSheets = prev.sheets?.map(s =>
        s.sheetName === sheetName ? { ...s, rows: patchRows(s.rows) } : s
      );
      // Keep top-level rows in sync (single-sheet fallback also covered)
      const newRows = newSheets
        ? newSheets.flatMap(s => s.rows)
        : patchRows(prev.rows);
      return { ...prev, rows: newRows, sheets: newSheets };
    });
  }, []);

  // ── Factory Learning hook — loads + applies correction patterns per factory ──
  const { saveCorrection, applyCorrections, getCorrections } = useFactoryLearning(
    selectedFactoryId,
    selectedManufacturer,
  );

  // ── 材料管理: Colors & Fabrics (Multi-select) ──
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedFabrics, setSelectedFabrics] = useState<string[]>([]);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [colorsSearch, setColorsSearch] = useState('');
  const [fabricsOpen, setFabricsOpen] = useState(false);

  // ── Factory Highlights (Multi-select) ──
  const [selectedFactoryHighlights, setSelectedFactoryHighlights] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [highlightsSearch, setHighlightsSearch] = useState('');

  // Fetch manufacturers from external Supabase on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setManufacturerListLoading(true);
      const fetched = await fetchFactoriesWithIds();
      if (!cancelled) {
        if (fetched.length > 0) {
          setFactoryItemsList(fetched);
          setManufacturerList(fetched.map(f => f.display_name));
          setManufacturerListSource('dynamic');
          console.log('[AIProcessor] ✅ Loaded', fetched.length, 'manufacturers with IDs from edge function');
        } else {
          // Fallback to static list if edge function fails or returns empty
          setManufacturerList(MANUFACTURERS);
          setFactoryItemsList([]);
          setManufacturerListSource('static');
          console.warn('[AIProcessor] ⚠️ Edge function returned empty — using static fallback list');
        }
        setManufacturerListLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch product categories for Factory Highlights
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCategoriesLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('supabase-functions-fetch-product-categories');
        if (!cancelled) {
          if (error) {
            console.error('[AIProcessor] Failed to fetch product categories:', error);
            setAvailableCategories([]);
          } else if (data?.categories && Array.isArray(data.categories)) {
            setAvailableCategories(data.categories);
            console.log('[AIProcessor] ✅ Loaded', data.categories.length, 'product categories for highlights');
          } else {
            setAvailableCategories([]);
          }
          setCategoriesLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[AIProcessor] Error fetching categories:', err);
          setAvailableCategories([]);
          setCategoriesLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isManufacturerSelected = selectedManufacturer.trim().length > 0;

  const filteredManufacturers = useMemo(() => {
    if (!manufacturerSearch.trim()) return manufacturerList;
    const q = manufacturerSearch.toLowerCase();
    return manufacturerList.filter(m => {
      if (m.toLowerCase().includes(q)) return true;
      // Also search by factory_id (code)
      const fItem = factoryItemsList.find(f => f.display_name === m);
      if (fItem?.factory_id && fItem.factory_id.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [manufacturerSearch, manufacturerList, factoryItemsList]);

  // ─── Add files to queue WITHOUT triggering processing ───────────────
  const addFilesToQueue = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const excelMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const excelExtensions = ['.xlsx', '.xls'];
    const isExcelFile = (f: File) => excelMimeTypes.includes(f.type) || excelExtensions.some(ext => f.name.toLowerCase().endsWith(ext));
    
    const validFiles = files.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf' || isExcelFile(f));
    if (validFiles.length === 0) return;

    // Build upload entries for display (thumbnails)
    // NOTE: PDFs and Excel files are NOT read as base64 here — only at processing time.
    // Reading large PDFs as base64 in addFilesToQueue was freezing the UI.
    const newEntries: UploadedFile[] = await Promise.all(
      validFiles.map(async (file) => {
        if (isExcelFile(file)) {
          return {
            id: Math.random().toString(36).substring(7),
            file,
            name: file.name,
            type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            thumbnail: '',
            base64Data: '',
            mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          };
        } else if (file.type === 'application/pdf') {
          // PDF: defer base64 reading to processing time to avoid UI freeze
          return {
            id: Math.random().toString(36).substring(7),
            file,
            name: file.name,
            type: file.type,
            thumbnail: '',
            base64Data: '', // Will be read lazily during processFiles
            mimeType: file.type,
          };
        } else {
          const { dataUrl, base64, mimeType } = await readFileAsBase64(file);
          return {
            id: Math.random().toString(36).substring(7),
            file,
            name: file.name,
            type: file.type,
            thumbnail: file.type.startsWith('image/') ? dataUrl : '',
            base64Data: base64,
            mimeType,
          };
        }
      })
    );

    setUploadedFiles(prev => [...prev, ...newEntries]);

    // Detect processing mode based on files present
    const allFiles = [...uploadedFiles, ...newEntries];
    const hasExcel = allFiles.some(f => excelExtensions.some(ext => f.name.toLowerCase().endsWith(ext)) || excelMimeTypes.includes(f.type));
    const hasPdf = allFiles.some(f => f.type === 'application/pdf');
    
    if (hasExcel && hasPdf) {
      // Cross-reference mode: PDF for images, Excel for data
      setProcessingMode('excel-pdf-crossref');
    } else if (hasExcel) {
      setProcessingMode('excel-catalog');
    } else if (hasPdf) {
      setProcessingMode('pdf-catalog');
    } else {
      setProcessingMode('single-image');
    }
  }, [uploadedFiles]);

  // ─── Generate / Process Files (triggered by button) ─────────────────
  // NOTE: handleGenerate is defined after processFiles below

  // ─── Handle "Generate Catalog Result" from the Preview Table ────────
  const handleGenerateFromPreview = useCallback(async (mapping: ColumnMappingState, selectedRows: number[], multiSheetMapping?: MultiSheetColumnMapping, imageOverrides?: Record<string, string>, multiSheetDimUnits?: MultiSheetDimUnits) => {
    if (!excelPreviewData) return;
    
    setIsGeneratingFromPreview(true);
    setIsProcessing(true);
    setAiError(null);
    setCatalogProductsWithRef([]);
    setProcessingProgress({ phase: 'extracting', message: '根據欄位映射生成目錄結果...' });

    try {
      const { rows, images, rawArrayBuffer, sheets } = excelPreviewData;

      // ═══ MULTI-SHEET AWARE GENERATION ═══════════════════════════════════
      // If we have per-sheet data and multi-sheet mapping, process each sheet
      // with its own column mapping to ensure images stay with the correct sheet.
      const allSheetRows: Array<{ row: typeof rows[0]; sheetMapping: ColumnMappingState; sheetName: string }> = [];

      if (sheets && sheets.length > 0 && multiSheetMapping) {
        // Multi-sheet mode: iterate each sheet and use its specific mapping
        for (const sheetData of sheets) {
          const sheetMappingForThisSheet = multiSheetMapping[sheetData.sheetName] || mapping;
          for (const row of sheetData.rows) {
            // Only include if row is in the selectedRows set
            if (selectedRows.includes(row.rowIndex)) {
              allSheetRows.push({ row, sheetMapping: sheetMappingForThisSheet, sheetName: sheetData.sheetName });
            }
          }
        }
      } else {
        // Legacy single-sheet mode
        const selectedRowSet = new Set(selectedRows);
        const sheetName = excelPreviewData.sheetNames[0] || 'Sheet 1';
        for (const row of rows) {
          if (selectedRowSet.has(row.rowIndex)) {
            allSheetRows.push({ row, sheetMapping: mapping, sheetName });
          }
        }
      }

      console.log(`[GenerateFromPreview] Processing ${allSheetRows.length} rows across ${sheets?.length || 1} sheets`);

      // Build CatalogProducts from user-confirmed mapping (per-row mapping aware)
      const catalogProds: CatalogProduct[] = allSheetRows.map(({ row, sheetMapping, sheetName }, idx) => {
        // User-selected unit override for this sheet's dimension parsing.
        // 'auto' (or undefined) → fall back to header-based detection.
        const sheetDimUnit: DimUnit = multiSheetDimUnits?.[sheetName] || 'mm';
        const dimUnitOverride: 'mm' | 'cm' | 'm' | undefined = sheetDimUnit === 'auto' ? undefined : sheetDimUnit;

        // Build column index lookup from this row's sheet mapping
        const fieldToCol: Record<string, number> = {};
        for (const [colIdxStr, field] of Object.entries(sheetMapping)) {
          // Skip special mapping keys (they start with '__img_' or '__ai_')
          if (colIdxStr.startsWith('__')) continue;
          if (field !== 'skip') {
            fieldToCol[field] = Number(colIdxStr);
          }
        }

        const getCellStr = (field: string): string => {
          const colIdx = fieldToCol[field];
          if (colIdx === undefined) return '';
          const val = row.cells[colIdx];
          return val !== null && val !== undefined ? String(val).trim() : '';
        };
        const getCellNum = (field: string): number | null => {
          const colIdx = fieldToCol[field];
          if (colIdx === undefined) return null;
          const val = row.cells[colIdx];
          if (val === null || val === undefined) return null;
          const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[,$¥￥]/g, ''));
          return isNaN(num) ? null : num;
        };

        const modelNumber = getCellStr('model_number');
        const rawTitle = getCellStr('title') || modelNumber || `Row ${row.rowIndex}`;
        const title = simplifiedToTraditional(rawTitle);
        // Apply Simplified → Traditional Chinese conversion for material (材质描述)
        const rawMaterial = getCellStr('material');
        const material = rawMaterial ? simplifiedToTraditional(rawMaterial) : '';
        const dimensions = getCellStr('dimensions');
        // Apply price cleaning (取大值): handles "680/750/820" → 820
        // CRITICAL: Always pass raw cell value to cleanPrice. 
        // getCellStr returns string representation; getCellNum would truncate at first non-numeric char.
        const rawCostPriceCell = (() => {
          const colIdx = fieldToCol['cost_price'];
          if (colIdx === undefined) return null;
          return row.cells[colIdx]; // raw value — string or number
        })();
        const costPrice = cleanPrice(rawCostPriceCell);
        const rawSalePriceCell = (() => {
          const colIdx = fieldToCol['sale_price'];
          if (colIdx === undefined) return null;
          return row.cells[colIdx]; // raw value — string or number
        })();
        const salePrice = cleanPrice(rawSalePriceCell);
        const rawColor = getCellStr('color') || null;
        const color = rawColor ? simplifiedToTraditional(rawColor) : null;
        // Apply Simplified → Traditional Chinese conversion for description
        const rawDescription = getCellStr('description');
        const description = rawDescription ? simplifiedToTraditional(rawDescription) : '';
        const rawCollection = getCellStr('collection');
        const collection = rawCollection ? simplifiedToTraditional(rawCollection) : '';
        // Extract additional mapped fields that map directly to bwf_product_master columns
        const factoryNameFromExcel = getCellStr('factory_name');
        const productionLeadTime = getCellNum('production_lead_time');
        // 'production_lead_time' mapping now feeds the new products.production_time
        // (4 fixed options) — normalize the raw cell value.
        const productionTime = normalizeProductionTime(getCellStr('production_lead_time'));
        const deliveryDays = getCellNum('delivery_days');
        const shippingDays = getCellNum('shipping_days');
        const shippingFee = getCellNum('shipping_fee');
        const remarks = getCellStr('remarks') || null;
        const specifications = getCellStr('specifications') ? simplifiedToTraditional(getCellStr('specifications')) : null;
        const imageUrl2 = getCellStr('image_url_2') || null;
        const imageUrl3 = getCellStr('image_url_3') || null;

        // Parse dimensions — support individual (mm) fields OR combined string
        let dimensionLMm: number | null = null;
        let dimensionWMm: number | null = null;
        let dimensionHMm: number | null = null;

        const dimLMmStr = getCellStr('dim_length_mm');
        const dimWMmStr = getCellStr('dim_width_mm');
        const dimHMmStr = getCellStr('dim_height_mm');

        if (dimLMmStr && (dimLMmStr.includes('/') || dimLMmStr.includes('*') || dimLMmStr.includes('×') || dimLMmStr.includes('\n'))) {
          const currentSheet = sheets?.find(s => s.sheetName === sheetName);
          const colIdx = fieldToCol['dim_length_mm'];
          const headerText = (colIdx !== undefined && currentSheet) ? (currentSheet.headerLabels[colIdx] || '') : '';
          dimensionLMm = parseSmartDimensions(dimLMmStr, headerText).l;
        } else {
          dimensionLMm = getCellNum('dim_length_mm');
        }
        if (dimWMmStr && (dimWMmStr.includes('/') || dimWMmStr.includes('*') || dimWMmStr.includes('×') || dimWMmStr.includes('\n'))) {
          const currentSheet = sheets?.find(s => s.sheetName === sheetName);
          const colIdx = fieldToCol['dim_width_mm'];
          const headerText = (colIdx !== undefined && currentSheet) ? (currentSheet.headerLabels[colIdx] || '') : '';
          dimensionWMm = parseSmartDimensions(dimWMmStr, headerText).w;
        } else {
          dimensionWMm = getCellNum('dim_width_mm');
        }
        if (dimHMmStr && (dimHMmStr.includes('/') || dimHMmStr.includes('*') || dimHMmStr.includes('×') || dimHMmStr.includes('\n'))) {
          const currentSheet = sheets?.find(s => s.sheetName === sheetName);
          const colIdx = fieldToCol['dim_height_mm'];
          const headerText = (colIdx !== undefined && currentSheet) ? (currentSheet.headerLabels[colIdx] || '') : '';
          dimensionHMm = parseSmartDimensions(dimHMmStr, headerText).h;
        } else {
          dimensionHMm = getCellNum('dim_height_mm');
        }

        if (dimensionLMm !== null) dimensionLMm = Math.round(dimensionLMm);
        if (dimensionWMm !== null) dimensionWMm = Math.round(dimensionWMm);
        if (dimensionHMm !== null) dimensionHMm = Math.round(dimensionHMm);

        // Fallback: parse from combined dimensions string using smart parser (unit-aware)
        // Trigger if ALL three dimension fields are still null and we have a combined string
        if (dimensionLMm === null && dimensionWMm === null && dimensionHMm === null && dimensions) {
          const dimColIdx = fieldToCol['dimensions'];
          const currentSheet = sheets?.find(s => s.sheetName === sheetName);
          const dimHeader = (dimColIdx !== undefined && currentSheet) ? (currentSheet.headerLabels[dimColIdx] || '') : '';
          const smartDims = parseSmartDimensions(dimensions, dimHeader, dimUnitOverride);
          dimensionLMm = smartDims.l;
          dimensionWMm = smartDims.w;
          dimensionHMm = smartDims.h;
          console.log(`[DimFallback] Combined "${dimensions}" (unit=${sheetDimUnit}) → L:${dimensionLMm} W:${dimensionWMm} H:${dimensionHMm}`);
        }

        const displayTitle = modelNumber && material
          ? `${modelNumber} - ${material}`
          : title;

        // Resolve image mapping: check if user swapped IMG-P and IMG-L targets
        const imgProductTarget = sheetMapping['__img_product'] || 'product_image';
        const imgLifestyleTarget = sheetMapping['__img_lifestyle'] || 'lifestyle_image';
        
        // Apply imageOverrides from ExcelPreviewTable (key format: `${sheetName}:${rowIndex}:${type}`)
        const productOverrideKey = `${sheetName}:${row.rowIndex}:product`;
        const lifestyleOverrideKey = `${sheetName}:${row.rowIndex}:lifestyle`;
        const overriddenProductImage = imageOverrides?.[productOverrideKey] || null;
        const overriddenLifestyleImage = imageOverrides?.[lifestyleOverrideKey] || null;

        // Use override first, then fall back to row data
        let resolvedProductImage = overriddenProductImage || row.productImageData || undefined;
        let resolvedLifestyleImage = overriddenLifestyleImage || row.lifestyleImageData || undefined;
        
        if (imgProductTarget === 'lifestyle_image' && imgLifestyleTarget === 'product_image') {
          // User swapped the image assignments
          const tempProduct = resolvedProductImage;
          resolvedProductImage = resolvedLifestyleImage;
          resolvedLifestyleImage = tempProduct;
        } else if (imgProductTarget === 'skip') {
          resolvedProductImage = undefined;
        } else if (imgLifestyleTarget === 'skip') {
          resolvedLifestyleImage = undefined;
        }

        return {
          id: `excel-preview-${row.rowIndex}-${idx}-${Math.random().toString(36).substring(7)}`,
          title: displayTitle,
          titleEn: '',
          titleZh: '',
          description: description || (material ? `材質描述: ${material}` : ''),
          tags: collection ? [collection] : [],
          price: salePrice || costPrice || 0,
          collection,
          material,
          dimensions,
          image_region: '',
          page_number: row.rowIndex,
          selected: true,
          expanded: false,
          cropped_image_url: resolvedProductImage,
          lifestyleImageUrl: resolvedLifestyleImage,
          additional_images: resolvedLifestyleImage ? [resolvedLifestyleImage] : [],
          bounding_box: null,
          costPrice,
          productionLeadTime,
          productionTime,
          deliveryDays,
          shippingDays,
          shippingFee,
          remarks,
          specifications,
          imageUrl2,
          imageUrl3,
          color,
          factoriesDisplayName: factoryNameFromExcel || selectedManufacturer,
          dimensionLMm,
          dimensionWMm,
          dimensionHMm,
          modelNumber,
          imageSource: resolvedProductImage ? 'excel' as const : null,
          dataSource: 'excel' as const,
          imageValidated: !!resolvedProductImage,
        };
      });

      const withImages = catalogProds.filter(p => p.cropped_image_url).length;
      console.log(`[GenerateFromPreview] Generated ${catalogProds.length} catalog products, ${withImages} with images`);

      // Apply factory corrections
      setCatalogProductsWithRef(applyCorrections(catalogProds));
      
      // Clear preview data to transition to the result view
      intentionalClearRef.current = true;
      setExcelPreviewData(null);
      setIsGeneratingFromPreview(false);
      setIsProcessing(false);
      
      const correctionCount = getCorrections().length;
      const correctionNote = correctionCount > 0 ? ` (${correctionCount} learnt corrections applied)` : '';
      setProcessingProgress({
        phase: 'complete',
        message: `✅ 成功生成 ${catalogProds.length} 個產品目錄結果 | ${withImages} 張圖片${correctionNote}`,
      });

    } catch (error: any) {
      setIsGeneratingFromPreview(false);
      setIsProcessing(false);
      // Classify error for better UX
      const rawMsg = error?.message || 'Generation from preview failed.';
      let errorCategory = '';
      if (rawMsg.includes('fetch') || rawMsg.includes('network') || rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError')) {
        errorCategory = '🌐 Network Error: ';
      } else if (rawMsg.includes('constraint') || rawMsg.includes('duplicate') || rawMsg.includes('violates')) {
        errorCategory = '🗄️ Database Constraint: ';
      } else if (rawMsg.includes('JSON') || rawMsg.includes('parse') || rawMsg.includes('payload') || rawMsg.includes('size')) {
        errorCategory = '📦 Data Formatting: ';
      } else if (rawMsg.includes('timeout') || rawMsg.includes('abort') || rawMsg.includes('Timeout')) {
        errorCategory = '⏱️ Timeout: ';
      }
      const classifiedError = `${errorCategory}${rawMsg}`;
      setAiError(classifiedError);
      setProcessingProgress({ phase: 'error', message: classifiedError });
    }
  }, [excelPreviewData, selectedManufacturer, applyCorrections, getCorrections, setCatalogProductsWithRef]);

  // ─── Cancel Preview Table → go back to upload ────────────────────────
  const handleCancelPreview = useCallback(() => {
    console.log('[IndexedDB] User cancelled preview — clearing session');
    intentionalClearRef.current = true;
    setExcelPreviewData(null);
    setProcessingProgress(null);
    setProcessingMode('idle');
    // Clear persisted sessions from IndexedDB + localStorage
    clearSession();
    clearMappings();
  }, []);

  // ─── Three-Way Action from Preview Table ────────────────────────────
  const handlePreviewAction = useCallback(async (
    action: PreviewAction,
    mapping: ColumnMappingState,
    selectedRows: number[],
    productNames: Record<string, string>,
    multiSheetMapping?: MultiSheetColumnMapping,
    imageOverrides?: Record<string, string>,
    multiSheetDimUnits?: MultiSheetDimUnits
  ) => {
    if (!excelPreviewData) return;

    setIsGeneratingFromPreview(true);
    // NOTE: Do NOT set isProcessing=true here — it would unmount the ExcelPreviewTable.
    // The table stays mounted and uses isGeneratingFromPreview (passed as isGenerating prop)
    // to disable buttons during processing, maintaining row persistence.
    setAiError(null);
    setCatalogProductsWithRef([]);

    const actionLabel = action === 'queue-shopify' ? '待上傳到 Shopify' : '上傳到產品目錄';
    setProcessingProgress({ phase: 'extracting', message: `${actionLabel} — 處理中...` });

    try {
      const { rows, sheets } = excelPreviewData;

      // ═══ MULTI-SHEET AWARE GENERATION ═══
      const allSheetRows: Array<{ row: typeof rows[0]; sheetMapping: ColumnMappingState; sheetName: string }> = [];

      if (sheets && sheets.length > 0 && multiSheetMapping) {
        for (const sheetData of sheets) {
          const sheetMappingForThisSheet = multiSheetMapping[sheetData.sheetName] || mapping;
          for (const row of sheetData.rows) {
            if (selectedRows.includes(row.rowIndex)) {
              allSheetRows.push({ row, sheetMapping: sheetMappingForThisSheet, sheetName: sheetData.sheetName });
            }
          }
        }
      } else {
        const selectedRowSet = new Set(selectedRows);
        const sheetName = excelPreviewData.sheetNames[0] || 'Sheet 1';
        for (const row of rows) {
          if (selectedRowSet.has(row.rowIndex)) {
            allSheetRows.push({ row, sheetMapping: mapping, sheetName });
          }
        }
      }

      console.log(`[PreviewAction:${action}] Processing ${allSheetRows.length} rows`);

      // Build CatalogProducts from user-confirmed mapping (per-row mapping aware)
      const catalogProds: CatalogProduct[] = allSheetRows.map(({ row, sheetMapping, sheetName }, idx) => {
        // User-selected unit override for this sheet's dimension parsing.
        const sheetDimUnit: DimUnit = multiSheetDimUnits?.[sheetName] || 'mm';
        const dimUnitOverride: 'mm' | 'cm' | 'm' | undefined = sheetDimUnit === 'auto' ? undefined : sheetDimUnit;

        const fieldToCol: Record<string, number> = {};
        for (const [colIdxStr, field] of Object.entries(sheetMapping)) {
          // Skip all special/internal mapping keys (e.g. __img_product, __ai_product_name)
          if (colIdxStr.startsWith('__')) continue;
          if (field !== 'skip') {
            fieldToCol[field] = Number(colIdxStr);
          }
        }

        const getCellStr = (field: string): string => {
          const colIdx = fieldToCol[field];
          if (colIdx === undefined) return '';
          const val = row.cells[colIdx];
          return val !== null && val !== undefined ? String(val).trim() : '';
        };
        const getCellNum = (field: string): number | null => {
          const colIdx = fieldToCol[field];
          if (colIdx === undefined) return null;
          const val = row.cells[colIdx];
          if (val === null || val === undefined) return null;
          const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[,$¥￥]/g, ''));
          return isNaN(num) ? null : num;
        };

        const modelNumber = getCellStr('model_number');
        const rawTitle = getCellStr('title') || modelNumber || `Row ${row.rowIndex}`;
        const title = simplifiedToTraditional(rawTitle);
        // Apply Simplified → Traditional Chinese conversion for material (材质描述)
        const rawMaterial = getCellStr('material');
        const material = rawMaterial ? simplifiedToTraditional(rawMaterial) : '';
        const dimensions = getCellStr('dimensions');
        // Apply price cleaning (取大值): handles "680/750/820" → 820
        // CRITICAL: Always pass raw cell value to cleanPrice. 
        // getCellStr returns string representation; getCellNum would truncate at first non-numeric char.
        const rawCostPriceCell = (() => {
          const colIdx = fieldToCol['cost_price'];
          if (colIdx === undefined) return null;
          return row.cells[colIdx]; // raw value — string or number
        })();
        const costPrice = cleanPrice(rawCostPriceCell);
        const rawSalePriceCell = (() => {
          const colIdx = fieldToCol['sale_price'];
          if (colIdx === undefined) return null;
          return row.cells[colIdx]; // raw value — string or number
        })();
        const salePrice = cleanPrice(rawSalePriceCell);
        const rawColor = getCellStr('color') || null;
        const color = rawColor ? simplifiedToTraditional(rawColor) : null;
        // Apply Simplified → Traditional Chinese conversion for description
        const rawDescription = getCellStr('description');
        const description = rawDescription ? simplifiedToTraditional(rawDescription) : '';
        const rawCollection = getCellStr('collection');
        const collection = rawCollection ? simplifiedToTraditional(rawCollection) : '';
        // Extract additional mapped fields for master DB
        const factoryNameFromExcel = getCellStr('factory_name');
        const productionLeadTime = getCellNum('production_lead_time');
        // 'production_lead_time' mapping feeds the new products.production_time (4 options)
        const productionTime = normalizeProductionTime(getCellStr('production_lead_time'));
        const deliveryDays = getCellNum('delivery_days');
        const shippingDays = getCellNum('shipping_days');
        const shippingFee = getCellNum('shipping_fee');
        const remarks = getCellStr('remarks') || null;
        const specifications = getCellStr('specifications') ? simplifiedToTraditional(getCellStr('specifications')) : null;
        const imageUrl2 = getCellStr('image_url_2') || null;
        const imageUrl3 = getCellStr('image_url_3') || null;

        // ── Delivery Term Parsing (from 參考貨期 column) ──────────────────────
        const rawDeliveryTermRef = getCellStr('delivery_term_ref');
        let deliveryTermId: string | null = null;
        let deliveryTermName: string | null = null;
        if (rawDeliveryTermRef) {
          const parsed = parseDeliveryTerm(rawDeliveryTermRef);
          deliveryTermId = parsed.id;
          deliveryTermName = parsed.name;
        }

        // Include AI-generated product name if available
        const nameKey = `${sheetName}:${row.rowIndex}`;
        const aiGeneratedName = productNames[nameKey] || '';

        // Parse dimensions — individual (mm) fields OR combined string
        let dimensionLMm: number | null = null;
        let dimensionWMm: number | null = null;
        let dimensionHMm: number | null = null;

        const dimLMmStr2 = getCellStr('dim_length_mm');
        const dimWMmStr2 = getCellStr('dim_width_mm');
        const dimHMmStr2 = getCellStr('dim_height_mm');

        if (dimLMmStr2 && (dimLMmStr2.includes('/') || dimLMmStr2.includes('*') || dimLMmStr2.includes('×') || dimLMmStr2.includes('\n'))) {
          const currentSheet = sheets?.find(s => s.sheetName === sheetName);
          const colIdx = fieldToCol['dim_length_mm'];
          const headerText = (colIdx !== undefined && currentSheet) ? (currentSheet.headerLabels[colIdx] || '') : '';
          dimensionLMm = parseSmartDimensions(dimLMmStr2, headerText).l;
        } else {
          dimensionLMm = getCellNum('dim_length_mm');
        }
        if (dimWMmStr2 && (dimWMmStr2.includes('/') || dimWMmStr2.includes('*') || dimWMmStr2.includes('×') || dimWMmStr2.includes('\n'))) {
          const currentSheet = sheets?.find(s => s.sheetName === sheetName);
          const colIdx = fieldToCol['dim_width_mm'];
          const headerText = (colIdx !== undefined && currentSheet) ? (currentSheet.headerLabels[colIdx] || '') : '';
          dimensionWMm = parseSmartDimensions(dimWMmStr2, headerText).w;
        } else {
          dimensionWMm = getCellNum('dim_width_mm');
        }
        if (dimHMmStr2 && (dimHMmStr2.includes('/') || dimHMmStr2.includes('*') || dimHMmStr2.includes('×') || dimHMmStr2.includes('\n'))) {
          const currentSheet = sheets?.find(s => s.sheetName === sheetName);
          const colIdx = fieldToCol['dim_height_mm'];
          const headerText = (colIdx !== undefined && currentSheet) ? (currentSheet.headerLabels[colIdx] || '') : '';
          dimensionHMm = parseSmartDimensions(dimHMmStr2, headerText).h;
        } else {
          dimensionHMm = getCellNum('dim_height_mm');
        }

        if (dimensionLMm !== null) dimensionLMm = Math.round(dimensionLMm);
        if (dimensionWMm !== null) dimensionWMm = Math.round(dimensionWMm);
        if (dimensionHMm !== null) dimensionHMm = Math.round(dimensionHMm);

        // Fallback: parse from combined dimensions string using smart parser (unit-aware)
        // Trigger if ALL three dimension fields are still null and we have a combined string
        if (dimensionLMm === null && dimensionWMm === null && dimensionHMm === null && dimensions) {
          const dimColIdx = fieldToCol['dimensions'];
          const currentSheet = sheets?.find(s => s.sheetName === sheetName);
          const dimHeader = (dimColIdx !== undefined && currentSheet) ? (currentSheet.headerLabels[dimColIdx] || '') : '';
          const smartDims = parseSmartDimensions(dimensions, dimHeader, dimUnitOverride);
          dimensionLMm = smartDims.l;
          dimensionWMm = smartDims.w;
          dimensionHMm = smartDims.h;
          console.log(`[DimFallback] Combined "${dimensions}" (unit=${sheetDimUnit}) → L:${dimensionLMm} W:${dimensionWMm} H:${dimensionHMm}`);
        }

        // Use AI-generated name as the display title if available, otherwise fallback
        const displayTitle = aiGeneratedName
          ? aiGeneratedName
          : (modelNumber && material ? `${modelNumber} - ${material}` : title);

        // Resolve image mapping — apply imageOverrides from ExcelPreviewTable
        const imgProductTarget = sheetMapping['__img_product'] || 'product_image';
        const imgLifestyleTarget = sheetMapping['__img_lifestyle'] || 'lifestyle_image';
        
        // Look up overridden images from ExcelPreviewTable (key format: `${sheetName}:${rowIndex}:${type}`)
        const productOverrideKey = `${sheetName}:${row.rowIndex}:product`;
        const lifestyleOverrideKey = `${sheetName}:${row.rowIndex}:lifestyle`;
        const overriddenProductImage = imageOverrides?.[productOverrideKey] || null;
        const overriddenLifestyleImage = imageOverrides?.[lifestyleOverrideKey] || null;
        
        // Use override first, then fall back to row data
        let resolvedProductImage = overriddenProductImage || row.productImageData || undefined;
        let resolvedLifestyleImage = overriddenLifestyleImage || row.lifestyleImageData || undefined;

        if (imgProductTarget === 'lifestyle_image' && imgLifestyleTarget === 'product_image') {
          // Swap: use the resolved values but in opposite positions
          const tempProduct = resolvedProductImage;
          resolvedProductImage = resolvedLifestyleImage;
          resolvedLifestyleImage = tempProduct;
        } else if (imgProductTarget === 'skip') {
          resolvedProductImage = undefined;
        } else if (imgLifestyleTarget === 'skip') {
          resolvedLifestyleImage = undefined;
        }

        return {
          id: `excel-action-${row.rowIndex}-${idx}-${Math.random().toString(36).substring(7)}`,
          title: displayTitle,
          titleEn: '',
          titleZh: '',
          description: description || (material ? `材質描述: ${material}` : ''),
          tags: collection ? [collection] : [],
          price: salePrice || costPrice || 0,
          collection,
          material,
          dimensions,
          image_region: '',
          page_number: row.rowIndex,
          selected: true,
          expanded: false,
          cropped_image_url: resolvedProductImage,
          lifestyleImageUrl: resolvedLifestyleImage,
          additional_images: resolvedLifestyleImage ? [resolvedLifestyleImage] : [],
          bounding_box: null,
          costPrice,
          productionLeadTime,
          productionTime,
          deliveryDays,
          shippingDays,
          shippingFee,
          remarks,
          specifications,
          imageUrl2,
          imageUrl3,
          color,
          factoriesDisplayName: factoryNameFromExcel || selectedManufacturer,
          dimensionLMm,
          dimensionWMm,
          dimensionHMm,
          modelNumber,
          deliveryTermId,
          deliveryTermName,
          imageSource: resolvedProductImage ? 'excel' as const : null,
          dataSource: 'excel' as const,
          imageValidated: !!resolvedProductImage,
        };
      });

      const withImages = catalogProds.filter(p => p.cropped_image_url).length;
      console.log(`[PreviewAction:${action}] Generated ${catalogProds.length} catalog products, ${withImages} with images`);

      // Apply factory corrections
      const correctedProds = applyCorrections(catalogProds);

      // ═══ BOTH actions require master DB write first ═══
      const payload = correctedProds.map(p => ({
        local_id: p.id,
        master_id: null,
        title: p.title,
        description_html: p.description,
        description: p.description,
        tags: p.tags,
        price: p.price,
        compare_at_price: null,
        collection: p.collection,
        image_url: p.cropped_image_url || p.lifestyleImageUrl || '',
        lifestyle_image_url: p.lifestyleImageUrl || '',
        category: selectedProductCategory || p.collection || '',
        // factory_name: prefer Excel-mapped value, then sidebar selector
        factory_name: (p as any).factoriesDisplayName || selectedManufacturer || '',
        // factory_id MUST be null (not empty string) if not set — DB expects UUID or null
        factory_id: selectedFactoryId || null,
        material: p.material || '',
        // Use nullish coalescing (??) instead of || for numeric fields — 0 is valid!
        dimension_l_mm: p.dimensionLMm ?? null,
        dimension_w_mm: p.dimensionWMm ?? null,
        dimension_h_mm: p.dimensionHMm ?? null,
        cost_price: p.costPrice ?? null,
        sale_price: 0,
        shopify_price: 0,
        color: p.color || null,
        production_lead_time: (p as any).productionLeadTime ?? null,
        delivery_days: (p as any).deliveryDays ?? null,
        shipping_days: (p as any).shippingDays ?? null,
        shipping_fee: (p as any).shippingFee ?? null,
        remarks: (p as any).remarks || null,
        factory_highlight: selectedFactoryHighlights || [],
        delivery_term_id: p.deliveryTermId || null,
        delivery_term_name: p.deliveryTermName || null,
      }));

      // ─── DEBUG: Log first item of payload so we can see exactly what's being sent ───
      console.log(`[PreviewAction:${action}] Payload sample (first item):`, JSON.stringify(payload[0], null, 2));

      // ─── MANDATORY: Write to master DB first (both actions) ───
      // Store image data as text strings (URL or base64 data URI) in bwf_product_master
      // Both http URLs and data:image/... base64 strings are valid text for the DB
      const MAX_IMAGE_SIZE_CHARS = 2_000_000; // ~2MB per image string limit to avoid payload overflow
      const isValidImageString = (v: unknown) => typeof v === 'string' && v.length > 0 && (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:image/'));
      const sanitizedPayload = payload.map(p => {
        let imageUrl = isValidImageString(p.image_url) ? p.image_url : '';
        let lifestyleUrl = isValidImageString(p.lifestyle_image_url) ? p.lifestyle_image_url : '';
        
        // Guard against oversized base64 strings that would exceed Supabase's payload limits
        if (imageUrl.length > MAX_IMAGE_SIZE_CHARS) {
          console.warn(`[PreviewAction] image_url for "${p.title}" exceeds ${MAX_IMAGE_SIZE_CHARS} chars (${Math.round(imageUrl.length / 1024)}KB) — truncating to empty`);
          imageUrl = '';
        }
        if (lifestyleUrl.length > MAX_IMAGE_SIZE_CHARS) {
          console.warn(`[PreviewAction] lifestyle_image_url for "${p.title}" exceeds ${MAX_IMAGE_SIZE_CHARS} chars (${Math.round(lifestyleUrl.length / 1024)}KB) — truncating to empty`);
          lifestyleUrl = '';
        }
        
        return {
          ...p,
          image_url: imageUrl,
          lifestyle_image_url: lifestyleUrl,
        };
      });

      // Use direct fetch with chunking (1 product per request to handle large base64 images safely)
      // If no images, we can use larger chunks for speed
      const hasLargePayloads = sanitizedPayload.some(p => (p.image_url?.length || 0) > 100_000 || (p.lifestyle_image_url?.length || 0) > 100_000);
      const CHUNK_SIZE = hasLargePayloads ? 1 : 3;
      const chunks: typeof sanitizedPayload[] = [];
      for (let i = 0; i < sanitizedPayload.length; i += CHUNK_SIZE) {
        chunks.push(sanitizedPayload.slice(i, i + CHUNK_SIZE));
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      // ─── PRE-FLIGHT VALIDATION ───
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing environment variables: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Go to Project Settings to configure them.');
      }
      
      // Validate that payload is JSON-serializable (catches circular refs, undefined, etc.)
      try {
        JSON.stringify(sanitizedPayload);
      } catch (jsonErr: any) {
        console.error(`[PreviewAction:${action}] ❌ PAYLOAD SERIALIZATION FAILED:`, jsonErr);
        console.error(`[PreviewAction:${action}] First product keys:`, Object.keys(sanitizedPayload[0] || {}));
        throw new Error(`Data serialization failed: ${jsonErr.message}. Check the product data for circular references or invalid values.`);
      }
      
      const fnUrl = `${supabaseUrl}/functions/v1/supabase-functions-upload-to-master-db`;

      console.log(`[PreviewAction:${action}] Uploading ${sanitizedPayload.length} products in ${chunks.length} chunks to ${fnUrl}`);

      const dbResults: any[] = [];
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        console.log(`[PreviewAction:${action}] Sending chunk ${ci + 1}/${chunks.length} (${chunk.length} products)`);
        
        const payloadStr = JSON.stringify({ products: chunk });
        const payloadSizeKB = Math.round(payloadStr.length / 1024);
        console.log(`[PreviewAction:${action}] Chunk ${ci + 1} payload size: ${payloadSizeKB}KB`);
        
        // Guard: if single-chunk payload exceeds 5MB, it will likely fail
        if (payloadStr.length > 5_000_000) {
          console.warn(`[PreviewAction:${action}] Chunk ${ci + 1} payload is ${payloadSizeKB}KB — very large, may fail`);
        }
        
        const resp = await fetch(fnUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'apikey': supabaseAnonKey,
          },
          body: payloadStr,
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
          console.error(`[PreviewAction:${action}] Chunk ${ci + 1} failed:`, resp.status, errText);
          // Parse error details if available
          let detail = errText.substring(0, 300);
          try {
            const errJson = JSON.parse(errText);
            detail = errJson.error || errJson.message || detail;
          } catch {}
          // For catalog-only, the master DB write is best-effort — we still
          // persist to the local `products` table below. Don't abort the whole
          // upload just because the external master DB rejected the chunk.
          if (action === 'catalog-only') {
            console.warn(`[PreviewAction:catalog-only] Master DB chunk ${ci + 1} failed (non-fatal): ${detail}`);
            continue;
          }
          throw new Error(`Database save failed (chunk ${ci + 1}/${chunks.length}, ${payloadSizeKB}KB): HTTP ${resp.status} — ${detail}`);
        }

        const chunkData = await resp.json();
        console.log(`[PreviewAction:${action}] Chunk ${ci + 1} response:`, chunkData);
        if (chunkData?.results) {
          dbResults.push(...chunkData.results);
        }
      }

      // Validate response — must get results
      const successCount = dbResults.filter((r: any) => r.success).length;
      const failCount = dbResults.filter((r: any) => !r.success).length;
      console.log(`[PreviewAction:${action}] Master DB total: ${successCount} success, ${failCount} failed`);

      // ─── CRITICAL: Log per-item error details for debugging ───
      const failedItems = dbResults.filter((r: any) => !r.success);
      if (failedItems.length > 0) {
        console.error(`[PreviewAction:${action}] ❌ FAILED ITEMS DETAIL:`, JSON.stringify(failedItems, null, 2));
        failedItems.forEach((item: any, idx: number) => {
          console.error(`  [${idx}] local_id=${item.local_id}, error="${item.error}"`);
        });
      }

      if (successCount === 0 && correctedProds.length > 0 && action !== 'catalog-only') {
        const firstError = failedItems[0]?.error || 'Unknown error';
        const errorSummary = failedItems.slice(0, 3).map((r: any) => r.error).join(' | ');
        console.error(`[PreviewAction:${action}] ALL FAILED. First error: ${firstError}`);
        console.error(`[PreviewAction:${action}] Payload sample (first item):`, JSON.stringify(sanitizedPayload[0], null, 2));
        throw new Error(`All ${correctedProds.length} products failed to save. Errors: ${errorSummary}`);
      }

      // ─── SELECTIVE BURN-DOWN: Only remove rows that were SUCCESSFULLY saved ───
      // Build a Set of local_ids that succeeded in the DB response
      const successfulLocalIds = new Set(
        dbResults.filter((r: any) => r.success).map((r: any) => r.local_id)
      );
      // Map successful local_ids back to their original row indices (page_number)
      const successfulRowIndices = correctedProds
        .filter(p => successfulLocalIds.has(p.id))
        .map(p => p.page_number);

      if (action === 'queue-shopify') {
        // Only add to local Shopify queue for items that SUCCEEDED in master DB
        for (const item of correctedProds) {
          if (!successfulLocalIds.has(item.id)) continue; // Skip failed items
          const imageUrl = item.cropped_image_url || item.lifestyleImageUrl || '';
          // Find master_id from DB response
          const dbResult = dbResults.find((r: any) => r.local_id === item.id);
          const product = {
            title: item.title,
            description: item.description,
            descriptionHtml: item.description,
            tags: item.tags,
            price: item.price,
            collection: item.collection,
            imageUrl,
            variants: [{
              id: Math.random().toString(36).substring(7),
              size: 'One Size',
              color: item.color || 'Default',
              sku: `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
              price: item.price,
              inventory: 100,
            }],
            factoriesDisplayName: selectedManufacturer || '',
            factoryId: selectedFactoryId || null,
            material: item.material || '',
            dimensionLMm: item.dimensionLMm ?? null,
            dimensionWMm: item.dimensionWMm ?? null,
            dimensionHMm: item.dimensionHMm ?? null,
            costPrice: item.costPrice ?? null,
            factoryHighlight: selectedFactoryHighlights,
            titleEn: item.titleEn || undefined,
            titleZh: item.titleZh || undefined,
            bwfMasterId: dbResult?.master_id || undefined,
            deliveryTermId: item.deliveryTermId || null,
            deliveryTermName: item.deliveryTermName || null,
            lifestyleImageUrl: item.lifestyleImageUrl || null,
          };
          onAddProduct(product);
        }
        setAddedCount(successCount);

        toast.success(`✅ ${successCount} 個產品已儲存並加入 Shopify 佇列`, {
          description: failCount > 0 ? `⚠️ ${failCount} 個產品儲存失敗，仍保留在列表中` : undefined,
        });
        setProcessingProgress({
          phase: 'complete',
          message: `✅ ${successCount} 個產品已加入 Shopify 佇列及產品目錄`,
        });

      } else if (action === 'catalog-only') {
        // Persist DIRECTLY to the Supabase `products` table so items show up
        // in 產品目錄 only — do NOT call onAddProduct (which would push them
        // into the in-memory store and the 待上傳到 Shopify queue).
        //
        // IMPORTANT: write ALL selected products regardless of whether the
        // external master DB accepted them — the products table is the source
        // of truth for 所有產品, and master DB is just an optional backup.
        const nowIso = new Date().toISOString();

        // ── Merge factory highlights for this factory ──
        // Accumulate ALL highlights ever uploaded for this factory: union of
        // what already exists in products + this upload's selection.
        let mergedHighlights: string[] = [...(selectedFactoryHighlights || [])];
        if (selectedManufacturer) {
          try {
            const { data: existingRows } = await supabase
              .from('products')
              .select('factory_highlights')
              .eq('factories_display_name', selectedManufacturer)
              .not('factory_highlights', 'is', null)
              .limit(200);
            const existing = (existingRows || []).flatMap((r: any) => r.factory_highlights || []);
            mergedHighlights = Array.from(new Set([...existing, ...mergedHighlights])).filter(Boolean);
          } catch (e) {
            console.warn('[catalog-only] could not fetch existing factory_highlights:', e);
          }
        }

        const productRows = correctedProds
          .map(item => {
            const dbResult = dbResults.find((r: any) => r.local_id === item.id);
            const imageUrl = item.cropped_image_url || item.lifestyleImageUrl || '';
            const newId = Math.random().toString(36).substring(2, 15);
            return {
              id: newId,
              title: item.title,
              description: item.description,
              description_html: item.description,
              tags: item.tags,
              price: item.price,
              compare_at_price: null,
              collection: item.collection,
              status: 'draft',
              image_url: imageUrl,
              error_message: null,
              shopify_product_id: null,
              sku: `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
              created_at: nowIso,
              source: 'local',
              synced_at: null,
              upload_session_id: null,
              model: (item as any).modelNumber || null,
              factories_display_name: selectedManufacturer || '',
              factory_id: selectedFactoryId || '',
              factory_highlights: mergedHighlights,
              bwf_master_id: dbResult?.master_id || null,
              cost_price: item.costPrice ?? null,
              sale_price: 0,
              production_date: (item as any).productionLeadTime ?? null,
              production_time: (item as any).productionTime ?? null,
              specifications: (item as any).specifications ?? null,
              image_url_2: (item as any).imageUrl2 ?? null,
              image_url_3: (item as any).imageUrl3 ?? null,
              shipping_days: (item as any).shippingDays ?? null,
              shipping_fee: (item as any).shippingFee ?? null,
              remarks: (item as any).remarks || '',
              color: item.color || '',
              dimension_l_mm: item.dimensionLMm ?? null,
              dimension_w_mm: item.dimensionWMm ?? null,
              dimension_h_mm: item.dimensionHMm ?? null,
              material: item.material || '',
              category: selectedProductCategory || null,
              level1_category: resolveCategoryLevels(selectedProductCategory).level1,
              level2_category: resolveCategoryLevels(selectedProductCategory).level2,
              delivery_term_id: item.deliveryTermId || null,
              delivery_term_name: item.deliveryTermName || null,
            };
          });

        if (productRows.length > 0) {
          const { error: upsertErr } = await supabase
            .from('products')
            .upsert(productRows, { onConflict: 'id' });
          if (upsertErr) {
            console.error('[PreviewAction:catalog-only] Failed to persist products to DB:', upsertErr.message);
            throw new Error(`產品目錄儲存失敗：${upsertErr.message}`);
          }
          console.log(`[PreviewAction:catalog-only] ✅ ${productRows.length} products persisted to products table only (not added to Shopify queue)`);

          // Back-fill: keep ALL products of this factory in sync with the merged
          // highlight set, so previously-uploaded products of the same factory
          // also reflect the consolidated highlights.
          if (selectedManufacturer && mergedHighlights.length > 0) {
            const { error: hlErr } = await supabase
              .from('products')
              .update({ factory_highlights: mergedHighlights })
              .eq('factories_display_name', selectedManufacturer);
            if (hlErr) console.warn('[catalog-only] factory_highlights back-fill failed:', hlErr.message);
          }
        }

        const catalogCount = productRows.length;
        toast.success(`✅ ${catalogCount} 個產品已上傳到產品目錄`, {
          description: '已寫入「所有產品」，含一級/二級分類',
        });
        setProcessingProgress({
          phase: 'complete',
          message: `✅ ${catalogCount} 個產品已上傳到產品目錄 (僅目錄)`,
        });
        // catalog-only writes ALL selected rows → burn them all down
        const allCatalogRowIndices = correctedProds.map(p => p.page_number);
        if (allCatalogRowIndices.length > 0) {
          removeRowsFromPreview(allCatalogRowIndices);
        }
        setProcessingProgress(null);
        setIsGeneratingFromPreview(false);
        return;
      }

      // ─── BURN-DOWN: Only remove SUCCESSFULLY processed rows from preview & IndexedDB ───
      // Failed rows remain in the list for retry.
      // This does NOT trigger the "Session Complete" screen unless every row across ALL sheets is gone.
      if (successfulRowIndices.length > 0) {
        removeRowsFromPreview(successfulRowIndices);
      }
      // Clear processing progress so the table UI is clean for the next selection batch
      setProcessingProgress(null);
      setIsGeneratingFromPreview(false);

    } catch (error: any) {
      setIsGeneratingFromPreview(false);
      // ─── DETAILED ERROR LOGGING ───
      console.error(`[PreviewAction] ❌ FULL ERROR OBJECT:`, error);
      console.error(`[PreviewAction] Error name:`, error?.name);
      console.error(`[PreviewAction] Error message:`, error?.message);
      console.error(`[PreviewAction] Error stack:`, error?.stack);
      if (error?.cause) console.error(`[PreviewAction] Error cause:`, error.cause);
      
      // Classify error for better UX
      const rawMsg = error?.message || 'Action from preview failed.';
      let errorCategory = '';
      if (rawMsg.includes('relay') || rawMsg.includes('Failed to send')) {
        errorCategory = '🔌 Supabase Relay Error: ';
      } else if (rawMsg.includes('fetch') || rawMsg.includes('network') || rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError')) {
        errorCategory = '🌐 Network Error: ';
      } else if (rawMsg.includes('constraint') || rawMsg.includes('duplicate') || rawMsg.includes('violates') || rawMsg.includes('unique')) {
        errorCategory = '🗄️ Database Constraint: ';
      } else if (rawMsg.includes('JSON') || rawMsg.includes('parse') || rawMsg.includes('payload') || rawMsg.includes('size') || rawMsg.includes('too large') || rawMsg.includes('serialization')) {
        errorCategory = '📦 Data Formatting / Payload Size: ';
      } else if (rawMsg.includes('timeout') || rawMsg.includes('abort') || rawMsg.includes('Timeout')) {
        errorCategory = '⏱️ Timeout: ';
      } else if (rawMsg.includes('HTTP 5') || rawMsg.includes('500') || rawMsg.includes('502') || rawMsg.includes('503')) {
        errorCategory = '🔥 Server Error: ';
      } else if (rawMsg.includes('environment') || rawMsg.includes('VITE_')) {
        errorCategory = '⚙️ Configuration Error: ';
      }
      const classifiedError = `${errorCategory}${rawMsg}`;
      setAiError(classifiedError);
      setProcessingProgress({ phase: 'error', message: classifiedError });
      toast.error('❌ 儲存失敗', { description: classifiedError });
    }
  }, [excelPreviewData, selectedManufacturer, selectedFactoryId, selectedFactoryHighlights, selectedProductCategory, resolveCategoryLevels, applyCorrections, onAddProduct, setCatalogProductsWithRef, removeRowsFromPreview]);

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const excelMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const excelExtensions = ['.xlsx', '.xls'];
    const isExcelFile = (f: File) => excelMimeTypes.includes(f.type) || excelExtensions.some(ext => f.name.toLowerCase().endsWith(ext));
    
    const validFiles = files.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf' || isExcelFile(f));
    if (validFiles.length === 0) return;

    // Check if there are Excel files — handle them separately
    const excelFiles = validFiles.filter(isExcelFile);
    const nonExcelFiles = validFiles.filter(f => !isExcelFile(f));
    const pdfFilesInUpload = nonExcelFiles.filter(f => f.type === 'application/pdf');
    const isPJSFactory = selectedFactoryId === 'PJS' || selectedManufacturer?.includes('爵尚') || selectedManufacturer?.includes('PJS');

    // ═══ CROSS-REFERENCE MODE: PDF (images) + Excel (data) ═══
    // When both PDF and Excel are uploaded, ALWAYS use PDF as visual source
    // and Excel as data source, bridging by Model Number.
    // Previously gated by isPJSFactory — now universal for ANY factory with both file types.
    if (excelFiles.length > 0 && pdfFilesInUpload.length > 0) {
      console.log(`[CrossRef] ═══ TRIGGERED ═══ Excel files: ${excelFiles.length}, PDF files: ${pdfFilesInUpload.length}, Factory: ${selectedFactoryId || 'none'} / ${selectedManufacturer || 'none'}`);
      setIsProcessing(true);
      setAiFields(null);
      setIsFieldsRevealed(false);
      setIsAdded(false);
      setAiError(null);
      setCatalogProductsWithRef([]);
      setAddedCount(0);
      setBatchProgress(null);
      setProcessingMode('excel-pdf-crossref');
      setProcessingProgress({ phase: 'uploading', message: '📎 Cross-Reference Mode: PDF (圖片) + Excel (數據)...' });

      try {
        // ── Step 1: Parse Excel for structured data ──────────────────
        const excelFile = excelFiles[0];
        const excelArrayBuffer = await excelFile.arrayBuffer();
        setProcessingProgress({ phase: 'analyzing', message: '解析 Excel 數據 (型號、價格、材質、尺寸)...' });

        const parseResult = await parseExcelFile(excelArrayBuffer, selectedManufacturer, selectedFactoryId);
        console.log(`[CrossRef] Excel parsed: ${parseResult.products.length} products from ${parseResult.sheetNames.length} sheets`);

        if (parseResult.products.length === 0) {
          throw new Error(`無法從 Excel 文件中提取產品。已掃描 ${parseResult.sheetNames.length} 個工作表。`);
        }

        // ══════════════════════════════════════════════════════════════════════
        // ── Step 2: GLOBAL SHEET VISUAL SEARCH (PDF as Anchor) ────────────────
        // ══════════════════════════════════════════════════════════════════════
        // STRATEGY: PDF-First Feature Extraction + Global Excel Image Search
        //
        //   1. Parse PDF to extract product thumbnails (Visual Feature Templates)
        //   2. Collect ALL images from the Excel sheet (NO column restriction)
        //   3. Send PDF thumbnails + all Excel images to Gemini for visual similarity
        //   4. Assign Excel image with highest similarity (>70%) to each product
        //   5. Reject lifestyle/scene images based on LOW visual similarity to clean thumbnails
        //
        // This approach is COLUMN-AGNOSTIC — Excel's fromCol is unreliable.
        // Visual similarity is the sole matching criterion.
        // ══════════════════════════════════════════════════════════════════════
        setProcessingProgress({ phase: 'extracting', message: `🔍 PDF視覺特徵提取 + 全域Excel圖片搜尋: ${parseResult.products.length} 個產品...` });

        const pdfFile = pdfFilesInUpload[0];
        const pdfArrayBuffer = await pdfFile.arrayBuffer();
        let pdfPageCount = await getPdfPageCount(pdfArrayBuffer);
        if (pdfPageCount === 0) pdfPageCount = 1; // fallback

        console.log(`[CrossRef] ═══ GLOBAL SHEET VISUAL SEARCH (PDF as Anchor) ═══`);
        console.log(`[CrossRef] PDF pages: ${pdfPageCount}, Excel products: ${parseResult.products.length}`);
        console.log(`[CrossRef] Strategy: PDF thumbnails → Visual Feature Templates. ALL Excel images as candidates (no column restriction).`);
        console.log(`[CrossRef] Matching: Gemini visual similarity. Column-agnostic. Rejects lifestyle via low visual similarity.`);

        // ── Collect Excel images with SPATIAL EXCLUSION ──────────────────
        // BANNED ZONE: Exclude images anchored in rows 0-2 (header/address/logo area)
        // DATA ZONE: Only include images from row 3+ (where actual product data lives)
        const rawExcelImages = parseResult.images;
        const allExcelImages = rawExcelImages.filter(img => {
          // If we have row anchor info, enforce the spatial exclusion
          if (img.fromRow !== undefined && img.fromRow < EXCEL_HEADER_ROW_EXCLUSION) {
            console.log(`[CrossRef] ✗ Excel Image[${img.imageIndex}] EXCLUDED: fromRow=${img.fromRow} is in header zone (< row ${EXCEL_HEADER_ROW_EXCLUSION})`);
            return false;
          }
          return true;
        });
        console.log(`[CrossRef] Excel images: ${rawExcelImages.length} total → ${allExcelImages.length} after header-zone exclusion (rows 0-${EXCEL_HEADER_ROW_EXCLUSION - 1} removed)`);

        // ── Group products by sheet for PDF page mapping ──────────────
        const sheetGroups: { sheetName: string; products: typeof parseResult.products }[] = [];
        const sheetOrder: string[] = [];
        for (const product of parseResult.products) {
          if (!sheetOrder.includes(product.sheetName)) {
            sheetOrder.push(product.sheetName);
            sheetGroups.push({ sheetName: product.sheetName, products: [] });
          }
          const group = sheetGroups.find(g => g.sheetName === product.sheetName)!;
          group.products.push(product);
        }

        console.log(`[CrossRef] Excel sheet groups: ${sheetGroups.map(g => `${g.sheetName}(${g.products.length})`).join(', ')}`);

        // ── Determine page-to-sheet mapping ──────────────────────────
        type PageAssignment = { pageNumber: number; products: typeof parseResult.products; sheetName: string };
        const pageAssignments: PageAssignment[] = [];

        if (sheetGroups.length === 1) {
          const productsPerPage = Math.ceil(parseResult.products.length / pdfPageCount);
          for (let page = 1; page <= pdfPageCount; page++) {
            const startIdx = (page - 1) * productsPerPage;
            const endIdx = Math.min(startIdx + productsPerPage, parseResult.products.length);
            const pageProducts = parseResult.products.slice(startIdx, endIdx);
            if (pageProducts.length > 0) {
              pageAssignments.push({ pageNumber: page, products: pageProducts, sheetName: sheetGroups[0].sheetName });
            }
          }
        } else if (sheetGroups.length === pdfPageCount) {
          sheetGroups.forEach((group, idx) => {
            pageAssignments.push({ pageNumber: idx + 1, products: group.products, sheetName: group.sheetName });
          });
        } else {
          const totalProducts = parseResult.products.length;
          let currentPage = 1;
          for (const group of sheetGroups) {
            const pagesForSheet = Math.max(1, Math.round((group.products.length / totalProducts) * pdfPageCount));
            const productsPerPage = Math.ceil(group.products.length / pagesForSheet);
            for (let i = 0; i < pagesForSheet && currentPage <= pdfPageCount; i++) {
              const startIdx = i * productsPerPage;
              const endIdx = Math.min(startIdx + productsPerPage, group.products.length);
              const pageProducts = group.products.slice(startIdx, endIdx);
              if (pageProducts.length > 0) {
                pageAssignments.push({ pageNumber: currentPage, products: pageProducts, sheetName: group.sheetName });
              }
              currentPage++;
            }
          }
          if (pageAssignments.length === 0) {
            pageAssignments.push({ pageNumber: 1, products: parseResult.products, sheetName: sheetGroups[0].sheetName });
          }
        }

        console.log(`[CrossRef] Page assignments:`, pageAssignments.map(pa => `Page ${pa.pageNumber}: ${pa.products.length} products (${pa.sheetName})`));

        // ══════════════════════════════════════════════════════════════════════
        // PHASE 1: PDF-First Feature Extraction — Render PDF pages & crop thumbnails
        // ══════════════════════════════════════════════════════════════════════
        setProcessingProgress({
          phase: 'extracting',
          message: `📄 PDF頁面渲染中: 提取產品視覺特徵模板...`,
        });

        const pdfThumbnails: Map<number, { base64: string; mime: string }> = new Map();
        let globalProductIdx = 0;

        for (const assignment of pageAssignments) {
          const { pageNumber, products: pageProducts } = assignment;

          setProcessingProgress({
            phase: 'extracting',
            message: `📄 PDF頁面 ${pageNumber}/${pdfPageCount}: 提取 ${pageProducts.length} 個產品縮略圖...`,
          });

          const pageImage = await renderPdfPageToImage(new Uint8Array(pdfArrayBuffer).buffer, pageNumber);

          if (pageImage) {
            const numProducts = pageProducts.length;
            // ═══ SPATIAL EXCLUSION: Skip top 15% of page (header/address/logo zone) ═══
            // DATA ZONE: Only extract product images from Y=150 to Y=1000 (normalized)
            const dataZoneStart = PDF_HEADER_EXCLUSION_TOP; // 150 = top 15% excluded
            const dataZoneEnd = 1000;
            const dataZoneHeight = dataZoneEnd - dataZoneStart; // 850 usable pixels
            const rowHeight = dataZoneHeight / numProducts;

            for (let rowIdx = 0; rowIdx < numProducts; rowIdx++) {
              const absIdx = globalProductIdx + rowIdx;

              // Crop each product's region WITHIN the data zone only
              const yMin = Math.round(dataZoneStart + rowIdx * rowHeight);
              const yMax = Math.round(dataZoneStart + (rowIdx + 1) * rowHeight);
              const padY = Math.round(rowHeight * 0.03);
              // Use the product image column area (X range) — avoid bleeding into address columns
              const boundingBox: [number, number, number, number] = [
                Math.max(dataZoneStart, yMin + padY),
                350, // Product image column X start
                Math.min(1000, yMax - padY),
                750, // Product image column X end
              ];

              try {
                const croppedUrl = await cropProductFromPageImageForCrossRef(pageImage.data, boundingBox);
                if (croppedUrl) {
                  // Extract base64 from data URL
                  const base64Part = croppedUrl.split(',')[1] || '';
                  if (base64Part.length > 500) {
                    // ═══ PIXEL VARIANCE TEST: Reject text blocks & solid colors ═══
                    const isValidProductImage = await passesPixelVarianceTest(base64Part, 'image/jpeg');
                    if (isValidProductImage) {
                      pdfThumbnails.set(absIdx, { base64: base64Part, mime: 'image/jpeg' });
                    } else {
                      console.warn(`[CrossRef] ✗ PDF thumbnail ${absIdx + 1}: REJECTED by pixel variance test (text/solid block)`);
                    }
                  }
                }
              } catch (cropErr) {
                console.warn(`[CrossRef] ✗ PDF thumbnail crop error for product ${absIdx + 1}:`, cropErr);
              }
            }
          } else {
            console.warn(`[CrossRef] ⚠️ Page ${pageNumber}: Failed to render`);
          }

          globalProductIdx += pageProducts.length;
        }

        console.log(`[CrossRef] PDF thumbnails extracted: ${pdfThumbnails.size}/${parseResult.products.length}`);

        // ══════════════════════════════════════════════════════════════════════
        // PHASE 2: Global Excel Image Search via Gemini Visual Similarity
        // ══════════════════════════════════════════════════════════════════════
        setProcessingProgress({
          phase: 'extracting',
          message: `🤖 Gemini視覺匹配: ${pdfThumbnails.size} 個PDF縮略圖 vs ${allExcelImages.length} 個Excel圖片...`,
        });

        const productImageSources: Map<number, { url: string; source: 'excel' | 'pdf'; validated: boolean }> = new Map();
        let visualMatchCount = 0;
        let pdfFallbackCount = 0;
        let validatedCount = 0;

        // Prepare PDF products for visual match API
        const pdfProductsForApi: Array<{
          index: number;
          model_number: string;
          dimensions: string;
          thumbnail: string;
          thumbnail_mime: string;
        }> = [];

        for (const [idx, thumb] of pdfThumbnails.entries()) {
          const product = parseResult.products[idx];
          if (product) {
            pdfProductsForApi.push({
              index: idx,
              model_number: product.modelNumber || product.title || `Product_${idx + 1}`,
              dimensions: product.dimensions || '',
              thumbnail: thumb.base64,
              thumbnail_mime: thumb.mime,
            });
          }
        }

        // Prepare Excel images for visual match API
        // Apply PIXEL VARIANCE TEST to reject text blocks / solid colors before sending
        const MAX_EXCEL_IMAGES_FOR_API = 25;
        const candidateExcelImages = allExcelImages.slice(0, MAX_EXCEL_IMAGES_FOR_API + 10); // Over-fetch to compensate for rejections
        
        const validatedExcelImages: typeof allExcelImages = [];
        for (const img of candidateExcelImages) {
          if (validatedExcelImages.length >= MAX_EXCEL_IMAGES_FOR_API) break;
          const passes = await passesPixelVarianceTest(img.base64, img.mimeType);
          if (passes) {
            validatedExcelImages.push(img);
          } else {
            console.log(`[CrossRef] ✗ Excel Image[${img.imageIndex}] REJECTED by pixel variance (text/solid block at row=${img.fromRow})`);
          }
        }
        
        console.log(`[CrossRef] Excel images after pixel variance: ${validatedExcelImages.length}/${candidateExcelImages.length} passed`);

        const excelImagesForApi: Array<{
          image_index: number;
          base64: string;
          mime_type: string;
          from_row?: number;
          from_col?: number;
          to_row?: number;
          to_col?: number;
        }> = validatedExcelImages.map(img => ({
          image_index: img.imageIndex,
          base64: img.base64,
          mime_type: img.mimeType,
          from_row: img.fromRow,
          from_col: img.fromCol,
          to_row: img.toRow,
          to_col: img.toCol,
        }));

        console.log(`[CrossRef] Sending to Gemini visual-match: ${pdfProductsForApi.length} PDF products, ${excelImagesForApi.length} validated Excel images`);

        // Process in batches to avoid payload limits
        // PAYLOAD GUARD: Estimate total image payload and reduce if needed
        // Supabase Edge Function relay has a ~6MB body limit
        const MAX_RELAY_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB safe limit (under 6MB relay cap)
        const estimateBase64Bytes = (b64: string) => Math.ceil((b64.length * 3) / 4);
        
        // Limit Excel images to keep payload under limit
        const avgExcelImageBytes = excelImagesForApi.length > 0
          ? excelImagesForApi.reduce((sum, img) => sum + estimateBase64Bytes(img.base64), 0) / excelImagesForApi.length
          : 100_000;
        const maxExcelImagesPerBatch = Math.max(3, Math.min(10, Math.floor((MAX_RELAY_PAYLOAD_BYTES * 0.7) / avgExcelImageBytes)));
        
        console.log(`[CrossRef] Payload guard: avg Excel image ~${(avgExcelImageBytes / 1024).toFixed(0)}KB, limiting to ${maxExcelImagesPerBatch} images per visual-match batch`);
        
        const VISUAL_BATCH_SIZE = 3;
        const visualMatchResults: Array<{
          product_index: number;
          model_number: string;
          matched_excel_image_index: number;
          similarity_score: number;
          excel_image_row: number;
          excel_image_col: number;
          status: string;
          reasoning?: string;
        }> = [];

        for (let batchStart = 0; batchStart < pdfProductsForApi.length; batchStart += VISUAL_BATCH_SIZE) {
          const batch = pdfProductsForApi.slice(batchStart, batchStart + VISUAL_BATCH_SIZE);
          
          setProcessingProgress({
            phase: 'extracting',
            message: `🤖 Gemini視覺匹配 ${batchStart + 1}-${Math.min(batchStart + VISUAL_BATCH_SIZE, pdfProductsForApi.length)}/${pdfProductsForApi.length}...`,
          });

          try {
            // Determine which Excel images are most relevant (near these products' rows)
            const batchProductRows = batch.map(p => parseResult.products[p.index]?.rowIndex ?? 0);
            const minRow = Math.min(...batchProductRows);
            const maxRow = Math.max(...batchProductRows);
            const ROW_SEARCH_RADIUS = 10;

            // Global search: include ALL images, but prioritize those near the row range
            const nearbyExcelImages = excelImagesForApi.filter(img => {
              if (img.from_row === undefined) return true; // Include images without row info
              return img.from_row >= (minRow - ROW_SEARCH_RADIUS) && img.from_row <= (maxRow + ROW_SEARCH_RADIUS);
            });

            // If nearby search yields too few, use all — capped by payload guard
            const imagesToSend = nearbyExcelImages.length >= batch.length 
              ? nearbyExcelImages.slice(0, maxExcelImagesPerBatch)
              : excelImagesForApi.slice(0, maxExcelImagesPerBatch);

            // Final payload size estimation before sending
            const estimatedPayloadSize = 
              batch.reduce((sum, p) => sum + estimateBase64Bytes(p.thumbnail) + 200, 0) +
              imagesToSend.reduce((sum, img) => sum + estimateBase64Bytes(img.base64) + 200, 0);
            
            if (estimatedPayloadSize > MAX_RELAY_PAYLOAD_BYTES) {
              // Further reduce images if still too large
              const reducedCount = Math.max(2, Math.floor(imagesToSend.length * (MAX_RELAY_PAYLOAD_BYTES / estimatedPayloadSize)));
              console.warn(`[CrossRef] ⚠️ Payload too large (${(estimatedPayloadSize / 1024 / 1024).toFixed(1)}MB). Reducing Excel images from ${imagesToSend.length} to ${reducedCount}`);
              imagesToSend.splice(reducedCount);
            }

            let matchResult: any = null;
            let matchError: any = null;
            
            try {
              // Use direct fetch to bypass Supabase relay's ~6MB body limit
              // The visual-match payload with images often exceeds relay capacity
              const vmPayload = JSON.stringify({
                pdf_products: batch,
                excel_images: imagesToSend,
                model: selectedModel || 'gemini-2.5-flash',
                batch_size: batch.length,
              });
              const vmPayloadSizeKB = Math.round(vmPayload.length / 1024);
              console.log(`[CrossRef] Visual-match batch payload: ${vmPayloadSizeKB}KB (direct fetch)`);
              
              const vmUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supabase-functions-visual-match-images`;
              const vmResponse = await fetch(vmUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                },
                body: vmPayload,
              });

              if (!vmResponse.ok) {
                let errorBody: string;
                try { const ed = await vmResponse.json(); errorBody = ed?.error || JSON.stringify(ed); }
                catch { errorBody = `HTTP ${vmResponse.status}`; }
                matchError = { message: `visual-match HTTP ${vmResponse.status}: ${errorBody}` };
              } else {
                matchResult = await vmResponse.json();
              }
            } catch (invokeErr: any) {
              // Catch network/fetch failures
              const errMsg = invokeErr?.message || String(invokeErr);
              if (errMsg.includes('relay') || errMsg.includes('Failed to send') || errMsg.includes('FunctionsFetchError') || errMsg.includes('Failed to fetch')) {
                console.error(`[CrossRef] ❌ Network error (payload ~${(estimatedPayloadSize / 1024 / 1024).toFixed(1)}MB): ${errMsg}`);
                matchError = { message: `Network error (~${(estimatedPayloadSize / 1024 / 1024).toFixed(1)}MB payload). Try uploading smaller images.` };
              } else {
                matchError = { message: errMsg };
              }
            }

            if (!matchError && matchResult?.matches) {
              visualMatchResults.push(...matchResult.matches);
              console.log(`[CrossRef] Visual match batch ${batchStart}-${batchStart + batch.length}: ${matchResult.matches.filter((m: any) => m.status === 'VERIFIED').length} verified`);
            } else {
              console.warn(`[CrossRef] Visual match batch ${batchStart} failed:`, matchError);
              // Add NO_MATCH entries for this batch
              for (const product of batch) {
                visualMatchResults.push({
                  product_index: product.index,
                  model_number: product.model_number,
                  matched_excel_image_index: -1,
                  similarity_score: 0,
                  excel_image_row: -1,
                  excel_image_col: -1,
                  status: 'NO_MATCH',
                });
              }
            }
          } catch (batchErr: any) {
            console.warn(`[CrossRef] Visual match batch ${batchStart} error:`, batchErr);
            for (const product of batch) {
              visualMatchResults.push({
                product_index: product.index,
                model_number: product.model_number,
                matched_excel_image_index: -1,
                similarity_score: 0,
                excel_image_row: -1,
                excel_image_col: -1,
                status: 'NO_MATCH',
              });
            }
          }

          // Small delay between batches to avoid rate limiting
          if (batchStart + VISUAL_BATCH_SIZE < pdfProductsForApi.length) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        // ── Assign images based on visual match results ──────────────────
        const claimedExcelIndices = new Set<number>();
        
        // Sort by similarity descending to handle conflicts
        const sortedResults = [...visualMatchResults].sort((a, b) => b.similarity_score - a.similarity_score);

        for (const match of sortedResults) {
          if (match.matched_excel_image_index === -1 || match.status === 'NO_MATCH') continue;
          if (claimedExcelIndices.has(match.matched_excel_image_index)) continue;

          const excelImg = allExcelImages.find(img => img.imageIndex === match.matched_excel_image_index);
          if (!excelImg) continue;

          const dataUri = `data:${excelImg.mimeType};base64,${excelImg.base64}`;
          productImageSources.set(match.product_index, {
            url: dataUri,
            source: 'excel',
            validated: match.status === 'VERIFIED',
          });
          claimedExcelIndices.add(match.matched_excel_image_index);
          visualMatchCount++;

          console.log(
            `[VISUAL MATCH] PDF Row ${match.product_index + 1} → Excel Image at [Col ${match.excel_image_col}, Row ${match.excel_image_row}] | Similarity: ${match.similarity_score}% | Status: ${match.status}`
          );
        }

        // ── EXCEL COLUMN C FALLBACK: If visual match failed, check for unclaimed Excel image in same row ────
        // This ensures products always get an image if one exists in their data row.
        let excelRowFallbackCount = 0;
        for (let idx = 0; idx < parseResult.products.length; idx++) {
          if (productImageSources.has(idx)) continue; // Already matched
          
          const product = parseResult.products[idx];
          const productRow = product.rowIndex;
          
          // Find an unclaimed Excel image anchored at the same row, preferring Column C (col index 2)
          const sameRowImage = allExcelImages.find(img => {
            if (img.fromRow === undefined) return false;
            if (img.fromRow !== productRow) return false;
            if (claimedExcelIndices.has(img.imageIndex)) return false;
            return true;
          });
          
          // Prefer Column C (index 2), but accept any column in the same row
          const colCImage = allExcelImages.find(img => {
            if (img.fromRow === undefined) return false;
            if (img.fromRow !== productRow) return false;
            if (img.fromCol !== 2) return false; // Column C = index 2
            if (claimedExcelIndices.has(img.imageIndex)) return false;
            return true;
          });
          
          const fallbackImg = colCImage || sameRowImage;
          if (fallbackImg) {
            const dataUri = `data:${fallbackImg.mimeType};base64,${fallbackImg.base64}`;
            productImageSources.set(idx, { url: dataUri, source: 'excel', validated: false });
            claimedExcelIndices.add(fallbackImg.imageIndex);
            excelRowFallbackCount++;
            console.log(`[CrossRef] ✓ ROW FALLBACK: Product ${idx + 1} ("${product.modelNumber}") → Excel image at row=${fallbackImg.fromRow}, col=${fallbackImg.fromCol}`);
          }
        }
        
        if (excelRowFallbackCount > 0) {
          console.log(`[CrossRef] Excel row-fallback images assigned: ${excelRowFallbackCount}`);
        }

        // ── PDF Fallback: For products without visual match, use PDF crop ────
        for (const [idx, thumb] of pdfThumbnails.entries()) {
          if (!productImageSources.has(idx)) {
            const croppedUrl = `data:image/jpeg;base64,${thumb.base64}`;
            productImageSources.set(idx, { url: croppedUrl, source: 'pdf', validated: false });
            pdfFallbackCount++;
          }
        }

        validatedCount = visualMatchResults.filter(m => m.status === 'VERIFIED').length;

        console.log(`[CrossRef] ═══ GLOBAL VISUAL SEARCH COMPLETE ═══`);
        console.log(`[CrossRef] Visual matches (Gemini): ${visualMatchCount}`);
        console.log(`[CrossRef] Excel row-fallback: ${excelRowFallbackCount}`);
        console.log(`[CrossRef] PDF fallbacks: ${pdfFallbackCount}`);
        console.log(`[CrossRef] Verified (>75% similarity): ${validatedCount}`);

        // ── Step 3: Gemini bilingual naming from Excel data ───────────
        let imageMatches: any[] = [];
        const imagesArray = parseResult.images;

        if (imagesArray.length > 0 || isPJSFactory || (excelFiles.length > 0 && pdfFilesInUpload.length > 0)) {
          try {
            setProcessingProgress({ phase: 'extracting', message: '使用 Gemini AI 生成雙語名稱...' });
            const productsContext = parseResult.products.map(p => ({
              title: p.title,
              modelNumber: p.modelNumber,
              rowIndex: p.rowIndex,
              material: p.material,
            }));

            // Use direct fetch to bypass Supabase relay (avoid functions-relay errors)
            const excelCatalogUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supabase-functions-gemini-excel-catalog`;
            const excelCatalogPayload = JSON.stringify({
              images: [],
              model: selectedModel,
              factory_name: selectedManufacturer,
              factory_code: selectedFactoryId,
              products_context: productsContext,
              text_only_naming: true,
            });
            console.log(`[CrossRef] Gemini naming request: ${Math.round(excelCatalogPayload.length / 1024)}KB payload to gemini-excel-catalog (direct fetch)`);
            
            const geminiResp = await fetch(excelCatalogUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: excelCatalogPayload,
            });

            let geminiResult: any = null;
            let geminiError: any = null;
            if (!geminiResp.ok) {
              const errText = await geminiResp.text().catch(() => `HTTP ${geminiResp.status}`);
              console.error(`[CrossRef] gemini-excel-catalog failed: HTTP ${geminiResp.status}`, errText);
              geminiError = { message: errText };
            } else {
              geminiResult = await geminiResp.json();
            }

            if (!geminiError && geminiResult?.image_matches) {
              imageMatches = geminiResult.image_matches;
              console.log(`[CrossRef] Gemini bilingual naming: ${imageMatches.length} matches`);
            }
          } catch (err) {
            console.warn('[CrossRef] Gemini naming failed (non-fatal):', err);
          }
        }

        // ── Step 4: Merge Excel data + visually-matched images → CatalogProducts ──
        // ALL text data from Excel. Images from Gemini visual similarity matching.
        // PDF crop used as fallback only when no visual match found.
        const catalogProds: CatalogProduct[] = parseResult.products.map((ep, epIndex) => {
          // Determine image source from our validated productImageSources map
          let imageUrl: string | undefined;
          let imageSource: 'pdf' | 'excel' | 'ai' | null = null;

          const imageEntry = productImageSources.get(epIndex);
          if (imageEntry) {
            imageUrl = imageEntry.url;
            imageSource = imageEntry.source;
            if (epIndex < 20) {
              console.log(`[CrossRef] ✓ Product ${epIndex + 1}: "${ep.modelNumber}" → Image from ${imageEntry.source}${imageEntry.validated ? ' (validated)' : ' (unvalidated)'}`);
            }
          }
          
          // If no image from either source, mark as no-image
          if (!imageUrl) {
            console.warn(`[CrossRef] ✗ Product ${epIndex + 1}: "${ep.modelNumber}" → NO IMAGE (neither Excel nor PDF fallback available)`);
          }

          // Bilingual naming from Gemini
          let titleEn = ep.titleEn || '';
          let titleZh = ep.titleZh || '';
          let aiDescription = ep.description;

          const geminiMatch = imageMatches.find((m: any) =>
            m.matched_model_number === ep.modelNumber ||
            m.matched_product_title === ep.title
          );

          if (geminiMatch) {
            if (geminiMatch.title_en) titleEn = geminiMatch.title_en;
            if (geminiMatch.title_zh) titleZh = geminiMatch.title_zh;
            if (geminiMatch.description) {
              aiDescription = ep.material
                ? `材質描述: ${ep.material}\n\n${geminiMatch.description}`
                : geminiMatch.description;
            }
          }

          // PJS fallback titles
          if (ep.modelNumber) {
            if (!titleEn) titleEn = `${ep.modelNumber} - ${ep.material || 'Product'}`;
            if (!titleZh) titleZh = `${ep.modelNumber} - ${ep.material || '產品'}`;
          }

          const displayTitle = titleEn || titleZh || ep.title;

          return {
            id: ep.id,
            title: displayTitle,
            titleEn,
            titleZh,
            description: aiDescription,
            tags: ep.tags,
            price: ep.price,
            collection: ep.collection,
            material: ep.material,
            dimensions: ep.dimensions,
            image_region: '',
            page_number: ep.rowIndex,
            selected: true,
            expanded: false,
            cropped_image_url: imageUrl,
            // Lifestyle image from Excel (效果圖 column) as additional image
            lifestyleImageUrl: ep.lifestyleImageData || undefined,
            additional_images: ep.lifestyleImageData ? [ep.lifestyleImageData] : [],
            bounding_box: null, // Excel image mode — no Gemini bounding box
            costPrice: ep.costPrice,
            color: ep.color,
            factoriesDisplayName: selectedManufacturer,
            dimensionLMm: ep.dimensionLMm,
            dimensionWMm: ep.dimensionWMm,
            dimensionHMm: ep.dimensionHMm,
            modelNumber: ep.modelNumber,
            deliveryTermId: ep.deliveryTermId || null,
            deliveryTermName: ep.deliveryTermName || null,
            imageSource,
            dataSource: 'excel' as const,
            imageValidated: imageEntry?.validated ?? false,
          };
        });

        const totalWithImages = catalogProds.filter(p => p.cropped_image_url).length;
        const totalExcelImages = catalogProds.filter(p => p.imageSource === 'excel').length;
        const totalPdfFallbacks = catalogProds.filter(p => p.imageSource === 'pdf').length;
        const totalNoImage = catalogProds.filter(p => !p.cropped_image_url).length;

        console.log(`[CrossRef] ═══════════════════════════════════════════════`);
        console.log(`[CrossRef] ═══ FINAL RESULTS (Global Visual Search v3) ═══`);
        console.log(`[CrossRef] ═══════════════════════════════════════════════`);
        console.log(`[CrossRef] Total products: ${catalogProds.length}`);
        console.log(`[CrossRef] Visual matches (Excel via Gemini): ${totalExcelImages}`);
        console.log(`[CrossRef] PDF fallback crops: ${totalPdfFallbacks}`);
        console.log(`[CrossRef] No image: ${totalNoImage}`);
        console.log(`[CrossRef] Strategy: PDF-First Visual Feature Templates → Global Excel Image Search (column-agnostic) → Gemini similarity scoring.`);

        setCatalogProductsWithRef(applyCorrections(catalogProds));
        const correctionCount = getCorrections().length;
        const correctionNote = correctionCount > 0 ? ` (${correctionCount} learnt corrections applied)` : '';
        const matchDetail = totalExcelImages > 0
          ? `${totalExcelImages} 視覺匹配`
          : '⚠️ 0 visual matches';
        const fallbackDetail = totalPdfFallbacks > 0 ? ` + ${totalPdfFallbacks} PDF回退` : '';
        setProcessingProgress({
          phase: 'complete',
          message: `✅ 全域視覺搜尋完成: ${catalogProds.length} 個產品 | ${matchDetail}${fallbackDetail} | 無圖片: ${totalNoImage}${correctionNote}`,
        });
        setIsProcessing(false);
      } catch (error: any) {
        setIsProcessing(false);
        setAiError(error.message || 'Cross-reference processing failed.');
        setProcessingProgress({ phase: 'error', message: error.message || 'Cross-Reference 失敗' });
      }
      return;
    }

    if (excelFiles.length > 0) {
      // ═══ EXCEL PROCESSING PATH — NEW: Table-First with Manual Column Mapping ═══
      // Step 1: Extract raw table data for preview
      // Step 2: Show preview table with column mapping dropdowns (human-in-the-loop)
      // Step 3: User clicks "Generate Catalog Result" → process with confirmed mappings
      setIsProcessing(true);
      setAiFields(null);
      setIsFieldsRevealed(false);
      setIsAdded(false);
      setAiError(null);
      setCatalogProductsWithRef([]);
      setAddedCount(0);
      setBatchProgress(null);
      setProcessingMode('excel-catalog');
      setProcessingProgress({ phase: 'uploading', message: '讀取 Excel 文件...' });

      try {
        const file = excelFiles[0]; // Process first Excel file
        const arrayBuffer = await file.arrayBuffer();

        setProcessingProgress({ phase: 'analyzing', message: '智能識別表頭與產品行...' });

        // Extract raw table data (with merged cell image inheritance)
        const rawTable = await extractRawExcelTable(arrayBuffer, selectedManufacturer, selectedFactoryId);

        console.log(`[AIProcessor] Raw table extracted: ${rawTable.rows.length} rows, header at row ${rawTable.headerRowIndex}`);

        if (rawTable.rows.length === 0) {
          throw new Error(`無法從 Excel 文件中識別數據行。已掃描 ${rawTable.sheetNames.length} 個工作表。`);
        }

        // Build preview data and show the interactive preview table
        const previewData: ExcelPreviewData = {
          // 上傳後將所有簡體中文內容轉為香港繁體（表頭 + 每格）
          headerLabels: rawTable.headerLabels.map(h => simplifiedToTraditional(h || '')),
          rows: rawTable.rows.map(r => ({
            rowIndex: r.rowIndex,
            cells: convertRowToTraditional(r.cells),
            productImageData: r.productImageData,
            lifestyleImageData: r.lifestyleImageData,
            isProductRow: r.isProductRow,
            hasMinimalData: r.hasMinimalData,
          })),
          headerRowIndex: rawTable.headerRowIndex,
          columnCount: rawTable.columnCount,
          sheetNames: rawTable.sheetNames,
          images: rawTable.images,
          factoryCode: rawTable.factoryCode,
          rawArrayBuffer: arrayBuffer,
          // Per-sheet independent data for multi-tab UI
          sheets: rawTable.sheets?.map(s => ({
            sheetName: s.sheetName,
            headerLabels: s.headerLabels.map(h => simplifiedToTraditional(h || '')),
            headerRowIndex: s.headerRowIndex,
            rows: s.rows.map(r => ({
              rowIndex: r.rowIndex,
              cells: convertRowToTraditional(r.cells),
              productImageData: r.productImageData,
              lifestyleImageData: r.lifestyleImageData,
              isProductRow: r.isProductRow,
              hasMinimalData: r.hasMinimalData,
            })),
            columnCount: s.columnCount,
          })),
        };

        setExcelPreviewData(previewData);
        setIsProcessing(false);
        const sheetCount = rawTable.sheets?.length || 1;
        const totalProductRows = rawTable.rows.filter(r => r.isProductRow).length;
        setProcessingProgress({
          phase: 'complete',
          message: `✅ 已提取 ${totalProductRows} 個產品行 (${sheetCount} 個工作表) — 請確認欄位對應後點擊 "生成目錄結果"`,
        });

      } catch (error: any) {
        setIsProcessing(false);
        const rawMsg = error?.message || 'Excel processing failed.';
        let errorCategory = '';
        if (rawMsg.includes('fetch') || rawMsg.includes('network') || rawMsg.includes('Failed to fetch')) {
          errorCategory = '🌐 Network Error: ';
        } else if (rawMsg.includes('無法從') || rawMsg.includes('識別')) {
          errorCategory = '📋 Data Extraction: ';
        } else if (rawMsg.includes('ArrayBuffer') || rawMsg.includes('read') || rawMsg.includes('file')) {
          errorCategory = '📁 File Read Error: ';
        }
        const classifiedError = `${errorCategory}${rawMsg}`;
        setAiError(classifiedError);
        setProcessingProgress({ phase: 'error', message: classifiedError });
      }
      return;
    }

    // ═══ ORIGINAL PDF/IMAGE PROCESSING PATH ═══

    // Use already-uploaded files from the queue (files were pre-loaded by addFilesToQueue)
    // But we need base64 data — re-read non-excel files for processing
    const uploadEntries: UploadedFile[] = await Promise.all(
      nonExcelFiles.map(async (file) => {
        const { dataUrl, base64, mimeType } = await readFileAsBase64(file);
        return {
          id: Math.random().toString(36).substring(7),
          file, name: file.name, type: file.type,
          thumbnail: file.type.startsWith('image/') ? dataUrl : '',
          base64Data: base64, mimeType,
        };
      })
    );

    setUploadedFiles(uploadEntries);
    setIsProcessing(true);
    setAiFields(null);
    setIsFieldsRevealed(false);
    setIsAdded(false);
    setAiError(null);
    setCatalogProductsWithRef([]);
    setAddedCount(0);
    setBatchProgress(null);

    const pdfFiles = uploadEntries.filter(f => f.type === 'application/pdf');
    const imageOnlyFiles = uploadEntries.filter(f => f.type.startsWith('image/'));

    if (pdfFiles.length > 0) {
      setProcessingMode('pdf-catalog');
      try {
        const products = await analyzePDFCatalogBatched(
          pdfFiles,
          imageOnlyFiles,
          selectedModel,
          (p) => setProcessingProgress(p),
          (bp) => setBatchProgress(bp),
          selectedManufacturer,
        );
        // V18 FIX 3: PREVENT STATE OVERWRITE — only set state ONCE with fully-processed data
        // Verify images survived the entire pipeline before committing to state
        const productsWithImages = products.filter(p => p.cropped_image_url);
        console.log(`[AIProcessor] 🎨 V18 PRE-SETSTATE CHECK: ${productsWithImages.length}/${products.length} products have cropped_image_url`);
        for (const cp of products) {
          console.log(`  V18 FINAL STATE: "${cp.title?.substring(0, 25)}" → cropped_image_url=${!!cp.cropped_image_url} (${cp.cropped_image_url?.length || 0} chars)`);
        }
        
        // ATOMIC STATE UPDATE: Set products and stop processing in the same tick
        // This prevents any intermediate render from seeing an empty array
        setCatalogProductsWithRef(products);
        console.log(`[AIProcessor] 🎨 V18 RE-RENDER: setCatalogProducts COMMITTED with ${products.length} products, ${productsWithImages.length} have images`);
        setIsProcessing(false);
      } catch (error: any) {
        setIsProcessing(false);
        setAiError(error.message || 'PDF catalog analysis failed.');
        setProcessingProgress({ phase: 'error', message: error.message || 'Analysis failed.' });
      }
    } else {
      setProcessingMode('single-image');
      setProcessingProgress(null);
      try {
        const result = await analyzeImageWithAI(uploadEntries, selectedModel);
        setIsProcessing(false);
        setAiFields(result);
        setTimeout(() => setIsFieldsRevealed(true), 100);
      } catch (error: any) {
        setIsProcessing(false);
        setAiError(error.message || 'AI analysis failed.');
      }
    }
  }, [selectedModel, selectedManufacturer, selectedFactoryId]);

  const handleGenerate = useCallback(async () => {
    if (uploadedFiles.length === 0) return;
    const files = uploadedFiles.map(f => f.file);
    processFiles(files);
  }, [uploadedFiles, processFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) addFilesToQueue(e.dataTransfer.files);
  }, [addFilesToQueue]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) addFilesToQueue(e.target.files);
    e.target.value = '';
  }, [addFilesToQueue]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback(() => { setIsDragOver(false); }, []);
  const removeFile = useCallback((id: string) => {
    setUploadedFiles(prev => {
      const remaining = prev.filter(f => f.id !== id);
      if (remaining.length === 0) {
        setProcessingMode('idle');
      }
      return remaining;
    });
  }, []);

  const handleAddToQueue = useCallback(() => {
    if (!aiFields) return;
    const imageFile = uploadedFiles.find(f => f.type.startsWith('image/'));
    const product = {
      title: aiFields.title, description: aiFields.description, descriptionHtml: aiFields.description,
      tags: aiFields.tags, price: aiFields.price, collection: selectedProductCategory || aiFields.collection,
      imageUrl: imageFile?.thumbnail || 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80',
      variants: [{ id: Math.random().toString(36).substring(7), size: 'One Size', color: 'Default', sku: `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`, price: aiFields.price, inventory: 100 }],
      factoriesDisplayName: selectedManufacturer || '',
      factoryId: selectedFactoryId || null,
      factoryHighlight: selectedFactoryHighlights,
      category: selectedProductCategory || aiFields.collection || '',
    };
    console.log('💾 Saving product with Manufacturer:', product.factoriesDisplayName, 'Factory ID:', product.factoryId, 'Highlights:', product.factoryHighlight, 'Category:', product.category);
    onAddProduct(product);
    setIsAdded(true);
  }, [aiFields, onAddProduct, uploadedFiles, selectedManufacturer, selectedFactoryId, selectedFactoryHighlights, selectedProductCategory]);

  const toggleCatalogItem = useCallback((id: string) => {
    setCatalogProductsWithRef(prev => prev.map(p => p.id === id ? { ...p, selected: !p.selected } : p));
  }, [setCatalogProductsWithRef]);

  const toggleAllCatalogItems = useCallback((selected: boolean) => {
    setCatalogProductsWithRef(prev => prev.map(p => ({ ...p, selected })));
  }, [setCatalogProductsWithRef]);

  const toggleExpandItem = useCallback((id: string) => {
    setCatalogProductsWithRef(prev => prev.map(p => p.id === id ? { ...p, expanded: !p.expanded } : p));
  }, [setCatalogProductsWithRef]);

  const updateCatalogProduct = useCallback((id: string, field: keyof CatalogProduct, value: any) => {
    // ── Save correction pattern (side-effect, uses ref to read current value) ──
    const correctableFields: CorrectableField[] = [
      'title', 'titleEn', 'titleZh', 'costPrice',
      'description', 'material', 'collection', 'color', 'dimensions',
    ];
    if (correctableFields.includes(field as CorrectableField) && selectedFactoryId) {
      const p = catalogProductsRef.current.find(x => x.id === id);
      if (p) {
        const originalValue = p[field] != null ? String(p[field]) : null;
        const correctedValue = value != null ? String(value) : '';
        if (originalValue !== correctedValue && correctedValue) {
          saveCorrection(
            field as CorrectableField,
            originalValue,
            correctedValue,
            p.modelNumber ?? null,
            { price: p.price },
          ).then(() => {
            toast.success('Correction learnt', {
              description: `"${field}" pattern saved for ${selectedFactoryId}`,
              duration: 2000,
            });
          });
        }
      }
    }

    // ── Update state ──
    setCatalogProductsWithRef(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  }, [selectedFactoryId, saveCorrection, setCatalogProductsWithRef]);

  const handleBatchAddToQueue = useCallback(() => {
    const selected = catalogProducts.filter(p => p.selected);
    let count = 0;
    for (const item of selected) {
      // V16 FIX 2: Force priority chain for imageUrl
      const imageUrl = item.cropped_image_url || 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80';
      // V16 FIX 3: Re-render verification log
      console.log('🔥 handleBatchAddToQueue — Image Transfer Check:', item.title?.substring(0, 30), '| cropped_image_url:', !!item.cropped_image_url, '| length:', item.cropped_image_url?.length || 0, '| using:', imageUrl.substring(0, 50));
      const product = {
        title: item.title, description: item.description, descriptionHtml: item.description,
        tags: item.tags, price: item.price, collection: selectedProductCategory || item.collection,
        imageUrl,
        variants: [{ id: Math.random().toString(36).substring(7), size: 'One Size', color: 'Default', sku: `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`, price: item.price, inventory: 100 }],
        factoriesDisplayName: selectedManufacturer || '',
        factoryId: selectedFactoryId || null,
        costPrice: item.costPrice ?? null,
        productionLeadTime: item.productionLeadTime ?? null,
        shippingDays: item.shippingDays ?? null,
        shippingFee: item.shippingFee ?? null,
        remarks: item.remarks ?? null,
        color: item.color ?? null,
        factoryHighlight: selectedFactoryHighlights,
        material: item.material || undefined,
        dimensionLMm: item.dimensionLMm ?? null,
        dimensionWMm: item.dimensionWMm ?? null,
        dimensionHMm: item.dimensionHMm ?? null,
        titleEn: item.titleEn || undefined,
        titleZh: item.titleZh || undefined,
        category: selectedProductCategory || item.collection || '',
      };
      console.log('💾 Saving product with Manufacturer:', product.factoriesDisplayName, 'Factory ID:', product.factoryId, 'Highlights:', product.factoryHighlight, 'Category:', product.category);
      onAddProduct(product);
      count++;
    }
    setAddedCount(count);
  }, [catalogProducts, onAddProduct, selectedManufacturer, selectedFactoryId, selectedFactoryHighlights, selectedProductCategory]);

  const handleReset = useCallback(() => {
    setUploadedFiles([]); setAiFields(null); setIsFieldsRevealed(false); setIsAdded(false);
    setAiError(null); setCatalogProductsWithRef([]); setAddedCount(0);
    setProcessingMode('idle'); setProcessingProgress(null); setBatchProgress(null);
  }, []);

  const selectedCatalogCount = catalogProducts.filter(p => p.selected).length;

  const leftPanelRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={leftPanelRef} className="flex h-full flex-col overflow-y-auto">
      {/* ══════ TOP SECTION: Configuration ══════ */}
      <div className="flex-shrink-0 border-b border-border bg-card/50 p-6">
        <div className="flex flex-col gap-4 max-w-4xl mx-auto">

          {/* ━━━ Step 1: 選擇廠家 ━━━ */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-300",
                isManufacturerSelected
                  ? "bg-emerald-500/20 text-emerald-500"
                  : "bg-primary/15 text-primary"
              )}>
                {isManufacturerSelected ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <span className="font-mono-data text-[11px] font-bold">1</span>
                )}
              </div>
              <h3 className="font-display text-sm font-bold tracking-tight">選擇廠家</h3>
              {isManufacturerSelected && (
                <Badge className="ml-auto bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-mono-data text-[10px] gap-1">
                  <Check className="h-2.5 w-2.5" />
                  已選擇
                </Badge>
              )}
            </div>

            <Popover open={manufacturerOpen} onOpenChange={setManufacturerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={manufacturerOpen}
                  className={cn(
                    "w-full justify-between h-10 font-body text-sm border-border bg-card hover:bg-accent/50 transition-colors",
                    !selectedManufacturer && "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Factory className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
                    {selectedManufacturer
                      ? (selectedFactoryId ? `${selectedManufacturer} (${selectedFactoryId})` : selectedManufacturer)
                      : '選擇或輸入廠家名稱...'}
                  </div>
                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" side="bottom" align="start" collisionBoundary={leftPanelRef.current ?? undefined}>
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="搜尋廠家..."
                    className="font-body text-sm"
                    value={manufacturerSearch}
                    onValueChange={setManufacturerSearch}
                  />
                  <CommandList>
                    {manufacturerListLoading ? (
                      <div className="flex items-center justify-center gap-2 py-6">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground font-body">載入廠家列表...</span>
                      </div>
                    ) : (
                    <>
                    <CommandEmpty>
                      {manufacturerSearch.trim() ? (
                        <div className="py-3 px-2 text-center">
                          <p className="text-xs text-muted-foreground font-body">找不到「{manufacturerSearch}」</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 gap-1.5 text-primary font-body text-xs"
                            onClick={() => {
                              setSelectedManufacturer(manufacturerSearch.trim());
                              setSelectedFactoryId('');
                              setManufacturerOpen(false);
                              setManufacturerSearch('');
                            }}
                          >
                            <Check className="h-3 w-3" />
                            使用「{manufacturerSearch}」作為新廠家
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground font-body py-3">沒有找到廠家</p>
                      )}
                    </CommandEmpty>
                    <CommandGroup>
                      {filteredManufacturers.map((manufacturer) => (
                        <CommandItem
                          key={manufacturer}
                          value={manufacturer}
                          onSelect={() => {
                            setSelectedManufacturer(manufacturer);
                            const matched = factoryItemsList.find(f => f.display_name === manufacturer);
                            setSelectedFactoryId(matched?.factory_id || '');
                            setManufacturerOpen(false);
                            setManufacturerSearch('');
                          }}
                          className="font-body text-sm cursor-pointer"
                        >
                          <Factory className="mr-2 h-3.5 w-3.5 text-muted-foreground/50" />
                          <span className="truncate">{manufacturer}</span>
                          {(() => {
                            const fItem = factoryItemsList.find(f => f.display_name === manufacturer);
                            return fItem?.factory_id ? (
                              <span className="ml-1 text-[10px] text-muted-foreground font-mono-data">({fItem.factory_id})</span>
                            ) : null;
                          })()}
                          {selectedManufacturer === manufacturer && (
                            <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {selectedManufacturer && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                <span className="font-body text-xs text-foreground truncate">
                  {selectedFactoryId ? `${selectedManufacturer} (${selectedFactoryId})` : selectedManufacturer}
                </span>
                {/* Learnt corrections badge */}
                {getCorrections().length > 0 && (
                  <span
                    title={`${getCorrections().length} learnt correction pattern(s) will be auto-applied on next upload`}
                    className="ml-1 flex items-center gap-1 rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-mono-data text-indigo-400 border border-indigo-500/30 cursor-default"
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    {getCorrections().length}
                  </span>
                )}
                <button
                  onClick={() => { setSelectedManufacturer(''); setSelectedFactoryId(''); }}
                  className="ml-auto rounded-full p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            )}

            {/* Source indicator */}
            {!manufacturerListLoading && manufacturerListSource && (
              <div className="flex items-center gap-1.5 px-1">
                {manufacturerListSource === 'dynamic' ? (
                  <>
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span className="font-body text-[10px] text-muted-foreground">
                      動態列表 · {manufacturerList.length} 個廠家
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    <span className="font-body text-[10px] text-amber-500">
                      使用靜態備用列表（Edge Function 無法連線）
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ━━━ Factory Highlights Multi-Select (廠家特點) ━━━ */}
          {isManufacturerSelected && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-primary/70" />
                <h4 className="font-display text-xs font-bold tracking-tight">廠家特點 (Factory Highlights)</h4>
                {selectedFactoryHighlights.length > 0 && (
                  <Badge className="ml-auto bg-primary/15 text-primary border border-primary/30 font-mono-data text-[10px]">
                    {selectedFactoryHighlights.length} 已選
                  </Badge>
                )}
              </div>

              {/* Selected Highlights as Chips */}
              {selectedFactoryHighlights.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
                  {selectedFactoryHighlights.map((highlight) => (
                    <Badge
                      key={highlight}
                      variant="secondary"
                      className="group gap-1 px-2 py-0.5 text-[11px] font-mono-data bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 hover:border-primary/40 transition-all cursor-default"
                    >
                      <span className="truncate max-w-[120px]">{highlight}</span>
                      <button
                        onClick={() => setSelectedFactoryHighlights(prev => prev.filter(h => h !== highlight))}
                        className="ml-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5 transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  <button
                    onClick={() => setSelectedFactoryHighlights([])}
                    className="flex items-center h-[22px] px-1.5 rounded-md text-[10px] font-mono-data text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-dashed border-border hover:border-destructive/30 transition-all"
                  >
                    清除全部
                  </button>
                </div>
              )}

              {/* Highlights Picker */}
              <Popover open={highlightsOpen} onOpenChange={setHighlightsOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all",
                      "border-border bg-background hover:border-primary/50 hover:bg-accent/50",
                      highlightsOpen && "border-primary ring-1 ring-primary/20 bg-accent/30"
                    )}
                  >
                    <Tag className="h-3.5 w-3.5 flex-shrink-0 text-primary/70" />
                    <span className="flex-1 font-body text-xs text-muted-foreground truncate">
                      {categoriesLoading ? '載入中...' : '選擇產品類別標籤...'}
                    </span>
                    <ChevronsUpDown className={cn(
                      "h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform",
                      highlightsOpen && "rotate-180"
                    )} />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" side="bottom" align="start" sideOffset={4} collisionBoundary={leftPanelRef.current ?? undefined}>
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="搜尋類別 (中英文)..."
                      value={highlightsSearch}
                      onValueChange={setHighlightsSearch}
                      className="font-body text-xs"
                    />
                    <CommandList className="max-h-[300px] overflow-y-auto">
                      <CommandEmpty className="py-4 text-center font-body text-xs text-muted-foreground">
                        {categoriesLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="h-3 w-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                            載入中...
                          </span>
                        ) : '找不到「' + highlightsSearch + '」'}
                      </CommandEmpty>

                      {/* Single consolidated list */}
                      <CommandGroup>
                        {availableCategories
                          .filter(c => !highlightsSearch.trim() || c.toLowerCase().includes(highlightsSearch.toLowerCase()))
                          .map((category) => {
                            const isSelected = selectedFactoryHighlights.includes(category);
                            return (
                              <CommandItem
                                key={category}
                                value={category}
                                onSelect={() => {
                                  if (isSelected) {
                                    setSelectedFactoryHighlights(prev => prev.filter(h => h !== category));
                                  } else {
                                    setSelectedFactoryHighlights(prev => [...prev, category]);
                                  }
                                }}
                                className="flex items-center gap-2 font-body text-xs cursor-pointer"
                              >
                                <div className={cn(
                                  "flex h-4 w-4 items-center justify-center rounded border transition-all",
                                  isSelected
                                    ? "bg-primary border-primary text-primary-foreground scale-100"
                                    : "border-muted-foreground/30 hover:border-primary/50"
                                )}>
                                  {isSelected && <Check className="h-3 w-3" />}
                                </div>
                                <span className={cn(
                                  "flex-1 truncate transition-colors",
                                  isSelected && "text-primary font-medium"
                                )}>{category}</span>
                                {isSelected && (
                                  <span className="text-[9px] font-mono-data text-primary/60">✓</span>
                                )}
                              </CommandItem>
                            );
                          })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </motion.div>
          )}

          {/* ━━━ Step 1b: 選擇產品分類 (可選) ━━━ */}
          {isManufacturerSelected && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.3 }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-300",
                  selectedProductCategory
                    ? "bg-emerald-500/15 text-emerald-500"
                    : "bg-muted text-muted-foreground"
                )}>
                  {selectedProductCategory ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5" />
                  )}
                </div>
                <h3 className="font-display text-sm font-bold tracking-tight">產品分類</h3>
                {selectedProductCategory && (
                  <Badge className="ml-auto bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-mono-data text-[10px] gap-1">
                    <Check className="h-2.5 w-2.5" />
                    {selectedProductCategory}
                  </Badge>
                )}
                {!selectedProductCategory && (
                  <span className="ml-auto font-mono-data text-[10px] text-muted-foreground/50">可選</span>
                )}
              </div>
              <div className="pl-8">
                {categoryListLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <CascadingCategorySelector
                    categories={categoryList}
                    value={selectedProductCategory}
                    onValueChange={setSelectedProductCategory}
                    placeholder="選擇此批次的產品分類..."
                    showClear
                    triggerClassName="bg-background border-border font-body text-sm"
                  />
                )}
                <p className="font-body text-[10px] text-muted-foreground/50 mt-1.5">
                  選擇分類後，此批次上傳的所有產品將自動歸入該分類。不選則需稍後在「分類管理」中手動指派。
                </p>
              </div>
            </motion.div>
          )}

          {/* ━━━ 材料管理 Module ━━━ */}
          {isManufacturerSelected && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.3 }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-300",
                  (selectedColors.length > 0 || selectedFabrics.length > 0)
                    ? "bg-violet-500/15 text-violet-500"
                    : "bg-muted text-muted-foreground"
                )}>
                  <Layers className="h-3.5 w-3.5" />
                </div>
                <h3 className="font-display text-sm font-bold tracking-tight">材料管理</h3>
                {(selectedColors.length > 0 || selectedFabrics.length > 0) && (
                  <Badge className="ml-auto bg-violet-500/15 text-violet-500 border border-violet-500/30 font-mono-data text-[10px] gap-1">
                    <Check className="h-2.5 w-2.5" />
                    {selectedColors.length + selectedFabrics.length} 已選
                  </Badge>
                )}
                {selectedColors.length === 0 && selectedFabrics.length === 0 && (
                  <span className="ml-auto font-mono-data text-[10px] text-muted-foreground/50">可選</span>
                )}
              </div>

              <div className="pl-8 space-y-3">
                {/* ── 顏色 Multi-select ── */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-display text-xs font-semibold text-foreground/80">顏色</span>
                    {selectedColors.length > 0 && (
                      <Badge className="bg-violet-500/10 text-violet-500 border border-violet-500/20 font-mono-data text-[10px]">
                        {selectedColors.length}
                      </Badge>
                    )}
                  </div>

                  {selectedColors.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedColors.map((colorEn) => {
                        const c = COLOR_MAP.find(x => x.en === colorEn);
                        return (
                          <Badge
                            key={colorEn}
                            variant="secondary"
                            className="group gap-1.5 px-2 py-0.5 text-[11px] font-body bg-violet-500/10 text-violet-600 border border-violet-500/20 hover:bg-violet-500/20 transition-all cursor-default"
                          >
                            {c && (
                              <span
                                className="h-2.5 w-2.5 rounded-full border border-border/50 flex-shrink-0"
                                style={{ backgroundColor: c.hex }}
                              />
                            )}
                            <span>{c?.cn ?? colorEn}</span>
                            <button
                              onClick={() => setSelectedColors(prev => prev.filter(x => x !== colorEn))}
                              className="ml-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5 transition-colors"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </Badge>
                        );
                      })}
                      <button
                        onClick={() => setSelectedColors([])}
                        className="flex items-center h-[22px] px-1.5 rounded-md text-[10px] font-mono-data text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-dashed border-border hover:border-destructive/30 transition-all"
                      >
                        清除全部
                      </button>
                    </div>
                  )}

                  <Popover open={colorsOpen} onOpenChange={setColorsOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all",
                          "border-border bg-background hover:border-violet-500/50 hover:bg-accent/50",
                          colorsOpen && "border-violet-500 ring-1 ring-violet-500/20 bg-accent/30"
                        )}
                      >
                        <span className="h-3.5 w-3.5 flex-shrink-0 text-violet-500/70 font-mono-data text-xs leading-none">🎨</span>
                        <span className="flex-1 font-body text-xs text-muted-foreground truncate">選擇顏色（可多選）...</span>
                        <ChevronsUpDown className={cn(
                          "h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform",
                          colorsOpen && "rotate-180"
                        )} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" side="bottom" align="start" sideOffset={4}>
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="搜尋顏色 (中英文)..."
                          value={colorsSearch}
                          onValueChange={setColorsSearch}
                          className="font-body text-xs"
                        />
                        <CommandList className="max-h-[260px] overflow-y-auto">
                          <CommandEmpty className="py-4 text-center font-body text-xs text-muted-foreground">
                            找不到「{colorsSearch}」
                          </CommandEmpty>
                          <CommandGroup>
                            {COLOR_MAP
                              .filter(c => !colorsSearch.trim() || c.cn.includes(colorsSearch) || c.en.toLowerCase().includes(colorsSearch.toLowerCase()))
                              .map((c) => {
                                const isSelected = selectedColors.includes(c.en);
                                return (
                                  <CommandItem
                                    key={c.en}
                                    value={c.en}
                                    onSelect={() => {
                                      if (isSelected) {
                                        setSelectedColors(prev => prev.filter(x => x !== c.en));
                                      } else {
                                        setSelectedColors(prev => [...prev, c.en]);
                                      }
                                    }}
                                    className="flex items-center gap-2 font-body text-xs cursor-pointer"
                                  >
                                    <div className={cn(
                                      "flex h-4 w-4 items-center justify-center rounded border transition-all flex-shrink-0",
                                      isSelected
                                        ? "bg-violet-500 border-violet-500 text-white scale-100"
                                        : "border-muted-foreground/30 hover:border-violet-500/50"
                                    )}>
                                      {isSelected && <Check className="h-3 w-3" />}
                                    </div>
                                    <span
                                      className="h-3.5 w-3.5 rounded-full border border-border/50 flex-shrink-0"
                                      style={{ backgroundColor: c.hex }}
                                    />
                                    <span className={cn("flex-1", isSelected && "text-violet-600 font-medium")}>{c.cn}</span>
                                    <span className="text-[9px] text-muted-foreground/50 font-mono-data">{c.en}</span>
                                  </CommandItem>
                                );
                              })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* ── 皮料/布料 Multi-select ── */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-display text-xs font-semibold text-foreground/80">皮料/布料</span>
                    {selectedFabrics.length > 0 && (
                      <Badge className="bg-violet-500/10 text-violet-500 border border-violet-500/20 font-mono-data text-[10px]">
                        {selectedFabrics.length}
                      </Badge>
                    )}
                  </div>

                  {selectedFabrics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedFabrics.map((fabric) => (
                        <Badge
                          key={fabric}
                          variant="secondary"
                          className="group gap-1 px-2 py-0.5 text-[11px] font-body bg-amber-500/10 text-amber-700 border border-amber-500/20 hover:bg-amber-500/20 transition-all cursor-default"
                        >
                          <span>{fabric}</span>
                          <button
                            onClick={() => setSelectedFabrics(prev => prev.filter(x => x !== fabric))}
                            className="ml-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5 transition-colors"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      ))}
                      <button
                        onClick={() => setSelectedFabrics([])}
                        className="flex items-center h-[22px] px-1.5 rounded-md text-[10px] font-mono-data text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-dashed border-border hover:border-destructive/30 transition-all"
                      >
                        清除全部
                      </button>
                    </div>
                  )}

                  <Popover open={fabricsOpen} onOpenChange={setFabricsOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all",
                          "border-border bg-background hover:border-amber-500/50 hover:bg-accent/50",
                          fabricsOpen && "border-amber-500 ring-1 ring-amber-500/20 bg-accent/30"
                        )}
                      >
                        <span className="flex-shrink-0 text-amber-600/70 font-mono-data text-xs leading-none">🪢</span>
                        <span className="flex-1 font-body text-xs text-muted-foreground truncate">選擇皮料/布料（可多選）...</span>
                        <ChevronsUpDown className={cn(
                          "h-3.5 w-3.5 text-muted-foreground flex-shrink-0 transition-transform",
                          fabricsOpen && "rotate-180"
                        )} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" side="bottom" align="start" sideOffset={4}>
                      <Command>
                        <CommandInput
                          placeholder="搜尋皮料/布料..."
                          className="font-body text-xs"
                        />
                        <CommandList className="max-h-[260px] overflow-y-auto">
                          <CommandEmpty className="py-4 text-center font-body text-xs text-muted-foreground">找不到相關材料</CommandEmpty>
                          <CommandGroup heading="皮料">
                            {['頭層牛皮', '二層牛皮', '羊皮', '豬皮', '馬皮', 'PU 仿皮', 'PVC 皮料', '超纖皮', '全粒面皮', '修面皮', '壓紋皮', '翻毛皮（麂皮）', '漆皮'].map((item) => {
                              const isSelected = selectedFabrics.includes(item);
                              return (
                                <CommandItem
                                  key={item}
                                  value={item}
                                  onSelect={() => {
                                    if (isSelected) {
                                      setSelectedFabrics(prev => prev.filter(x => x !== item));
                                    } else {
                                      setSelectedFabrics(prev => [...prev, item]);
                                    }
                                  }}
                                  className="flex items-center gap-2 font-body text-xs cursor-pointer"
                                >
                                  <div className={cn(
                                    "flex h-4 w-4 items-center justify-center rounded border transition-all flex-shrink-0",
                                    isSelected
                                      ? "bg-amber-500 border-amber-500 text-white"
                                      : "border-muted-foreground/30 hover:border-amber-500/50"
                                  )}>
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </div>
                                  <span className={cn("flex-1", isSelected && "text-amber-700 font-medium")}>{item}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                          <CommandGroup heading="布料">
                            {['棉布', '麻布', '絨布', '天鵝絨', '燈芯絨', '帆布', '牛仔布', '針織布', '緹花布', '提花布', '雪尼爾', '人造絲', '滌綸布', '尼龍布', '防水布', '仿麂皮布'].map((item) => {
                              const isSelected = selectedFabrics.includes(item);
                              return (
                                <CommandItem
                                  key={item}
                                  value={item}
                                  onSelect={() => {
                                    if (isSelected) {
                                      setSelectedFabrics(prev => prev.filter(x => x !== item));
                                    } else {
                                      setSelectedFabrics(prev => [...prev, item]);
                                    }
                                  }}
                                  className="flex items-center gap-2 font-body text-xs cursor-pointer"
                                >
                                  <div className={cn(
                                    "flex h-4 w-4 items-center justify-center rounded border transition-all flex-shrink-0",
                                    isSelected
                                      ? "bg-amber-500 border-amber-500 text-white"
                                      : "border-muted-foreground/30 hover:border-amber-500/50"
                                  )}>
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </div>
                                  <span className={cn("flex-1", isSelected && "text-amber-700 font-medium")}>{item}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </motion.div>
          )}

        </div>
      </div>

      {/* ══════ MIDDLE SECTION: Upload & AI Processing ══════ */}
      <div className="flex-shrink-0 p-6 max-w-4xl mx-auto w-full">
        <div className="flex flex-col gap-4">

        {/* ━━━ Step 2: 上傳產品檔案 ━━━ */}
        <div className={cn("space-y-3 transition-opacity duration-300", !isManufacturerSelected && "opacity-40 pointer-events-none")}>
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              isManufacturerSelected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            )}>
              <span className="font-mono-data text-[11px] font-bold">2</span>
            </div>
            <h3 className={cn(
              "font-display text-sm font-bold tracking-tight transition-colors",
              !isManufacturerSelected && "text-muted-foreground"
            )}>上傳產品檔案</h3>
          </div>

          {!isManufacturerSelected && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
              <p className="font-body text-[11px] text-muted-foreground/60">請先在第一步選擇廠家，才可上傳檔案</p>
            </div>
          )}

          {/* Mode Indicator */}
          {processingMode !== 'idle' && (
            <div className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2",
              processingMode === 'pdf-catalog' ? "border-amber-500/30 bg-amber-500/5"
                : processingMode === 'excel-pdf-crossref' ? "border-cyan-500/30 bg-cyan-500/5"
                : processingMode === 'excel-catalog' ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-primary/30 bg-primary/5"
            )}>
              {processingMode === 'excel-pdf-crossref' ? (
                <>
                  <FileStack className="h-3.5 w-3.5 text-cyan-500" />
                  <span className="font-mono-data text-xs text-cyan-400">📎 Cross-Reference 模式</span>
                  <Badge className="ml-auto bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 font-mono-data text-[10px]">
                    PDF→圖片 (FORCED) | Excel→數據 | XLS圖片=BLOCKED
                  </Badge>
                </>
              ) : processingMode === 'pdf-catalog' ? (
                <>
                  <FileStack className="h-3.5 w-3.5 text-amber-500" />
                  <span className="font-mono-data text-xs text-amber-400">PDF 目錄模式</span>
                  <Badge className="ml-auto bg-amber-500/15 text-amber-500 border border-amber-500/30 font-mono-data text-[10px]">
                    多產品提取
                  </Badge>
                </>
              ) : processingMode === 'excel-catalog' ? (
                <>
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="font-mono-data text-xs text-emerald-400">Excel 目錄模式</span>
                  <Badge className="ml-auto bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-mono-data text-[10px]">
                    多產品提取
                  </Badge>
                </>
              ) : (
                <>
                  <FileImage className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono-data text-xs text-primary">單圖模式</span>
                </>
              )}
            </div>
          )}

          {/* Upload Zone */}
          <div
            onDrop={isManufacturerSelected ? handleDrop : undefined}
            onDragOver={isManufacturerSelected ? handleDragOver : undefined}
            onDragLeave={isManufacturerSelected ? handleDragLeave : undefined}
            onClick={() => isManufacturerSelected && fileInputRef.current?.click()}
            className={cn(
              'group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all duration-300',
              isManufacturerSelected ? 'cursor-pointer' : 'cursor-not-allowed',
              isDragOver ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10' : 'border-border hover:border-primary/40 hover:bg-card',
              uploadedFiles.length > 0 ? 'h-48' : 'h-56'
            )}
          >
            <input ref={fileInputRef} type="file" className="hidden" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls" onChange={handleFileInputChange} disabled={!isManufacturerSelected} />
            <div className={cn('flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-300', isDragOver ? 'bg-primary/20 scale-110' : 'bg-muted group-hover:bg-primary/10')}>
              <Upload className={cn('h-6 w-6 transition-colors', isDragOver ? 'text-primary' : 'text-muted-foreground group-hover:text-primary')} />
            </div>
            <p className="mt-4 font-display text-sm font-bold">{isDragOver ? '放開以上傳檔案' : '上傳產品檔案'}</p>
            <p className="mt-1 text-center text-xs text-muted-foreground font-body">拖放 <strong>PDF 目錄</strong>、<strong>Excel 表格</strong>或產品圖片</p>
            <p className="mt-1 font-mono-data text-[10px] text-muted-foreground/60">PDF（多產品目錄）· XLSX · XLS · JPG · PNG · WEBP</p>
          </div>
        </div>

        {/* File Thumbnails */}
        <AnimatePresence>
          {uploadedFiles.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-2">
              <h4 className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">已上傳檔案 ({uploadedFiles.length})</h4>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {uploadedFiles.map((file) => (
                  <div key={file.id} className="group/file relative flex-shrink-0 overflow-hidden rounded-lg border border-border">
                    {file.thumbnail ? (
                      <img src={file.thumbnail} alt={file.name} className="h-20 w-20 object-cover cursor-zoom-in" onClick={(e) => { e.stopPropagation(); setPreviewImage(file.thumbnail); }} />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center bg-muted">
                        {file.name.match(/\.xlsx?$/i) ? <FileSpreadsheet className="h-8 w-8 text-emerald-500/50" /> : <FileText className="h-8 w-8 text-muted-foreground/50" />}
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover/file:bg-black/40 group-hover/file:opacity-100">
                      <div className="flex gap-1">
                        {file.thumbnail && (
                          <button onClick={(e) => { e.stopPropagation(); setPreviewImage(file.thumbnail); }} className="rounded-full bg-black/60 p-1 text-white hover:bg-black/80"><Eye className="h-3 w-3" /></button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); removeFile(file.id); }} className="rounded-full bg-black/60 p-1 text-white hover:bg-black/80"><X className="h-3 w-3" /></button>
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                      <div className="flex items-center gap-1">
                        {file.type === 'application/pdf' ? <FileText className="h-2.5 w-2.5 text-white/70" /> : file.name.match(/\.xlsx?$/i) ? <FileSpreadsheet className="h-2.5 w-2.5 text-white/70" /> : <FileImage className="h-2.5 w-2.5 text-white/70" />}
                        <span className="truncate text-[9px] text-white/80 font-mono-data">{file.name}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Generate Button — manual trigger for extraction */}
        {uploadedFiles.length > 0 && !isProcessing && catalogProducts.length === 0 && !aiFields && !aiError && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-2">
            <Button
              onClick={handleGenerate}
              disabled={uploadedFiles.length === 0 || isProcessing}
              className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-display text-sm font-bold py-5 shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.98]"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  處理中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  產生 — 開始提取產品數據
                </>
              )}
            </Button>
            <p className="font-body text-[10px] text-muted-foreground/60 text-center">
              請確認所有檔案（PDF / Excel / 圖片）上傳完畢後再按此按鈕
            </p>
          </motion.div>
        )}

        {/* Processing Indicators */}
        {isProcessing && processingMode === 'pdf-catalog' && processingProgress && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
              <div className="flex-1">
                <p className="font-display text-sm font-bold text-amber-400">{processingProgress.message}</p>
                {processingProgress.detail && <p className="text-xs text-muted-foreground font-body mt-0.5">{processingProgress.detail}</p>}
              </div>
            </div>

            {/* Batch Progress Bar */}
            {batchProgress && batchProgress.isLargeFile && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 text-amber-500/70" />
                    <span className="font-mono-data text-[10px] text-amber-400">
                      Page {batchProgress.currentBatch} / {batchProgress.totalBatches}
                    </span>
                  </div>
                  <span className="font-mono-data text-[10px] text-muted-foreground">
                    {batchProgress.productsFoundSoFar} items found · {batchProgress.elapsedSeconds.toFixed(0)}s
                  </span>
                </div>
                <Progress
                  value={(batchProgress.currentBatch / batchProgress.totalBatches) * 100}
                  className="h-2 bg-amber-500/10"
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono-data text-[9px] text-muted-foreground/60">
                    Page {batchProgress.startPage} of ~{batchProgress.totalPages}
                  </span>
                  <span className="font-mono-data text-[9px] text-muted-foreground/60">
                    {batchProgress.successfulBatches} OK
                    {batchProgress.batchErrors.length > 0 && (
                      <span className="text-rose-400"> · {batchProgress.batchErrors.length} failed</span>
                    )}
                  </span>
                </div>
                {batchProgress.isLargeFile && batchProgress.currentBatch <= 1 && (
                  <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 mt-1">
                    <AlertTriangle className="h-3 w-3 text-amber-500/70 flex-shrink-0" />
                    <p className="font-body text-[10px] text-amber-400/80">
                      Large file detected. Processing one page at a time ({PARALLEL_CONCURRENCY} in parallel) for maximum stability.
                    </p>
                  </div>
                )}
                {batchProgress.batchErrors.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {batchProgress.batchErrors.map((err, i) => (
                      <div key={i} className="flex items-center gap-1.5 rounded bg-rose-500/10 px-2 py-1">
                        <X className="h-2.5 w-2.5 text-rose-400 flex-shrink-0" />
                        <span className="font-mono-data text-[9px] text-rose-400 truncate">
                          Batch {err.batch}: {err.error.substring(0, 80)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Phase dots (non-batch mode or small files) */}
            {(!batchProgress || !batchProgress.isLargeFile) && (
              <div className="flex items-center gap-2">
                {(['uploading', 'analyzing', 'extracting', 'complete'] as const).map((phase, i) => (
                  <div key={phase} className="flex items-center gap-1">
                    <div className={cn('h-2 w-2 rounded-full transition-colors',
                      processingProgress.phase === phase ? 'bg-amber-500 animate-pulse' :
                      ['uploading', 'analyzing', 'extracting', 'complete'].indexOf(processingProgress.phase) > i ? 'bg-amber-500' : 'bg-muted-foreground/20'
                    )} />
                    <span className={cn('font-mono-data text-[9px]', processingProgress.phase === phase ? 'text-amber-400' : 'text-muted-foreground/40')}>{phase}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {isProcessing && processingMode === 'single-image' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="font-display text-sm font-bold text-primary">AI 分析中...</p>
              <p className="text-xs text-muted-foreground font-body">深度分析形狀、材質、風格及家具類別</p>
            </div>
          </motion.div>
        )}

        {isProcessing && processingMode === 'excel-catalog' && processingProgress && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
              <div className="flex-1">
                <p className="font-display text-sm font-bold text-emerald-400">{processingProgress.message}</p>
                {processingProgress.detail && <p className="text-xs text-muted-foreground font-body mt-0.5">{processingProgress.detail}</p>}
              </div>
            </div>
          </motion.div>
        )}

        {/* Cross-Reference Mode Processing */}
        {isProcessing && processingMode === 'excel-pdf-crossref' && processingProgress && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge className="bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 font-mono-data text-[10px] gap-1">
                    🔍 Visual Search
                  </Badge>
                  <span className="font-mono-data text-[10px] text-muted-foreground">PDF → 視覺模板 | Excel → 全域圖片搜尋</span>
                </div>
                <p className="font-display text-sm font-bold text-cyan-400">{processingProgress.message}</p>
                {processingProgress.detail && <p className="text-xs text-muted-foreground font-body mt-0.5">{processingProgress.detail}</p>}
              </div>
            </div>
          </motion.div>
        )}

        {/* AI Error Display */}
        {aiError && !isProcessing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-500" />
            <div className="flex-1">
              <p className="font-display text-sm font-bold text-rose-500">處理失敗 — Error Details</p>
              <p className="mt-1 text-xs text-rose-400/80 font-body whitespace-pre-line break-all">{aiError}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-1.5 border-rose-500/30 text-rose-500 hover:bg-rose-500/10 font-body text-xs"
                  onClick={() => { if (uploadedFiles.length > 0) { setAiError(null); processFiles(uploadedFiles.map(f => f.file)); } }}>
                  <RotateCcw className="h-3 w-3" /> 重新分析
                </Button>
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground font-body text-xs"
                  onClick={() => { navigator.clipboard.writeText(aiError || ''); toast.success('Error copied to clipboard'); }}>
                  📋 Copy Error
                </Button>
              </div>
            </div>
          </motion.div>
        )}
        </div>
      </div>

      {/* Image Preview Modal */}
      <AnimatePresence>
        {previewImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setPreviewImage(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="relative max-h-[80vh] max-w-[80vw]">
              <img src={previewImage} alt="Preview" className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain shadow-2xl" />
              <button onClick={() => setPreviewImage(null)} className="absolute -right-3 -top-3 rounded-full bg-black/80 p-2 text-white hover:bg-black"><X className="h-4 w-4" /></button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════ BOTTOM SECTION: Product Preview Results ══════ */}
      <div className="flex-1 p-6 pt-0 max-w-6xl mx-auto w-full">
        {/* Visual separator */}
        {(aiFields || isProcessing || catalogProducts.length > 0 || excelPreviewData) && (
          <div className="mb-6 border-t border-border" />
        )}

        {/* ══════ EXCEL PREVIEW TABLE (Human-in-the-loop Column Mapping) ══════ */}
        {excelPreviewData && !isProcessing && catalogProducts.length === 0 && (
          <ExcelPreviewTable
            previewData={excelPreviewData}
            onGenerateCatalog={handleGenerateFromPreview}
            onAction={handlePreviewAction}
            onRowsDiscarded={removeRowsFromPreview}
            onCellEdit={handleCellEdit}
            onCancel={handleCancelPreview}
            isGenerating={isGeneratingFromPreview}
          />
        )}

        {/* Empty State */}
        {!aiFields && !isProcessing && catalogProducts.length === 0 && !excelPreviewData && (
          <div className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-border">
            <Sparkles className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="font-display text-sm font-bold text-muted-foreground/60">AI 智能產品提取</p>
            <p className="mt-1 text-xs text-muted-foreground/40 font-body">上傳產品圖片或 PDF 目錄進行 AI 分析</p>
            <div className="mt-4 flex flex-col items-center gap-2 max-w-md">
              <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 px-4 py-2.5 w-full">
                <FileImage className="h-4 w-4 text-primary/50 flex-shrink-0" />
                <div>
                  <p className="font-display text-xs font-bold text-muted-foreground/60">單張圖片</p>
                  <p className="text-[10px] text-muted-foreground/40 font-body">上傳一張或多張產品圖片 → 1 個產品</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 w-full">
                <FileStack className="h-4 w-4 text-amber-500/50 flex-shrink-0" />
                <div>
                  <p className="font-display text-xs font-bold text-amber-400/60">PDF 目錄</p>
                  <p className="text-[10px] text-muted-foreground/40 font-body">上傳多頁 PDF → 提取所有產品</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Single Image: Processing skeleton */}
        {isProcessing && processingMode === 'single-image' && (
          <div className="space-y-6 rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" />
              <span className="font-mono-data text-xs text-primary">正在分析圖片...</span>
            </div>
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <div className="flex gap-2"><Skeleton className="h-6 w-20" /><Skeleton className="h-6 w-24" /><Skeleton className="h-6 w-16" /></div>
            <div className="flex gap-4"><Skeleton className="h-10 w-32" /><Skeleton className="h-10 w-40" /></div>
          </div>
        )}

        {/* PDF Catalog: Processing skeleton */}
        {isProcessing && processingMode === 'pdf-catalog' && (
          <div className="space-y-4 rounded-xl border border-amber-500/20 bg-card p-6">
            <div className="flex items-center gap-2">
              <FileStack className="h-4 w-4 text-amber-500 animate-pulse" />
              <span className="font-mono-data text-xs text-amber-400">
                {batchProgress?.isLargeFile
                  ? `正在掃描 PDF — 第 ${batchProgress.currentBatch} 頁 / 共 ${batchProgress.totalBatches} 頁 (${PARALLEL_CONCURRENCY} 個並行)...`
                  : '正在掃描 PDF 頁面 — 識別個別產品中...'
                }
              </span>
            </div>
            {batchProgress?.isLargeFile && batchProgress.productsFoundSoFar > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="font-mono-data text-xs text-emerald-400">
                  {batchProgress.productsFoundSoFar} products extracted so far from {batchProgress.successfulBatches} page(s)
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-background p-4 space-y-3">
                  <Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" />
                  <div className="flex gap-2"><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-20" /></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Single Image: AI Generated Fields */}
        <AnimatePresence>
          {aiFields && isFieldsRevealed && processingMode === 'single-image' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5 rounded-xl border border-border bg-card p-6">
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground font-body uppercase tracking-wider">
                  <Sparkles className="h-3 w-3 text-primary" /> 產品標題
                </label>
                <Input value={aiFields.title} onChange={(e) => setAiFields(prev => prev ? { ...prev, title: e.target.value } : null)} className="font-display text-base font-bold bg-background border-border" />
              </motion.div>

              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground font-body uppercase tracking-wider">
                  <Sparkles className="h-3 w-3 text-primary" /> 描述 (HTML)
                </label>
                <Textarea value={aiFields.description} onChange={(e) => setAiFields(prev => prev ? { ...prev, description: e.target.value } : null)} rows={6} className="font-body text-sm bg-background border-border resize-none" />
              </motion.div>

              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground font-body uppercase tracking-wider">
                  <Tag className="h-3 w-3 text-primary" /> 標籤 <span className="text-[9px] font-normal normal-case text-muted-foreground/60 font-mono-data">（已選 {aiFields.tags.length} 個）</span>
                </label>
                <TagSelector selectedTags={aiFields.tags} onChange={(tags) => setAiFields(prev => prev ? { ...prev, tags } : null)} />
              </motion.div>

              <div className="grid grid-cols-2 gap-4">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }} className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground font-body uppercase tracking-wider">
                    <DollarSign className="h-3 w-3 text-primary" /> 價格
                  </label>
                  <Input type="number" step="0.01" value={aiFields.price} onChange={(e) => setAiFields(prev => prev ? { ...prev, price: parseFloat(e.target.value) || 0 } : null)} className="font-mono-data text-lg font-bold bg-background border-border" />
                </motion.div>
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }} className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground font-body uppercase tracking-wider">
                    <FolderOpen className="h-3 w-3 text-primary" /> 系列
                  </label>
                  <Input value={aiFields.collection} onChange={(e) => setAiFields(prev => prev ? { ...prev, collection: e.target.value } : null)} className="font-body bg-background border-border" />
                </motion.div>
              </div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="flex gap-3 pt-2">
                {!isAdded ? (
                  <Button onClick={handleAddToQueue} className="gap-2 bg-primary font-display font-bold text-primary-foreground">
                    <Check className="h-4 w-4" /> 確認並加入佇列
                  </Button>
                ) : (
                  <div className="flex items-center gap-3">
                    <Badge className="gap-1.5 bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 px-3 py-1.5 font-body">
                      <Check className="h-3.5 w-3.5" /> 已加入佇列
                    </Badge>
                    <Button variant="outline" size="sm" onClick={onNavigateToPublish} className="gap-1.5 font-body text-xs">在表格中查看</Button>
                    <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5 font-body text-xs">處理下一個</Button>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PDF Catalog: Review Grid */}
        <AnimatePresence>
          {catalogProducts.length > 0 && !isProcessing && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              {/* Header — Sticky action bar */}
              <div className="sticky top-0 z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-card p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                    <Grid3X3 className="h-5 w-5 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-bold">目錄提取結果</h3>
                    <p className="text-xs text-muted-foreground font-body">
                      {catalogProducts.length} 個產品已檢測 · 已選 {selectedCatalogCount} 個
                      {batchProgress?.isLargeFile && (
                        <span className="text-amber-400/70">
                          {' '}· {batchProgress.successfulBatches}/{batchProgress.totalBatches} pages
                          {batchProgress.batchErrors.length > 0 && ` (${batchProgress.batchErrors.length} failed)`}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => toggleAllCatalogItems(selectedCatalogCount < catalogProducts.length)} className="font-body text-xs">
                    {selectedCatalogCount === catalogProducts.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  {addedCount === 0 ? (
                    <Button onClick={handleBatchAddToQueue} disabled={selectedCatalogCount === 0} className="gap-2 bg-amber-500 hover:bg-amber-600 font-display font-bold text-white" size="sm">
                      <Check className="h-3.5 w-3.5" /> Add {selectedCatalogCount} to Queue
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge className="gap-1.5 bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 px-3 py-1.5 font-body">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {addedCount} Added
                      </Badge>
                      <Button variant="outline" size="sm" onClick={onNavigateToPublish} className="font-body text-xs gap-1">View in Table</Button>
                      <Button variant="ghost" size="sm" onClick={handleReset} className="font-body text-xs gap-1"><RotateCcw className="h-3 w-3" /> New Catalog</Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Failed Pages Error Summary (Task 4) */}
              {batchProgress && batchProgress.batchErrors.length > 0 && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-rose-400" />
                    <h4 className="font-display text-sm font-bold text-rose-400">
                      Failed Pages: {batchProgress.batchErrors.map(e => e.batch).join(', ')}
                    </h4>
                    <Badge variant="outline" className="ml-auto font-mono-data text-[9px] px-2 py-0.5 border-rose-500/30 text-rose-400">
                      {batchProgress.batchErrors.length} of {batchProgress.totalBatches} pages failed
                    </Badge>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {batchProgress.batchErrors.map((err, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-md bg-rose-500/10 px-3 py-1.5">
                        <X className="h-3 w-3 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="font-mono-data text-[10px] font-bold text-rose-300">Page {err.batch}</span>
                          <p className="font-mono-data text-[9px] text-rose-400/70 truncate">{err.error}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 font-body text-[10px] text-muted-foreground/60">
                    Products from these pages were not extracted. You can re-process the catalog to retry.
                  </p>
                </motion.div>
              )}

              {/* Image Stats Summary */}
              {catalogProducts.length > 0 && (
                <div className="flex items-center gap-4 flex-wrap rounded-lg border border-border/50 bg-muted/30 px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-mono-data text-[10px] text-muted-foreground">
                      {catalogProducts.filter(p => p.cropped_image_url && p.bbox_quality === 'ok').length} with 1:1 square crops
                    </span>
                  </div>
                  {catalogProducts.filter(p => p.bbox_quality && p.bbox_quality !== 'ok' && p.bbox_quality !== 'invalid').length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                      <span className="font-mono-data text-[10px] text-rose-400">
                        {catalogProducts.filter(p => p.bbox_quality && p.bbox_quality !== 'ok' && p.bbox_quality !== 'invalid').length} bbox quality issues
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-amber-500" />
                    <span className="font-mono-data text-[10px] text-muted-foreground">
                      {catalogProducts.filter(p => p.image_type === 'lifestyle_only').length} lifestyle only
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    <span className="font-mono-data text-[10px] text-muted-foreground">
                      {catalogProducts.filter(p => !p.cropped_image_url && p.image_type !== 'lifestyle_only').length} no image
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <Grid3X3 className="h-3 w-3 text-muted-foreground/40" />
                    <span className="font-mono-data text-[10px] text-muted-foreground">
                      {catalogProducts.length} total products
                    </span>
                  </div>
                </div>
              )}

              {/* Product Grid — 2x2 responsive */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {catalogProducts.map((item, index) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className={cn(
                      'group rounded-lg border bg-card overflow-hidden transition-all duration-200',
                      item.selected ? 'border-amber-500/40 shadow-sm shadow-amber-500/5' : 'border-border',
                      'hover:shadow-md'
                    )}
                  >
                    {/* Card Header with Thumbnail */}
                    <div className="flex items-start gap-3 p-4 pb-2">
                      <Checkbox checked={item.selected} onCheckedChange={() => toggleCatalogItem(item.id)} className="mt-1 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500" />
                      {/* Product Thumbnail — Red Border Debug for bad bbox quality */}
                      {item.cropped_image_url ? (
                        <div className="relative flex-shrink-0">
                          <img
                            src={item.cropped_image_url}
                            alt={item.title}
                            className={cn(
                              "h-16 w-16 rounded-md object-contain flex-shrink-0 cursor-zoom-in bg-white",
                              item.bbox_quality && item.bbox_quality !== 'ok'
                                ? "border-2 border-rose-500 ring-2 ring-rose-500/30"
                                : "border border-border"
                            )}
                            onClick={(e) => { e.stopPropagation(); setPreviewImage(item.cropped_image_url!); }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          {item.bbox_quality && item.bbox_quality !== 'ok' && (
                            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[8px] text-white font-bold" title={`Bbox quality: ${item.bbox_quality} — AI may have misread the grid`}>!</span>
                          )}
                          {/* Multi-image badge: shows when a lifestyle 效果圖 is also available */}
                          {item.lifestyleImageUrl && (
                            <span
                              className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[8px] text-white font-bold cursor-pointer"
                              title="效果圖 available — click to preview lifestyle image"
                              onClick={(e) => { e.stopPropagation(); setPreviewImage(item.lifestyleImageUrl!); }}
                            >+</span>
                          )}
                        </div>
                      ) : (
                        <div className={cn(
                          "relative flex h-16 w-16 items-center justify-center rounded-md flex-shrink-0",
                          item.bbox_quality && ['too_thin', 'too_wide', 'too_tall', 'failed', 'invalid'].includes(item.bbox_quality)
                            ? "bg-rose-500/10 border-2 border-rose-500/50"
                            : "bg-muted/50 border border-border"
                        )}>
                          <FileImage className={cn(
                            "h-5 w-5",
                            item.bbox_quality && item.bbox_quality !== 'ok' ? "text-rose-500/50" : "text-muted-foreground/30"
                          )} />
                          {item.image_type === 'lifestyle_only' ? (
                            <span className="absolute -bottom-1 left-0 right-0 text-center text-[7px] font-mono-data text-amber-500 bg-amber-500/10 rounded-b-md px-0.5 py-0.5 leading-tight">Lifestyle Only</span>
                          ) : item.bbox_quality && item.bbox_quality !== 'ok' ? (
                            <span className="absolute -bottom-1 left-0 right-0 text-center text-[7px] font-mono-data text-rose-500 bg-rose-500/10 rounded-b-md px-0.5 py-0.5 leading-tight truncate">{item.bbox_quality === 'too_thin' ? '⚠ Too Thin' : item.bbox_quality === 'too_wide' ? '⚠ Too Wide' : item.bbox_quality === 'too_tall' ? '⚠ Too Tall' : '⚠ Failed'}</span>
                          ) : (
                            <span className="absolute -bottom-1 left-0 right-0 text-center text-[7px] font-mono-data text-muted-foreground/60 bg-muted rounded-b-md px-0.5 py-0.5 leading-tight">No Crop</span>
                          )}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="font-mono-data text-[9px] px-1.5 py-0 flex-shrink-0">P{item.page_number}</Badge>
                          <Badge className="bg-primary/10 text-primary border-0 font-mono-data text-[9px] px-1.5 py-0 flex-shrink-0">{item.collection}</Badge>
                          {item.image_type === 'lifestyle_only' && (
                            <Badge variant="outline" className="font-mono-data text-[9px] px-1.5 py-0 flex-shrink-0 border-amber-500/40 text-amber-500 bg-amber-500/5">🖼 Lifestyle Only – No Crop</Badge>
                          )}
                          {!item.cropped_image_url && item.image_type !== 'lifestyle_only' && (
                            <Badge variant="outline" className="font-mono-data text-[9px] px-1.5 py-0 flex-shrink-0 border-muted-foreground/30 text-muted-foreground/70">No Image</Badge>
                          )}
                          {item.cropped_image_url && item.bbox_quality === 'ok' && (
                            <Badge variant="outline" className="font-mono-data text-[9px] px-1.5 py-0 flex-shrink-0 border-emerald-500/40 text-emerald-500 bg-emerald-500/5">✓ 1:1 Crop</Badge>
                          )}
                          {item.cropped_image_url && item.bbox_quality && item.bbox_quality !== 'ok' && (
                            <Badge variant="outline" className="font-mono-data text-[9px] px-1.5 py-0 flex-shrink-0 border-rose-500/40 text-rose-500 bg-rose-500/5">⚠ {item.bbox_quality}</Badge>
                          )}
                          {item.bounding_box && Array.isArray(item.bounding_box) && (
                            <Badge variant="outline" className="font-mono-data text-[8px] px-1 py-0 flex-shrink-0 border-border/50 text-muted-foreground/50">[{item.bounding_box.join(',')}]</Badge>
                          )}
                          {/* Cross-reference source indicator */}
                          {item.dataSource === 'excel' && processingMode === 'excel-pdf-crossref' && (
                            <Badge variant="outline" className={cn(
                              "font-mono-data text-[8px] px-1 py-0 flex-shrink-0",
                              item.imageValidated && item.imageSource === 'excel'
                                ? "border-cyan-500/40 text-cyan-500 bg-cyan-500/5"
                                : item.imageSource === 'pdf' 
                                  ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/5"
                                  : item.imageSource === 'excel' && !item.imageValidated
                                    ? "border-rose-500/40 text-rose-500 bg-rose-500/5 animate-pulse"
                                    : "border-rose-500/40 text-rose-500 bg-rose-500/5 animate-pulse"
                            )}>
                              {item.imageValidated && item.imageSource === 'excel' 
                                ? '✅ Product Image (Col C)'
                                : item.imageSource === 'pdf' 
                                  ? '✅ Product Image (PDF Fallback)' 
                                  : item.imageSource === 'excel' && !item.imageValidated
                                    ? '❌ ERROR: Lifestyle Image Detected'
                                    : '❌ NO IMAGE'}
                            </Badge>
                          )}
                          {item.imageSource && item.dataSource && processingMode !== 'excel-pdf-crossref' && (
                            <Badge variant="outline" className={cn(
                              "font-mono-data text-[8px] px-1 py-0 flex-shrink-0",
                              item.imageValidated
                                ? "border-cyan-500/40 text-cyan-500 bg-cyan-500/5"
                                : item.imageSource === 'excel' && !item.imageValidated
                                  ? "border-rose-500/40 text-rose-500 bg-rose-500/5 animate-pulse"
                                  : "border-amber-500/40 text-amber-500 bg-amber-500/5"
                            )}>
                              {item.imageValidated 
                                ? `✅ Product Image (Col C)` 
                                : item.imageSource === 'excel' && !item.imageValidated
                                  ? `❌ ERROR: Lifestyle Image Detected`
                                  : `📎 Image: ${item.imageSource === 'pdf' ? 'PDF' : item.imageSource === 'excel' ? 'XLS' : 'AI'}`
                              }
                            </Badge>
                          )}
                        </div>
                        <h4 className="font-display text-sm font-bold leading-snug line-clamp-2">{item.title}</h4>
                        {/* Bilingual names (PJS mode) */}
                        {(item.titleEn || item.titleZh) && (
                          <div className="mt-1 space-y-0.5">
                            {item.titleEn && (
                              <p className="font-mono-data text-[10px] text-primary/80 truncate" title={item.titleEn}>
                                🇬🇧 {item.titleEn}
                              </p>
                            )}
                            {item.titleZh && (
                              <p className="font-mono-data text-[10px] text-amber-500/80 truncate" title={item.titleZh}>
                                🇨🇳 {item.titleZh}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-mono-data text-sm font-bold text-primary">HK${item.price.toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Meta info row */}
                    <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                      {item.material && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono-data text-[9px] text-muted-foreground">
                          <Layers className="h-2.5 w-2.5" /> {item.material}
                        </span>
                      )}
                      {item.dimensions && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono-data text-[9px] text-muted-foreground">
                          <Ruler className="h-2.5 w-2.5" /> {item.dimensions}
                        </span>
                      )}
                      {(item.dimensionLMm || item.dimensionWMm || item.dimensionHMm) && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono-data text-[9px] text-emerald-600 dark:text-emerald-400">
                          <Ruler className="h-2.5 w-2.5" /> {[item.dimensionLMm, item.dimensionWMm, item.dimensionHMm].filter(Boolean).join('×')}mm
                        </span>
                      )}
                      {item.image_region && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono-data text-[9px] text-muted-foreground">
                          <Eye className="h-2.5 w-2.5" /> {item.image_region}
                        </span>
                      )}
                    </div>

                    {/* Tags */}
                    <div className="px-4 pb-2">
                      <div className="flex flex-wrap gap-1">
                        {item.tags.slice(0, 4).map(tag => (
                          <Badge key={tag} variant="outline" className="font-body text-[9px] px-1.5 py-0 bg-primary/5 border-primary/20 text-primary/80">{tag}</Badge>
                        ))}
                        {item.tags.length > 4 && <Badge variant="outline" className="font-mono-data text-[9px] px-1.5 py-0">+{item.tags.length - 4}</Badge>}
                      </div>
                    </div>

                    {/* Expand/Collapse toggle */}
                    <button onClick={() => toggleExpandItem(item.id)} className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border-t border-border/50">
                      {item.expanded ? <><ChevronUp className="h-3 w-3" /> Collapse</> : <><ChevronDown className="h-3 w-3" /> Edit Details</>}
                    </button>

                    {/* Expanded Editor */}
                    <AnimatePresence>
                      {item.expanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border">
                          <div className="p-4 space-y-3 bg-background/50">
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">Title</label>
                              <Input value={item.title} onChange={(e) => updateCatalogProduct(item.id, 'title', e.target.value)} className="font-display text-sm font-bold bg-background border-border h-8" />
                            </div>
                            {/* Bilingual name fields — always shown for manual override */}
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body flex items-center gap-1">
                                  🇬🇧 English Name
                                </label>
                                <Input
                                  value={item.titleEn || ''}
                                  onChange={(e) => updateCatalogProduct(item.id, 'titleEn' as any, e.target.value)}
                                  className="font-body text-xs bg-background border-border h-8"
                                  placeholder="e.g. 095 - Velvet Armchair"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body flex items-center gap-1">
                                  🇨🇳 Chinese Name
                                </label>
                                <Input
                                  value={item.titleZh || ''}
                                  onChange={(e) => updateCatalogProduct(item.id, 'titleZh' as any, e.target.value)}
                                  className="font-body text-xs bg-background border-border h-8"
                                  placeholder="e.g. 095 - 絨布休閒椅"
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">Description (HTML)</label>
                              <Textarea value={item.description} onChange={(e) => updateCatalogProduct(item.id, 'description', e.target.value)} rows={4} className="font-body text-xs bg-background border-border resize-none" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">Tags ({item.tags.length})</label>
                              <TagSelector selectedTags={item.tags} onChange={(tags) => updateCatalogProduct(item.id, 'tags', tags)} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">Price (HKD)</label>
                                <Input type="number" step="0.01" value={item.price} onChange={(e) => updateCatalogProduct(item.id, 'price', parseFloat(e.target.value) || 0)} className="font-mono-data text-sm font-bold bg-background border-border h-8" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">Collection</label>
                                <Input value={item.collection} onChange={(e) => updateCatalogProduct(item.id, 'collection', e.target.value)} className="font-body text-sm bg-background border-border h-8" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">Material</label>
                                <Input value={item.material} onChange={(e) => updateCatalogProduct(item.id, 'material', e.target.value)} className="font-body text-sm bg-background border-border h-8" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">Dimensions</label>
                                <Input value={item.dimensions} onChange={(e) => updateCatalogProduct(item.id, 'dimensions', e.target.value)} className="font-body text-sm bg-background border-border h-8" />
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">成本價 (Cost)</label>
                                <Input type="number" step="0.01" value={item.costPrice ?? ''} onChange={(e) => updateCatalogProduct(item.id, 'costPrice' as any, parseFloat(e.target.value) || null)} className="font-mono-data text-sm bg-background border-border h-8" placeholder="0.00" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">生產天數 (天)</label>
                                <Input type="number" value={item.productionLeadTime ?? ''} onChange={(e) => updateCatalogProduct(item.id, 'productionLeadTime' as any, parseInt(e.target.value) || null)} className="font-mono-data text-sm bg-background border-border h-8" placeholder="0" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">船期 (天)</label>
                                <Input type="number" value={item.shippingDays ?? ''} onChange={(e) => updateCatalogProduct(item.id, 'shippingDays' as any, parseInt(e.target.value) || null)} className="font-mono-data text-sm bg-background border-border h-8" placeholder="0" />
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">運費 (Shipping Fee)</label>
                                <Input type="number" step="0.01" value={item.shippingFee ?? ''} onChange={(e) => updateCatalogProduct(item.id, 'shippingFee' as any, parseFloat(e.target.value) || null)} className="font-mono-data text-sm bg-background border-border h-8" placeholder="0.00" />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">顏色 (Color)</label>
                                <ColorSelector
                                  value={item.color || ''}
                                  onChange={(val) => updateCatalogProduct(item.id, 'color' as any, val || null)}
                                  compact={false}
                                  placeholder="選擇顏色..."
                                  className="h-8"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-body">備註 (Remarks)</label>
                                <Input value={item.remarks ?? ''} onChange={(e) => updateCatalogProduct(item.id, 'remarks' as any, e.target.value || null)} className="font-body text-sm bg-background border-border h-8" placeholder="任何備註..." />
                              </div>
                            </div>
                            {/* ── Learnt Corrections Panel ── */}
                            {selectedFactoryId && getCorrections().filter(c => !c.modelNumber || c.modelNumber === item.modelNumber).length > 0 && (
                              <div className="mt-3 rounded-md border border-indigo-500/20 bg-indigo-500/5 p-3">
                                <div className="flex items-center gap-1.5 mb-2">
                                  <Sparkles className="h-3 w-3 text-indigo-400" />
                                  <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider font-body">
                                    Learnt Corrections ({getCorrections().filter(c => !c.modelNumber || c.modelNumber === item.modelNumber).length})
                                  </span>
                                </div>
                                <div className="space-y-1">
                                  {getCorrections()
                                    .filter(c => !c.modelNumber || c.modelNumber === item.modelNumber)
                                    .slice(0, 6)
                                    .map((c, i) => (
                                      <div key={i} className="flex items-center gap-2 text-[11px] font-mono-data">
                                        <span className="text-muted-foreground min-w-[80px]">{c.fieldName}</span>
                                        {c.originalValue && (
                                          <>
                                            <span className="text-rose-400 truncate max-w-[120px]" title={c.originalValue}>
                                              {c.originalValue.length > 20 ? c.originalValue.slice(0, 20) + '…' : c.originalValue}
                                            </span>
                                            <span className="text-muted-foreground">→</span>
                                          </>
                                        )}
                                        <span className="text-emerald-400 truncate max-w-[120px]" title={c.correctedValue}>
                                          {c.correctedValue.length > 20 ? c.correctedValue.slice(0, 20) + '…' : c.correctedValue}
                                        </span>
                                        <span className="ml-auto text-[10px] text-muted-foreground">×{c.occurrenceCount}</span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
