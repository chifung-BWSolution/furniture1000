import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  RefreshCw,
  Send,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { LoadingImage } from '@/components/ui/loading-image';
import { Textarea } from '@/components/ui/textarea';
import {
  formatRfqDateTime,
  openRfqByToken,
  rfqStatusClass,
  rfqStatusLabel,
  submitRfqByToken,
  withdrawRfqByToken,
  type RfqPublicView,
  type RfqSubmitLine,
} from '@/lib/rfq';

interface LineForm {
  unitPrice: string;
  noQuote: boolean;
  leadTime: string;
  validity: string;
  moq: string;
  packageQty: string;
  volume: string;
  alternate: string;
  note: string;
}

const EMPTY_FORM: LineForm = {
  unitPrice: '',
  noQuote: false,
  leadTime: '',
  validity: '',
  moq: '',
  packageQty: '',
  volume: '',
  alternate: '',
  note: '',
};

function formStorageKey(token: string) {
  return `fds:rfq:${token}:form`;
}

function emailStorageKey(token: string) {
  return `fds:rfq:${token}:email`;
}

function idemStorageKey(token: string) {
  return `fds:rfq:${token}:idem`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — form still works in memory */
  }
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `rfq-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function intOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function formFromMy(item: RfqPublicView['items'][number]): LineForm {
  const my = item.my;
  if (!my) return { ...EMPTY_FORM };
  return {
    unitPrice: my.unit_price != null ? String(my.unit_price) : '',
    noQuote: my.no_quote,
    leadTime: my.lead_time_days != null ? String(my.lead_time_days) : '',
    validity: my.validity_days != null ? String(my.validity_days) : '',
    moq: my.moq != null ? String(my.moq) : '',
    packageQty: my.package_qty != null ? String(my.package_qty) : '',
    volume: my.volume != null ? String(my.volume) : '',
    alternate: my.alternate_text ?? '',
    note: my.note ?? '',
  };
}

export function RfqInvitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const { confirm, confirmDialog } = useConfirm();

  const [view, setView] = useState<RfqPublicView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, LineForm>>({});
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [receipt, setReceipt] = useState<{ code: string; version: number } | null>(null);
  const idemRef = useRef<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    const result = await openRfqByToken(token);
    setView(result.view);
    setError(result.error);
    setLoading(false);
    if (result.view) {
      const stored = readJson<Record<string, LineForm>>(
        formStorageKey(token),
        {},
      );
      setForms((current) => {
        const next: Record<string, LineForm> = { ...current, ...stored };
        for (const item of result.view!.items) {
          if (!next[item.id]) next[item.id] = formFromMy(item);
        }
        return next;
      });
    }
  }, [token]);

  useEffect(() => {
    setEmail(localStorage.getItem(emailStorageKey(token)) || '');
    idemRef.current = localStorage.getItem(idemStorageKey(token)) || '';
    void load();
  }, [load, token]);

  useEffect(() => {
    if (!view) return;
    writeJson(formStorageKey(token), forms);
  }, [forms, token, view]);

  useEffect(() => {
    if (!email) return;
    try {
      localStorage.setItem(emailStorageKey(token), email);
    } catch {
      /* ignore */
    }
  }, [email, token]);

  const canSubmit = Boolean(view?.can_submit);
  const submitted = view?.submission?.status === 'submitted';

  const updateForm = (itemId: string, patch: Partial<LineForm>) => {
    setForms((current) => ({
      ...current,
      [itemId]: { ...(current[itemId] ?? EMPTY_FORM), ...patch },
    }));
  };

  const validLineCount = useMemo(() => {
    if (!view) return 0;
    return view.items.filter((item) => {
      const form = forms[item.id];
      if (!form || form.noQuote) return false;
      const price = numberOrNull(form.unitPrice);
      return price != null && price >= 0;
    }).length;
  }, [forms, view]);

  const submit = async () => {
    if (!view || !canSubmit) return;
    if (validLineCount === 0) {
      toast.error('至少要有一行填上有效單價（0 也是有效價）。');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error('請填一個格式正確的電郵。');
      return;
    }

    const lines: RfqSubmitLine[] = view.items.map((item) => {
      const form = forms[item.id] ?? EMPTY_FORM;
      const price = form.noQuote ? null : numberOrNull(form.unitPrice);
      return {
        rfq_item_id: item.id,
        unit_price: price,
        no_quote: form.noQuote,
        lead_time_days: intOrNull(form.leadTime),
        validity_days: intOrNull(form.validity),
        moq: numberOrNull(form.moq),
        package_qty: numberOrNull(form.packageQty),
        volume: numberOrNull(form.volume),
        alternate_text: form.alternate.trim() || null,
        note: form.note.trim() || null,
      };
    });

    if (!idemRef.current) {
      idemRef.current = newIdempotencyKey();
      try {
        localStorage.setItem(idemStorageKey(token), idemRef.current);
      } catch {
        /* ignore */
      }
    }

    setSubmitting(true);
    try {
      const result = await submitRfqByToken(token, lines, email.trim(), idemRef.current);
      if (result.error || !result.receiptCode) {
        toast.error(result.error || '未能提交回價。');
        return;
      }
      setReceipt({ code: result.receiptCode, version: result.version ?? 0 });
      toast.success(`已提交 v${result.version ?? ''}`, {
        description: `回執 ${result.receiptCode}`,
      });
      idemRef.current = '';
      try {
        localStorage.removeItem(idemStorageKey(token));
      } catch {
        /* ignore */
      }
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (!view) return;
    const ok = await confirm({
      title: '撤回這次回價？',
      description: '撤回不會刪除版本，之後仍可在截止前重新提交。',
      confirmLabel: '撤回',
      destructive: true,
    });
    if (!ok) return;
    setWithdrawing(true);
    try {
      const result = await withdrawRfqByToken(token);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('已撤回，仍可在截止前重新提交。');
      setReceipt(null);
      await load();
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">讀取詢價資料…</p>
      </main>
    );
  }

  if (error || !view) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">未能打開這條連結</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error || '連結無效或已過期。'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            請向採購同事確認，索取最新一條連結。
          </p>
          <Button type="button" variant="outline" className="mt-4 gap-2" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            再試一次
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 pb-10">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <p className="font-display text-sm font-semibold">FDS Furniture Design Platform</p>
          <p className="text-xs text-muted-foreground">廠家回價</p>
        </div>
      </header>

      <div className="mx-auto mt-4 w-full max-w-5xl space-y-4 px-4 sm:px-6">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{view.rfq.title}</h1>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${rfqStatusClass(view.rfq.status)}`}>
              {rfqStatusLabel(view.rfq.status)}
            </span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{view.rfq.rfq_no}</span>
            <span>{view.invitation.factory_name || view.invitation.factory_id}</span>
            <span>幣別 {view.rfq.currency}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              截止 {formatRfqDateTime(view.rfq.close_at)}
            </span>
          </p>
          {view.rfq.notes ? (
            <p className="mt-3 whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {view.rfq.notes}
            </p>
          ) : null}
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            這條連結只屬於你廠。你只會看到自己的回價，看不到其他廠的價格。
          </p>
        </section>

        {view.submission ? (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-sm font-medium">
                <BadgeCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                {view.submission.status === 'withdrawn'
                  ? `已撤回 v${view.submission.version}`
                  : `已提交 v${view.submission.version}`}
              </p>
              {canSubmit && submitted ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={withdrawing}
                  onClick={() => void withdraw()}
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {withdrawing ? '撤回中…' : '撤回這次回價'}
                </Button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              回執 {view.submission.receipt_code} · 提交人 {view.submission.submitter_email} ·{' '}
              {formatRfqDateTime(view.submission.submitted_at)}
            </p>
            {receipt ? (
              <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                新版本已儲存：v{receipt.version} · 回執 {receipt.code}
              </p>
            ) : null}
          </section>
        ) : null}

        {!canSubmit ? (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="inline-flex items-center gap-2 font-medium">
              <Clock className="h-4 w-4" aria-hidden="true" />
              已過截止時間
            </p>
            <p className="mt-1">
              不能再提交或撤回。下面只顯示你之前提交的內容；未提交的行會留空。
            </p>
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2 px-1">
            <div>
              <h2 className="text-base font-semibold">回價項目</h2>
              <p className="text-xs text-muted-foreground">
                空白代表不報價；0 是有效價；負數不接受。至少一行有有效單價才可提交。
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              已填 {validLineCount} / {view.items.length} 行
            </Badge>
          </div>

          {view.items.map((item, index) => {
            const form = forms[item.id] ?? EMPTY_FORM;
            const my = item.my;
            const decision = item.decision;
            return (
              <article key={item.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30">
                    {item.image_url ? (
                      <LoadingImage src={item.image_url} alt={item.name} className="h-16 w-16" />
                    ) : (
                      <FileText className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {index + 1}. {item.name}
                      </h3>
                      {item.model ? (
                        <Badge variant="outline" className="font-mono text-xs">
                          {item.model}
                        </Badge>
                      ) : null}
                      {decision === 'awarded' ? (
                        <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" />
                          已得標
                        </Badge>
                      ) : decision === 'not_selected' ? (
                        <Badge variant="outline" className="border-zinc-300 bg-zinc-100 text-zinc-700">
                          未中選
                        </Badge>
                      ) : decision === 'not_awarded' ? (
                        <Badge variant="outline" className="border-zinc-300 bg-zinc-100 text-zinc-700">
                          此行不採購
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          未決定
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.quantity} {item.unit || ''}
                      {item.dimensions ? ` · ${item.dimensions}` : ''}
                      {item.specifications ? ` · ${item.specifications}` : ''}
                    </p>
                    {!my ? <p className="mt-1 text-xs text-muted-foreground">尚未回價這一行。</p> : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block text-xs font-medium text-muted-foreground">
                    單價（{view.rfq.currency}）
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={form.unitPrice}
                      disabled={!canSubmit || form.noQuote}
                      onChange={(event) => updateForm(item.id, { unitPrice: event.target.value })}
                      placeholder={form.noQuote ? '不報價' : '0 也是有效價'}
                      className="mt-1 h-10"
                    />
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <Checkbox
                      checked={form.noQuote}
                      disabled={!canSubmit}
                      onCheckedChange={(checked) => {
                        updateForm(item.id, {
                          noQuote: checked === true,
                          unitPrice: checked === true ? '' : form.unitPrice,
                        });
                      }}
                    />
                    這一行不報價
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    交期（天）
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={form.leadTime}
                      disabled={!canSubmit}
                      onChange={(event) => updateForm(item.id, { leadTime: event.target.value })}
                      placeholder="例如 30"
                      className="mt-1 h-10"
                    />
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    有效期（天）
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={form.validity}
                      disabled={!canSubmit}
                      onChange={(event) => updateForm(item.id, { validity: event.target.value })}
                      placeholder="例如 30"
                      className="mt-1 h-10"
                    />
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    MOQ
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={form.moq}
                      disabled={!canSubmit}
                      onChange={(event) => updateForm(item.id, { moq: event.target.value })}
                      placeholder="最低起訂量"
                      className="mt-1 h-10"
                    />
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    包裝件數
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={form.packageQty}
                      disabled={!canSubmit}
                      onChange={(event) => updateForm(item.id, { packageQty: event.target.value })}
                      placeholder="每箱件數"
                      className="mt-1 h-10"
                    />
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground">
                    體積
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={form.volume}
                      disabled={!canSubmit}
                      onChange={(event) => updateForm(item.id, { volume: event.target.value })}
                      placeholder="例如 CBM"
                      className="mt-1 h-10"
                    />
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-1">
                    替代型號／說明
                    <Input
                      value={form.alternate}
                      disabled={!canSubmit}
                      onChange={(event) => updateForm(item.id, { alternate: event.target.value })}
                      placeholder="未入庫型號可在這裡說明"
                      className="mt-1 h-10"
                    />
                  </label>
                  <label className="block text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-4">
                    備註
                    <Textarea
                      value={form.note}
                      disabled={!canSubmit}
                      onChange={(event) => updateForm(item.id, { note: event.target.value })}
                      placeholder="其他交期、包裝或付款說明"
                      className="mt-1 min-h-[60px]"
                    />
                  </label>
                </div>

                {my && form.moq && Number(form.moq) > Number(item.quantity) ? (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    MOQ 高於詢價數量；仍可提交，採購方會看到提示。
                  </p>
                ) : null}
              </article>
            );
          })}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold">提交回價</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            提交後會產生不可變版本與回執碼。截止前可撤回或再提交新版本。
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block text-sm font-medium">
              填寫人電郵 <span className="text-destructive">*</span>
              <Input
                type="email"
                value={email}
                disabled={!canSubmit}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="你的工作電郵"
                className="mt-1.5 h-10"
              />
            </label>
            <Button
              type="button"
              className="h-10 gap-2"
              disabled={!canSubmit || submitting || validLineCount === 0 || !email.trim()}
              onClick={() => void submit()}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {submitting ? '提交中…' : submitted ? '提交新版本' : '提交回價'}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            未提交的行會留空，不會當成 0。回執與已提交內容會保存在這個瀏覽器；換裝置請保留回執碼。
          </p>
        </section>
      </div>
      {confirmDialog}
    </main>
  );
}
