/**
 * ExcelPreviewTable — Interactive Data Table & Column Mapping UI
 * ─────────────────────────────────────────────────────────────────
 * After Excel extraction, presents ALL raw data in a full-width preview table.
 * Users manually map columns via dropdown menus to standard bwf_product_master fields.
 * Merged-cell images are inherited by all rows within the merge range.
 * 
 * KEY FEATURES:
 * 1. ALL columns extracted from Excel are shown (not just a subset)
 * 2. BOTH "Effect Image" (效果圖) AND "Product Image" (產品圖片) are rendered
 *    as visible thumbnails in dedicated columns
 * 3. Mapping dropdowns are DIRECTLY ABOVE each table column
 * 4. Checkboxes on each row for selective generation
 * 5. "Generate Catalog Result" only processes selected rows with mapped columns
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { saveMappings, loadMappings } from '@/lib/sessionStore';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CheckCircle2,
  AlertTriangle,
  Image as ImageIcon,
  Sparkles,
  RotateCcw,
  ArrowRight,
  Columns3,
  ImagePlus,
  Plus,
  RefreshCw,
  Upload,
  Wand2,
  Loader2,
  ShoppingCart,
  Archive,
  Trash2,
} from 'lucide-react';
import { ExcelImage, SheetTableData, parseSmartDimensions, cleanPrice } from '@/lib/excelParser';
import { simplifiedToTraditional, containsSimplifiedChinese } from '@/lib/chineseConverter';
// supabase relay import removed — using direct fetch to bypass relay size limits

// ─── Standard Headers (bwf_product_master schema fields) ──────────
// IMPORTANT: These MUST match actual columns in the bwf_product_master table.
// The edge function `upload-to-master-db` maps these directly to DB columns.
export const STANDARD_HEADERS = [
  { value: 'skip', label: '— 跳過 (Skip) —', labelZh: '跳過' },
  // ── Core identification fields ──
  { value: 'model_number', label: 'Model Number (產品型號)', labelZh: '產品型號' },
  { value: 'title', label: 'Title (品名) → title', labelZh: '品名' },
  { value: 'description', label: 'Description (描述) → description', labelZh: '描述' },
  // ── Pricing fields ──
  { value: 'cost_price', label: 'Cost Price (出廠價) → cost_price', labelZh: '出廠價' },
  { value: 'sale_price', label: 'Sale Price (售價) → sale_price', labelZh: '售價' },
  // ── Image fields ──
  { value: 'product_image', label: 'Product Image (產品圖片) → image_url', labelZh: '產品圖片' },
  { value: 'lifestyle_image', label: 'Lifestyle Image (效果圖) → lifestyle_image_url', labelZh: '效果圖' },
  // ── Material & Physical ──
  { value: 'material', label: 'Material (材質描述) → material', labelZh: '材質描述' },
  { value: 'color', label: 'Color (顏色) → color', labelZh: '顏色' },
  // ── Dimensions (stored as mm in DB) — SEPARATE COLUMNS PREFERRED ──
  { value: 'dim_length_mm', label: '長度 → dimension_l_mm', labelZh: '長度' },
  { value: 'dim_width_mm', label: '闊度 → dimension_w_mm', labelZh: '闊度' },
  { value: 'dim_height_mm', label: '高度 → dimension_h_mm', labelZh: '高度' },
  { value: 'dimensions', label: 'Dimensions Combined (尺寸) → splits to 長/闊/高', labelZh: '尺寸(合併)' },
  // ── Classification ──
  { value: 'collection', label: 'Collection/Category (系列) → category', labelZh: '系列' },
  { value: 'factory_name', label: 'Factory Name (工廠名) → factory_name', labelZh: '工廠名' },
  // ── Lead time & Shipping ──
  { value: 'production_lead_time', label: 'Production Lead Time (生產週期) → production_lead_time', labelZh: '生產週期' },
  { value: 'delivery_days', label: 'Delivery Days (交貨天數) → delivery_days', labelZh: '交貨天數' },
  { value: 'shipping_days', label: 'Shipping Days (運輸天數) → shipping_days', labelZh: '運輸天數' },
  { value: 'shipping_fee', label: 'Shipping Fee (運費) → shipping_fee', labelZh: '運費' },
  // ── Other ──
  { value: 'remarks', label: 'Remarks (備註) → remarks', labelZh: '備註' },
  { value: 'delivery_term_ref', label: 'Delivery Term Ref (參考貨期) → delivery_term_name/id', labelZh: '參考貨期' },
  { value: 'index_number', label: 'Row Index (序號) — skip in DB', labelZh: '序號' },
] as const;

export type StandardHeaderValue = (typeof STANDARD_HEADERS)[number]['value'];

// ─── Types ────────────────────────────────────────────────────────
export interface RawExtractedRow {
  /** 0-based Excel row index */
  rowIndex: number;
  /** All cell values for this row (index = column index) */
  cells: (string | number | null)[];
  /** Product image data URI (inherited from merged cells if applicable) */
  productImageData?: string | null;
  /** Lifestyle image data URI */
  lifestyleImageData?: string | null;
  /** Whether this row is flagged as a valid product row */
  isProductRow: boolean;
  /** Whether this row has enough data to be a product (model + dimensions OR price) */
  hasMinimalData: boolean;
}

export interface ExcelPreviewData {
  /** Raw header row texts from Excel (detected automatically) */
  headerLabels: string[];
  /** All extracted rows (including header, pre-data, and product rows) */
  rows: RawExtractedRow[];
  /** Index of the detected header row */
  headerRowIndex: number;
  /** Total columns count */
  columnCount: number;
  /** Sheet names */
  sheetNames: string[];
  /** All extracted images */
  images: ExcelImage[];
  /** Factory code (for display) */
  factoryCode: string;
  /** The raw ArrayBuffer for re-processing */
  rawArrayBuffer: ArrayBuffer;
  /** Per-sheet independent data for multi-tab UI */
  sheets?: SheetPreviewData[];
}

/** Per-sheet data for the multi-tab preview UI */
export interface SheetPreviewData {
  sheetName: string;
  headerLabels: string[];
  headerRowIndex: number;
  rows: RawExtractedRow[];
  columnCount: number;
}

/** Multi-sheet column mapping — keyed by sheet name */
export interface MultiSheetColumnMapping {
  [sheetName: string]: ColumnMappingState;
}

export interface ColumnMappingState {
  [columnIndex: string]: StandardHeaderValue;
}

/** Unit for dimension parsing. 'auto' = detect from header text; mm/cm/m force the multiplier. */
export type DimUnit = 'auto' | 'mm' | 'cm' | 'm';

/** Per-sheet dimension unit override — keyed by sheet name */
export interface MultiSheetDimUnits {
  [sheetName: string]: DimUnit;
}

/** Action type for the three-way action buttons */
export type PreviewAction = 'queue-shopify' | 'catalog-only' | 'discard';

interface ExcelPreviewTableProps {
  previewData: ExcelPreviewData;
  onGenerateCatalog: (mapping: ColumnMappingState, selectedRows: number[], multiSheetMapping?: MultiSheetColumnMapping, imageOverrides?: Record<string, string>, multiSheetDimUnits?: MultiSheetDimUnits) => void;
  /** New three-way action handler: passes action type, mapping, selected rows, product names, image overrides, and multi-sheet mapping */
  onAction?: (action: PreviewAction, mapping: ColumnMappingState, selectedRows: number[], productNames: Record<string, string>, multiSheetMapping?: MultiSheetColumnMapping, imageOverrides?: Record<string, string>, multiSheetDimUnits?: MultiSheetDimUnits) => void;
  /** Called when rows are discarded/removed from the preview — parent should remove from data */
  onRowsDiscarded?: (rowIndices: number[]) => void;
  /** Called when a cell value is edited inline — parent updates preview data */
  onCellEdit?: (sheetName: string, rowIndex: number, colIdx: number, value: string) => void;
  onCancel: () => void;
  isGenerating: boolean;
}

// ─── Auto-detect column mappings from header text ─────────────────
/**
 * Detect a column that holds dimensions by inspecting cell data.
 * A column qualifies when ≥40% of non-empty cells contain a dimension-like
 * pattern (two or three numbers joined by * × x or /), and no other column
 * was already mapped to 'dimensions'.
 * Returns the 0-based column index, or -1 if none qualifies.
 */
function detectDimensionsColumnFromData(
  rows: RawExtractedRow[],
  columnCount: number,
  mapping: ColumnMappingState,
  headers?: string[],
): number {
  // Skip if a dimensions/dim_* mapping already exists
  for (const v of Object.values(mapping)) {
    if (v === 'dimensions' || v === 'dim_length_mm' || v === 'dim_width_mm' || v === 'dim_height_mm') {
      return -1;
    }
  }
  // Headers that LOOK like dimensions (numbers × numbers in cells) but are NOT product dimensions:
  // 包装规格/包裝規格 = packaging spec; 纸箱/紙箱 = carton box; 净重 = net weight; 毛重 = gross weight; etc.
  const EXCLUDE_HEADER_RE = /包[装裝]|包裝規格|纸箱|紙箱|净重|淨重|毛重|重量|箱規|箱规|carton|packaging|gross\s*weight|net\s*weight/i;
  // A cell counts as a dimension if it matches either the positional form
  // (e.g. "550*600*830") or the labeled-Chinese form (e.g. "座高：46\n座宽：48").
  const DIM_RE = /\d{2,4}\s*[*×xX/]\s*\d{2,4}(?:\s*[*×xX/]\s*\d{2,4})?/;
  const LABELED_DIM_RE = /(座高|总高|總高|椅高|高度|座宽|座寬|椅宽|椅寬|总宽|總寬|宽度|寬度|座深|总深|總深|深度)\s*[：:=]\s*\d/;
  let bestCol = -1;
  let bestRatio = 0;
  for (let c = 0; c < columnCount; c++) {
    if (mapping[c] && mapping[c] !== 'skip') continue;
    const headerText = headers?.[c]?.trim() || '';
    if (headerText && EXCLUDE_HEADER_RE.test(headerText)) continue;
    let nonEmpty = 0;
    let dimMatches = 0;
    for (const row of rows) {
      const cell = row.cells?.[c];
      if (cell === null || cell === undefined) continue;
      const s = String(cell).trim();
      if (!s) continue;
      nonEmpty++;
      if (DIM_RE.test(s) || LABELED_DIM_RE.test(s)) dimMatches++;
    }
    if (nonEmpty < 2) continue;
    const ratio = dimMatches / nonEmpty;
    if (ratio >= 0.3 && ratio > bestRatio) {
      bestRatio = ratio;
      bestCol = c;
    }
  }
  return bestCol;
}

