/**
 * 報價設定 › 圖片庫（參考 QMS 的 quote-photos）。
 *
 * - 圖片庫是全公司共用的一組圖，存在公開 bucket `quote-photos`，
 *   資料列在 `quote_photo_assets`；DB 只存 object path，永不存 base64。
 * - 一張報價只記錄「選了哪幾張、怎麼排版」（`bwf_quote.project_data.quotePhotoLayouts`），
 *   另外在 `project_data.quotePhotoAssets` 存圖片庫快照（id / title / objectPath），
 *   所以之後把圖從圖片庫移除，已發出的報價版本仍然印得出來。
 * - 上載、排序、刪除都直接寫 Storage + 表，權限交給 RLS（admin / uploader / pm）。
 */
import { resizeImageToBlob } from '@/lib/imageStorage';
import { supabase } from '@/lib/supabase';

export const QUOTE_PHOTO_BUCKET = 'quote-photos';
export const QUOTE_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
export const QUOTE_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
/** 圖片庫上限，跟 QMS 一致。 */
export const QUOTE_PHOTO_LIBRARY_LIMIT = 60;
/** 一張報價最多插 12 張圖。 */
export const QUOTE_PHOTO_LIMIT = 12;
/** 上載前縮到這個邊長，PDF 夠用又不會拉幾 MB 原圖。 */
const UPLOAD_MAX_DIM = 1800;

/** 圖片在報價單 PDF 的位置：內容內頁／封面／封底（照 FCCD 的封面封底設定）。 */
export const QUOTE_PHOTO_PLACEMENTS = ['content', 'cover', 'back'] as const;
export type QuotePhotoPlacement = (typeof QUOTE_PHOTO_PLACEMENTS)[number];

export const QUOTE_PHOTO_PLACEMENT_LABELS: Record<QuotePhotoPlacement, string> = {
  content: '內容內頁',
  cover: '封面',
  back: '封底',
};

/** 會各自佔一頁 A4 的位置（封面在正文前、封底在最後）。 */
export type QuoteCoverPlacement = Exclude<QuotePhotoPlacement, 'content'>;
export type QuoteCoverPage = QuotePhotoAsset & { placement: QuoteCoverPlacement };

/** AI 生成參考圖可以切換的模型，順序＝介面顯示次序（預設第一個）。 */
export const QUOTE_PHOTO_GENERATE_MODELS = [
  { id: 'grok', label: 'Grok 4.7', provider: 'xAI' },
  { id: 'gemini', label: 'Gemini 3.8', provider: 'Google' },
] as const;
export type QuotePhotoGenerateModel = (typeof QUOTE_PHOTO_GENERATE_MODELS)[number]['id'];
/** 一次生成最多帶 5 張參考圖（跟 Edge function 的上限一致）。 */
export const QUOTE_PHOTO_GENERATE_MAX_REFERENCES = 5;
export const QUOTE_PHOTO_PROMPT_MAX = 500;

export type QuotePhotoAsset = {
  id: string;
  title: string;
  objectPath: string;
  url: string;
  sortOrder: number;
  sizeBytes: number;
  /** 內容內頁（報價排版內）／封面（PDF 第 1 頁起）／封底（PDF 最後一頁）。 */
  placement: QuotePhotoPlacement;
  /**
   * 插入 PDF 開關：封面／封底停用後不自動插入；
   * 內頁停用後不自動插入獨立整頁（仍可在報價編輯器排版選用）。
   */
  isActive: boolean;
  /**
   * 內頁圖啟用時：出 PDF 自動插在正文第 pageNumber 頁之後的獨立整頁，
   * 超出正文頁數時排在正文最後一頁之後。封面／封底不用這個欄位。
   */
  pageNumber: number;
  /** true＝AI 生成的參考圖，介面與 PDF 都要標示「僅供設計參考」。 */
  isGenerated: boolean;
};

/** 存在 project_data 的報價圖片快照。 */
export type QuotePhotoRef = {
  assetId: string;
  title: string;
  objectPath: string;
  caption?: string;
};

type AssetRow = {
  id: string;
  title: string | null;
  object_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sort_order: number | null;
  placement?: string | null;
  is_active?: boolean | null;
  page_number?: number | null;
  is_generated?: boolean | null;
};

