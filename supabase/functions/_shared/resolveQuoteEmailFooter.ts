import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { materializeQuoteEmailFooter, type QuoteEmailFooterText } from "./quoteEmailFooter.ts";

export interface ResolvedQuoteEmailFooter {
  footer: QuoteEmailFooterText | null;
  senderName: string;
}

function fromStored(row: {
  pm_name?: string | null;
  sender_name?: string | null;
  phone?: string | null;
  "zh-Hant"?: string | null;
  "zh-Hans"?: string | null;
  en?: string | null;
  body_zh_hant?: string | null;
  body_zh_hans?: string | null;
  body_en?: string | null;
} | null): ResolvedQuoteEmailFooter {
  if (!row) return { footer: null, senderName: "" };
  const made = materializeQuoteEmailFooter({
    pm_name: String(row.pm_name ?? row.sender_name ?? ""),
    sender_name: row.sender_name,
    phone: row.phone,
    body_zh_hant: String(row.body_zh_hant ?? row["zh-Hant"] ?? ""),
    body_zh_hans: String(row.body_zh_hans ?? row["zh-Hans"] ?? ""),
    body_en: String(row.body_en ?? row.en ?? ""),
  });
  return { footer: made.footer, senderName: made.senderName };
}

export async function resolveQuoteEmailFooter(
  furniture: SupabaseClient,
  quoteUuid: string,
  pms: SupabaseClient | null,
): Promise<ResolvedQuoteEmailFooter> {
  const { data: footer, error } = await furniture.rpc("fds_quote_email_footer", {
    p_quote_uuid: quoteUuid,
  });
  if (error) throw new Error(error.message);
  if (footer) return fromStored(footer);
  if (!pms) return { footer: null, senderName: "" };

  // Older drafts may have an obsolete or missing PM label. Use the existing
  // PMS pitching link to resolve the assigned staff identity in that case.
  const { data: quote, error: quoteError } = await furniture.from("bwf_quote")
    .select("bwf_pitching_id")
    .eq("id", quoteUuid)
    .maybeSingle();
  if (quoteError) throw new Error(quoteError.message);
  if (!quote?.bwf_pitching_id) return { footer: null, senderName: "" };

  const { data: pitching, error: pitchingError } = await pms.from("bwf_pitchings")
    .select("main_pm_id")
    .eq("id", quote.bwf_pitching_id)
    .maybeSingle();
  if (pitchingError) {
    console.warn("[quote email footer] PMS pitching lookup failed:", pitchingError.message);
    return { footer: null, senderName: "" };
  }
  if (!pitching?.main_pm_id) return { footer: null, senderName: "" };

  const { data: row, error: lookupError } = await furniture.from("bwf_quote_email_footer")
    .select("pm_name,sender_name,phone,body_zh_hant,body_zh_hans,body_en")
    .eq("pms_staff_id", pitching.main_pm_id)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  return fromStored(row);
}