function autoDetectMappings(headers: string[], rows?: RawExtractedRow[], columnCount?: number): ColumnMappingState {
  const mapping: ColumnMappingState = {};
  
  const patterns: { field: StandardHeaderValue; regex: RegExp }[] = [
    { field: 'index_number', regex: /^(序号|序號|#|no\.?|index)$/i },
    { field: 'model_number', regex: /model|型號|型号|貨號|货号|item\s*no|product\s*code|sku|产品型号/i },
    { field: 'title', regex: /^(name|品名|產品名|产品名|產品名稱|产品名称|product\s*name|item\s*name)$/i },
    { field: 'description', regex: /desc|說明|说明|note/i },
    { field: 'cost_price', regex: /price|單價|单价|unit\s*price|cost|報價|报价|FOB|出廠價|出厂价/i },
    { field: 'sale_price', regex: /sale\s*price|售價|售价|零售价|retail/i },
    { field: 'product_image', regex: /产品图片|產品圖片|product\s*image|photo|白底|单图|單圖|产品图|產品圖/i },
    { field: 'lifestyle_image', regex: /效果图|效果圖|lifestyle|scene\s*image|场景图|場景圖/i },
    { field: 'material', regex: /material|材質|材质|用料|fabric|面料|材质描述/i },
    { field: 'color', regex: /color|colour|顏色|颜色|色/i },
    { field: 'dimensions', regex: /dimension|尺寸|size|規格|规格|長寬高|长宽高|L\*W\*H|W\*D\*H/i },
    { field: 'dim_length_mm', regex: /^(L|length|長|长|長度|长度|長度?\s*[\(（]?\s*[mc]m\s*[\)）]?|长度?\s*[\(（]?\s*[mc]m\s*[\)）]?)$/i },
    { field: 'dim_width_mm', regex: /^(W|width|寬|宽|寬度|宽度|闊|闊度?\s*[\(（]?\s*[mc]m\s*[\)）]?|寬度?\s*[\(（]?\s*[mc]m\s*[\)）]?|宽度?\s*[\(（]?\s*[mc]m\s*[\)）]?)$/i },
    { field: 'dim_height_mm', regex: /^(H|height|高|高度|高度?\s*[\(（]?\s*[mc]m\s*[\)）]?)$/i },
    { field: 'collection', regex: /series|系列|collection|category|類別|类别/i },
    { field: 'factory_name', regex: /factory|工廠|工厂|manufacturer|供應商|供应商|廠名|厂名/i },
    { field: 'production_lead_time', regex: /lead\s*time|生产周期|生產週期|工期/i },
    { field: 'delivery_days', regex: /delivery\s*day|交期|交貨|交货|到貨|到货/i },
    { field: 'shipping_days', regex: /shipping\s*day|運輸天數|运输天数|船期/i },
    { field: 'shipping_fee', regex: /shipping\s*fee|運費|运费|物流费/i },
    { field: 'remarks', regex: /備註|备注|remark|annotation|附註/i },
    { field: 'delivery_term_ref', regex: /參考貨期|参考货期|貨期|货期/i },
  ];

  const usedFields = new Set<StandardHeaderValue>();

  // Headers we explicitly never auto-map (packaging/weight/config columns can otherwise
  // match 規格/重量/說明 patterns and be misclassified as dimensions/remarks/description).
  // 配置说明 = "configuration notes" — CYJ casual-chair sheets use this for build details
  // we don't want imported.
  const ALWAYS_SKIP_RE = /包[装裝]|纸箱|紙箱|carton|gross\s*weight|net\s*weight|^配置|配置说明|配置說明/i;

  for (let i = 0; i < headers.length; i++) {
    const headerText = (headers[i] || '').trim();
    if (!headerText) {
      mapping[i] = 'skip';
      continue;
    }
    if (ALWAYS_SKIP_RE.test(headerText)) {
      mapping[i] = 'skip';
      continue;
    }

    let matched = false;
    for (const { field, regex } of patterns) {
      if (usedFields.has(field)) continue;
      if (regex.test(headerText)) {
        mapping[i] = field;
        usedFields.add(field);
        matched = true;
        break;
      }
    }
    if (!matched) {
      mapping[i] = 'skip';
    }
  }

  // ── Data-based dimensions fallback ──
  // If no column was matched to 'dimensions' via header text, scan row data
  // for a column whose cells contain L*W*H-style values (e.g. "550*600*830").
  // Without this, the 3-column split (長/闊/高) won't trigger when headers
  // are missing or non-standard.
  if (rows && columnCount && !Object.values(mapping).includes('dimensions')) {
    const dimCol = detectDimensionsColumnFromData(rows, columnCount, mapping, headers);
    if (dimCol >= 0) {
      mapping[dimCol] = 'dimensions';
    }
  }

  // Pre-set image column mappings (special keys for the thumbnail columns)
  mapping['__img_product' as any] = 'product_image';
  mapping['__img_lifestyle' as any] = 'lifestyle_image';
  // Pre-set AI product name column mapping to 'title'
  mapping['__ai_product_name' as any] = 'title';

  return mapping;
}

// ─── Image Override Modal Component ─────────────────────────────────
interface ImageOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentImage: string | null;
  onConfirm: (newImage: string) => void;
  mode: 'replace' | 'add';
}

function ImageOverrideModal({ isOpen, onClose, currentImage, onConfirm, mode }: ImageOverrideModalProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(currentImage);
  const [isDragging, setIsDragging] = useState(false);
  const [isReplacing, setIsReplacing] = useState(mode === 'add');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPreviewImage(currentImage);
    setIsReplacing(mode === 'add');
  }, [currentImage, mode, isOpen]);

  // Handle clipboard paste
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              setPreviewImage(ev.target?.result as string);
              setIsReplacing(true);
            };
            reader.readAsDataURL(file);
          }
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPreviewImage(ev.target?.result as string);
        setIsReplacing(true);
      };
      reader.readAsDataURL(files[0]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPreviewImage(ev.target?.result as string);
        setIsReplacing(true);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleConfirm = () => {
    if (previewImage) {
      onConfirm(previewImage);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-[Syne] font-bold text-lg text-foreground">
            {mode === 'replace' ? '圖片管理' : '新增圖片'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Image Preview / Drop Zone */}
        {(!isReplacing && previewImage) ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={previewImage}
              alt="Current image"
              className="max-h-[300px] max-w-full rounded-xl object-contain border border-white/10"
            />
          </div>
        ) : (
          <div
            ref={dropZoneRef}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-all min-h-[200px]',
              isDragging
                ? 'border-indigo-400 bg-indigo-500/10 scale-[1.02]'
                : previewImage
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-muted-foreground/30 bg-muted/30 hover:border-indigo-400/50 hover:bg-indigo-500/5',
            )}
          >
            {previewImage ? (
              <img
                src={previewImage}
                alt="New image"
                className="max-h-[200px] max-w-full rounded-lg object-contain"
              />
            ) : (
              <div className="contents">
                <Upload className="w-8 h-8 text-muted-foreground/50" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-[Manrope] text-muted-foreground">
                    拖放圖片到此處 或 點擊選擇
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    也支援 <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-xs">Ctrl+V</kbd> 貼上剪貼簿圖片
                  </p>
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {mode === 'replace' && !isReplacing && (
            <Button
              variant="outline"
              onClick={() => setIsReplacing(true)}
              className="gap-2 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              更換
            </Button>
          )}
          <Button
            onClick={handleConfirm}
            disabled={!previewImage || (!isReplacing && mode === 'add')}
            className="gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            <CheckCircle2 className="w-4 h-4" />
            確定
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── AI Product Name Generator Helper ─────────────────────────────

/**
 * Resize a base64 image to max dimensions to reduce payload size.
 * Returns a compressed JPEG base64 string (without the data: prefix).
 */
async function resizeImageForAI(dataUri: string, maxDim: number = 512): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      // Only downscale if larger than maxDim
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      // Use JPEG at 0.7 quality for minimal size
      const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const base64 = resizedDataUrl.split(',')[1] || '';
      resolve({ base64, mime: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Image load failed for resize'));
    img.src = dataUri;
  });
}

async function generateProductName(
  imageDataUri: string,
  modelNumber: string,
  existingTitle?: string,
): Promise<string> {
  // Resize image to reduce payload (max 512px, JPEG quality 0.7)
  // This brings typical images from 1-5MB down to 30-100KB
  let base64Data: string;
  let mimeType: string;
  
  try {
    const resized = await resizeImageForAI(imageDataUri, 512);
    base64Data = resized.base64;
    mimeType = resized.mime;
  } catch {
    // Fallback: use original but strip prefix
    base64Data = imageDataUri.split(',')[1] || '';
    mimeType = imageDataUri.match(/data:(.*?);/)?.[1] || 'image/jpeg';
  }

  // Payload size check — if still too large after resize, skip the image
  const estimatedPayloadBytes = Math.ceil((base64Data.length * 3) / 4);
  if (estimatedPayloadBytes > 4 * 1024 * 1024) {
    console.warn(`[AI Name] Image still too large after resize (${(estimatedPayloadBytes / 1024 / 1024).toFixed(1)}MB), skipping image`);
    throw new Error('Image too large for AI naming. Try a smaller image.');
  }

  const contents = [
    {
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Data,
          },
        },
        {
          text: `You are a furniture product categorization expert for the Hong Kong market. Analyze this product image and identify the furniture category.

Rules:
1. Output format: ${modelNumber} [Hong Kong Traditional Chinese Category] [English Category]
2. The Chinese category MUST be in Hong Kong Traditional Chinese (繁體中文), NOT Simplified Chinese.
3. The category should accurately describe what type of furniture this is (e.g., 辦公椅, 會議桌, 文件櫃, 梳化, 書架, 餐枱, 吧椅, 屏風工作位)
4. Add a style or key design descriptor before the category (e.g., 人體工學辦公椅, 圓形會議桌, 真皮梳化)
5. The English category should match (e.g., Ergonomic Office Chair, Round Conference Table, Leather Sofa)
6. Keep it concise: 3-8 Chinese characters, 2-5 English words

Model Number: ${modelNumber}
${existingTitle ? `Existing title hint: ${existingTitle}` : ''}

Return ONLY the result in format: ${modelNumber} [TraditionalChineseCategory] [EnglishCategory]
Do not add quotes, brackets, or extra formatting. Example: ABC-123 人體工學辦公椅 Ergonomic Office Chair`,
        },
      ],
    },
  ];

  // Use direct fetch to bypass Supabase relay's ~6MB body limit
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const fnUrl = `${supabaseUrl}/functions/v1/supabase-functions-gemini-proxy`;
  
  const payload = JSON.stringify({ model: 'gemini-2.5-flash', contents });
  const payloadSizeKB = Math.round(payload.length / 1024);
  console.log(`[AI Name] Sending request: ${payloadSizeKB}KB payload to gemini-proxy (direct fetch, bypass relay)`);

  const response = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'apikey': supabaseAnonKey,
    },
    body: payload,
  });

  if (!response.ok) {
    let errorDetail: string;
    try {
      const errData = await response.json();
      errorDetail = errData?.error || JSON.stringify(errData);
    } catch {
      errorDetail = `HTTP ${response.status}`;
    }
    throw new Error(`AI naming error (${response.status}): ${errorDetail}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No response from AI');
  }

  return text.trim();
}

// ─── Component ────────────────────────────────────────────────────
export function ExcelPreviewTable({
  previewData,
  onGenerateCatalog,
  onAction,
  onRowsDiscarded,
  onCellEdit,
  onCancel,
  isGenerating,
}: ExcelPreviewTableProps) {
  const { sheetNames, sheets } = previewData;
  const hasMultipleSheets = (sheets && sheets.length > 1) || sheetNames.length > 1;

  // ─── Multi-Sheet State ──────────────────────────────────────────
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);

  // Build per-sheet data source. If `sheets` is provided (new multi-sheet extraction), use it.
  // Otherwise fall back to legacy single-sheet mode.
  const sheetDataList: Array<{
    sheetName: string;
    headerLabels: string[];
    rows: RawExtractedRow[];
    columnCount: number;
  }> = useMemo(() => {
    if (sheets && sheets.length > 0) {
      return sheets.map(s => ({
        sheetName: s.sheetName,
        headerLabels: s.headerLabels,
        rows: s.rows,
        columnCount: s.columnCount,
      }));
    }
    // Legacy fallback — single sheet
    return [{
      sheetName: sheetNames[0] || 'Sheet 1',
      headerLabels: previewData.headerLabels,
      rows: previewData.rows,
      columnCount: previewData.columnCount,
    }];
  }, [sheets, sheetNames, previewData]);

  const activeSheet = sheetDataList[activeSheetIdx] || sheetDataList[0];

  // ─── Per-Sheet Column Mapping State ─────────────────────────────
  const [multiSheetMappings, setMultiSheetMappings] = useState<MultiSheetColumnMapping>(() => {
    // Auto-detect initially; async restore from IndexedDB will override if available
    const mappings: MultiSheetColumnMapping = {};
    for (const sd of sheetDataList) {
      mappings[sd.sheetName] = autoDetectMappings(sd.headerLabels, sd.rows, sd.columnCount);
    }
    return mappings;
  });

  // Restore mappings from IndexedDB on mount (sanitize stale values)
  useEffect(() => {
    const validValues = new Set(STANDARD_HEADERS.map(h => h.value));
    (async () => {
      const saved = await loadMappings();
      if (saved && typeof saved === 'object' && sheetDataList.some(sd => saved[sd.sheetName])) {
        // Sanitize: replace any persisted values that no longer exist in STANDARD_HEADERS
        const sanitized: MultiSheetColumnMapping = {};
        for (const [sheetName, mapping] of Object.entries(saved)) {
          const cleanMapping: ColumnMappingState = {};
          for (const [key, val] of Object.entries(mapping as Record<string, string>)) {
            cleanMapping[key] = validValues.has(val as StandardHeaderValue) ? (val as StandardHeaderValue) : 'skip';
          }
          // If the restored mapping has no 'dimensions' nor any dim_* axis,
          // run data-based dimension detection so columns like 550*600*830
          // are still split into 長/闊/高 even when older saved mappings exist.
          const hasDimMapping = Object.values(cleanMapping).some(v =>
            v === 'dimensions' || v === 'dim_length_mm' || v === 'dim_width_mm' || v === 'dim_height_mm'
          );
          if (!hasDimMapping) {
            const sd = sheetDataList.find(s => s.sheetName === sheetName);
            if (sd) {
              const dimCol = detectDimensionsColumnFromData(sd.rows, sd.columnCount, cleanMapping, sd.headerLabels);
              if (dimCol >= 0) cleanMapping[dimCol] = 'dimensions';
            }
          }
          sanitized[sheetName] = cleanMapping;
        }
        setMultiSheetMappings(sanitized);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist mappings to IndexedDB on change
  useEffect(() => {
    saveMappings(multiSheetMappings);
  }, [multiSheetMappings]);

  // ─── Per-Sheet Dimension Unit Override ──────────────────────────
  // 'auto' = detect from header (legacy behaviour); mm/cm/m force the multiplier.
  // Default to 'mm' so factories whose Excels are already in MM (e.g. CYJ) don't
  // get silently 10× upscaled when the header lacks a unit keyword.
  const [multiSheetDimUnits, setMultiSheetDimUnits] = useState<MultiSheetDimUnits>(() => {
    const units: MultiSheetDimUnits = {};
    for (const sd of sheetDataList) {
      units[sd.sheetName] = 'mm';
    }
    return units;
  });

  const currentDimUnit: DimUnit = multiSheetDimUnits[activeSheet.sheetName] || 'mm';
  const dimUnitOverride: 'mm' | 'cm' | 'm' | undefined = currentDimUnit === 'auto' ? undefined : currentDimUnit;

  const handleDimUnitChange = useCallback((unit: DimUnit) => {
    setMultiSheetDimUnits(prev => ({ ...prev, [activeSheet.sheetName]: unit }));
  }, [activeSheet.sheetName]);

  const currentMapping = multiSheetMappings[activeSheet.sheetName] || {};

  // ─── Per-Sheet Row Selection State ──────────────────────────────
  const [multiSheetSelections, setMultiSheetSelections] = useState<Record<string, Set<number>>>(() => {
    const selections: Record<string, Set<number>> = {};
    for (const sd of sheetDataList) {
      selections[sd.sheetName] = new Set<number>();
    }
    return selections;
  });

  const currentSelection = multiSheetSelections[activeSheet.sheetName] || new Set<number>();

  // ─── Auto-switch to next non-empty sheet when current sheet becomes empty or is removed ───
  useEffect(() => {
    // Guard: if activeSheetIdx is out of bounds (sheets were aggressively removed), 
    // find the first sheet with actionable data, or fall back to 0
    if (activeSheetIdx >= sheetDataList.length) {
      const firstWithData = sheetDataList.findIndex(sd => sd.rows.some(r => r.hasMinimalData));
      setActiveSheetIdx(firstWithData !== -1 ? firstWithData : 0);
      return;
    }

    // Check if the current active sheet still has actionable rows
    const currentRows = activeSheet.rows.filter(r => r.hasMinimalData);
    if (currentRows.length === 0 && sheetDataList.length > 1) {
      // Current sheet is empty — find the next sheet with actionable rows
      // Prefer the next sheet in order, wrap around if needed
      let nextIdx = -1;
      for (let i = 1; i < sheetDataList.length; i++) {
        const candidate = (activeSheetIdx + i) % sheetDataList.length;
        if (sheetDataList[candidate].rows.filter(r => r.hasMinimalData).length > 0) {
          nextIdx = candidate;
          break;
        }
      }
      if (nextIdx !== -1) {
        setActiveSheetIdx(nextIdx);
      }
    }
  }, [activeSheet.rows, sheetDataList, activeSheetIdx]);

  // ─── Clean up stale selections when previewData rows change (after burn-down) ───
  useEffect(() => {
    setMultiSheetSelections(prev => {
      const next = { ...prev };
      let changed = false;
      const validSheetNames = new Set(sheetDataList.map(sd => sd.sheetName));

      // Remove selections for sheets that no longer exist
      for (const sheetName of Object.keys(next)) {
        if (!validSheetNames.has(sheetName)) {
          delete next[sheetName];
          changed = true;
        }
      }

      // Clean up row selections within remaining sheets
      for (const sd of sheetDataList) {
        const validRowIndices = new Set(sd.rows.filter(r => r.hasMinimalData).map(r => r.rowIndex));
        const currentSel = next[sd.sheetName];
        if (currentSel && currentSel.size > 0) {
          const cleaned = new Set<number>();
          for (const rowIdx of currentSel) {
            if (validRowIndices.has(rowIdx)) {
              cleaned.add(rowIdx);
            }
          }
          if (cleaned.size !== currentSel.size) {
            next[sd.sheetName] = cleaned;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [sheetDataList]);

  // Derived data for active sheet
  const displayRows = useMemo(
    () => activeSheet.rows.filter(r => r.hasMinimalData),
    [activeSheet.rows]
  );

  const mappedCount = useMemo(
    () => Object.entries(currentMapping).filter(([k, v]) => v !== 'skip' && !k.startsWith('__img_')).length,
    [currentMapping]
  );

  // Total selected across ALL sheets
  const totalSelected = useMemo(() => {
    let count = 0;
    for (const sel of Object.values(multiSheetSelections)) {
      count += sel.size;
    }
    return count;
  }, [multiSheetSelections]);

  // Handler: update column mapping for current sheet
  const handleMappingChange = useCallback((colIdx: number | string, value: StandardHeaderValue) => {
    setMultiSheetMappings(prev => ({
      ...prev,
      [activeSheet.sheetName]: { ...prev[activeSheet.sheetName], [colIdx]: value },
    }));
  }, [activeSheet.sheetName]);

  // Handler: reset mappings for current sheet
  const handleResetMappings = useCallback(() => {
    setMultiSheetMappings(prev => ({
      ...prev,
      [activeSheet.sheetName]: autoDetectMappings(activeSheet.headerLabels, activeSheet.rows, activeSheet.columnCount),
    }));
  }, [activeSheet.sheetName, activeSheet.headerLabels]);

  // Handler: toggle row selection for current sheet
  const handleToggleRow = useCallback((rowIndex: number) => {
    setMultiSheetSelections(prev => {
      const current = new Set(prev[activeSheet.sheetName] || []);
      if (current.has(rowIndex)) {
        current.delete(rowIndex);
      } else {
        current.add(rowIndex);
      }
      return { ...prev, [activeSheet.sheetName]: current };
    });
  }, [activeSheet.sheetName]);

  // Handler: select all / deselect all for current sheet
  const handleSelectAll = useCallback(() => {
    setMultiSheetSelections(prev => {
      const current = prev[activeSheet.sheetName] || new Set<number>();
      const allSelected = displayRows.every(r => current.has(r.rowIndex));
      if (allSelected) {
        return { ...prev, [activeSheet.sheetName]: new Set<number>() };
      } else {
        return { ...prev, [activeSheet.sheetName]: new Set(displayRows.map(r => r.rowIndex)) };
      }
    });
  }, [activeSheet.sheetName, displayRows]);

  // ─── Image Override State (declared early to avoid initialization errors) ──
  // Override image store: key = `${sheetName}:${rowIndex}:${type}`
  const [imageOverrides, setImageOverrides] = useState<Record<string, string>>({});

  // Handler: generate catalog — passes mapping for current sheet PLUS multi-sheet mapping
  const handleGenerate = useCallback(() => {
    // Collect all selected rows across all sheets
    const allSelectedRows: number[] = [];
    for (const sd of sheetDataList) {
      const sel = multiSheetSelections[sd.sheetName];
      if (sel) {
        for (const rowIdx of sel) {
          allSelectedRows.push(rowIdx);
        }
      }
    }
    // Pass current sheet mapping for backward compat, plus multi-sheet mapping, imageOverrides, and dim units
    onGenerateCatalog(currentMapping, allSelectedRows, multiSheetMappings, imageOverrides, multiSheetDimUnits);
  }, [currentMapping, multiSheetSelections, multiSheetMappings, sheetDataList, onGenerateCatalog, imageOverrides, multiSheetDimUnits]);

  // ─── AI Product Name State (declared early to avoid initialization errors) ──
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [generatingNames, setGeneratingNames] = useState<Record<string, boolean>>({});
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);

  // Handler: three-way action buttons
  const handleAction = useCallback((action: PreviewAction) => {
    if (action === 'discard') {
      // Collect all selected row indices across all sheets
      const discardedRows: number[] = [];
      for (const sd of sheetDataList) {
        const sel = multiSheetSelections[sd.sheetName];
        if (sel) {
          for (const rowIdx of sel) {
            discardedRows.push(rowIdx);
          }
        }
      }
      
      if (discardedRows.length === 0) return;
      
      // Clear selections ONLY for the discarded rows (not all sheets)
      const discardedSet = new Set(discardedRows);
      setMultiSheetSelections(prev => {
        const next = { ...prev };
        for (const sd of sheetDataList) {
          const currentSel = prev[sd.sheetName];
          if (currentSel && currentSel.size > 0) {
            const remaining = new Set<number>();
            for (const rowIdx of currentSel) {
              if (!discardedSet.has(rowIdx)) {
                remaining.add(rowIdx);
              }
            }
            next[sd.sheetName] = remaining;
          }
        }
        return next;
      });
      
      // Notify parent to remove these rows from preview data (burn-down)
      if (onRowsDiscarded) {
        onRowsDiscarded(discardedRows);
      }
      return;
    }

    // Collect all selected rows across all sheets
    const allSelectedRows: number[] = [];
    for (const sd of sheetDataList) {
      const sel = multiSheetSelections[sd.sheetName];
      if (sel) {
        for (const rowIdx of sel) {
          allSelectedRows.push(rowIdx);
        }
      }
    }

    if (allSelectedRows.length === 0) return;

    if (onAction) {
      onAction(action, currentMapping, allSelectedRows, productNames, multiSheetMappings, imageOverrides, multiSheetDimUnits);
    } else {
      // Fallback: use legacy onGenerateCatalog for backward compat
      onGenerateCatalog(currentMapping, allSelectedRows, multiSheetMappings, imageOverrides, multiSheetDimUnits);
    }
  }, [currentMapping, multiSheetSelections, multiSheetMappings, sheetDataList, onAction, onGenerateCatalog, productNames, onRowsDiscarded, imageOverrides, multiSheetDimUnits]);

  // Visible columns for current sheet
  const visibleColumns = useMemo(() => {
    const cols: number[] = [];
    for (let c = 0; c < activeSheet.columnCount; c++) {
      const hasData = displayRows.some(r => {
        const val = r.cells[c];
        return val !== null && val !== undefined && String(val).trim() !== '';
      });
      if (hasData) cols.push(c);
    }
    return cols;
  }, [activeSheet.columnCount, displayRows]);

  // ─── Parsed Dimension Values (Smart Parse for Preview Display) ─────
  // When a column is mapped to 'dimensions' (combined), parse L/W/H for display.
  // Also handles dim_length_mm, dim_width_mm, dim_height_mm columns.
  // Key: `${rowIndex}:${field}` → parsed numeric string
  const parsedDimensionCells = useMemo(() => {
    const result: Record<string, string> = {};
    
    // Find which columns are mapped to dimension-related fields
    const dimCombinedCol = Object.entries(currentMapping).find(([k, v]) => v === 'dimensions' && !k.startsWith('__'))?.[0];
    const dimLMmCol = Object.entries(currentMapping).find(([k, v]) => v === 'dim_length_mm' && !k.startsWith('__'))?.[0];
    const dimWMmCol = Object.entries(currentMapping).find(([k, v]) => v === 'dim_width_mm' && !k.startsWith('__'))?.[0];
    const dimHMmCol = Object.entries(currentMapping).find(([k, v]) => v === 'dim_height_mm' && !k.startsWith('__'))?.[0];

    // If there's a combined dimensions column, parse it for each row and provide
    // virtual L/W/H values for display in that column's cell
    if (dimCombinedCol !== undefined) {
      const colIdx = Number(dimCombinedCol);
      // Get the header text for smart unit detection
      const headerText = activeSheet.headerLabels[colIdx] || '';

      for (const row of displayRows) {
        const rawVal = row.cells[colIdx];
        if (rawVal === null || rawVal === undefined) continue;
        const rawStr = String(rawVal).trim();
        if (!rawStr) continue;

        const parsed = parseSmartDimensions(rawStr, headerText, dimUnitOverride);
        // Store parsed values keyed by row:field
        // For the combined column cell itself, show "長×闊×高" parsed with mm labels
        const parts: string[] = [];
        if (parsed.l !== null) parts.push(`長:${parsed.l}`);
        if (parsed.w !== null) parts.push(`闊:${parsed.w}`);
        if (parsed.h !== null) parts.push(`高:${parsed.h}`);
        result[`${row.rowIndex}:dim_combined_display:${colIdx}`] = parts.length > 0 ? parts.join(' × ') + ' mm' : rawStr;
        
        // Also store individual L/W/H so if there's no separate dim_*_mm columns,
        // we can display them as virtual resolved values
        if (parsed.l !== null) result[`${row.rowIndex}:dim_l`] = String(parsed.l);
        if (parsed.w !== null) result[`${row.rowIndex}:dim_w`] = String(parsed.w);
        if (parsed.h !== null) result[`${row.rowIndex}:dim_h`] = String(parsed.h);
      }
    }
    
    // For mm fields, display as plain number (no suffix)
    // ALSO handle complex dimension strings (e.g., "60/70/80*75") by parsing via parseSmartDimensions
    if (dimLMmCol !== undefined) {
      const colIdx = Number(dimLMmCol);
      const headerText = activeSheet.headerLabels[colIdx] || '';
      for (const row of displayRows) {
        const rawVal = row.cells[colIdx];
        if (rawVal === null || rawVal === undefined) continue;
        const rawStr = String(rawVal).trim();
        if (!rawStr) continue;
        
        // If it contains slashes, asterisks, or newlines, it's a complex dimension string → parse it
        if (rawStr.includes('/') || rawStr.includes('*') || rawStr.includes('×') || rawStr.includes('\n')) {
          const parsed = parseSmartDimensions(rawStr, headerText);
          if (parsed.l !== null) {
            result[`${row.rowIndex}:dim_display:${colIdx}`] = String(parsed.l);
          }
        } else {
          const num = typeof rawVal === 'number' ? rawVal : parseFloat(rawStr.replace(/[,$¥￥]/g, ''));
          if (!isNaN(num)) {
            result[`${row.rowIndex}:dim_display:${colIdx}`] = String(Math.round(num));
          }
        }
      }
    }
    if (dimWMmCol !== undefined) {
      const colIdx = Number(dimWMmCol);
      const headerText = activeSheet.headerLabels[colIdx] || '';
      for (const row of displayRows) {
        const rawVal = row.cells[colIdx];
        if (rawVal === null || rawVal === undefined) continue;
        const rawStr = String(rawVal).trim();
        if (!rawStr) continue;
        
        if (rawStr.includes('/') || rawStr.includes('*') || rawStr.includes('×') || rawStr.includes('\n')) {
          const parsed = parseSmartDimensions(rawStr, headerText);
          if (parsed.w !== null) {
            result[`${row.rowIndex}:dim_display:${colIdx}`] = String(parsed.w);
          }
        } else {
          const num = typeof rawVal === 'number' ? rawVal : parseFloat(rawStr.replace(/[,$¥￥]/g, ''));
          if (!isNaN(num)) {
            result[`${row.rowIndex}:dim_display:${colIdx}`] = String(Math.round(num));
          }
        }
      }
    }
    if (dimHMmCol !== undefined) {
      const colIdx = Number(dimHMmCol);
      const headerText = activeSheet.headerLabels[colIdx] || '';
      for (const row of displayRows) {
        const rawVal = row.cells[colIdx];
        if (rawVal === null || rawVal === undefined) continue;
        const rawStr = String(rawVal).trim();
        if (!rawStr) continue;
        
        if (rawStr.includes('/') || rawStr.includes('*') || rawStr.includes('×') || rawStr.includes('\n')) {
          const parsed = parseSmartDimensions(rawStr, headerText);
          if (parsed.h !== null) {
            result[`${row.rowIndex}:dim_display:${colIdx}`] = String(parsed.h);
          }
        } else {
          const num = typeof rawVal === 'number' ? rawVal : parseFloat(rawStr.replace(/[,$¥￥]/g, ''));
          if (!isNaN(num)) {
            result[`${row.rowIndex}:dim_display:${colIdx}`] = String(Math.round(num));
          }
        }
      }
    }
    
    return result;
  }, [currentMapping, displayRows, activeSheet.headerLabels, dimUnitOverride]);

  // ── Parsed Price Cells (價格取大值) ──────────────────────────────────
  // For columns mapped to cost_price or sale_price, apply cleanPrice (取大值) for display.
  // e.g., "680/750/820" → "820"
  const parsedPriceCells = useMemo(() => {
    const result: Record<string, string> = {};
    
    const costPriceCol = Object.entries(currentMapping).find(([k, v]) => v === 'cost_price' && !k.startsWith('__'))?.[0];
    const salePriceCol = Object.entries(currentMapping).find(([k, v]) => v === 'sale_price' && !k.startsWith('__'))?.[0];
    
    const priceColumns = [costPriceCol, salePriceCol].filter(Boolean) as string[];
    
    for (const col of priceColumns) {
      const colIdx = Number(col);
      for (const row of displayRows) {
        const rawVal = row.cells[colIdx];
        if (rawVal === null || rawVal === undefined) continue;
        
        // Pass raw value directly to cleanPrice to preserve type information
        // (cleanPrice handles both string and number types with concatenation detection)
        const cleaned = cleanPrice(rawVal);
        if (cleaned !== null) {
          result[`${row.rowIndex}:price_display:${colIdx}`] = String(cleaned);
        }
      }
    }
    
    return result;
  }, [currentMapping, displayRows]);

  // ── Virtual Dimension Columns (3 columns replacing combined) ─────────
  // When a column is mapped to 'dimensions' (combined), we inject 3 virtual columns
  // for 長度 (mm), 闊度 (mm), 高度 (mm) INSTEAD of showing the combined cell.
  const dimCombinedColIdx = useMemo(() => {
    const entry = Object.entries(currentMapping).find(([k, v]) => v === 'dimensions' && !k.startsWith('__'));
    return entry ? Number(entry[0]) : null;
  }, [currentMapping]);

  // Enlarged image state
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

  // ─── Inline cell editing ───────────────────────────────────────────
  // key = `${rowIndex}:${colIdx}` for the cell currently being edited
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = useCallback((rowIndex: number, colIdx: number, current: string) => {
    setEditingCell(`${rowIndex}:${colIdx}`);
    setEditValue(current);
  }, []);

  const commitEdit = useCallback((rowIndex: number, colIdx: number) => {
    onCellEdit?.(activeSheet.sheetName, rowIndex, colIdx, editValue);
    setEditingCell(null);
  }, [onCellEdit, activeSheet.sheetName, editValue]);

  // ─── Image Override State ──────────────────────────────────────────
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageModalTarget, setImageModalTarget] = useState<{
    rowIndex: number;
    type: 'product' | 'lifestyle';
    currentImage: string | null;
    mode: 'replace' | 'add';
  } | null>(null);

  // Check if current sheet has images (including overrides)
  const hasAnyProductImage = useMemo(
    () => displayRows.some(r => r.productImageData) || Object.keys(imageOverrides || {}).some(k => k.includes(`:product`)),
    [displayRows, imageOverrides]
  );
  const hasAnyLifestyleImage = useMemo(
    () => displayRows.some(r => r.lifestyleImageData) || Object.keys(imageOverrides || {}).some(k => k.includes(`:lifestyle`)),
    [displayRows, imageOverrides]
  );

  // Column letter helper
  const colLetter = (idx: number) => {
    if (idx < 26) return String.fromCharCode(65 + idx);
    return String.fromCharCode(64 + Math.floor(idx / 26)) + String.fromCharCode(65 + (idx % 26));
  };

  const getImageForRow = useCallback((row: RawExtractedRow, type: 'product' | 'lifestyle') => {
    const key = `${activeSheet.sheetName}:${row.rowIndex}:${type}`;
    if (imageOverrides?.[key]) return imageOverrides[key];
    return type === 'product' ? row.productImageData : row.lifestyleImageData;
  }, [activeSheet.sheetName, imageOverrides]);

  const handleImageClick = useCallback((row: RawExtractedRow, type: 'product' | 'lifestyle') => {
    const currentImage = getImageForRow(row, type);
    setImageModalTarget({
      rowIndex: row.rowIndex,
      type,
      currentImage: currentImage || null,
      mode: currentImage ? 'replace' : 'add',
    });
    setImageModalOpen(true);
  }, [getImageForRow]);

  const handleImageConfirm = useCallback((newImage: string) => {
    if (!imageModalTarget) return;
    const key = `${activeSheet.sheetName}:${imageModalTarget.rowIndex}:${imageModalTarget.type}`;
    setImageOverrides(prev => ({ ...prev, [key]: newImage }));
  }, [activeSheet.sheetName, imageModalTarget]);



  // Get model number for a row (from the mapped column)
  const getModelNumber = useCallback((row: RawExtractedRow): string => {
    const modelColIdx = Object.entries(currentMapping).find(([_, v]) => v === 'model_number')?.[0];
    if (modelColIdx && !modelColIdx.startsWith('__')) {
      const val = row.cells[Number(modelColIdx)];
      return val ? String(val).trim() : '';
    }
    return '';
  }, [currentMapping]);

  // Get title for a row (from the mapped column)
  const getTitle = useCallback((row: RawExtractedRow): string => {
    const titleColIdx = Object.entries(currentMapping).find(([_, v]) => v === 'title')?.[0];
    if (titleColIdx && !titleColIdx.startsWith('__')) {
      const val = row.cells[Number(titleColIdx)];
      return val ? String(val).trim() : '';
    }
    return '';
  }, [currentMapping]);

  const handleGenerateProductName = useCallback(async (row: RawExtractedRow) => {
    const nameKey = `${activeSheet.sheetName}:${row.rowIndex}`;
    const image = getImageForRow(row, 'product') || getImageForRow(row, 'lifestyle');
    if (!image) return;

    const modelNumber = getModelNumber(row);
    const title = getTitle(row);

    setGeneratingNames(prev => ({ ...prev, [nameKey]: true }));
    try {
      const generatedName = await generateProductName(image, modelNumber, title);
      setProductNames(prev => ({ ...prev, [nameKey]: generatedName }));
    } catch (err) {
      console.error('[AI Name] Error generating name:', err);
      setProductNames(prev => ({ ...prev, [nameKey]: `❌ ${err instanceof Error ? err.message : 'Error'}` }));
    } finally {
      setGeneratingNames(prev => ({ ...prev, [nameKey]: false }));
    }
  }, [activeSheet.sheetName, getImageForRow, getModelNumber, getTitle]);

  // Batch generate names for all SELECTED rows that have images
  const handleBatchGenerateNames = useCallback(async () => {
    const rowsWithImages = displayRows.filter(row => {
      const isSelected = currentSelection.has(row.rowIndex); // Only process selected rows
      const hasImage = !!(getImageForRow(row, 'product') || getImageForRow(row, 'lifestyle'));
      const nameKey = `${activeSheet.sheetName}:${row.rowIndex}`;
      const alreadyGenerated = !!productNames[nameKey];
      return isSelected && hasImage && !alreadyGenerated;
    });

    if (rowsWithImages.length === 0) return;

    setIsBatchGenerating(true);

    // Process sequentially to avoid rate limiting
    for (const row of rowsWithImages) {
      const nameKey = `${activeSheet.sheetName}:${row.rowIndex}`;
      const image = getImageForRow(row, 'product') || getImageForRow(row, 'lifestyle');
      if (!image) continue;

      const modelNumber = getModelNumber(row);
      const title = getTitle(row);

      setGeneratingNames(prev => ({ ...prev, [nameKey]: true }));
      try {
        const generatedName = await generateProductName(image, modelNumber, title);
        setProductNames(prev => ({ ...prev, [nameKey]: generatedName }));
      } catch (err) {
        console.error('[AI Name Batch] Error generating name for row', row.rowIndex, err);
        setProductNames(prev => ({ ...prev, [nameKey]: `❌ ${err instanceof Error ? err.message : 'Error'}` }));
      } finally {
        setGeneratingNames(prev => ({ ...prev, [nameKey]: false }));
      }

      // Small delay between requests to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    setIsBatchGenerating(false);
  }, [displayRows, activeSheet.sheetName, getImageForRow, getModelNumber, getTitle, productNames, currentSelection]);

  // Count rows eligible for batch generation (only selected rows with images)
  const batchEligibleCount = useMemo(() => {
    return displayRows.filter(row => {
      const isSelected = currentSelection.has(row.rowIndex);
      const hasImage = !!(getImageForRow(row, 'product') || getImageForRow(row, 'lifestyle'));
      const nameKey = `${activeSheet.sheetName}:${row.rowIndex}`;
      const alreadyGenerated = !!productNames[nameKey];
      return isSelected && hasImage && !alreadyGenerated;
    }).length;
  }, [displayRows, activeSheet.sheetName, getImageForRow, productNames, currentSelection]);

  // Determine the "Product Name" column insertion point:
  // After model_number or material columns in visible order
  const productNameInsertIndex = useMemo(() => {
    // Find the last index in visibleColumns that is mapped to model_number, title, or material
    let lastRelevantIdx = -1;
    for (let i = 0; i < visibleColumns.length; i++) {
      const colIdx = visibleColumns[i];
      const mapping = currentMapping[colIdx];
      if (mapping === 'model_number' || mapping === 'material' || mapping === 'title') {
        lastRelevantIdx = i;
      }
    }
    // Insert after the last relevant column, or at position 0 if none found
    return lastRelevantIdx + 1;
  }, [visibleColumns, currentMapping]);

  // Check if all rows have been processed (empty state)
  const allProcessed = displayRows.length === 0;

  if (allProcessed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
        <h3 className="font-semibold text-lg text-foreground font-[Syne]">
          所有產品已處理完成
        </h3>
        <p className="text-sm text-muted-foreground font-[Manrope]">
          All products in this session have been processed. Upload a new file to continue.
        </p>
        <Button
          variant="outline"
          onClick={onCancel}
          className="mt-2"
        >
          <Upload className="w-4 h-4 mr-2" />
          上傳新檔案
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-indigo-500/20 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-500/10">
            <Columns3 className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground font-[Syne]">
              數據預覽 & 欄位對應 (Column Mapping)
            </h3>
            <p className="text-sm text-foreground/70 font-[Manrope]">
              {hasMultipleSheets
                ? '每個工作表獨立處理 — 切換 Tab 查看不同工作表的數據和圖片'
                : '下拉選單對齊每個 Excel 欄位，選擇要映射的 bwf_product_master 欄位'
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="font-mono text-sm font-semibold text-foreground">
            {displayRows.length} 數據行
          </Badge>
          <Badge variant="outline" className="font-mono text-sm font-semibold text-indigo-700 border-indigo-500/50">
            {mappedCount} 欄位已映射
          </Badge>
          <Badge variant="outline" className="font-mono text-sm font-semibold text-emerald-700 border-emerald-600/50">
            {totalSelected} 已選 (全部)
          </Badge>
          {hasAnyProductImage && (
            <Badge variant="outline" className="font-mono text-sm font-semibold text-cyan-700 border-cyan-600/50 gap-1">
              <ImageIcon className="w-3 h-3" /> 產品圖
            </Badge>
          )}
          {hasAnyLifestyleImage && (
            <Badge variant="outline" className="font-mono text-sm font-semibold text-purple-700 border-purple-600/50 gap-1">
              <ImagePlus className="w-3 h-3" /> 效果圖
            </Badge>
          )}
        </div>
      </div>

      {/* ═══ MULTI-SHEET TABS ═══════════════════════════════════════════ */}
      {hasMultipleSheets && (
        <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted/30 p-1 overflow-x-auto">
          {sheetDataList.map((sd, idx) => {
            const sheetSel = multiSheetSelections[sd.sheetName] || new Set();
            const isActive = idx === activeSheetIdx;
            return (
              <button
                key={sd.sheetName}
                onClick={() => setActiveSheetIdx(idx)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-[IBM_Plex_Mono] transition-all whitespace-nowrap',
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                <span className="font-semibold">{sd.sheetName}</span>
                <Badge
                  variant={isActive ? 'secondary' : 'outline'}
                  className={cn(
                    'text-xs px-1.5 py-0 h-4',
                    isActive ? 'bg-white/20 text-white border-white/30' : '',
                  )}
                >
                  {sd.rows.filter(r => r.hasMinimalData).length} rows
                </Badge>
                {sheetSel.size > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs px-1 py-0 h-4',
                      isActive ? 'border-emerald-300/50 text-emerald-200' : 'border-emerald-500/30 text-emerald-400',
                    )}
                  >
                    {sheetSel.size} ✓
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Mapping Summary - Quick Overview (for active sheet) */}
      <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border/50 bg-muted/30 px-4 py-2">
        <span className="text-sm text-foreground font-[Manrope] mr-2 font-medium">
          {hasMultipleSheets && <span className="text-indigo-700">[{activeSheet.sheetName}]</span>} 映射狀態:
        </span>
        {Object.entries(currentMapping)
          .filter(([k, v]) => v !== 'skip' && !k.startsWith('__img_'))
          .map(([colIdx, field]) => (
            <Badge
              key={colIdx}
              variant="secondary"
              className="text-sm font-mono font-semibold text-foreground"
            >
              Col {colLetter(Number(colIdx))} → {STANDARD_HEADERS.find(h => h.value === field)?.labelZh || field}
            </Badge>
          ))}
        {mappedCount === 0 && (
          <span className="text-sm text-foreground/50 italic">尚未映射任何欄位</span>
        )}
        {dimCombinedColIdx !== null && (
          <div className="ml-auto flex items-center gap-1.5 rounded-md border border-emerald-600/50 bg-emerald-500/5 px-2 py-1">
            <span className="text-sm font-mono text-emerald-800 font-medium">尺寸原始單位:</span>
            <Select value={currentDimUnit} onValueChange={(v) => handleDimUnitChange(v as DimUnit)}>
              <SelectTrigger className="h-6 w-[90px] text-sm font-mono border-emerald-600/50 bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mm" className="text-sm">mm (毫米)</SelectItem>
                <SelectItem value="cm" className="text-sm">cm (公分)</SelectItem>
                <SelectItem value="m" className="text-sm">m (米)</SelectItem>
                <SelectItem value="auto" className="text-sm">auto (自動偵測)</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-emerald-700 font-[Manrope]">
              {currentDimUnit === 'mm' && '不放大 ×1'}
              {currentDimUnit === 'cm' && '×10 → mm'}
              {currentDimUnit === 'm' && '×1000 → mm'}
              {currentDimUnit === 'auto' && '依表頭判斷'}
            </span>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleResetMappings}
          className={cn("text-sm", dimCombinedColIdx === null && "ml-auto")}
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          重置映射
        </Button>
      </div>

      {/* Data Table with Column-Aligned Dropdowns */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: 'min(calc(100vh - 320px), 600px)' }}>
          <table className="w-max min-w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
                {/* Row 1: Column mapping dropdowns — DIRECTLY above each data column */}
                <TableRow className="border-b-2 border-indigo-500/30 bg-card/95 backdrop-blur-sm [&>th]:align-middle [&>th]:h-[40px]">
                  {/* Checkbox column */}
                  <TableHead className="w-10 text-center sticky left-0 z-30 bg-card">
                    <Checkbox
                      checked={displayRows.length > 0 && displayRows.every(r => currentSelection.has(r.rowIndex))}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  {/* Row # column */}
                  <TableHead className="w-12 text-center text-sm font-mono text-foreground sticky left-10 z-30 bg-card">
                    <span className="text-foreground/70">Row</span>
                  </TableHead>
                  {/* Product Image column header with mapping dropdown */}
                  {hasAnyProductImage && (
                    <TableHead className="w-[72px] text-center p-1">
                      <Select
                        value={currentMapping['__img_product'] || 'product_image'}
                        onValueChange={(val) => handleMappingChange('__img_product', val as StandardHeaderValue)}
                      >
                        <SelectTrigger className="h-7 text-sm border-cyan-600/50 bg-background/50 font-mono font-semibold text-cyan-800 w-[68px]">
                          <span className="truncate text-sm">
                            {currentMapping['__img_product'] === 'lifestyle_image' ? '效果圖' : currentMapping['__img_product'] === 'skip' ? '跳過' : '產品圖'}
                          </span>
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="product_image" className="text-sm">產品圖片 → image_url</SelectItem>
                          <SelectItem value="lifestyle_image" className="text-sm">效果圖 → lifestyle_image_url</SelectItem>
                          <SelectItem value="skip" className="text-sm">— 跳過 —</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableHead>
                  )}
                  {/* Lifestyle Image column header with mapping dropdown */}
                  {hasAnyLifestyleImage && (
                    <TableHead className="w-[72px] text-center p-1">
                      <Select
                        value={currentMapping['__img_lifestyle'] || 'lifestyle_image'}
                        onValueChange={(val) => handleMappingChange('__img_lifestyle', val as StandardHeaderValue)}
                      >
                        <SelectTrigger className="h-7 text-sm border-purple-600/50 bg-background/50 font-mono font-semibold text-purple-800 w-[68px]">
                          <span className="truncate text-sm">
                            {currentMapping['__img_lifestyle'] === 'product_image' ? '產品圖' : currentMapping['__img_lifestyle'] === 'skip' ? '跳過' : '效果圖'}
                          </span>
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="lifestyle_image" className="text-sm">效果圖 → lifestyle_image_url</SelectItem>
                          <SelectItem value="product_image" className="text-sm">產品圖片 → image_url</SelectItem>
                          <SelectItem value="skip" className="text-sm">— 跳過 —</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableHead>
                  )}
                  {/* Data column dropdowns — with AI Product Name inserted after model_number/material */}
                  {visibleColumns.map((colIdx, arrIdx) => (
                    <React.Fragment key={colIdx}>
                      {/* If this is the combined dimensions column, render 3 virtual column headers instead */}
                      {colIdx === dimCombinedColIdx ? (
                        <>
                          <TableHead className="min-w-[100px] p-1">
                            <div className="h-7 flex items-center justify-center text-sm font-mono font-semibold text-emerald-800 border border-emerald-600/50 rounded bg-emerald-500/5 px-1 relative group">
                              長度 (mm)
                              <button
                                onClick={() => handleMappingChange(colIdx, 'skip' as StandardHeaderValue)}
                                className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-rose-500/80 text-white text-[7px] leading-none hidden group-hover:flex items-center justify-center"
                                title="取消映射"
                              >×</button>
                            </div>
                          </TableHead>
                          <TableHead className="min-w-[100px] p-1">
                            <div className="h-7 flex items-center justify-center text-sm font-mono font-semibold text-emerald-800 border border-emerald-600/50 rounded bg-emerald-500/5 px-1">
                              闊度 (mm)
                            </div>
                          </TableHead>
                          <TableHead className="min-w-[100px] p-1">
                            <div className="h-7 flex items-center justify-center text-sm font-mono font-semibold text-emerald-800 border border-emerald-600/50 rounded bg-emerald-500/5 px-1">
                              高度 (mm)
                            </div>
                          </TableHead>
                        </>
                      ) : (
                      <TableHead className="min-w-[140px] p-1">
                        <Select
                          value={currentMapping[colIdx] || 'skip'}
                          onValueChange={(val) => handleMappingChange(colIdx, val as StandardHeaderValue)}
                        >
                          <SelectTrigger className="h-7 text-xs border-indigo-500/30 bg-background/50 font-mono">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {STANDARD_HEADERS.map(h => (
                              <SelectItem key={h.value} value={h.value} className="text-xs">
                                {h.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableHead>
                      )}
                      {/* Insert AI Product Name column right after the anchor column */}
                      {arrIdx === productNameInsertIndex - 1 && (
                        <TableHead className="min-w-[220px] p-1">
                          <div className="flex items-center gap-1.5">
                            <Select
                              value={currentMapping['__ai_product_name'] || 'title'}
                              onValueChange={(val) => handleMappingChange('__ai_product_name', val as StandardHeaderValue)}
                            >
                              <SelectTrigger className="h-7 text-xs border-amber-500/30 bg-background/50 font-mono flex-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-[300px]">
                                <SelectItem value="title" className="text-xs">Title (品名) → title</SelectItem>
                                <SelectItem value="skip" className="text-xs">— 跳過 —</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBatchGenerating || batchEligibleCount === 0}
                              onClick={handleBatchGenerateNames}
                              className={cn(
                                "h-7 text-xs font-[IBM_Plex_Mono] gap-1 border-amber-500/30 shrink-0",
                                batchEligibleCount > 0
                                  ? "text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 hover:border-amber-600/50"
                                  : "text-muted-foreground/40"
                              )}
                              title={`一鍵生成 ${batchEligibleCount} 個產品名稱 — AI 識別傢俬類別 (需有圖片)`}
                            >
                              {isBatchGenerating ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Wand2 className="w-3 h-3" />
                              )}
                              {isBatchGenerating ? '...' : `(${batchEligibleCount})`}
                            </Button>
                          </div>
                        </TableHead>
                      )}
                    </React.Fragment>
                  ))}
                  {/* Fallback: if productNameInsertIndex is 0 or beyond visible columns, show at end */}
                  {(productNameInsertIndex === 0 || productNameInsertIndex > visibleColumns.length) && (
                    <TableHead className="min-w-[220px] p-1">
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={currentMapping['__ai_product_name'] || 'title'}
                          onValueChange={(val) => handleMappingChange('__ai_product_name', val as StandardHeaderValue)}
                        >
                          <SelectTrigger className="h-7 text-xs border-amber-500/30 bg-background/50 font-mono flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            <SelectItem value="title" className="text-xs">Title (品名) → title</SelectItem>
                            <SelectItem value="skip" className="text-xs">— 跳過 —</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBatchGenerating || batchEligibleCount === 0}
                          onClick={handleBatchGenerateNames}
                          className={cn(
                            "h-7 text-xs font-[IBM_Plex_Mono] gap-1 border-amber-500/30 shrink-0",
                            batchEligibleCount > 0
                              ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 hover:border-amber-400/50"
                              : "text-muted-foreground/40"
                          )}
                          title={`一鍵生成 ${batchEligibleCount} 個產品名稱 — AI 識別傢俬類別 (需有圖片)`}
                        >
                          {isBatchGenerating ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Wand2 className="w-3 h-3" />
                          )}
                          {isBatchGenerating ? '...' : `(${batchEligibleCount})`}
                        </Button>
                      </div>
                    </TableHead>
                  )}
                </TableRow>
                {/* Row 2: Original Excel headers (for reference) */}
                <TableRow className="bg-muted/50 border-b border-border [&>th]:align-middle [&>th]:h-[32px]">
                  <TableHead className="sticky left-0 z-30 bg-muted/50" />
                  <TableHead className="text-center text-sm font-mono text-foreground/60 sticky left-10 z-30 bg-muted/50">
                    #
                  </TableHead>
                  {/* Image column labels — show short reference tags below the dropdowns */}
                  {hasAnyProductImage && (
                    <TableHead className="w-[72px] bg-muted/50 text-center text-sm font-mono text-cyan-700">
                      產品圖
                    </TableHead>
                  )}
                  {hasAnyLifestyleImage && (
                    <TableHead className="w-[72px] bg-muted/50 text-center text-sm font-mono text-purple-700">
                      效果圖
                    </TableHead>
                  )}
                  {visibleColumns.map((colIdx, arrIdx) => (
                    <React.Fragment key={colIdx}>
                      {colIdx === dimCombinedColIdx ? (
                        <>
                          <TableHead className="text-sm font-mono text-emerald-700 px-2">
                            <span className="text-indigo-700">{colLetter(colIdx)}:</span>{' '}
                            <span>dimension_l_mm</span>
                          </TableHead>
                          <TableHead className="text-sm font-mono text-emerald-700 px-2">
                            <span className="text-indigo-700">{colLetter(colIdx)}:</span>{' '}
                            <span>dimension_w_mm</span>
                          </TableHead>
                          <TableHead className="text-sm font-mono text-emerald-700 px-2">
                            <span className="text-indigo-700">{colLetter(colIdx)}:</span>{' '}
                            <span>dimension_h_mm</span>
                          </TableHead>
                        </>
                      ) : (
                      <TableHead className="text-sm font-mono text-foreground/70 px-2 truncate max-w-[160px]">
                        <span className="text-indigo-700">{colLetter(colIdx)}:</span>{' '}
                        <span className="text-foreground">{simplifiedToTraditional(activeSheet.headerLabels[colIdx] || '') || '—'}</span>
                      </TableHead>
                      )}
                      {/* AI Product Name reference header inserted at same position */}
                      {arrIdx === productNameInsertIndex - 1 && (
                        <TableHead className="text-sm font-mono text-amber-600 text-center font-semibold">
                          產品名稱
                        </TableHead>
                      )}
                    </React.Fragment>
                  ))}
                  {/* Fallback position */}
                  {(productNameInsertIndex === 0 || productNameInsertIndex > visibleColumns.length) && (
                    <TableHead className="text-xs font-mono text-amber-400/60 text-center">
                      產品名稱
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>

              <TableBody>
                {displayRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={visibleColumns.length + 4 + (hasAnyProductImage ? 1 : 0) + (hasAnyLifestyleImage ? 1 : 0) + (dimCombinedColIdx !== null ? 2 : 0)}
                      className="text-center py-12 text-foreground/60 font-[Manrope]"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <AlertTriangle className="w-6 h-6 text-amber-400/60" />
                        <span className="text-sm">未偵測到有效產品行 — 請確認 Excel 檔案格式正確</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {displayRows.map((row) => {
                  const isSelected = currentSelection.has(row.rowIndex);
                  const isProductRow = row.isProductRow;
                  return (
                    <TableRow
                      key={`${activeSheet.sheetName}-${row.rowIndex}`}
                      className={cn(
                        'transition-colors h-[52px]',
                        isSelected
                          ? 'bg-indigo-500/5 hover:bg-indigo-500/10'
                          : 'opacity-60 hover:opacity-80',
                        !isProductRow && isSelected && 'bg-amber-500/5',
                      )}
                    >
                      {/* Checkbox */}
                      <TableCell className="text-center sticky left-0 z-10 bg-card p-1">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleRow(row.rowIndex)}
                        />
                      </TableCell>
                      {/* Row number */}
                      <TableCell className="text-center text-sm font-mono text-foreground/70 sticky left-10 z-10 bg-card p-1">
                        {row.rowIndex}
                      </TableCell>
                      {/* Product Image Thumbnail — with override support */}
                      {hasAnyProductImage && (
                        <TableCell className="text-center p-1">
                          {(() => {
                            const img = getImageForRow(row, 'product');
                            return img ? (
                              <div className="w-12 h-12 mx-auto rounded border border-cyan-500/30 overflow-hidden cursor-pointer hover:scale-110 transition-transform hover:border-cyan-400 hover:shadow-lg hover:shadow-cyan-500/10"
                                onClick={() => handleImageClick(row, 'product')}
                              >
                                <img
                                  src={img}
                                  alt={`Product Row ${row.rowIndex}`}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div
                                className="w-12 h-12 flex items-center justify-center rounded border border-dashed border-border/30 mx-auto cursor-cell hover:border-indigo-400/50 hover:bg-indigo-500/5 transition-all group"
                                onClick={() => handleImageClick(row, 'product')}
                                title="點擊新增產品圖片"
                              >
                                <Plus className="w-4 h-4 text-muted-foreground/30 group-hover:text-indigo-400 transition-colors" />
                              </div>
                            );
                          })()}
                        </TableCell>
                      )}
                      {/* Lifestyle Image Thumbnail — with override support */}
                      {hasAnyLifestyleImage && (
                        <TableCell className="text-center p-1">
                          {(() => {
                            const img = getImageForRow(row, 'lifestyle');
                            return img ? (
                              <div className="w-12 h-12 mx-auto rounded border border-purple-500/30 overflow-hidden cursor-pointer hover:scale-110 transition-transform hover:border-purple-400 hover:shadow-lg hover:shadow-purple-500/10"
                                onClick={() => handleImageClick(row, 'lifestyle')}
                              >
                                <img
                                  src={img}
                                  alt={`Lifestyle Row ${row.rowIndex}`}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div
                                className="w-12 h-12 flex items-center justify-center rounded border border-dashed border-border/30 mx-auto cursor-cell hover:border-indigo-400/50 hover:bg-indigo-500/5 transition-all group"
                                onClick={() => handleImageClick(row, 'lifestyle')}
                                title="點擊新增效果圖"
                              >
                                <Plus className="w-4 h-4 text-muted-foreground/30 group-hover:text-indigo-400 transition-colors" />
                              </div>
                            );
                          })()}
                        </TableCell>
                      )}
                      {/* Data cells — with AI Product Name inserted at correct position */}
                      {visibleColumns.map((colIdx, arrIdx) => {
                        const value = row.cells[colIdx];
                        const rawDisplayVal = value !== null && value !== undefined ? String(value).trim() : '';
                        const mapping = currentMapping[colIdx];
                        const isMapped = mapping && mapping !== 'skip';
                        
                        // ── VIRTUAL 3-COLUMN SPLIT for Combined Dimensions ──
                        // If this is the combined dimensions column, render 3 separate cells
                        if (colIdx === dimCombinedColIdx) {
                          const dimL = parsedDimensionCells[`${row.rowIndex}:dim_l`] || '';
                          const dimW = parsedDimensionCells[`${row.rowIndex}:dim_w`] || '';
                          const dimH = parsedDimensionCells[`${row.rowIndex}:dim_h`] || '';
                          
                          const nameKey = `${activeSheet.sheetName}:${row.rowIndex}`;
                          const generatedName = productNames[nameKey];
                          const isGeneratingName = generatingNames[nameKey];
                          const hasImage = !!(getImageForRow(row, 'product') || getImageForRow(row, 'lifestyle'));
                          
                          return (
                            <React.Fragment key={colIdx}>
                              <TableCell
                                className="text-sm font-[IBM_Plex_Mono] px-2 text-emerald-700 text-center"
                                title={`Raw: ${rawDisplayVal} → L: ${dimL}`}
                              >
                                {dimL || <span className="text-foreground/30">—</span>}
                              </TableCell>
                              <TableCell
                                className="text-sm font-[IBM_Plex_Mono] px-2 text-emerald-700 text-center"
                                title={`Raw: ${rawDisplayVal} → W: ${dimW}`}
                              >
                                {dimW || <span className="text-foreground/30">—</span>}
                              </TableCell>
                              <TableCell
                                className="text-sm font-[IBM_Plex_Mono] px-2 text-emerald-700 text-center"
                                title={`Raw: ${rawDisplayVal} → H: ${dimH}`}
                              >
                                {dimH || <span className="text-foreground/30">—</span>}
                              </TableCell>
                              {/* AI Product Name cell inserted after the anchor column */}
                              {arrIdx === productNameInsertIndex - 1 && (
                                <TableCell className="p-1 min-w-[220px]">
                                  {isGeneratingName ? (
                                    <div className="flex items-center gap-1.5 text-sm text-amber-600">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      <span className="font-[IBM_Plex_Mono] text-sm">AI 生成中...</span>
                                    </div>
                                  ) : generatedName ? (
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs font-[IBM_Plex_Mono] text-foreground truncate max-w-[180px]" title={generatedName}>
                                        {generatedName}
                                      </span>
                                      <button
                                        onClick={() => handleGenerateProductName(row)}
                                        className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                        title="重新生成"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={!hasImage}
                                      onClick={() => handleGenerateProductName(row)}
                                      className={cn(
                                        "h-7 text-sm font-[IBM_Plex_Mono] gap-1",
                                        hasImage
                                          ? "text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                                          : "text-muted-foreground/40 cursor-not-allowed"
                                      )}
                                      title={hasImage ? "一鍵生成 — 使用 AI 識別傢俬類別" : "需要先新增圖片才能生成名稱"}
                                    >
                                      <Wand2 className="w-3 h-3" />
                                      一鍵生成
                                    </Button>
                                  )}
                                </TableCell>
                              )}
                            </React.Fragment>
                          );
                        }

                        // ── Smart Dimension Display ──
                        // If this column is mapped to a dimension field, show parsed value instead of raw
                        let displayVal = '';
                        const isDimensionField = mapping === 'dim_length_mm' || mapping === 'dim_width_mm' || mapping === 'dim_height_mm';
                        const isPriceField = mapping === 'cost_price' || mapping === 'sale_price';
                        
                        if (isDimensionField && rawDisplayVal) {
                          // Check for per-column dimension display
                          const perColKey = `${row.rowIndex}:dim_display:${colIdx}`;
                          
                          if (parsedDimensionCells[perColKey]) {
                            displayVal = parsedDimensionCells[perColKey];
                          } else {
                            // Fallback: try to parse complex dimension strings for individual mm fields
                            if ((mapping === 'dim_length_mm' || mapping === 'dim_width_mm' || mapping === 'dim_height_mm') && (rawDisplayVal.includes('/') || rawDisplayVal.includes('*'))) {
                              const headerText = activeSheet.headerLabels[colIdx] || '';
                              const parsed = parseSmartDimensions(rawDisplayVal, headerText);
                              if (mapping === 'dim_length_mm' && parsed.l !== null) {
                                displayVal = String(parsed.l);
                              } else if (mapping === 'dim_width_mm' && parsed.w !== null) {
                                displayVal = String(parsed.w);
                              } else if (mapping === 'dim_height_mm' && parsed.h !== null) {
                                displayVal = String(parsed.h);
                              } else {
                                displayVal = rawDisplayVal ? simplifiedToTraditional(rawDisplayVal) : '';
                              }
                            } else {
                              displayVal = rawDisplayVal ? simplifiedToTraditional(rawDisplayVal) : '';
                            }
                          }
                        } else if (isPriceField && rawDisplayVal) {
                          // ── Smart Price Display (價格取大值) ──
                          // Apply cleanPrice to show max value from slash-separated prices
                          const priceKey = `${row.rowIndex}:price_display:${colIdx}`;
                          if (parsedPriceCells[priceKey]) {
                            displayVal = parsedPriceCells[priceKey];
                          } else {
                            displayVal = rawDisplayVal ? simplifiedToTraditional(rawDisplayVal) : '';
                          }
                        } else {
                          // Apply Simplified → Traditional Chinese conversion for preview display
                          displayVal = rawDisplayVal ? simplifiedToTraditional(rawDisplayVal) : '';
                        }

                        const nameKey = `${activeSheet.sheetName}:${row.rowIndex}`;
                        const generatedName = productNames[nameKey];
                        const isGeneratingName = generatingNames[nameKey];
                        const hasImage = !!(getImageForRow(row, 'product') || getImageForRow(row, 'lifestyle'));

                        const cellKey = `${row.rowIndex}:${colIdx}`;
                        const isEditingThis = editingCell === cellKey;

                        return (
                          <React.Fragment key={colIdx}>
                            <TableCell
                              className={cn(
                                'text-sm font-[IBM_Plex_Mono] px-2 max-w-[200px]',
                                !isEditingThis && 'truncate cursor-text hover:bg-indigo-500/5',
                                isMapped && 'text-foreground',
                                !isMapped && 'text-foreground/50',
                                isDimensionField && isMapped && displayVal && 'text-emerald-700',
                                isPriceField && isMapped && displayVal && rawDisplayVal !== displayVal && 'text-amber-600',
                              )}
                              title={isEditingThis ? undefined : '點擊編輯'}
                              onClick={() => { if (!isEditingThis) startEdit(row.rowIndex, colIdx, rawDisplayVal); }}
                            >
                              {isEditingThis ? (
                                <input
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => commitEdit(row.rowIndex, colIdx)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitEdit(row.rowIndex, colIdx);
                                    if (e.key === 'Escape') setEditingCell(null);
                                  }}
                                  className="w-full min-w-[120px] rounded border border-indigo-400 bg-background px-1.5 py-1 text-sm font-[IBM_Plex_Mono] focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                />
                              ) : (
                                displayVal || <span className="text-foreground/30">—</span>
                              )}
                            </TableCell>
                            {/* AI Product Name cell inserted after the anchor column */}
                            {arrIdx === productNameInsertIndex - 1 && (
                              <TableCell className="p-1 min-w-[220px]">
                                {isGeneratingName ? (
                                  <div className="flex items-center gap-1.5 text-xs text-amber-400">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span className="font-[IBM_Plex_Mono] text-xs">AI 生成中...</span>
                                  </div>
                                ) : generatedName ? (
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs font-[IBM_Plex_Mono] text-foreground truncate max-w-[180px]" title={generatedName}>
                                      {generatedName}
                                    </span>
                                    <button
                                      onClick={() => handleGenerateProductName(row)}
                                      className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                      title="重新生成"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={!hasImage}
                                    onClick={() => handleGenerateProductName(row)}
                                    className={cn(
                                      "h-7 text-xs font-[IBM_Plex_Mono] gap-1",
                                      hasImage
                                        ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                        : "text-muted-foreground/40 cursor-not-allowed"
                                    )}
                                    title={hasImage ? "一鍵生成 — 使用 AI 識別傢俬類別" : "需要先新增圖片才能生成名稱"}
                                  >
                                    <Wand2 className="w-3 h-3" />
                                    一鍵生成
                                  </Button>
                                )}
                              </TableCell>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {/* Fallback: AI Product Name cell at end if no anchor found */}
                      {(productNameInsertIndex === 0 || productNameInsertIndex > visibleColumns.length) && (() => {
                        const nameKey = `${activeSheet.sheetName}:${row.rowIndex}`;
                        const generatedName = productNames[nameKey];
                        const isGeneratingName = generatingNames[nameKey];
                        const hasImage = !!(getImageForRow(row, 'product') || getImageForRow(row, 'lifestyle'));
                        return (
                          <TableCell className="p-1 min-w-[220px]">
                            {isGeneratingName ? (
                              <div className="flex items-center gap-1.5 text-xs text-amber-400">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span className="font-[IBM_Plex_Mono] text-xs">AI 生成中...</span>
                              </div>
                            ) : generatedName ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs font-[IBM_Plex_Mono] text-foreground truncate max-w-[180px]" title={generatedName}>
                                  {generatedName}
                                </span>
                                <button
                                  onClick={() => handleGenerateProductName(row)}
                                  className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                  title="重新生成"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!hasImage}
                                onClick={() => handleGenerateProductName(row)}
                                className={cn(
                                  "h-7 text-xs font-[IBM_Plex_Mono] gap-1",
                                  hasImage
                                    ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                    : "text-muted-foreground/40 cursor-not-allowed"
                                )}
                                title={hasImage ? "一鍵生成 — 使用 AI 識別傢俬類別" : "需要先新增圖片才能生成名稱"}
                              >
                                <Wand2 className="w-3 h-3" />
                                一鍵生成
                              </Button>
                            )}
                          </TableCell>
                        );
                      })()}
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
        </div>
      </div>

      {/* Validation Messages */}
      {mappedCount < 2 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-amber-300 font-[Manrope]">
            至少需要映射 2 個欄位 (建議: 產品型號 + 尺寸 或 出廠價)
          </span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isGenerating}
          className="text-sm"
        >
          取消返回
        </Button>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground font-mono">
            {totalSelected} rows selected{hasMultipleSheets ? ` across ${sheetDataList.filter(sd => (multiSheetSelections[sd.sheetName]?.size || 0) > 0).length} sheets` : ''}
          </span>
          
          {/* Button C: Delete selected rows from preview (no save) */}
          <Button
            variant="ghost"
            onClick={() => handleAction('discard')}
            disabled={isGenerating || totalSelected === 0}
            className="text-sm gap-1.5 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">刪除</span>
            <span className="sm:hidden">刪除</span>
          </Button>

          {/* Button B: Upload to Catalog Only */}
          <Button
            onClick={() => handleAction('catalog-only')}
            disabled={isGenerating || mappedCount < 2 || totalSelected === 0}
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 text-sm font-[Syne] font-semibold"
          >
            {isGenerating ? (
              <span className="contents">
                <Loader2 className="w-4 h-4 animate-spin" />
                處理中...
              </span>
            ) : (
              <span className="contents">
                <Archive className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">上傳到產品目錄</span>
                <span className="sm:hidden">目錄</span>
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Image Override Modal */}
      <ImageOverrideModal
        isOpen={imageModalOpen}
        onClose={() => { setImageModalOpen(false); setImageModalTarget(null); }}
        currentImage={imageModalTarget?.currentImage || null}
        onConfirm={handleImageConfirm}
        mode={imageModalTarget?.mode || 'add'}
      />

      {/* Fallback: Image Enlarge Modal (for non-override views) */}
      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
          onClick={() => setEnlargedImage(null)}
        >
          <div className="relative max-h-[80vh] max-w-[80vw]">
            <img
              src={enlargedImage}
              alt="Enlarged preview"
              className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain shadow-2xl border border-white/10"
            />
            <button
              onClick={() => setEnlargedImage(null)}
              className="absolute -right-3 -top-3 rounded-full bg-black/80 p-2 text-white hover:bg-black border border-white/20"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
