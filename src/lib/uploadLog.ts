import { supabase } from '@/lib/supabase';
import { fetchPmsStaffName } from '@/lib/pmsStaff';
import { getPublishTimestampHk } from '@/lib/publishTimestamps';

export type PublishLogStage =
  | 'copywriting'
  | 'product_info'
  | 'furniture_group_check'
  | 'ready_to_publish';

export type ActivityLogStage =
  | 'listed_products'
  | 'product_catalog'
  | 'ai_processor'
  | 'settings'
  | 'general';

export type UploadLogStage = PublishLogStage | ActivityLogStage;

export type UploadLogAction =
  | 'submit'
  | 'save'
  | 'complete'
  | 'add_to_ready'
  | 'upload';

/** Default Traditional Chinese labels for publish / product pages. */
export const UPLOAD_LOG_STAGE_LABELS: Record<UploadLogStage, string> = {
  copywriting: '產品文案',
  product_info: '產品信息',
  furniture_group_check: '傢俬組檢查',
  ready_to_publish: '準備上載',
  listed_products: '待處理產品',
  product_catalog: '產品目錄',
  ai_processor: 'AI 處理',
  settings: '設定',
  general: '系統',
};

export interface UploadLogEntry {
  productId: string;
  rtsId?: string | null;
  stage: UploadLogStage;
  action: UploadLogAction;
  pageLabel?: string | null;
  productSku?: string | null;
}

async function resolveCurrentUser(): Promise<{
  userId: string | null;
  email: string | null;
  name: string | null;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.warn('[uploadLog] skipped: no authenticated user');
    return { userId: null, email: null, name: null };
  }
  let name: string | null = null;
  try {
    name = await fetchPmsStaffName(user.id);
  } catch {
    /* non-fatal */
  }
  return {
    userId: user.id,
    email: user.email ?? null,
    name: name?.trim() || null,
  };
}

function buildLogRow(
  entry: UploadLogEntry,
  user: { userId: string | null; email: string | null; name: string | null },
  loggedAt: string,
) {
  if (!user.userId) {
    throw new Error('upload_log requires an authenticated user');
  }
  const pageLabel = entry.pageLabel?.trim()
    || UPLOAD_LOG_STAGE_LABELS[entry.stage]
    || null;
  const productSku = entry.productSku?.trim() || null;
  return {
    product_id: entry.productId,
    rts_id: entry.rtsId ?? null,
    stage: entry.stage,
    action: entry.action,
    page_label: pageLabel,
    product_sku: productSku,
    user_id: user.userId,
    user_email: user.email,
    user_name: user.name,
    logged_at: loggedAt,
  };
}

/** Fire-and-forget single upload_log row. Never throws. */
export async function writeUploadLog(entry: UploadLogEntry): Promise<void> {
  try {
    const user = await resolveCurrentUser();
    const { error } = await supabase
      .from('upload_log')
      .insert(buildLogRow(entry, user, getPublishTimestampHk()));
    if (error) {
      console.warn('[uploadLog] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[uploadLog] unexpected error:', err);
  }
}

/** Batch insert for multi-select actions (完成 / 加入到準備上載 / bulk upload). */
export async function writeUploadLogBatch(entries: UploadLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const user = await resolveCurrentUser();
    const loggedAt = getPublishTimestampHk();
    const rows = entries.map((entry) => buildLogRow(entry, user, loggedAt));
    const { error } = await supabase.from('upload_log').insert(rows);
    if (error) {
      console.warn('[uploadLog] batch insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[uploadLog] unexpected error:', err);
  }
}

/** Log a product edit from 待處理產品 / 產品目錄 detail modal. */
export async function writeProductEditLog(opts: {
  productId: string;
  stage: 'listed_products' | 'product_catalog';
  productSku?: string | null;
}): Promise<void> {
  await writeUploadLog({
    productId: opts.productId,
    stage: opts.stage,
    action: 'save',
    pageLabel: UPLOAD_LOG_STAGE_LABELS[opts.stage],
    productSku: opts.productSku,
  });
}
