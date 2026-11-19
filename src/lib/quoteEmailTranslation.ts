import { parseInvokeError } from '@/lib/edgeFunctionErrors';
import { supabase } from '@/lib/supabase';
import type { QuoteEmailLocale } from '../../supabase/functions/_shared/quoteCustomerEmail.ts';

export async function translateQuoteEmailDraft(
  texts: string[],
  locale: QuoteEmailLocale,
  limits: number[],
): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke('supabase-functions-fetch-pms-pitchings', {
    body: { action: 'translate_quote_email', locale, texts },
  });
  if (error) throw new Error(await parseInvokeError(error, data));
  const translations: unknown = data?.translations;
  if (!Array.isArray(translations) || translations.length !== texts.length ||
      translations.some((value) => typeof value !== 'string')) {
    throw new Error('未能取得郵件翻譯');
  }
  if (translations.some((value, index) => value.length > limits[index])) {
    throw new Error('翻譯後有欄位超出字數上限，請縮短原文再試');
  }
  return translations;
}
