import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Loader2, Mail, Plus, StopCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { confirm } from '@/components/ui/confirm-dialog';
import { buildCustomerPortalQuoteShareUrl } from '@/lib/customerPortalRoutes';
import { buildQuoteCustomerEmail, defaultQuoteEmailGreeting, QUOTE_EMAIL_LOCALES, quoteEmailAddressee, type QuoteEmailLocale } from '../../../supabase/functions/_shared/quoteCustomerEmail.ts';
import { cleanTranslatedName, englishNameInSample } from '../../../supabase/functions/_shared/quoteSampleItems.ts';
import { translateQuoteEmailDraft } from '@/lib/quoteEmailTranslation';
import { getQuoteEmailFooter } from '@/lib/quoteEmailFooters';
import type { QuoteEmailFooterText } from '../../../supabase/functions/_shared/quoteEmailFooter.ts';
import { fetchPmsPitchings } from '@/lib/pmsPitchings';
import {
  QUOTE_EMAIL_STATUS_LABELS,
  quoteEmailProblemText,
  dispatchQuoteEmailsNow,
  loadQuoteEmailContactSource,
  loadQuoteEmailCopy,
  loadQuoteEmailPreview,
  loadQuoteEmailStatus,
  resolveQuoteEmailPhone,
  resolveQuoteEmailRecipient,
  normalizeCustomQuoteEmailSections,
  quoteEmailErrorMessage,
  quoteEmailReadiness,
  saveQuoteEmailTemplate,
  scheduleQuoteEmail,
  stopQuoteEmail,
  type QuoteEmailCustomSection,
  type QuoteEmailPreviewItem,
  type QuoteEmailStatusData,
} from '@/lib/quoteEmailFollowUp';

export interface QuoteEmailFollowUpQuote {
  id: string;
  quoteId: string;
  clientEmail?: string | null;
  clientName?: string | null;
  /** 客戶聯絡人姓名。郵件開頭用這個，沒有才用公司名稱。 */
  clientContactName?: string | null;
  /** 報價公司資訊裡的負責同事電話。編輯中尚未保存時由父層傳入。 */
  contactPhone?: string | null;
  /** PMS pitching id. Used to fill the PM work mobile when the quote has none. */
  pitchingId?: string | null;
  /** 報價單本身的語言。英文報價打開郵件視窗時預設英文。 */
  documentLocale?: 'zh' | 'en';
}

/**
 * FDS-15：每張報價自己的郵件模板與跟進狀態。
 * 固定三段（報價內容簡述、可電話聯繫、加單授權連結）不可刪除；
 * 沒有負責同事電話或有效客戶連結時不會發送。
 * 「立即發送」＝先排入隊列（唯一待發索引防重複）再即時叫醒 `send-quote-email`；
 * 叫不到時郵件仍在隊列，由每 15 分鐘一次的 cron 補寄。
 */
