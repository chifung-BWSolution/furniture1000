import { supabase } from '@/lib/supabase';
import type { LogType } from '@/constants/analytics-mock';
import type { LoginLog } from '@/lib/adminApi';
import { UPLOAD_LOG_STAGE_LABELS } from '@/lib/uploadLog';

const ACTIVITY_GROUP_MS = 180_000;

type UploadRow = {
  id: string;
  user_name: string | null;
  user_email: string | null;
  stage: string;
  action: string;
  logged_at: string;
  product_id: string | null;
  page_label: string | null;
  product_sku: string | null;
};

type PendingUploadLog = {
  id: string;
  user: string;
  logType: LogType;
  stage: string;
  pageLabel: string | null;
  sku: string;
  at: string;
};

function mapUploadAction(action: string, stage: string): LogType {
  if (action === 'upload') return 'publish';
  if (stage === 'ready_to_publish' && action === 'add_to_ready') return 'publish';
  return 'edit';
}

function resolveSku(
  productSku: string | null | undefined,
  productId: string | null | undefined,
  skuByProductId: Map<string, string>,
): string {
  return String(productSku ?? '').trim()
    || (productId ? skuByProductId.get(productId) ?? '' : '')
    || '';
}

function activityGroupKey(user: string, at: string, logType: LogType): string {
  const bucket = Math.floor(new Date(at).getTime() / ACTIVITY_GROUP_MS);
  return `${user}|${bucket}|${logType}`;
}

function pushGroupedActivityLogs(
  groups: Map<string, PendingUploadLog[]>,
  logs: LoginLog[],
  logType: LogType,
): void {
  for (const [, group] of groups) {
    group.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const lead = group[0];
    const skus = [...new Set(group.map((g) => g.sku).filter(Boolean))];
    logs.push({
      id: `ul-${lead.id}${group.length > 1 ? `+${group.length}` : ''}`,
      user: lead.user,
      type: logType,
      skus: skus.length > 0 ? skus : undefined,
      detail: skus.length === 0
        ? (UPLOAD_LOG_STAGE_LABELS[lead.stage as keyof typeof UPLOAD_LOG_STAGE_LABELS] || '系統')
        : undefined,
      ip: '—',
      location: '系統',
      at: lead.at,
      suspicious: false,
    });
  }
}

async function fetchSkuMap(productIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(productIds.filter(Boolean))];
  const BATCH = 100;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const { data } = await supabase
      .from('products')
      .select('id, sku, product_sku')
      .in('id', batch);
    for (const row of data ?? []) {
      const sku = String(row.sku ?? row.product_sku ?? '').trim();
      if (sku) map.set(String(row.id), sku);
    }
  }
  return map;
}

/** Build edit/publish rows from upload_log + products (client-side, always fresh). */
export async function buildUploadActivityLogs(limit = 200): Promise<LoginLog[]> {
  const { data: uploadRows, error } = await supabase
    .from('upload_log')
    .select('id, user_name, user_email, stage, action, logged_at, product_id, page_label, product_sku')
    .order('logged_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[loginLogEnrichment] upload_log fetch failed:', error.message);
    return [];
  }

  const rows = (uploadRows ?? []) as UploadRow[];
  const productIds = rows.map((r) => String(r.product_id ?? '').trim()).filter(Boolean);
  const skuByProductId = await fetchSkuMap(productIds);

  const pending: PendingUploadLog[] = [];
  for (const row of rows) {
    const user = String(row.user_name ?? '').trim() || String(row.user_email ?? '').trim() || '未知用戶';
    if (user === '歷史紀錄') continue;
    pending.push({
      id: row.id,
      user,
      logType: mapUploadAction(row.action, row.stage),
      stage: row.stage,
      pageLabel: row.page_label,
      sku: resolveSku(row.product_sku, row.product_id, skuByProductId),
      at: row.logged_at,
    });
  }

  const logs: LoginLog[] = [];
  const editGroups = new Map<string, PendingUploadLog[]>();
  const publishGroups = new Map<string, PendingUploadLog[]>();

  for (const item of pending) {
    if (item.logType === 'publish') {
      const key = activityGroupKey(item.user, item.at, 'publish');
      const group = publishGroups.get(key) ?? [];
      group.push(item);
      publishGroups.set(key, group);
      continue;
    }

    const key = activityGroupKey(item.user, item.at, 'edit');
    const group = editGroups.get(key) ?? [];
    group.push(item);
    editGroups.set(key, group);
  }

  pushGroupedActivityLogs(editGroups, logs, 'edit');
  pushGroupedActivityLogs(publishGroups, logs, 'publish');

  return logs;
}

/** Replace edge-function upload rows with client-built rows that include SKU/page data. */
export async function mergeUploadActivityLogs(logs: LoginLog[]): Promise<LoginLog[]> {
  const uploadLogs = await buildUploadActivityLogs();
  const nonUpload = logs.filter((l) => !l.id.startsWith('ul-'));
  const merged = [...nonUpload, ...uploadLogs];
  merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return merged.slice(0, 250);
}
