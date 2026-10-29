import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Plus, StopCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { confirm } from '@/components/ui/confirm-dialog';
import { buildCustomerPortalQuoteShareUrl } from '@/lib/customerPortalRoutes';
import {
  QUOTE_EMAIL_PROBLEM_TEXT,
  QUOTE_EMAIL_STATUS_LABELS,
  buildQuoteEmailSections,
  dispatchQuoteEmailsNow,
  loadQuoteEmailStatus,
  normalizeCustomQuoteEmailSections,
  quoteEmailErrorMessage,
  quoteEmailReadiness,
  saveQuoteEmailTemplate,
  scheduleQuoteEmail,
  stopQuoteEmail,
  type QuoteEmailCustomSection,
  type QuoteEmailStatusData,
} from '@/lib/quoteEmailFollowUp';

export interface QuoteEmailFollowUpQuote {
  id: string;
  quoteId: string;
  clientEmail?: string | null;
  clientName?: string | null;
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
  const [phone, setPhone] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sections, setSections] = useState<QuoteEmailCustomSection[]>([]);

  const quoteId = quote?.id ?? '';

  useEffect(() => {
    if (!open || !quoteId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setStatus(null);
    void loadQuoteEmailStatus(quoteId)
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        setIntro(data?.intro_text ?? '');
        setPhone(data?.contact_phone ?? '');
        setRecipient(data?.recipient_email || quote?.clientEmail || '');
        setSections(normalizeCustomQuoteEmailSections(data?.custom_sections));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(quoteEmailErrorMessage(err));
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
  }, [open, quoteId]);

  const quoteUrl = useMemo(() => {
    if (!status?.share_token) return '';
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return origin ? buildCustomerPortalQuoteShareUrl(origin, status.share_token) : '';
  }, [status?.share_token]);

  const previewSections = useMemo(() => buildQuoteEmailSections({
    itemCount: status?.item_count ?? 0,
    totalCents: Math.round((status?.total_amount ?? 0) * 100),
    sampleItems: status?.sample_items ?? null,
    introText: intro,
    contactPhone: phone,
    quoteUrl,
    customSections: sections,
  }), [status, intro, phone, quoteUrl, sections]);

  const problem = quoteEmailReadiness({ recipient, contactPhone: phone, shareToken: status?.share_token ?? null });
  const statusLabel = QUOTE_EMAIL_STATUS_LABELS[status?.status ?? 'not_sent'];

  const persistTemplate = async () => {
    if (!quote) return false;
    try {
      await saveQuoteEmailTemplate({
        quoteUuid: quote.id,
        introText: intro,
        contactPhone: phone,
        customSections: sections,
      });
      return true;
    } catch (err) {
      setError(quoteEmailErrorMessage(err));
      return false;
    }
  };

  const handleSave = async () => {
    setBusy('save');
    setError('');
    const ok = await persistTemplate();
    setBusy(null);
    if (ok) {
      toast.success('郵件模板已儲存');
      setStatus(await loadQuoteEmailStatus(quote!.id).catch(() => status));
    }
  };

  const handleSend = async () => {
    if (!quote) return;
    if (problem) {
      setError(QUOTE_EMAIL_PROBLEM_TEXT[problem]);
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
        toast.success('已寄出', {
          description: `已寄到 ${recipient.trim()}；客戶首次有效查看後，只會停止這張單的自動跟進。`,
        });
        return;
      }
      toast.info('已排入發送，最遲 15 分鐘內寄出', {
        description: dispatch.error
          ? `即時寄出未成功（${dispatch.error}），郵件仍在隊列，系統會自動補寄。`
          : '系統會在背景寄出；客戶首次有效查看後，只會停止這張單的自動跟進。',
      });
    } catch (err) {
      setError(quoteEmailErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const handleStop = async () => {
    if (!quote) return;
    const ok = await confirm({
      title: '停止這張報價的自動跟進？',
      description: '停止後不會再自動發跟進信。其他報價不受影響，已排隊的跟進信會取消。',
      confirmLabel: '停止自動跟進',
      cancelLabel: '返回',
      destructive: true,
    });
    if (!ok) return;
    setBusy('stop');
    setError('');
    try {
      await stopQuoteEmail(quote.id, 'manual');
      setStatus(await loadQuoteEmailStatus(quote.id));
      toast.success('已停止自動跟進');
    } catch (err) {
      setError(quoteEmailErrorMessage(err));
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
      title="郵件模板與跟進"
      description={quote ? `${quote.quoteId}${quote.clientName ? ` · ${quote.clientName}` : ''}` : undefined}
      size="4xl"
      footer={
        <>
          <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => onOpenChange(false)}>
            關閉
          </Button>
          <Button type="button" variant="outline" disabled={Boolean(busy) || loading} onClick={() => void handleSave()}>
            {busy === 'save' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            儲存模板
          </Button>
          <Button type="button" disabled={Boolean(busy) || loading || Boolean(problem)} onClick={() => void handleSend()}>
            {busy === 'send' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}
            {busy === 'send' ? '正在寄出' : '立即發送'}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在讀取郵件狀態
        </p>
      ) : (
        <div className="space-y-4">
          {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          {!error && problem ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {QUOTE_EMAIL_PROBLEM_TEXT[problem]}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="rounded-md border bg-background px-2 py-0.5 font-medium">{statusLabel}</span>
            {status?.auto_follow_up ? <span className="text-muted-foreground">每 3 天自動跟進</span> : null}
            {status?.first_viewed_at ? <span className="text-muted-foreground">首次查看 {status.first_viewed_at.slice(0, 16).replace('T', ' ')}</span> : null}
            {status?.next_follow_up_at && status.auto_follow_up ? (
              <span className="text-muted-foreground">下次跟進 {status.next_follow_up_at.slice(0, 16).replace('T', ' ')}</span>
            ) : null}
            <span className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void handleStop()}>
                <StopCircle className="mr-1 h-3.5 w-3.5" />
                停止自動跟進
              </Button>
            </span>
          </div>

          <label className="block text-sm">
            客戶收件電郵
            <Input
              className="mt-1"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="customer@example.com"
              inputMode="email"
              autoComplete="off"
            />
            <span className="mt-1 block text-xs text-muted-foreground">發送前會再次核對格式；不會自動猜測或補上其他地址。</span>
          </label>

          <label className="block text-sm">
            負責同事聯絡電話（固定第二段）
            <Input
              className="mt-1"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="例如 +852 9000 0000"
              autoComplete="off"
            />
            <span className="mt-1 block text-xs text-muted-foreground">沒有填電話就不會發送，因為客戶要有可直接聯絡的號碼。</span>
          </label>

          <label className="block text-sm">
            報價內容簡述（固定第一段，可加引言）
            <Textarea
              className="mt-1"
              rows={3}
              value={intro}
              maxLength={2000}
              onChange={(event) => setIntro(event.target.value)}
              placeholder="例如：以下是按你提供的平面圖整理的傢俬方案。"
            />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">附加自訂內容（可選）</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={sections.length >= 10}
                onClick={() => setSections((current) => [...current, { title: '', body: '' }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                加一段
              </Button>
            </div>
            {sections.length === 0 ? (
              <p className="text-xs text-muted-foreground">未加自訂段落。固定三段仍然會出現在郵件內。</p>
            ) : sections.map((section, index) => (
              <div key={index} className="space-y-1 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={section.title}
                    maxLength={60}
                    onChange={(event) => setSections((current) => current.map((row, i) => (i === index ? { ...row, title: event.target.value } : row)))}
                    placeholder="段落標題"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="移除這一段"
                    onClick={() => setSections((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={section.body}
                  maxLength={800}
                  onChange={(event) => setSections((current) => current.map((row, i) => (i === index ? { ...row, body: event.target.value } : row)))}
                  placeholder="例如：送貨及安裝日期會另行確認。"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border bg-background p-3">
            <p className="text-sm font-medium">郵件內容預覽</p>
            <p className="text-xs text-muted-foreground">固定三段不可刪除；發送時會用這張單當下的模板與報價現況。按「立即發送」會即時寄出，寄不出時留在隊列，15 分鐘內自動補寄。</p>
            {previewSections.map((section) => (
              <div key={section.key} className="rounded-md border border-border/60 px-2.5 py-2">
                <p className="text-xs font-semibold text-foreground">{section.label}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{section.body}</p>
              </div>
            ))}
          </div>

          {status?.messages.length ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">發送紀錄</p>
              <ul className="space-y-1 text-xs">
                {status.messages.map((message) => (
                  <li key={message.id} className="flex flex-wrap gap-2 rounded border px-2 py-1">
                    <span className="font-medium">{message.kind === 'manual' ? '手動' : '自動跟進'}</span>
                    <span>{message.status}</span>
                    <span className="text-muted-foreground">{message.to_email}</span>
                    {message.attempts > 1 ? <span className="text-muted-foreground">嘗試 {message.attempts}</span> : null}
                    {message.sent_at ? <span className="text-muted-foreground">{message.sent_at.slice(0, 16).replace('T', ' ')}</span> : null}
                    {message.error ? <span className="text-destructive">{message.error}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {status?.views.length ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">查看紀錄</p>
              <ul className="space-y-1 text-xs">
                {status.views.map((view, index) => (
                  <li key={`${view.viewed_at}-${index}`} className="rounded border px-2 py-1">
                    <span className="text-muted-foreground">{view.viewed_at.slice(0, 16).replace('T', ' ')}</span>
                    <span className={view.is_valid ? 'ml-2 text-emerald-700' : 'ml-2 text-muted-foreground'}>
                      {view.is_valid ? '有效查看（已停這張單的自動信）' : `未計為查看${view.reason ? `：${view.reason}` : ''}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
