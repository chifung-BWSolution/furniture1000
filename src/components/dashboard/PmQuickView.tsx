import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calculator, FileText } from 'lucide-react';
import { PM_PRO_PDF_PATH, pmInquiryPath } from '@/content/bwaPm';
import {
  getFurnitureInquiry,
  inquiryErrorMessage,
  inquiryStatusLabel,
  saveFurnitureInquiry,
  sendFurnitureInquiry,
  type BwaInquiryStatus,
} from '@/lib/bwaFurnitureInquiry';
import { formatListMoney } from '@/lib/listTableUtils';
import { Button } from '@/components/ui/button';

interface DraftLine {
  key: string;
  name: string;
  spec: string;
  quantity: string;
  unit: string;
  returnedUnitPrice: number | null;
}

function blankLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    name: '',
    spec: '',
    quantity: '1',
    unit: '',
    returnedUnitPrice: null,
  };
}

function money(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '未回覆';
  const text = formatListMoney(value);
  return text === 'N/A' ? '未回覆' : `HK$ ${text}`;
}

export function PmQuickView() {
  const [params, setParams] = useSearchParams();
  const inquiryId = (params.get('inquiry') || '').trim();
  const [projectRef, setProjectRef] = useState('');
  const [projectName, setProjectName] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [status, setStatus] = useState<BwaInquiryStatus>('draft');
  const [loading, setLoading] = useState(Boolean(inquiryId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!inquiryId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getFurnitureInquiry(inquiryId).then((result) => {
      if (cancelled) return;
      if (result.error || !result.inquiry) {
        setMessage(result.error ? inquiryErrorMessage(result.error) : '找不到這張詢價。');
        setLoading(false);
        return;
      }
      const inquiry = result.inquiry;
      setProjectRef(inquiry.bwa_project_ref);
      setProjectName(inquiry.bwa_project_name);
      setNote(inquiry.note);
      setStatus(inquiry.status);
      setLines(
        inquiry.items.length > 0
          ? inquiry.items.map((item) => ({
            key: item.id,
            name: item.name,
            spec: item.spec,
            quantity: String(item.quantity),
            unit: item.unit,
            returnedUnitPrice: item.returned_unit_price,
          }))
          : [blankLine()],
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [inquiryId]);

  const locked = status !== 'draft';

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const payload = () => ({
    id: inquiryId || null,
    projectRef,
    projectName,
    note,
    items: lines.map((line) => ({
      name: line.name.trim(),
      spec: line.spec.trim(),
      quantity: Number(line.quantity) || 0,
      unit: line.unit.trim(),
    })),
  });

  const save = async () => {
    setSaving(true);
    setMessage('');
    const result = await saveFurnitureInquiry(payload());
    setSaving(false);
    if (result.error || !result.id) {
      setMessage(inquiryErrorMessage(result.error));
      return null;
    }
    if (result.id !== inquiryId) {
      const next = new URLSearchParams(params);
      next.set('inquiry', result.id);
      setParams(next, { replace: true });
    }
    setMessage('已儲存草稿。');
    return result.id;
  };

  const send = async () => {
    setSaving(true);
    setMessage('');
    const saved = await saveFurnitureInquiry(payload());
    if (saved.error || !saved.id) {
      setSaving(false);
      setMessage(inquiryErrorMessage(saved.error));
      return;
    }
    const error = await sendFurnitureInquiry(saved.id);
    setSaving(false);
    if (error) {
      setMessage(inquiryErrorMessage(error));
      if (saved.id !== inquiryId) {
        const next = new URLSearchParams(params);
        next.set('inquiry', saved.id);
        setParams(next, { replace: true });
      }
      return;
    }
    setStatus('sent');
    if (saved.id !== inquiryId) {
      const next = new URLSearchParams(params);
      next.set('inquiry', saved.id);
      setParams(next, { replace: true });
    }
    setMessage('已送給 BWF。回覆的賣價會出現在每一列，不能在這裡改。');
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50 text-foreground dark:bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 md:px-6">
        <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            PM報價 · BWA
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold">
            <Calculator className="h-5 w-5 text-primary" />
            傢俬詢價
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            填工程編號和傢俬項目，送給 BWF。賣價由 BWF 回覆，這一頁只讀。
          </p>
          <p className="mt-2 text-sm font-semibold">{inquiryStatusLabel(status)}</p>
        </section>

        {loading && <p className="px-2 text-sm text-muted-foreground">載入詢價…</p>}
        {!loading && (
          <section className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                工程編號
                <input
                  value={projectRef}
                  disabled={locked}
                  onChange={(event) => setProjectRef(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 disabled:opacity-60"
                />
              </label>
              <label className="text-sm">
                工程名稱
                <input
                  value={projectName}
                  disabled={locked}
                  onChange={(event) => setProjectName(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 disabled:opacity-60"
                />
              </label>
            </div>
            <label className="block text-sm">
              備註
              <textarea
                value={note}
                disabled={locked}
                onChange={(event) => setNote(event.target.value)}
                className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-60"
              />
            </label>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={line.key} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1.4fr_1.4fr_5rem_5rem_7rem_auto]">
                  <label className="text-xs text-muted-foreground">
                    項目 {index + 1}
                    <input
                      aria-label={`項目 ${index + 1} 名稱`}
                      value={line.name}
                      disabled={locked}
                      onChange={(event) => updateLine(line.key, { name: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    規格
                    <input
                      aria-label={`項目 ${index + 1} 規格`}
                      value={line.spec}
                      disabled={locked}
                      onChange={(event) => updateLine(line.key, { spec: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    數量
                    <input
                      aria-label={`項目 ${index + 1} 數量`}
                      value={line.quantity}
                      disabled={locked}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    單位
                    <input
                      aria-label={`項目 ${index + 1} 單位`}
                      value={line.unit}
                      disabled={locked}
                      onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
                    />
                  </label>
                  <div className="text-xs text-muted-foreground">
                    BWF 賣價
                    <p className="mt-1 flex h-10 items-center text-sm font-semibold text-foreground">
                      {money(line.returnedUnitPrice)}
                    </p>
                  </div>
                  {!locked && lines.length > 1 && (
                    <button
                      type="button"
                      className="self-end text-xs text-muted-foreground underline"
                      onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    >
                      移除
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {!locked && (
                <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, blankLine()])}>
                  加一項
                </Button>
              )}
              {!locked && (
                <Button type="button" variant="outline" disabled={saving} onClick={() => void save()}>
                  儲存草稿
                </Button>
              )}
              {!locked && (
                <Button type="button" disabled={saving} onClick={() => void send()}>
                  送給 BWF
                </Button>
              )}
              {inquiryId && (
                <Link
                  to={pmInquiryPath(PM_PRO_PDF_PATH, inquiryId)}
                  className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-semibold"
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  說明
                </Link>
              )}
            </div>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