const photoErrorMessages: Record<string, string> = {
  quote_photo_type_invalid: '只接受 JPG、PNG 或 WebP 圖片。',
  quote_photo_too_large: '每張圖片不可超過 15 MB。',
  quote_photo_library_limit: `圖片庫最多 ${QUOTE_PHOTO_LIBRARY_LIMIT} 張圖片，請先刪除不再用的圖。`,
  quote_photo_upload_failed: '圖片未能上載，請稍後再試。',
  quote_photo_record_failed: '圖片記錄未能保存，請稍後再試。',
  quote_photo_permission_denied: '只有管理員、上載員或 PM 可以修改圖片庫。',
  quote_photo_library_unavailable: '圖片庫暫時不能使用，請聯絡管理員。',
  quote_photo_not_found: '找不到這張圖片，可能已被移除。',
  quote_photo_generate_invalid: `請輸入描述（最多 ${QUOTE_PHOTO_PROMPT_MAX} 字）並選擇比例。`,
  quote_photo_generate_reference_limit: `最多只可以選 ${QUOTE_PHOTO_GENERATE_MAX_REFERENCES} 張參考圖片。`,
  quote_photo_generate_reference_invalid: '參考圖片已不存在，請重新選擇。',
  quote_photo_generate_unavailable: '這個 AI 圖片模型暫時不可用，請切換另一個模型或稍後再試。',
  quote_photo_generate_timeout: 'AI 生成逾時，請再試一次或改用另一個模型。',
  quote_photo_generate_failed: 'AI 生成失敗，請再試一次或改用另一個模型。',
  quote_photo_generate_permission_denied: '只有管理員、上載員或 PM 可以生成參考圖。',
};

export function quotePhotoErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return photoErrorMessages[code] ?? '圖片處理失敗，請稍後再試。';
}

