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
import { searchBwaWorks, type BwaWorkOption } from '@/lib/bwaWorks';
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

function workKindLabel(kind: BwaWorkOption['kind']): string {
  return kind === 'project' ? '工程' : '提案';
}

function linkLabel(pitchingId: string | null, projectId: string | null): string {
  if (projectId) return '已連到 BWA 工程';
  if (pitchingId) return '已連到 BWA 提案';
  return '';
}

function optionKey(option: BwaWorkOption): string {
  return `${option.kind}:${option.project_id || option.pitching_id || option.code}`;
}

export function PmQuickView() {
  const [params, setParams] = useSearchParams();
  const inquiryId = (params.get('inquiry') || '').trim();
  const [projectRef, setProjectRef] = useState('');
  const [projectName, setProjectName] = useState('');
  const [pitchingId, setPitchingId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [status, setStatus] = useState<BwaInquiryStatus>('draft');
  const [loading, setLoading] = useState(Boolean(inquiryId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [workQuery, setWorkQuery] = useState('');
  const [workOptions, setWorkOptions] = useState<BwaWorkOption[]>([]);
  const [workError, setWorkError] = useState('');
  const [workOpen, setWorkOpen] = useState(false);
  const [workLoading, setWorkLoading] = useState(false);

  useEffect(() => {
    if (!inquiryId) {
      setProjectRef('');
      setProjectName('');
      setPitchingId(null);
      setProjectId(null);
      setNote('');
      setLines([blankLine()]);
      setStatus('draft');
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
      setPitchingId(inquiry.bwa_pitching_id);
      setProjectId(inquiry.bwa_project_id);
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

  useEffect(() => {
    if (locked || !workOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setWorkLoading(true);
      void searchBwaWorks(workQuery).then((result) => {
        if (cancelled) return;
        setWorkOptions(result.items);
        setWorkError(result.error);
        setWorkLoading(false);
      });
    }, workQuery.trim() ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workQuery, workOpen, locked]);

  const clearWorkLink = () => {
    setPitchingId(null);
    setProjectId(null);
  };

  const pickWork = (option: BwaWorkOption) => {
    setProjectRef(option.code);
    setProjectName(option.name);
    setPitchingId(option.pitching_id);
    setProjectId(option.project_id);
    setWorkQuery('');
    setWorkOpen(false);
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const payload = () => ({
    id: inquiryId || null,
    projectRef,
    projectName,
    pitchingId,
    projectId,
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
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <h1 className="fds-page-title">
            <Calculator className="h-5 w-5 text-primary" />
            傢俬詢價
          </h1>
          <p className="fds-page-description">
            從 BWA 工程或提案選一筆，或直接手填編號和名稱，再填傢俬項目送給 BWF。賣價由 BWF 回覆，這一頁只讀。PMS 沒有傢俬明細可以帶入。
          </p>
          <p className="mt-2 text-sm font-semibold">{inquiryStatusLabel(status)}</p>
        </section>

        {loading && <p className="px-2 text-sm text-muted-foreground">載入詢價…</p>}
        {!loading && (
          <section className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            {!locked && (
              <div className="relative">
                <label className="text-sm" htmlFor="bwa-work-search">
                  搜尋 BWA 工程或提案
                  <input
                    id="bwa-work-search"
                    value={workQuery}
                    role="combobox"
                    aria-expanded={workOpen}
                    aria-controls="bwa-work-list"
                    autoComplete="off"
                    placeholder="編號、名稱或客戶"
                    onFocus={() => setWorkOpen(true)}
                    onBlur={() => window.setTimeout(() => setWorkOpen(false), 150)}
                    onChange={(event) => {
                      setWorkQuery(event.target.value);
                      setWorkOpen(true);
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3"
                  />
                </label>
                {workOpen && (
                  <ul
                    id="bwa-work-list"
                    role="listbox"
                    className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-md"
                  >
                    {workLoading && <li className="px-3 py-2 text-sm text-muted-foreground">搜尋中…</li>}
                    {!workLoading && workError && (
                      <li className="px-3 py-2 text-sm text-muted-foreground">{workError}</li>
                    )}
                    {!workLoading && !workError && workOptions.length === 0 && (
                      <li className="px-3 py-2 text-sm text-muted-foreground">
                        沒有符合的工程或提案。可以直接手填下面的編號和名稱。
                      </li>
                    )}
                    {!workLoading && !workError && workOptions.map((option) => (
                      <li key={optionKey(option)}>
                        <button
                          type="button"
                          role="option"
                          className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            pickWork(option);
                          }}
                        >
                          <span className="text-sm font-semibold">
                            {workKindLabel(option.kind)} · {option.code || '無編號'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {option.name || '無名稱'}
                            {option.customer_name && option.customer_name !== option.name ? ` · ${option.customer_name}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                工程編號
                <input
                  value={projectRef}
                  disabled={locked}
                  onChange={(event) => {
                    setProjectRef(event.target.value);
                    clearWorkLink();
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 disabled:opacity-60"
                />
              </label>
              <label className="text-sm">
                工程名稱
                <input
                  value={projectName}
                  disabled={locked}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    clearWorkLink();
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 disabled:opacity-60"
                />
              </label>
            </div>
            {linkLabel(pitchingId, projectId) && (
              <p className="text-xs text-muted-foreground">{linkLabel(pitchingId, projectId)}。手改編號或名稱會改回手填。</p>
            )}
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
