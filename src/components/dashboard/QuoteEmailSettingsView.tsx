import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePlatformRole } from '@/hooks/use-platform-role';
import {
  getQuoteEmailFooterEditorId,
  listQuoteEmailFooters,
  loadQuoteEmailBcc,
  saveQuoteEmailBcc,
  presentQuoteEmailSignature,
  quoteEmailSenderDraft,
  saveQuoteEmailFooter,
  type QuoteEmailFooterRow,
} from '@/lib/quoteEmailFooters';

function senderDraft(row: QuoteEmailFooterRow): QuoteEmailFooterRow {
  return { ...row, ...quoteEmailSenderDraft(row) };
}

export function QuoteEmailSettingsView() {
  const { profileRole } = usePlatformRole();
  const [rows, setRows] = useState<QuoteEmailFooterRow[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuoteEmailFooterRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const busy = saving;
  const [error, setError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  const [bcc, setBcc] = useState('');
  const [bccDraft, setBccDraft] = useState<string | null>(null);
  const [bccError, setBccError] = useState('');
  const [bccLoadError, setBccLoadError] = useState('');
  const [bccSaving, setBccSaving] = useState(false);
  const canEdit = draft && (profileRole === 'admin' || (profileRole === 'pm' && staffId === draft.pms_staff_id));

  useEffect(() => {
    let cancelled = false;
    if (profileRole === 'pm') {
      void getQuoteEmailFooterEditorId().then((id) => {
        if (!cancelled) setStaffId(id);
      }).catch(() => {
        if (!cancelled) setStaffId(null);
      });
    }
    return () => { cancelled = true; };
  }, [profileRole]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setBccLoadError('');
    void Promise.all([
      listQuoteEmailFooters(),
      loadQuoteEmailBcc().then(
        (value) => ({ value, error: '' }),
        (err: unknown) => ({ value: '', error: err instanceof Error ? err.message : '讀取團隊電郵失敗' }),
      ),
    ]).then(([items, delivery]) => {
      if (cancelled) return;
      setRows(items);
      setBcc(delivery.value);
      setBccLoadError(delivery.error);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : '讀取寄件人資料失敗');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadVersion]);

  const save = async () => {
    if (!draft || !canEdit) return;
    if (!draft.sender_name.trim()) {
      toast.error('請填寫姓名');
      return;
    }
    setSaving(true);
    try {
      const closing = draft.body_zh_hant.trim();
      const next = {
        ...draft,
        sender_name: draft.sender_name.trim(),
        phone: draft.phone.trim(),
        body_zh_hant: closing,
        body_zh_hans: closing,
        body_en: closing,
      };
      await saveQuoteEmailFooter(next);
      setRows((current) => current.map((row) => row.pms_staff_id === next.pms_staff_id ? next : row));
      setDraft(null);
      toast.success('已儲存寄件人資料');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '儲存寄件人資料失敗');
    } finally {
      setSaving(false);
    }
  };

  const saveBcc = async () => {
    if (bccDraft === null || bccSaving) return;
    setBccSaving(true);
    setBccError('');
    try {
      await saveQuoteEmailBcc(bccDraft);
      setBcc(bccDraft.trim());
      setBccDraft(null);
      toast.success('已儲存團隊電郵');
    } catch (err) {
      setBccError(err instanceof Error ? err.message : '儲存團隊電郵失敗');
    } finally {
      setBccSaving(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full space-y-4 fds-page-padding">
        <header className="fds-page-header">
          <h1 className="fds-page-title"><Mail className="h-5 w-5 text-primary" />電郵設定</h1>
          <p className="fds-page-description">報價電郵會帶上負責同事的姓名、電話和下款。團隊電郵會收到每封報價信的密件副本。</p>
        </header>
        <button
          type="button"
          onClick={() => {
            setBccError(bccLoadError);
            setBccDraft(bcc);
          }}
          className="flex w-full items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">團隊電郵 BCC</span>
            <span className="mt-1 block truncate text-sm text-muted-foreground">
              {bccLoadError || (bcc.trim() ? bcc : '未設定，寄出時不會密件副本')}
            </span>
          </span>
          <span className="shrink-0 text-sm font-medium text-primary">設定</span>
        </button>
        <section className="overflow-hidden rounded-xl border bg-card" aria-label="寄件人資料">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">項目經理</TableHead>
                <TableHead className="w-36">姓名</TableHead>
                <TableHead className="w-40">電話</TableHead>
                <TableHead>下款</TableHead>
                <TableHead className="w-24"><span className="sr-only">操作</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading || error || rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="px-4 py-6 text-muted-foreground">
                    {loading ? '正在讀取寄件人資料…' : error ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span role="alert" className="text-destructive">{error}</span>
                        <Button type="button" size="sm" variant="outline" onClick={() => setLoadVersion((value) => value + 1)}>重試</Button>
                      </div>
                    ) : '目前沒有在職 PM 的寄件人資料。'}
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => {
                const shown = senderDraft(row);
                const editable = profileRole === 'admin' || (profileRole === 'pm' && staffId === row.pms_staff_id);
                return (
                  <TableRow key={row.pms_staff_id}>
                    <TableCell className="whitespace-normal align-top font-medium">{row.pm_name}</TableCell>
                    <TableCell className="whitespace-normal align-top">{shown.sender_name || '—'}</TableCell>
                    <TableCell className="whitespace-normal align-top">{shown.phone || '—'}</TableCell>
                    <TableCell className="whitespace-pre-wrap break-words align-top text-muted-foreground">
                      <span className="line-clamp-3">
                        {presentQuoteEmailSignature({
                          name: shown.sender_name,
                          phone: shown.phone,
                          body: shown.body_zh_hant,
                          locale: 'zh-Hant',
                        }) || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Button type="button" size="sm" variant="outline" onClick={() => setDraft(shown)}>
                        {editable ? '編輯' : '查看'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      </div>
      <Modal
        open={bccDraft !== null}
        onOpenChange={(open) => { if (!open && !bccSaving) setBccDraft(null); }}
        title="團隊電郵 BCC"
        description="客戶看不到這個地址。之後寄出的報價電郵都會密件抄送到這裡。"
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" disabled={bccSaving} onClick={() => setBccDraft(null)}>關閉</Button>
            <Button type="button" disabled={bccSaving} onClick={() => void saveBcc()}>
              {bccSaving ? '正在儲存…' : '儲存'}
            </Button>
          </>
        }
      >
        <div className="space-y-1.5 text-sm">
          <label className="font-medium" htmlFor="quote-email-bcc">團隊電郵</label>
          <Input
            id="quote-email-bcc"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={320}
            value={bccDraft ?? ''}
            disabled={bccSaving}
            placeholder="sale@bwteam-furniture.com"
            onChange={(event) => setBccDraft(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">留空就不再密件副本。</p>
          {bccError ? <p role="alert" className="text-sm text-destructive">{bccError}</p> : null}
        </div>
      </Modal>
      <Modal
        open={draft !== null}
        onOpenChange={(open) => { if (!open && !busy) setDraft(null); }}
        title="寄件人資料"
        description={draft?.pm_name}
        size="lg"
        footer={
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>關閉</Button>
            {canEdit && (
              <Button type="button" disabled={busy} onClick={() => void save()}>
                {saving ? '正在儲存…' : '儲存'}
              </Button>
            )}
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 text-sm">
                <label className="font-medium" htmlFor="quote-email-sender-name">姓名</label>
                <Input
                  id="quote-email-sender-name"
                  value={draft.sender_name}
                  maxLength={120}
                  readOnly={!canEdit || busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => current ? { ...current, sender_name: value } : current);
                  }}
                />
              </div>
              <div className="space-y-1.5 text-sm">
                <label className="font-medium" htmlFor="quote-email-sender-phone">電話</label>
                <Input
                  id="quote-email-sender-phone"
                  value={draft.phone}
                  maxLength={80}
                  readOnly={!canEdit || busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => current ? { ...current, phone: value } : current);
                  }}
                />
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5 text-sm">
                <label className="font-medium" htmlFor="quote-email-footer">下款</label>
                <Textarea
                  id="quote-email-footer"
                  value={draft.body_zh_hant}
                  rows={10}
                  maxLength={2000}
                  readOnly={!canEdit || busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => current ? { ...current, body_zh_hant: value } : current);
                  }}
                />
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="font-medium">合成後</p>
                <div className="min-h-40 whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 leading-6">
                  {presentQuoteEmailSignature({
                    name: draft.sender_name,
                    phone: draft.phone,
                    body: draft.body_zh_hant,
                    locale: 'zh-Hant',
                  }) || '填寫姓名、電話或下款後，這裡會顯示客戶看到的內容。'}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
