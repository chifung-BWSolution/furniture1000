import { translateQuoteEmailDraft } from '@/lib/quoteEmailTranslation';
import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePlatformRole } from '@/hooks/use-platform-role';
import { getQuoteEmailFooterEditorId, listQuoteEmailFooters, saveQuoteEmailFooter, type QuoteEmailFooterRow } from '@/lib/quoteEmailFooters';

const footerFields = [
  { key: 'body_zh_hant', label: '繁體', locale: 'zh-Hant' },
  { key: 'body_zh_hans', label: '简体', locale: 'zh-Hans' },
  { key: 'body_en', label: '英文', locale: 'en' },
] as const;

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
    void listQuoteEmailFooters().then((items) => {
      if (!cancelled) setRows(items);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : '讀取頁尾模板失敗');
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
      toast.error(err instanceof Error ? err.message : '翻譯頁尾模板失敗');
    } finally {
      setTranslating(false);
    }
  };

  const save = async () => {
    if (!draft || !canEdit) return;
    setSaving(true);
    try {
      const next = {
        ...draft,
        body_zh_hant: draft.body_zh_hant.trim(),
        body_zh_hans: draft.body_zh_hans.trim(),
        body_en: draft.body_en.trim(),
      };
      await saveQuoteEmailFooter(next);
      setRows((current) => current.map((row) => row.pms_staff_id === next.pms_staff_id ? next : row));
      setDraft(null);
      toast.success('已儲存頁尾模板');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '儲存頁尾模板失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full space-y-4 fds-page-padding">
        <header className="fds-page-header">
          <h1 className="fds-page-title"><Mail className="h-5 w-5 text-primary" />電郵設定</h1>
          <p className="fds-page-description">報價通知和自動跟進會使用報價上項目經理的頁尾模板。</p>
        </header>
        <section className="overflow-hidden rounded-xl border bg-card" aria-label="電郵頁尾模板">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/4">項目經理</TableHead>
                <TableHead>頁尾模板</TableHead>
                <TableHead className="w-24"><span className="sr-only">操作</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading || error || rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="px-4 py-6 text-muted-foreground">
                    {loading ? '正在讀取頁尾模板…' : error ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span role="alert" className="text-destructive">{error}</span>
                        <Button type="button" size="sm" variant="outline" onClick={() => setLoadVersion((value) => value + 1)}>重試</Button>
                      </div>
                    ) : '目前沒有在職 PM 的頁尾模板。'}
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => (
                <TableRow key={row.pms_staff_id}>
                  <TableCell className="whitespace-normal align-top font-medium">{row.pm_name}</TableCell>
                  <TableCell className="whitespace-pre-line break-words align-top text-muted-foreground">
                    {row.body_zh_hant || '—'}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <Button type="button" size="sm" variant="outline" onClick={() => setDraft(row)}>
                      {profileRole === 'admin' || (profileRole === 'pm' && staffId === row.pms_staff_id) ? '編輯' : '查看'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
      <Modal
        open={draft !== null}
        onOpenChange={(open) => { if (!open && !busy) setDraft(null); }}
        title="電郵頁尾模板"
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
                  rows={3}
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
