import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { isSafeEmail, sendEmail } from "../_shared/email.ts";
import { DEFAULT_QUOTE_EMAIL_BCC, quoteEmailBccList, quoteEmailFromHeader, type QuoteEmailFooterText } from "../_shared/quoteEmailFooter.ts";
import { buildQuoteCustomerEmail, normalizeQuoteEmailLocale, quoteEmailAddressee, type QuoteEmailPreviewItem } from "../_shared/quoteCustomerEmail.ts";
import { localizeEnglishItemNames, localizeEnglishSampleItems } from "../_shared/quoteSampleItems.ts";
import { translateQuoteEmail } from "../_shared/translateQuoteEmail.ts";
import { pmsProjectUrl, pmsServiceRoleKey } from "../_shared/pmsProject.ts";
import { resolveQuoteEmailFooter } from "../_shared/resolveQuoteEmailFooter.ts";

/**
 * FDS-15 郵件 worker。
 *
 * 每次呼叫：
 *   1. 按 next_follow_up_at 排入到期跟進信（每單每 3 天一次，去重）
 *   2. claim 待發郵件（status = sending，attempts + 1）
 *   3. 用「發送當下」的模板組成客戶稱呼、報價摘要及自訂段，交給共用發信服務
 *   4. 成功 → mark sent（手動首封會開自動跟進，3 天後再寄）；
 *      失敗 → 交回 queue 重試，3 次後 failed，錯誤保留。
 *
 * 授權：x-worker-secret（pg_cron／vault）或 admin／uploader／pm 登入帳號。
 * 注意：`_shared/email.ts` 屬 shared module，必須用 supabase CLI 部署，單檔上傳不會打包。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CALLER_ROLES = ["admin", "uploader", "pm"];

type ClaimedEmail = {
  id: string;
  quote_uuid: string;
  kind: "manual" | "follow_up";
  to_email: string;
  attempts: number;
  quote_id: string;
  intro_text: string;
  recipient_name: string | null;
  locale: string;
  custom_sections: Array<{ title?: string; body?: string }>;
  settings_status: string;
  share_token: string | null;
  share_short_code?: string | null;
  item_count: number;
  total_amount: number;
  sample_items: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authorize(req: Request, admin: SupabaseClient): Promise<Response | null> {
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret !== null) {
    const secret = workerSecret.trim();
    if (!secret) return json({ error: "Unauthorized" }, 401);
    const { data, error } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    if (error || data !== true) return json({ error: "Unauthorized" }, 401);
    return null;
  }
  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!jwt || !url || !anonKey) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user?.id) return json({ error: "Unauthorized" }, 401);
  const { data: allowed, error: roleError } = await userClient.rpc("bwf_has_role", { p_roles: CALLER_ROLES });
  if (roleError || allowed !== true) return json({ error: "permission_denied" }, 403);
  return null;
}

const PUBLIC_PORTAL_URL = "https://www.bwteam-furniture.com";

function appUrl(): string {
  const configured = (Deno.env.get("FDS_APP_URL") ?? "").trim().replace(/\/+$/, "");
  if (!configured || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(configured)) {
    return PUBLIC_PORTAL_URL;
  }
  return configured;
}

function shareUrl(token: string | null, shortCode?: string | null): string {
  const base = appUrl();
  if (!base || !token) return "";
  const code = String(shortCode ?? "").trim();
  if (code) return `${base}/q/${encodeURIComponent(code)}`;
  return `${base}/customer?quote_share=${encodeURIComponent(token)}`;
}

async function englishSampleItems(sample: string | null): Promise<string | null> {
  const key = Deno.env.get("GOOGLE_TRANSLATION_API_KEY")?.trim() ?? "";
  return localizeEnglishSampleItems(sample, (names) => translateQuoteEmail(names, "en", key));
}

function customerVisibleItem(row: {
  name?: string | null;
  is_section_title?: boolean | null;
  is_custom_term?: boolean | null;
  hide_in_pdf?: boolean | null;
}): boolean {
  return !row.is_section_title && !row.is_custom_term && !row.hide_in_pdf && String(row.name ?? "").trim() !== "";
}

async function loadPreviewItems(admin: SupabaseClient, quoteUuid: string): Promise<{ count: number; items: QuoteEmailPreviewItem[] } | null> {
  const { data, error } = await admin.from("bwf_quote_item")
    .select("name,image,quantity,unit,unit_price,material,color,remarks,dimension_l_mm,dimension_w_mm,dimension_h_mm,dimension_mode,category,is_section_title,is_custom_term,hide_in_pdf")
    .eq("quote_uuid", quoteUuid)
    .order("sort_order", { ascending: true });
  if (error) {
    console.warn("[send-quote-email] preview items", error.message);
    return null;
  }
  const visible = (data ?? []).filter(customerVisibleItem);
  return {
    count: visible.length,
    items: visible.slice(0, 20).map((row) => ({
      name: String(row.name ?? ""),
      image: row.image,
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: row.unit_price,
      material: row.material,
      color: row.color,
      remarks: row.remarks,
      dimensionLMm: row.dimension_l_mm,
      dimensionWMm: row.dimension_w_mm,
      dimensionHMm: row.dimension_h_mm,
      dimensionMode: row.dimension_mode,
      category: row.category,
    })),
  };
}

function buildMessage(
  row: ClaimedEmail,
  footer: QuoteEmailFooterText | null,
  preview: { count: number; items: QuoteEmailPreviewItem[] } | null,
  customerName = "",
  greeting?: string | null,
  locale?: string | null,
  extra?: {
    version?: string | null;
    clientName?: string | null;
    clientIndustry?: string[] | null;
    subjectOverride?: string | null;
    productTitle?: string | null;
    productHighlights?: string | null;
    deliveryDetails?: string | null;
    paymentTerms?: string | null;
    warrantyTerms?: string | null;
    validityDays?: string | null;
    pmName?: string | null;
    contactPhone?: string | null;
  },
): { subject: string; text: string; html: string } {
  return buildQuoteCustomerEmail({
    kind: row.kind,
    quoteId: row.quote_id,
    version: extra?.version,
    clientName: extra?.clientName,
    clientIndustry: extra?.clientIndustry,
    subjectOverride: extra?.subjectOverride,
    productTitle: extra?.productTitle,
    productHighlights: extra?.productHighlights,
    introText: row.intro_text,
    customerName: customerName || row.recipient_name,
    greeting,
    locale: normalizeQuoteEmailLocale(locale || row.locale),
    footer,
    customSections: row.custom_sections,
    itemCount: preview?.count ?? row.item_count,
    totalAmount: row.total_amount,
    sampleItems: row.sample_items,
    previewItems: preview?.items,
    shareUrl: shareUrl(row.share_token, row.share_short_code),
    deliveryDetails: extra?.deliveryDetails,
    paymentTerms: extra?.paymentTerms,
    warrantyTerms: extra?.warrantyTerms,
    validityDays: extra?.validityDays,
    pmName: extra?.pmName,
    contactPhone: extra?.contactPhone,
  });
}

async function recordLog(
  admin: SupabaseClient,
  row: ClaimedEmail,
  status: "success" | "failed",
  detail: { provider?: string | null; messageId?: string | null; error?: string | null },
) {
  const { error } = await admin.from("email_notification_logs").insert({
    recipient: row.to_email,
    notification_type: row.kind === "follow_up" ? "quote_email_follow_up" : "quote_email_manual",
    related_quote_id: row.quote_id || null,
    status,
    error_message: detail.error ?? null,
    provider: detail.provider ?? null,
    message_id: detail.messageId ?? null,
    payload: { quote_uuid: row.quote_uuid, message_id: row.id, attempts: row.attempts },
  });
  if (error) console.error("[send-quote-email] log insert", error.message);
}

/** Quotes queued before PDF attachments have no object. Listing first avoids Storage's HTTP 400 for a missing key. */
async function loadOptionalQuotePdf(admin: SupabaseClient, quoteUuid: string): Promise<Blob | null> {
  const name = `${quoteUuid}.pdf`;
  const { data: listed, error: listError } = await admin.storage.from("quote-email-pdfs").list("", {
    limit: 10,
    search: name,
  });
  if (listError) throw new Error(listError.message);
  if (!listed?.some((item) => item.name === name)) return null;
  const { data, error } = await admin.storage.from("quote-email-pdfs").download(name);
  if (error || !data) throw new Error(error?.message ?? "pdf_download_failed");
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let admin: SupabaseClient;
  try {
    admin = adminClient();
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Server misconfigured" }, 500);
  }

  const denied = await authorize(req, admin);
  if (denied) return denied;

  let limit = 10;
  try {
    const body = await req.json();
    if (body && Number.isFinite(Number(body.limit))) limit = Number(body.limit);
  } catch {
    // empty body is fine
  }

  const { data: queuedFollowUps, error: enqueueError } = await admin.rpc("fds_quote_email_enqueue_follow_ups", {
    p_limit: limit,
  });
  if (enqueueError) return json({ error: enqueueError.message }, 500);

  const { data: claimed, error: claimError } = await admin.rpc("fds_quote_email_claim", { p_limit: limit });
  if (claimError) return json({ error: claimError.message }, 500);

  const pmsKey = pmsServiceRoleKey();
  const pms = pmsKey ? createClient(pmsProjectUrl(), pmsKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) : null;

  const rows = (Array.isArray(claimed) ? claimed : []) as ClaimedEmail[];
  const results: Array<{ id: string; status: string; error?: string }> = [];
  const { data: delivery, error: deliveryError } = await admin.from("bwf_quote_email_delivery")
    .select("bcc_email")
    .eq("id", true)
    .maybeSingle();
  if (deliveryError) console.warn("[send-quote-email] bcc lookup", deliveryError.message);
  const teamBcc = deliveryError || !delivery ? DEFAULT_QUOTE_EMAIL_BCC : String(delivery.bcc_email ?? "");

  for (const row of rows) {
    const to = String(row.to_email ?? "").trim();
    if (!isSafeEmail(to)) {
      await admin.rpc("fds_quote_email_mark", { p_id: row.id, p_status: "failed", p_error: "invalid_recipient" });
      results.push({ id: row.id, status: "invalid_recipient" });
      continue;
    }
    if (!row.share_token) {
      await admin.rpc("fds_quote_email_mark", { p_id: row.id, p_status: "failed", p_error: "share_link_missing" });
      results.push({ id: row.id, status: "share_link_missing" });
      continue;
    }

    try {
      const [{ data: quote, error: quoteError }, resolved] = await Promise.all([
        admin.from("bwf_quote")
          .select([
            "version",
            "pm_name:project_data->formData->>projectManager",
            "contact_name:project_data->clientInfo->>contactName",
            "form_contact:project_data->formData->>clientContactName",
            "company_name:project_data->clientInfo->>name",
            "form_company_name:project_data->formData->>clientName",
            "client_industry:project_data->formData->clientIndustry",
            "validity:project_data->quoteMeta->>validity",
            "form_validity:project_data->formData->>validityDays",
            "delivery_details:project_data->>deliveryDetails",
            "delivery_details_en:project_data->>deliveryDetailsEn",
            "terms_payment:project_data->termsContent->>payment",
            "terms_warranty:project_data->termsContent->>warranty",
            "terms_payment_en:project_data->termsContentEn->>payment",
            "terms_warranty_en:project_data->termsContentEn->>warranty",
          ].join(","))
          .eq("id", row.quote_uuid)
          .maybeSingle(),
        resolveQuoteEmailFooter(admin, row.quote_uuid, pms),
      ]);
      if (quoteError) throw new Error(quoteError.message);
      const quoteRow = (quote ?? {}) as Record<string, unknown>;
      const senderName = resolved.senderName || String(quoteRow.pm_name ?? "").trim() || "";
      const clientName = String(quoteRow.company_name ?? quoteRow.form_company_name ?? "").trim();
      const customerName = quoteEmailAddressee(
        String(quoteRow.contact_name ?? quoteRow.form_contact ?? row.recipient_name ?? ""),
        clientName,
      );
      const { data: template, error: greetingError } = await admin.from("bwf_quote_email_template")
        .select("greeting_text, locale, contact_phone, subject_text, product_title, product_highlights")
        .eq("quote_uuid", row.quote_uuid)
        .maybeSingle();
      if (greetingError) console.warn("[send-quote-email] greeting", greetingError.message);
      const savedGreeting = greetingError ? null : (template ? String(template.greeting_text ?? "") : null);
      const emailLocale = greetingError
        ? normalizeQuoteEmailLocale(row.locale)
        : normalizeQuoteEmailLocale(String(template?.locale ?? row.locale ?? ""));
      const savedSubject = greetingError ? "" : String(template?.subject_text ?? "").trim();
      const savedProductTitle = greetingError ? "" : String(template?.product_title ?? "").trim();
      const savedProductHighlights = greetingError ? "" : String(template?.product_highlights ?? "").trim();
      const contactPhone = (greetingError ? "" : String(template?.contact_phone ?? "").trim()) || "";
      const resendFrom = quoteEmailFromHeader(senderName);
      const footer = resolved.footer;
      const pdf = await loadOptionalQuotePdf(admin, row.quote_uuid);
      const attachment = pdf ? {
        filename: `${(row.quote_id || "Quotation").replace(/[^a-zA-Z0-9_.-]/g, "-")}.pdf`,
        content: encodeBase64(await pdf.arrayBuffer()),
      } : undefined;

      // Race guard: the customer may have viewed (or the PM stopped follow-ups)
      // between claim and send. confirm_send re-checks and cancels the message.
      const { data: canSend, error: confirmError } = await admin.rpc("fds_quote_email_confirm_send", { p_id: row.id });
      if (confirmError) throw new Error(confirmError.message);
      if (canSend !== true) {
        results.push({ id: row.id, status: "cancelled_before_send" });
        continue;
      }
      const preview = await loadPreviewItems(admin, row.quote_uuid);
      const needsItemTranslation = emailLocale === "en" && !savedProductHighlights;
      const sampleItems = needsItemTranslation
        ? await englishSampleItems(row.sample_items)
        : row.sample_items;
      let previewItems = preview?.items ?? null;
      if (previewItems && needsItemTranslation) {
        const names = await localizeEnglishItemNames(
          previewItems.map((item) => item.name),
          (names) => translateQuoteEmail(names, "en", Deno.env.get("GOOGLE_TRANSLATION_API_KEY")?.trim() ?? ""),
        );
        previewItems = previewItems.map((item, index) => ({ ...item, name: names[index] || item.name }));
      }
      const message = buildMessage(
        { ...row, sample_items: sampleItems },
        footer,
        preview ? { count: preview.count, items: previewItems ?? [] } : null,
        customerName,
        savedGreeting || null,
        emailLocale,
        {
          version: quoteRow.version ? String(quoteRow.version) : null,
          clientName,
          clientIndustry: Array.isArray(quoteRow.client_industry) ? quoteRow.client_industry.map(String) : null,
          subjectOverride: savedSubject || null,
          productTitle: savedProductTitle || null,
          productHighlights: savedProductHighlights || null,
          deliveryDetails: String(
            (emailLocale === "en" ? quoteRow.delivery_details_en : quoteRow.delivery_details) ??
              quoteRow.delivery_details ?? "",
          ),
          paymentTerms: String(
            (emailLocale === "en" ? quoteRow.terms_payment_en : quoteRow.terms_payment) ??
              quoteRow.terms_payment ?? "",
          ),
          warrantyTerms: String(
            (emailLocale === "en" ? quoteRow.terms_warranty_en : quoteRow.terms_warranty) ??
              quoteRow.terms_warranty ?? "",
          ),
          validityDays: String(quoteRow.validity ?? quoteRow.form_validity ?? "30"),
          pmName: senderName,
          contactPhone,
        },
      );
      const bcc = quoteEmailBccList(to, teamBcc);
      const sent = await sendEmail({ to: [to], bcc, ...message, resendFrom, attachment });
      await recordLog(admin, row, "success", { provider: sent.provider, messageId: sent.id });
      await admin.rpc("fds_quote_email_mark", {
        p_id: row.id,
        p_status: "sent",
        p_error: null,
        p_provider: sent.provider,
        p_message_id: sent.id,
      });
      results.push({ id: row.id, status: "sent" });
    } catch (error) {
      const text = error instanceof Error ? error.message : "send failed";
      const retryable = row.attempts < 3;
      await recordLog(admin, row, "failed", { error: text });
      await admin.rpc("fds_quote_email_mark", {
        p_id: row.id,
        p_status: retryable ? "queued" : "failed",
        p_error: text,
      });
      results.push({ id: row.id, status: retryable ? "queued_for_retry" : "failed", error: text });
    }
  }

  return json({ ok: true, follow_ups_enqueued: Number(queuedFollowUps) || 0, claimed: rows.length, results });
});
