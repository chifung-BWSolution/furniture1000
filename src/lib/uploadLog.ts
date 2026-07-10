import { supabase } from '@/lib/supabase';
import { fetchPmsStaffName } from '@/lib/pmsStaff';
import { getPublishTimestampHk } from '@/lib/publishTimestamps';

export type UploadLogStage =
  | 'copywriting'
  | 'product_info'
  | 'furniture_group_check'
  | 'ready_to_publish';

export type UploadLogAction =
  | 'submit'
  | 'save'
  | 'complete'
  | 'add_to_ready'
  | 'upload';

export interface UploadLogEntry {
  productId: string;
  rtsId?: string | null;
  stage: UploadLogStage;
  action: UploadLogAction;
}

async function resolveCurrentUser(): Promise<{
  userId: string | null;
  email: string | null;
  name: string | null;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
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
    name: name ?? user.email ?? null,
  };
}

function buildLogRow(
  entry: UploadLogEntry,
  user: { userId: string | null; email: string | null; name: string | null },
  loggedAt: string,
) {
  return {
    product_id: entry.productId,
    rts_id: entry.rtsId ?? null,
    stage: entry.stage,
    action: entry.action,
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
    console.warn('[uploadLog] batch unexpected error:', err);
  }
}