export function QuoteEmailFollowUpModal({
  open,
  quote,
  onOpenChange,
}: {
  open: boolean;
  quote: QuoteEmailFollowUpQuote | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<QuoteEmailStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'save' | 'send' | 'stop' | null>(null);
  const [error, setError] = useState('');
  const [intro, setIntro] = useState('');
  const [greeting, setGreeting] = useState('');
  const [previewIntro, setPreviewIntro] = useState('');
  const [previewGreeting, setPreviewGreeting] = useState('');
  const [previewSections, setPreviewSections] = useState<QuoteEmailCustomSection[]>([]);
  const [locale, setLocale] = useState<QuoteEmailLocale>('zh-Hant');
  const [englishItems, setEnglishItems] = useState<QuoteEmailPreviewItem[] | null>(null);
  const [translatingItems, setTranslatingItems] = useState(false);
  const [phone, setPhone] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sections, setSections] = useState<QuoteEmailCustomSection[]>([]);
  const [previewItems, setPreviewItems] = useState<QuoteEmailPreviewItem[]>([]);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [emailFooter, setEmailFooter] = useState<QuoteEmailFooterText | null>(null);
  const [viewHistoryOpen, setViewHistoryOpen] = useState(false);
  const viewHistoryButtonRef = useRef<HTMLButtonElement>(null);

  const quoteId = quote?.id ?? '';
  const pitchingId = quote?.pitchingId?.trim() || '';

  useEffect(() => {
    setViewHistoryOpen(false);
    if (!open || !quoteId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setStatus(null);
    setPreviewItems([]);
    setVisibleCount(null);
    setEmailFooter(null);
    setGreeting('');
    setLocale('zh-Hant');
    setEnglishItems(null);
    void Promise.all([
      loadQuoteEmailStatus(quoteId),
      loadQuoteEmailContactSource(quoteId).catch(() => ({ clientEmail: '', companyPhone: '' })),
      loadQuoteEmailPreview(quoteId).catch(() => null),
      getQuoteEmailFooter(quoteId).catch(() => null),
      loadQuoteEmailCopy(quoteId),
    ])
      .then(async ([data, source, preview, footer, copy]) => {
        if (cancelled) return;
        setStatus(data);
        setEmailFooter(footer);
        if (preview) {
          setPreviewItems(preview.items);
          setVisibleCount(preview.count);
        }
        const person = quoteEmailAddressee(quote?.clientContactName, quote?.clientName);
        const nextLocale: QuoteEmailLocale = quote?.documentLocale === 'en' ? 'en' : copy.locale;
        const defaults = (Object.keys(QUOTE_EMAIL_LOCALES) as QuoteEmailLocale[])
          .map((key) => defaultQuoteEmailGreeting(person, key));
        const storedGreeting = copy.greeting?.trim() ?? '';
        const nextGreeting = storedGreeting && !defaults.includes(storedGreeting)
          ? storedGreeting
          : defaultQuoteEmailGreeting(person, nextLocale);
        const nextIntro = data?.intro_text ?? '';
        const nextSections = normalizeCustomQuoteEmailSections(data?.custom_sections);
        setLocale(nextLocale);
        setGreeting(nextGreeting);
        setPreviewGreeting(nextGreeting);
        setIntro(nextIntro);
        setPreviewIntro(nextIntro);
        setSections(nextSections);
        setPreviewSections(nextSections);
        const companyPhone = quote?.contactPhone?.trim() || source.companyPhone;
        const fromQuote = resolveQuoteEmailPhone({
          templatePhone: data?.contact_phone,
          companyPhone,
        });
        if (fromQuote) {
          setPhone(fromQuote);
        } else if (pitchingId) {
          const pitchings = await fetchPmsPitchings({ ids: [pitchingId], limit: 1 });
          if (!cancelled) {
            setPhone(resolveQuoteEmailPhone({ pmWorkPhone: pitchings[0]?.main_pm_phone }));
          }
        } else {
          setPhone('');
        }
        setRecipient(resolveQuoteEmailRecipient({
          savedRecipient: data?.recipient_email,
          editorEmail: quote?.clientEmail,
          storedEmail: source.clientEmail,
        }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(quoteEmailErrorMessage(err, quote?.documentLocale === 'en' ? 'en' : 'zh'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Only reload when the modal opens or a different quote is targeted; parent
    // re-renders must not reset what the user is editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quoteId, pitchingId]);

  const quoteUrl = useMemo(() => {
    if (!status?.share_token) return '';
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return origin ? buildCustomerPortalQuoteShareUrl(origin, status.share_token) : '';
  }, [status?.share_token]);

  const localEnglishItems = useMemo(() => (
    locale === 'en'
      ? previewItems.map((item) => ({
        ...item,
        name: englishNameInSample(item.name) ?? item.name,
      }))
      : previewItems
  ), [locale, previewItems]);
  const shownPreviewItems = locale === 'en' ? (englishItems ?? localEnglishItems) : previewItems;

  useEffect(() => {
    if (!open || locale !== 'en' || previewItems.length === 0) {
      setEnglishItems(null);
      setTranslatingItems(false);
      return;
    }
    const pending = previewItems.flatMap((item, index) => (
      englishNameInSample(item.name) === null && /\p{Script=Han}/u.test(item.name)
        ? [{ index, name: item.name }]
        : []
    ));
    if (!pending.length) {
      setEnglishItems(null);
      setTranslatingItems(false);
      return;
    }
    let cancelled = false;
    setTranslatingItems(true);
    void translateQuoteEmailDraft(
      pending.map((item) => item.name),
      'en',
      pending.map(() => 240),
    ).then((names) => {
      if (cancelled) return;
      const next = localEnglishItems.map((item) => ({ ...item }));
      pending.forEach((item, resultIndex) => {
        const text = cleanTranslatedName(names[resultIndex] ?? '');
        if (text) next[item.index] = { ...next[item.index], name: text };
      });
      setEnglishItems(next);
    }).catch(() => {
      if (!cancelled) setEnglishItems(null);
    }).finally(() => {
      if (!cancelled) setTranslatingItems(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, locale, previewItems, localEnglishItems]);

  const customerEmail = useMemo(() => buildQuoteCustomerEmail({
    kind: 'manual',
    quoteId: quote?.quoteId || '',
    greeting: previewGreeting,
    locale,
    footer: emailFooter,
    introText: previewIntro,
    customSections: previewSections,
    itemCount: visibleCount ?? status?.item_count ?? 0,
    totalAmount: status?.total_amount ?? 0,
    sampleItems: status?.sample_items ?? null,
    previewItems: shownPreviewItems,
    shareUrl: quoteUrl,
  }), [quote?.quoteId, previewGreeting, locale, emailFooter, previewIntro, previewSections, visibleCount, status?.item_count, status?.total_amount, status?.sample_items, shownPreviewItems, quoteUrl]);

  const chooseLocale = (next: QuoteEmailLocale) => {
    const person = quoteEmailAddressee(quote?.clientContactName, quote?.clientName);
    const defaults = (Object.keys(QUOTE_EMAIL_LOCALES) as QuoteEmailLocale[])
      .map((key) => defaultQuoteEmailGreeting(person, key));
    const updatedGreeting = defaults.includes(greeting.trim())
      ? defaultQuoteEmailGreeting(person, next)
      : greeting;
    setGreeting(updatedGreeting);
    setPreviewGreeting(updatedGreeting);
    setLocale(next);
  };

  const problem = quoteEmailReadiness({ recipient, contactPhone: phone, shareToken: status?.share_token ?? null });
  const statusLabel = QUOTE_EMAIL_STATUS_LABELS[status?.status ?? 'not_sent'];
  const en = locale === 'en';
  const tx = (zh: string, english: string) => (en ? english : zh);
  const errorLocale = en ? 'en' as const : 'zh' as const;

  const persistTemplate = async () => {
    if (!quote) return false;
    try {
      await saveQuoteEmailTemplate({
        quoteUuid: quote.id,
        introText: intro,
        contactPhone: phone,
        greeting,
        locale,
        customSections: sections,
      });
      return true;
    } catch (err) {
      setError(quoteEmailErrorMessage(err, errorLocale));
      return false;
    }
  };

  const handleSave = async () => {
    setBusy('save');
    setError('');
    const ok = await persistTemplate();
    setBusy(null);
    if (ok) {
      toast.success(tx('郵件模板已儲存', 'Email template saved'));
      setStatus(await loadQuoteEmailStatus(quote!.id).catch(() => status));
    }
  };

  const handleSend = async () => {
    if (!quote) return;
    if (problem) {
      setError(quoteEmailProblemText(problem, errorLocale));
      return;
    }
    setBusy('send');
    setError('');
    const savedOk = await persistTemplate();
    if (!savedOk) {
      setBusy(null);
      return;
    }
    try {
      // 先排入隊列（唯一待發索引保證不重複），再即時叫醒 worker 寄出。
      // 即時寄出失敗時郵件仍在隊列，cron 每 15 分鐘會補寄，不會因為網絡問題丟信。
      const messageId = await scheduleQuoteEmail({ quoteUuid: quote.id, to: recipient, kind: 'manual' });
      const dispatch = await dispatchQuoteEmailsNow(5);
      const next = await loadQuoteEmailStatus(quote.id).catch(() => null);
      if (next) setStatus(next);
      const message = next?.messages.find((row) => row.id === messageId) ?? null;
      const sent = message?.status === 'sent' || (Boolean(messageId) && dispatch.sentIds.includes(String(messageId)));
      if (sent) {
        toast.success(tx('已寄出', 'Sent'), {
          description: tx(
            `已寄到 ${recipient.trim()}；客戶首次有效查看後，只會停止這張單的自動跟進。`,
            `Sent to ${recipient.trim()}. The first valid view stops auto follow-up for this quotation only.`,
          ),
        });
        return;
      }
      toast.info(tx('已排入發送，最遲 15 分鐘內寄出', 'Queued. It will send within 15 minutes.'), {
        description: dispatch.error
          ? tx(
            `即時寄出未成功（${dispatch.error}），郵件仍在隊列，系統會自動補寄。`,
            `Sending now failed (${dispatch.error}). The email stays queued and will be sent automatically.`,
          )
          : tx(
            '系統會在背景寄出；客戶首次有效查看後，只會停止這張單的自動跟進。',
            'It will send in the background. The first valid view stops auto follow-up for this quotation only.',
          ),
      });
    } catch (err) {
      setError(quoteEmailErrorMessage(err, errorLocale));
    } finally {
      setBusy(null);
    }
  };

  const handleStop = async () => {
    if (!quote) return;
    const ok = await confirm({
      title: tx('停止這張報價的自動跟進？', 'Stop auto follow-up for this quotation?'),
      description: tx('停止後不會再自動發跟進信。其他報價不受影響，已排隊的跟進信會取消。', 'No more follow-up emails will be sent for this quotation. Other quotations are unchanged, and any queued follow-up is cancelled.'),
      confirmLabel: tx('停止自動跟進', 'Stop auto follow-up'),
      cancelLabel: tx('返回', 'Back'),
      destructive: true,
    });
    if (!ok) return;
    setBusy('stop');
    setError('');
    try {
      await stopQuoteEmail(quote.id, 'manual');
      setStatus(await loadQuoteEmailStatus(quote.id));
      toast.success(tx('已停止自動跟進', 'Auto follow-up stopped'));
    } catch (err) {
      setError(quoteEmailErrorMessage(err, errorLocale));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      icon={<Mail className="h-6 w-6" />}
      title={tx('郵件模板與跟進', 'Email template and follow-up')}
      description={quote ? `${quote.quoteId}${quote.clientName ? ` · ${quote.clientName}` : ''}` : undefined}
      size="5xl"
      className="max-w-[1440px]"
      bodyClassName="overflow-hidden"
      footer={
        <>
          <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => onOpenChange(false)}>
            {tx('關閉', 'Close')}
          </Button>
          <Button type="button" variant="outline" disabled={Boolean(busy) || loading} onClick={() => void handleSave()}>
            {busy === 'save' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {tx('儲存模板', 'Save template')}
          </Button>
          <Button type="button" disabled={Boolean(busy) || loading || Boolean(problem)} onClick={() => void handleSend()}>
            {busy === 'send' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}
            {busy === 'send' ? tx('正在寄出', 'Sending') : tx('立即發送', 'Send now')}
          </Button>
        </>
      }
    >
      <div className="h-[min(72vh,760px)]">
      {loading ? (
        <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {tx('正在讀取郵件狀態', 'Loading email status')}
        </p>
      ) : (
        <div className="grid h-full gap-4 lg:grid-cols-[minmax(280px,24rem)_minmax(0,1fr)]">
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          {!error && problem ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {quoteEmailProblemText(problem, errorLocale)}
            </p>
          ) : null}

          <div className="space-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-md border bg-background px-2 py-0.5 font-medium">{statusLabel}</span>
              {status?.auto_follow_up ? <span className="text-muted-foreground">{tx('每 3 天自動跟進', 'Follow up every 3 days')}</span> : null}
              {status?.first_viewed_at ? <span className="text-muted-foreground">{tx('首次查看', 'First viewed')} {status.first_viewed_at.slice(0, 16).replace('T', ' ')}</span> : null}
              {status?.next_follow_up_at && status.auto_follow_up ? (
                <span className="text-muted-foreground">{tx('下次跟進', 'Next follow-up')} {status.next_follow_up_at.slice(0, 16).replace('T', ' ')}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                ref={viewHistoryButtonRef}
                type="button"
                size="sm"
                variant="outline"
                aria-haspopup="dialog"
                disabled={!status}
                onClick={() => setViewHistoryOpen(true)}
              >
                <History className="mr-1 h-3.5 w-3.5" />
                {tx('查看記錄', 'View history')}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void handleStop()}>
                <StopCircle className="mr-1 h-3.5 w-3.5" />
                {tx('停止自動跟進', 'Stop auto follow-up')}
              </Button>
            </div>
          </div>

          <label className="block text-sm">
            {tx('客戶收件電郵', 'Customer email')}
            <Input
              className="mt-1"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="customer@example.com"
              inputMode="email"
              autoComplete="off"
            />
            <span className="mt-1 block text-xs text-muted-foreground">{tx('發送前會再次核對格式；不會自動猜測或補上其他地址。', 'The address is checked again before sending. No other address is guessed or added.')}</span>
          </label>

          <label className="block text-sm">
            {tx('負責同事聯絡電話（固定第二段）', 'Colleague phone (fixed second section)')}
            <Input
              className="mt-1"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder={tx('例如 +852 9000 0000', 'e.g. +852 9000 0000')}
              autoComplete="off"
            />
            <span className="mt-1 block text-xs text-muted-foreground">{tx('沒有填電話就不會發送，因為客戶要有可直接聯絡的號碼。', 'The email is not sent without a phone number the customer can call.')}</span>
          </label>

          <label className="block text-sm">
            {tx('稱呼', 'Greeting')}
            <Input
              className="mt-1"
              value={greeting}
              maxLength={200}
              onChange={(event) => setGreeting(event.target.value)}
              onBlur={(event) => setPreviewGreeting(event.target.value)}
              placeholder={tx('例如：Dear Angela Fung,', 'e.g. Dear Angela Fung,')}
              autoComplete="off"
            />
          </label>

          <label className="block text-sm">
            {tx('報價內容簡述（固定第一段，可加引言）', 'Quotation summary (fixed first section, optional intro)')}
            <Textarea
              className="mt-1"
              rows={3}
              value={intro}
              maxLength={2000}
              onChange={(event) => setIntro(event.target.value)}
              onBlur={(event) => setPreviewIntro(event.target.value)}
              placeholder={tx('例如：以下是按你提供的平面圖整理的傢俬方案。', 'e.g. Here is the furniture scheme prepared from your floor plan.')}
            />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{tx('附加自訂內容（可選）', 'Extra sections (optional)')}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sections.length >= 10}
                onClick={() => {
                  setSections((current) => [...current, { title: '', body: '' }]);
                  setPreviewSections((current) => [...current, { title: '', body: '' }]);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {tx('加一段', 'Add a section')}
              </Button>
            </div>
            {sections.length === 0 ? (
              <p className="text-xs text-muted-foreground">{tx('未加自訂段落。固定三段仍然會出現在郵件內。', 'No extra sections. The three fixed sections still appear in the email.')}</p>
            ) : sections.map((section, index) => (
              <div key={index} className="space-y-1 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={section.title}
                    maxLength={60}
                    onChange={(event) => setSections((current) => current.map((row, i) => (i === index ? { ...row, title: event.target.value } : row)))}
                    onBlur={(event) => setPreviewSections((current) => current.map((row, i) => (i === index ? { ...row, title: event.target.value } : row)))}
                    placeholder={tx('段落標題', 'Section title')}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={tx('移除這一段', 'Remove this section')}
                    onClick={() => {
                      setSections((current) => current.filter((_, i) => i !== index));
                      setPreviewSections((current) => current.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={section.body}
                  maxLength={800}
                  onChange={(event) => setSections((current) => current.map((row, i) => (i === index ? { ...row, body: event.target.value } : row)))}
                  onBlur={(event) => setPreviewSections((current) => current.map((row, i) => (i === index ? { ...row, body: event.target.value } : row)))}
                  placeholder={tx('例如：送貨及安裝日期會另行確認。', 'e.g. Delivery and installation dates will be confirmed separately.')}
                />
              </div>
            ))}
          </div>

          {status?.messages.length ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{tx('發送紀錄', 'Send history')}</p>
              <ul className="space-y-1 text-xs">
                {status.messages.map((message) => (
                  <li key={message.id} className="flex flex-wrap gap-2 rounded border px-2 py-1">
                    <span className="font-medium">{message.kind === 'manual' ? tx('手動', 'Manual') : tx('自動跟進', 'Auto follow-up')}</span>
                    <span>{message.status}</span>
                    <span className="text-muted-foreground">{message.to_email}</span>
                    {message.attempts > 1 ? <span className="text-muted-foreground">{tx(`嘗試 ${message.attempts}`, `${message.attempts} attempts`)}</span> : null}
                    {message.sent_at ? <span className="text-muted-foreground">{message.sent_at.slice(0, 16).replace('T', ' ')}</span> : null}
                    {message.error ? <span className="text-destructive">{message.error}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <aside className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border bg-white lg:min-h-0">
          <div className="border-b bg-slate-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">{tx('客戶收到的郵件', 'Email the customer receives')}</p>
              <div className="flex gap-1">
                {(Object.entries(QUOTE_EMAIL_LOCALES) as [QuoteEmailLocale, string][]).map(([key, label]) => (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={locale === key ? 'default' : 'outline'}
                    className="h-7 px-2 text-xs"
                    onClick={() => chooseLocale(key)}
                  >
                    {en ? (key === 'en' ? 'English' : key === 'zh-Hans' ? 'Simplified' : 'Traditional') : label}
                  </Button>
                ))}
              </div>
            </div>
            {translatingItems ? (
              <p className="mt-1 text-xs text-slate-500">{tx('正在把傢私名稱譯成英文…', 'Translating furniture names into English…')}</p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500">{tx('主旨：', 'Subject: ')}{customerEmail.subject}</p>
            <p className="truncate text-xs text-slate-500">{tx('收件：', 'To: ')}{recipient.trim() || tx('（未填收件電郵）', '(no recipient yet)')}</p>
          </div>
          <iframe
            key={customerEmail.html}
            title={tx('客戶收到的郵件', 'Email the customer receives')}
            sandbox=""
            srcDoc={customerEmail.html}
            className="min-h-0 w-full flex-1 bg-[#F1F5FC]"
          />
        </aside>
        </div>
      )}
      </div>
      <Modal
        open={open && viewHistoryOpen}
        onOpenChange={setViewHistoryOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          viewHistoryButtonRef.current?.focus();
        }}
        title={tx('查看記錄', 'View history')}
        description={quote?.quoteId}
        icon={<History className="h-5 w-5" />}
        size="lg"
      >
        {status?.views.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">{tx('時間', 'Time')}</TableHead>
                <TableHead>{tx('結果', 'Result')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.views.map((view, index) => (
                <TableRow key={`${view.viewed_at}-${index}`}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    <time dateTime={view.viewed_at}>{view.viewed_at.slice(0, 16).replace('T', ' ')}</time>
                  </TableCell>
                  <TableCell className={view.is_valid ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
                    {view.is_valid
                      ? tx('有效查看（已停止這張報價的自動跟進）', 'Valid view (auto follow-up stopped for this quotation)')
                      : tx(
                        `未計為查看${view.reason ? `：${view.reason}` : ''}`,
                        `Not counted as a view${view.reason ? `: ${view.reason}` : ''}`,
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{tx('暫無查看記錄。', 'No views yet.')}</p>
        )}
      </Modal>
    </Modal>
  );
}
