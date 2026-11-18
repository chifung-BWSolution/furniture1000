import { supabase } from '@/lib/supabase';
import { parseInvokeError } from '@/lib/edgeFunctionErrors';
import { refreshDefaultQuoteEmailFooter, type QuoteEmailFooterText } from '../../supabase/functions/_shared/quoteEmailFooter.ts';

export interface QuoteEmailFooterRow {
  pms_staff_id: string;
  pm_name: string;
  body_zh_hant: string;
  body_zh_hans: string;
  body_en: string;
}

export async function listQuoteEmailFooters(): Promise<QuoteEmailFooterRow[]> {
  const { data, error } = await supabase.functions.invoke('supabase-functions-fetch-pms-pitchings', {
    body: { action: 'quote_email_footers' },
  });
  if (error) throw new Error(await parseInvokeError(error, data));
  if (!Array.isArray(data?.active_pm_ids)) throw new Error('電郵頁尾功能尚未部署到這個環境');
  if (!data.active_pm_ids.length) return [];

  const { data: rows, error: listError } = await supabase.from('bwf_quote_email_footer')
    .select('pms_staff_id,pm_name,body_zh_hant,body_zh_hans,body_en')
    .in('pms_staff_id', data.active_pm_ids)
    .order('pm_name');
  if (listError) throw new Error(listError.message);
  return (rows ?? []).map((row) => {
    const footer = refreshDefaultQuoteEmailFooter({
      'zh-Hant': row.body_zh_hant,
      'zh-Hans': row.body_zh_hans,
      en: row.body_en,
    });
    return { ...row, body_zh_hant: footer['zh-Hant'], body_zh_hans: footer['zh-Hans'], body_en: footer.en };
  });
}

export async function saveQuoteEmailFooter(row: QuoteEmailFooterRow): Promise<void> {
  const { data, error } = await supabase.from('bwf_quote_email_footer')
    .update({
      body_zh_hant: row.body_zh_hant.trim(),
      body_zh_hans: row.body_zh_hans.trim(),
      body_en: row.body_en.trim(),
    })
    .eq('pms_staff_id', row.pms_staff_id)
    .select('pms_staff_id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('沒有權限修改這份頁尾模板');
}

export async function getQuoteEmailFooterEditorId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('bwf_current_staff_id');
  if (error) throw new Error(error.message);
  return data;
}

export async function getQuoteEmailFooter(quoteUuid: string): Promise<QuoteEmailFooterText | null> {
  const { data, error } = await supabase.functions.invoke('supabase-functions-fetch-pms-pitchings', {
    body: { action: 'quote_email_footer', quote_uuid: quoteUuid },
  });
  if (error) throw new Error(await parseInvokeError(error, data));
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'footer')) throw new Error('電郵頁尾功能尚未部署到這個環境');
  return data.footer;
}