/** 顯示用短標題：舊有的 AI 生成圖可能以整句描述做標題，介面一律截斷。 */
export function quotePhotoShortTitle(title: string, max = 20): string {
  const clean = (title || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean || '圖片';
  return `${clean.slice(0, max)}…`;
}

/** 圖片來源 URL：圖片庫走 objectPath，產品圖直接給絕對 URL。 */
export function quotePhotoRefUrl(ref: { objectPath?: string; url?: string }): string {
  const absolute = (ref.url || '').trim();
  if (/^https?:\/\//i.test(absolute)) return absolute;
  return quotePhotoObjectUrl(ref.objectPath || '');
}

/** Storage 公開 URL；product_images 同樣做法，讓 <LoadingImage> 自動轉 320px 縮圖。 */
export function quotePhotoObjectUrl(objectPath: string): string {
  const raw = (objectPath || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.replace(/^\/+/, '');
  if (!path) return '';
  const { data } = supabase.storage.from(QUOTE_PHOTO_BUCKET).getPublicUrl(path);
  if (data?.publicUrl) return data.publicUrl;
  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${QUOTE_PHOTO_BUCKET}/${path}`;
}

/** 用檔頭判斷真正格式：Windows 會把 JPEG 命名成 .png，瀏覽器就跟著報 image/png。 */
export function sniffQuotePhotoType(head: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(head.subarray(from, to)));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message ?? ''}`;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /schema cache|does not exist|Could not find the table/i.test(text)
  );
}

function permissionDenied(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.code ?? ''} ${error.message ?? ''}`;
  return error.code === '42501' || /row-level security|permission denied/i.test(text);
}

function fromRow(row: AssetRow): QuotePhotoAsset | null {
  const objectPath = (row.object_path || '').trim();
  if (!row.id || !objectPath) return null;
  const placement = QUOTE_PHOTO_PLACEMENTS.find((value) => value === row.placement) ?? 'content';
  return {
    id: row.id,
    title: (row.title || '').trim() || '圖片',
    objectPath,
    url: quotePhotoObjectUrl(objectPath),
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
    sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : 0,
    placement,
    isActive: row.is_active !== false,
    pageNumber: typeof row.page_number === 'number' && row.page_number >= 1 ? row.page_number : 1,
    isGenerated: row.is_generated === true,
  };
}

const ASSET_COLUMNS =
  'id,title,object_path,mime_type,size_bytes,sort_order,placement,is_active,page_number,is_generated';

export async function listQuotePhotoAssets(): Promise<{
  assets: QuotePhotoAsset[];
  missingTable: boolean;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('quote_photo_assets')
    .select(ASSET_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return { assets: [], missingTable: true, error: null };
    return { assets: [], missingTable: false, error: error.message };
  }
  const assets = ((data ?? []) as AssetRow[])
    .map(fromRow)
    .filter((asset): asset is QuotePhotoAsset => Boolean(asset));
  return { assets, missingTable: false, error: null };
}

async function nextSortOrder(): Promise<number> {
  const { data } = await supabase
    .from('quote_photo_assets')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  const top = ((data ?? []) as Array<{ sort_order: number | null }>)[0]?.sort_order;
  return (typeof top === 'number' ? top : 0) + 1;
}

function titleFromFilename(filename: string): string {
  const base = (filename || '').replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim();
  return (base || '圖片').slice(0, 120);
}

/** 上載一張圖到圖片庫；失敗會清掉已上傳的檔案，不留孤兒 object。 */
export async function uploadQuotePhotoAsset(file: File): Promise<QuotePhotoAsset> {
  if (!file || file.size <= 0) throw new Error('quote_photo_type_invalid');
  if (file.size > QUOTE_PHOTO_MAX_BYTES) throw new Error('quote_photo_too_large');

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffQuotePhotoType(head);
  if (!sniffed) throw new Error('quote_photo_type_invalid');

  const existing = await listQuotePhotoAssets();
  if (existing.missingTable) throw new Error('quote_photo_library_unavailable');
  if (existing.error) throw new Error('quote_photo_upload_failed');
  if (existing.assets.length >= QUOTE_PHOTO_LIBRARY_LIMIT) {
    throw new Error('quote_photo_library_limit');
  }

  const blob = await resizeImageToBlob(file, UPLOAD_MAX_DIM);
  const objectPath = `library/${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(QUOTE_PHOTO_BUCKET)
    .upload(objectPath, blob, { contentType: 'image/jpeg', upsert: false });
  if (uploadError) {
    const text = uploadError.message || '';
    if (/exceeded the maximum allowed size|too large/i.test(text)) {
      throw new Error('quote_photo_too_large');
    }
    if (/mime|content type/i.test(text)) throw new Error('quote_photo_type_invalid');
    throw new Error('quote_photo_upload_failed');
  }

  const { data: session } = await supabase.auth.getSession();
  const { data: inserted, error: insertError } = await supabase
    .from('quote_photo_assets')
    .insert({
      title: titleFromFilename(file.name),
      object_path: objectPath,
      mime_type: 'image/jpeg',
      size_bytes: blob.size,
      sort_order: await nextSortOrder(),
      created_by: session.session?.user.id ?? null,
      is_active: false,
    })
    .select(ASSET_COLUMNS)
    .single();

  if (insertError || !inserted) {
    await supabase.storage.from(QUOTE_PHOTO_BUCKET).remove([objectPath]);
    throw new Error(permissionDenied(insertError) ? 'quote_photo_permission_denied' : 'quote_photo_record_failed');
  }

  const asset = fromRow(inserted as AssetRow);
  if (!asset) throw new Error('quote_photo_record_failed');
  return asset;
}

/** Edge function 的部署 slug：CLAUDE.md §0，前端要同時試帶前綴的名。 */
const GENERATE_SLUGS = [
  'supabase-functions-generate-quote-reference-image',
  'generate-quote-reference-image',
] as const;

/**
 * AI 生成一張參考圖並寫入圖片庫（Grok 4.7 或 Gemini 3.8，可帶最多 5 張產品圖作參考）。
 * 生成結果 isGenerated = true，介面與 PDF 都會標示「僅供設計參考」。
 */
export async function generateQuoteReferenceImage(input: {
  purpose?: 'orthographic';
  productId?: string;
  model: QuotePhotoGenerateModel;
  prompt?: string;
  aspectRatio: string;
  /** 產品圖的絕對 URL（product-images 公開 bucket），Edge function 直接抓圖。 */
  referenceUrls?: string[];
}): Promise<QuotePhotoAsset> {
  const prompt = (input.prompt || '').replace(/\s+/g, ' ').trim();
  if ((!prompt && input.purpose !== 'orthographic') || (input.purpose === 'orthographic' && !input.productId)) throw new Error('quote_photo_generate_invalid');
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('quote_photo_generate_permission_denied');

  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  for (const slug of GENERATE_SLUGS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), input.purpose === 'orthographic' ? 260_000 : 150_000);
    let response: Response;
    try {
      response = await fetch(`${base}/functions/v1/${slug}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          purpose: input.purpose,
          productId: input.productId,
          model: input.model,
          prompt,
          aspectRatio: input.aspectRatio,
          referenceUrls: input.referenceUrls ?? [],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      throw new Error(aborted ? 'quote_photo_generate_timeout' : 'quote_photo_generate_failed');
    } finally {
      window.clearTimeout(timer);
    }

    // 未部署的 slug 回 404（gateway 的錯誤體沒有 error 欄），換下一個名再試。
    if (response.status === 404) continue;

    const body = await response.json().catch(() => null) as {
      error?: string;
      asset?: { id?: string; title?: string; objectPath?: string; url?: string; sortOrder?: number; sizeBytes?: number; placement?: string; isActive?: boolean };
    } | null;

    if (!response.ok) {
      const code = typeof body?.error === 'string' ? body.error : '';
      if (code === 'unauthorized') throw new Error('quote_photo_generate_permission_denied');
      if (code) throw new Error(code);
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'quote_photo_generate_permission_denied'
          : 'quote_photo_generate_failed',
      );
    }

    const asset = body?.asset;
    const objectPath = (asset?.objectPath || '').trim();
    if (!asset?.id || !objectPath) throw new Error('quote_photo_generate_failed');
    const placement = QUOTE_PHOTO_PLACEMENTS.find((value) => value === asset.placement) ?? 'content';
    return {
      id: asset.id,
      title: (asset.title || '').trim() || 'AI 參考圖',
      objectPath,
      url: (asset.url || '').trim() || quotePhotoObjectUrl(objectPath),
      sortOrder: typeof asset.sortOrder === 'number' ? asset.sortOrder : 0,
      sizeBytes: typeof asset.sizeBytes === 'number' ? asset.sizeBytes : 0,
      placement,
      isActive: asset.isActive !== false,
      pageNumber: 1,
      isGenerated: true,
    };
  }

  throw new Error('quote_photo_generate_unavailable');
}

/** 改名（圖片庫列表的名稱會印在編輯器的已選清單）。 */export async function renameQuotePhotoAsset(id: string, title: string): Promise<void> {
  const next = title.trim().slice(0, 120) || '圖片';
  const { error } = await supabase
    .from('quote_photo_assets')
    .update({ title: next })
    .eq('id', id);
  if (error) {
    throw new Error(permissionDenied(error) ? 'quote_photo_permission_denied' : 'quote_photo_record_failed');
  }
}

export async function reorderQuotePhotoAssets(ids: string[]): Promise<void> {
  for (const [index, id] of ids.entries()) {
    const { error } = await supabase
      .from('quote_photo_assets')
      .update({ sort_order: index + 1 })
      .eq('id', id);
    if (error) {
      throw new Error(permissionDenied(error) ? 'quote_photo_permission_denied' : 'quote_photo_record_failed');
    }
  }
}

/** 設定這張圖插入 PDF 的位置（內容內頁／封面／封底）、啟用狀態或內頁插入頁數。 */
export async function updateQuotePhotoPlacement(
  id: string,
  input: { placement?: QuotePhotoPlacement; isActive?: boolean; pageNumber?: number },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.placement) patch.placement = input.placement;
  if (typeof input.isActive === 'boolean') patch.is_active = input.isActive;
  if (typeof input.pageNumber === 'number' && Number.isFinite(input.pageNumber)) {
    patch.page_number = Math.max(1, Math.floor(input.pageNumber));
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('quote_photo_assets').update(patch).eq('id', id);
  if (error) {
    throw new Error(permissionDenied(error) ? 'quote_photo_permission_denied' : 'quote_photo_record_failed');
  }
}

/** 內頁圖設定成獨立整頁時的資料形狀（跟封面／封底同一種做法）。 */
export type QuoteContentPage = QuotePhotoAsset & { placement: 'content' };

/**
 * 報價 PDF 要自動插入的內頁獨立整頁：只取啟用的 content 圖，
 * 按指定的頁數（插在正文第幾頁之後）排，同頁數之內按圖片庫的 sort_order。
 */
export async function listQuoteContentPages(): Promise<QuoteContentPage[]> {
  const { data, error } = await supabase
    .from('quote_photo_assets')
    .select(ASSET_COLUMNS)
    .eq('placement', 'content')
    .eq('is_active', true);
  if (error) return [];
  return ((data ?? []) as AssetRow[])
    .map(fromRow)
    .filter((asset): asset is QuoteContentPage => Boolean(asset) && asset.placement === 'content')
    .sort((a, b) => a.pageNumber - b.pageNumber || a.sortOrder - b.sortOrder);
}

/**
 * 報價 PDF 要自動插入的封面／封底頁：只取啟用的，封面先、封底後，
 * 同組之內按圖片庫的 sort_order。
 */
export async function listQuoteCoverPages(): Promise<QuoteCoverPage[]> {
  const { data, error } = await supabase
    .from('quote_photo_assets')
    .select(ASSET_COLUMNS)
    .in('placement', ['cover', 'back'])
    .eq('is_active', true);
  if (error) return [];
  const rank: Record<string, number> = { cover: 0, back: 1 };
  return ((data ?? []) as AssetRow[])
    .map(fromRow)
    .filter(
      (asset): asset is QuotePhotoAsset & { placement: QuoteCoverPlacement } =>
        Boolean(asset) && (asset.placement === 'cover' || asset.placement === 'back'),
    )
    .sort((a, b) => rank[a.placement] - rank[b.placement] || a.sortOrder - b.sortOrder);
}

/**
 * 由圖片庫移除。只刪資料列，檔案留在 Storage：已發出的報價版本、
 * 已分享連結仍然用同一個 object path 印圖。
 */
export async function deleteQuotePhotoAsset(id: string): Promise<void> {
  const { error } = await supabase.from('quote_photo_assets').delete().eq('id', id);
  if (error) {
    throw new Error(permissionDenied(error) ? 'quote_photo_permission_denied' : 'quote_photo_record_failed');
  }
}

/** 讀 project_data.quotePhotos，壞資料直接丟掉。 */
export function parseQuotePhotoRefs(value: unknown): QuotePhotoRef[] {
  if (!Array.isArray(value)) return [];
  const refs: QuotePhotoRef[] = [];
  for (const entry of value.slice(0, QUOTE_PHOTO_LIMIT)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const assetId = typeof row.assetId === 'string' ? row.assetId.trim() : '';
    const objectPath = typeof row.objectPath === 'string' ? row.objectPath.trim() : '';
    if (!assetId || !objectPath) continue;
    if (refs.some((ref) => ref.assetId === assetId)) continue;
    const caption = typeof row.caption === 'string' ? row.caption.trim().slice(0, 60) : '';
    refs.push({
      assetId,
      objectPath,
      title: (typeof row.title === 'string' ? row.title.trim().slice(0, 120) : '') || '圖片',
      ...(caption ? { caption } : {}),
    });
  }
  return refs;
}

/** project_data 內的圖片來源快照：排版只記 sourceId，印刷時靠它找回 URL。 */
export type QuotePhotoAssetRef = {
  id: string;
  title: string;
  /** 圖片庫 object path（quote-photos bucket）。 */
  objectPath?: string;
  /** 產品圖等外部來源的絕對 URL。 */
  url?: string;
  /** AI 生成的參考圖：PDF 要加註「僅供設計參考」。 */
  isGenerated?: boolean;
};

export function parseQuotePhotoAssetRefs(value: unknown): QuotePhotoAssetRef[] {
  if (!Array.isArray(value)) return [];
  const refs: QuotePhotoAssetRef[] = [];
  for (const entry of value.slice(0, 64)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const objectPath = typeof row.objectPath === 'string' ? row.objectPath.trim() : '';
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!id || (!objectPath && !url)) continue;
    if (refs.some((ref) => ref.id === id)) continue;
    refs.push({
      id,
      title: (typeof row.title === 'string' ? row.title.trim().slice(0, 120) : '') || '圖片',
      ...(objectPath ? { objectPath } : {}),
      ...(url ? { url } : {}),
      ...(row.isGenerated === true ? { isGenerated: true } : {}),
    });
  }
  return refs;
}

/** 只有 admin / uploader / pm 可以上載、排序、刪除（跟 RLS 一致）。 */
export async function canManageQuotePhotos(): Promise<boolean> {
  const { data, error } = await supabase.rpc('bwf_has_role', { p_roles: ['admin', 'uploader', 'pm'] });
  if (error) {
    console.warn('[quotePhotoLibrary] role check failed:', error.message);
    return false;
  }
  return data === true;
}

export function quotePhotoAssetToRef(asset: QuotePhotoAsset, caption?: string): QuotePhotoRef {
  return {
    assetId: asset.id,
    objectPath: asset.objectPath,
    title: asset.title,
    ...(caption?.trim() ? { caption: caption.trim().slice(0, 60) } : {}),
  };
}
