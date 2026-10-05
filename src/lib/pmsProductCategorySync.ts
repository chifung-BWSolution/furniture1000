import { supabase } from '@/lib/supabase';
import { parseInvokeError } from '@/lib/edgeFunctionErrors';

export type PmsCategorySyncRow = {
  id: string;
  level1: string;
  level2: string;
  sort_order: number;
  previousLevel1?: string;
  previousLevel2?: string;
};

export type PmsCategorySyncPayload = {
  creates: PmsCategorySyncRow[];
  updates: PmsCategorySyncRow[];
  deletes: string[];
};

const INVOKE_SLUGS = [
  'supabase-functions-sync-product-category-pms',
  'sync-product-category-pms',
] as const;

/** Push product_category settings-page deltas to PMS v3 (server uses service role). */
export async function pushProductCategorySettingsToPms(
  payload: PmsCategorySyncPayload,
): Promise<{ ok: boolean; errors: string[]; skipped?: boolean }> {
  let lastError: string | null = null;

  for (const slug of INVOKE_SLUGS) {
    const { data, error } = await supabase.functions.invoke(slug, {
      body: { action: 'push', ...payload },
    });

    if (error) {
      lastError = await parseInvokeError(error, data);
      continue;
    }

    if (data?.skipped) {
      return { ok: true, errors: [], skipped: true };
    }

    const errors = Array.isArray(data?.errors)
      ? (data.errors as string[])
      : data?.error
        ? [String(data.error)]
        : [];

    if (data?.ok === false || errors.length > 0) {
      return { ok: false, errors };
    }

    return { ok: true, errors: [] };
  }

  return {
    ok: false,
    errors: [lastError ?? 'PMS 分類同步 edge function 無法連線'],
  };
}
