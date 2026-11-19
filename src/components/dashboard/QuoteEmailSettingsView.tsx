import { translateQuoteEmailDraft } from '@/lib/quoteEmailTranslation';
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
  quoteEmailSenderDraft,
  saveQuoteEmailFooter,
  type QuoteEmailFooterRow,
} from '@/lib/quoteEmailFooters';

const footerFields = [
  { key: 'body_zh_hant', label: '繁體', locale: 'zh-Hant' },
  { key: 'body_zh_hans', label: '简体', locale: 'zh-Hans' },
  { key: 'body_en', label: '英文', locale: 'en' },
] as const;

function closingPreview(text: string): string {
  const line = text.trim().split('\n').find((row) => row.trim()) ?? '';
  if (!line) return '—';
  return line.length > 72 ? `${line.slice(0, 72)}…` : line;
}

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
  const [translating, setTranslating] = useState(false);
  const busy = saving || translating;
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

  const translateFooter = async (source: typeof footerFields[number]) => {
    if (!draft || !canEdit || busy || !draft[source.key].trim()) return;
    const targets = footerFields.filter(({ key }) => key !== source.key);
    setTranslating(true);
    try {
      const results = await Promise.all(targets.map(async ({ key, locale }) => {
        const [text] = await translateQuoteEmailDraft([draft[source.key]], locale, [2000]);
        return [key, text] as const;
      }));
      setDraft({ ...draft, ...Object.fromEntries(results) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '翻譯下款失敗');
    } finally {
      setTranslating(false);
    }
  };

  const save = async () => {
    if (!draft || !canEdit) return;
    if (!draft.sender_name.trim()) {
      toast.error('請填寫姓名');
      return;
    }
    setSaving(true);
    try {
      const next = {
        ...draft,
        sender_name: draft.sender_name.trim(),
        phone: draft.phone.trim(),
        body_zh_hant: draft.body_zh_hant.trim(),
        body_zh_hans: draft.body_zh_hans.trim(),
        body_en: draft.body_en.trim(),
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
                    <TableCell className="whitespace-normal break-words align-top text-muted-foreground">
                      {closingPreview(shown.body_zh_hant)}
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
        size="md"
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
            <p className="text-sm font-medium">下款</p>
            {footerFields.map((field) => (
              <div className="space-y-1.5 text-sm" key={field.key}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="font-medium" htmlFor={'quote-email-footer-' + field.key}>{field.label}</label>
                  {canEdit && (
                    <Button type="button" size="sm" variant="ghost"
                      disabled={busy || !draft[field.key].trim()} onClick={() => void translateFooter(field)}>
                      {translating ? '翻譯中…' : '從' + field.label + '翻譯到其他版本'}
                    </Button>
                  )}
                </div>
                <Textarea
                  id={'quote-email-footer-' + field.key}
                  value={draft[field.key]}
                  rows={5}
                  maxLength={2000}
                  readOnly={!canEdit || busy}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => current ? { ...current, [field.key]: value } : current);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
