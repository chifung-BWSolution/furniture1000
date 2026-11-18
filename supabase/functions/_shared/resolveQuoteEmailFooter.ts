import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { refreshDefaultQuoteEmailFooter, type QuoteEmailFooterText } from "./quoteEmailFooter.ts";

export async function resolveQuoteEmailFooter(
  furniture: SupabaseClient,
  quoteUuid: string,
  pms: SupabaseClient | null,
): Promise<QuoteEmailFooterText | null> {
  const { data: footer, error } = await furniture.rpc("fds_quote_email_footer", {
    p_quote_uuid: quoteUuid,
  });
  if (error) throw new Error(error.message);
  if (footer) return refreshDefaultQuoteEmailFooter(footer);
  if (!pms) return null;

  // Older drafts may have an obsolete or missing PM label. Use the existing
  // PMS pitching link to resolve the assigned staff identity in that case.
  const { data: quote, error: quoteError } = await furniture.from("bwf_quote")
    .select("bwf_pitching_id")
    .eq("id", quoteUuid)
    .maybeSingle();
  if (quoteError) throw new Error(quoteError.message);
  if (!quote?.bwf_pitching_id) return null;

  const { data: pitching, error: pitchingError } = await pms.from("bwf_pitchings")
    .select("main_pm_id")
    .eq("id", quote.bwf_pitching_id)
    .maybeSingle();
  if (pitchingError) {
    console.warn("[quote email footer] PMS pitching lookup failed:", pitchingError.message);
    return null;
  }
  if (!pitching?.main_pm_id) return null;

  const { data: row, error: lookupError } = await furniture.from("bwf_quote_email_footer")
    .select("body_zh_hant,body_zh_hans,body_en")
    .eq("pms_staff_id", pitching.main_pm_id)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  return row ? refreshDefaultQuoteEmailFooter({
    "zh-Hant": row.body_zh_hant,
    "zh-Hans": row.body_zh_hans,
    en: row.body_en,
  }) : null;
}
