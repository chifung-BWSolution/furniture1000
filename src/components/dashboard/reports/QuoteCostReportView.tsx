import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fetchCaseShowcase, type CaseOrder } from '@/lib/caseShowcase';
import { loadPitchingsForQuoteRows, type PmsPitchingListItem } from '@/lib/pmsPitchings';
import { buildQuoteEditorPath } from '@/lib/quoteRoutes';
import { attachQuoteCostAssignments, costRatio, fetchQuoteCostRows, quoteCostAssignmentOptions, quoteCostMetrics, summarizeQuoteCosts, type AssignedQuoteCostRow, type QuoteCostRow } from '@/lib/quoteCostReport';

const ALL_STATUSES = '__all__';
const HIDDEN_STATUS_OPTIONS = new Set(['客戶方案', '測試']);
const PAGE_SIZE = 25;
const money = new Intl.NumberFormat('zh-HK', { style: 'currency', currency: 'HKD', currencyDisplay: 'code' });
const percent = new Intl.NumberFormat('zh-HK', { style: 'percent', maximumFractionDigits: 2 });
const metricTextClasses = {
  shipping: 'text-blue-700 dark:text-blue-300',
  installation: 'text-teal-700 dark:text-teal-300',
  combined: 'text-violet-700 dark:text-violet-300',
};
const metricSummaryBackgrounds = {
  shipping: 'bg-blue-50 dark:bg-blue-950/40',
  installation: 'bg-teal-50 dark:bg-teal-950/40',
  combined: 'bg-violet-50 dark:bg-violet-950/40',
};
const billedInstallationClass = 'text-amber-800 dark:text-amber-300';
const contractAmountClass = 'text-indigo-700 dark:text-indigo-300';
const sortLabels = {
  amount: '合約金額',
  shipping: '運輸成本佔比',
  installation: '安裝成本佔比',
  combined: '合計佔比',
};
type SortKey = keyof typeof sortLabels;
type SortDirection = 'ascending' | 'descending';

function quoteSortValue(row: QuoteCostRow, key: SortKey) {
  return key === 'amount' ? row.amount : costRatio(row[key], row.amount);
}

function formatMoney(value: number | null) {
  return value === null ? '—' : money.format(value);
}

function formatPercent(value: number | null) {
  return value === null ? '—' : percent.format(value);
}

function ReportSelect({ label, value, options, onChange, disabled }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm text-muted-foreground">
      {label}
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label} className="min-w-24 bg-card text-foreground"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function QuoteDetails({ rows, period }: { rows: AssignedQuoteCostRow[]; period: string }) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'combined', direction: 'descending' });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aValue = quoteSortValue(a, sort.key);
      const bValue = quoteSortValue(b, sort.key);
      if (aValue === null && bValue !== null) return 1;
      if (bValue === null && aValue !== null) return -1;
      const difference = ((aValue ?? 0) - (bValue ?? 0)) * (sort.direction === 'ascending' ? 1 : -1);
      return difference || (b.date ?? '').localeCompare(a.date ?? '') || a.quote_id.localeCompare(b.quote_id);
    }).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [page, rows, sort]);

  const sortButton = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.direction === 'ascending' ? ArrowUp : ArrowDown;
    const nextDirection = active && sort.direction === 'descending' ? 'ascending' : 'descending';
    return (
      <Button type="button" variant="ghost" size="sm"
        className="h-8 gap-1 px-1 font-medium"
        aria-label={`按${sortLabels[key]}${nextDirection === 'ascending' ? '由低至高' : '由高至低'}排序`}
        onClick={() => {
          setSort({ key, direction: nextDirection });
          setPage(0);
        }}>
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? '' : 'opacity-50'}`} aria-hidden="true" />
      </Button>
    );
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card" aria-labelledby="quote-cost-details">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4">
        <h2 id="quote-cost-details" className="font-semibold">{period} 報價明細</h2>
        <p className="text-sm text-muted-foreground">
          {rows.length} 張 · 按{sortLabels[sort.key]}{sort.direction === 'ascending' ? '由低至高' : '由高至低'}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="border-t px-4 py-8 text-center text-sm text-muted-foreground">此期間沒有符合條件的報價。</p>
      ) : (
        <Table className="min-w-[980px] border-t">
          <TableHeader>
            <TableRow>
              {['報價單號', '報價日期', '項目', '項目經理', '狀態'].map((label) => <TableHead key={label}>{label}</TableHead>)}
              <TableHead className="whitespace-nowrap text-right"
                aria-sort={sort.key === 'amount' ? sort.direction : undefined}>
                {sortButton('amount', '合約金額')}
              </TableHead>
              {quoteCostMetrics.map(({ key, label }) => (
                <TableHead key={key} className="whitespace-nowrap text-right" aria-sort={sort.key === key ? sort.direction : undefined}>
                  {sortButton(key, `${label}／佔比`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap font-medium">
                  <Link className="text-primary underline-offset-4 hover:underline" to={buildQuoteEditorPath(row.quote_id, row.version)}>
                    {row.quote_id}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{row.date}</TableCell>
                <TableCell>{row.projectName || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{row.managerNames.join('、') || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{row.status}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  <span className={row.amount === null ? 'text-muted-foreground' : contractAmountClass}>
                    {formatMoney(row.amount)}
                  </span>
                  <span className={`block text-xs ${row.billedInstallation === null ? 'text-muted-foreground' : billedInstallationClass}`}>
                    <span className="sr-only">收取安裝費 </span>
                    {formatMoney(row.billedInstallation)}
                  </span>
                </TableCell>
                {quoteCostMetrics.map(({ key }) => {
                  const ratio = costRatio(row[key], row.amount);
                  return (
                    <TableCell key={key} className="whitespace-nowrap text-right tabular-nums">
                      <span className={row[key] === null ? 'text-muted-foreground' : metricTextClasses[key]}>
                        {row[key] === null ? (key === 'combined' ? '資料不全' : '未填') : formatMoney(row[key])}
                      </span>
                      <span className={`block text-xs ${ratio === null ? 'text-muted-foreground' : `font-semibold ${metricTextClasses[key]}`}`}>
                        {formatPercent(ratio)}
                      </span>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-3 border-t px-4 py-3 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</Button>
          <span className="tabular-nums">{page + 1} / {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>下一頁</Button>
        </div>
      )}
    </section>
  );
}

export function QuoteCostReportView() {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [mode, setMode] = useState('month');
  const [selectedYear, setYear] = useState('');
  const [selectedMonth, setMonth] = useState('');
  const [status, setStatus] = useState(ALL_STATUSES);
  const [manager, setManager] = useState(ALL_STATUSES);
  const [installation, setInstallation] = useState(ALL_STATUSES);
  const [transport, setTransport] = useState(ALL_STATUSES);
  const [dateRange, setDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const { startDate = '', endDate = '' } = dateRange ?? {};
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ rows: QuoteCostRow[]; error: boolean } | null>(null);
  const [orders, setOrders] = useState<CaseOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState(false);
  const [pitchingRows, setPitchingRows] = useState<(QuoteCostRow & { pitching: PmsPitchingListItem | null })[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchQuoteCostRows(controller.signal).then((rows) => {
      if (controller.signal.aborted) return;
      setResult({ rows, error: false });
      void loadPitchingsForQuoteRows(rows).then((enriched) => {
        if (!controller.signal.aborted) setPitchingRows(enriched);
      });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ rows: [], error: true });
    });
    void fetchCaseShowcase<CaseOrder>('orders', controller.signal).then(({ items }) => {
      if (controller.signal.aborted) return;
      setOrders(items);
    }).catch(() => {
      if (!controller.signal.aborted) setOrdersError(true);
    });
    return () => controller.abort();
  }, [request]);

  const rows = useMemo(() => attachQuoteCostAssignments(
    pitchingRows ?? (result?.rows ?? []).map((row) => ({ ...row, pitching: null })),
    orders ?? [],
  ), [result, pitchingRows, orders]);
  const assignmentFilters = useMemo(() => ({
    managers: quoteCostAssignmentOptions(rows, 'managers'),
    installations: quoteCostAssignmentOptions(rows, 'installations'),
    transports: quoteCostAssignmentOptions(rows, 'transports'),
  }), [rows]);
  const statuses = [...new Set(rows.map((row) => row.status))]
    .filter((value) => !HIDDEN_STATUS_OPTIONS.has(value))
    .sort((a, b) => a.localeCompare(b, 'zh-HK'));
  const dates = rows.flatMap((row) => row.date && row.date <= today ? [row.date] : []).sort();
  const years = [...new Set(dates.map((date) => date.slice(0, 4)))];
  const year = years.includes(selectedYear) ? selectedYear : years.at(-1) ?? '';
  const months = [...new Set(dates.filter((date) => date.startsWith(year)).map((date) => date.slice(5, 7)))];
  const month = months.includes(selectedMonth) ? selectedMonth : months.at(-1) ?? '';
  const selectedPeriod = mode === 'month' ? `${year}-${month}` : year;
  const changeMode = (value: string) => {
    if (!value) return;
    if (value === 'range' && !dateRange) {
      const rangeYear = year || today.slice(0, 4);
      const rangeMonth = month || today.slice(5, 7);
      const firstDay = mode === 'year' ? `${rangeYear}-01-01` : `${rangeYear}-${rangeMonth}-01`;
      const lastDay = mode === 'year'
        ? `${rangeYear}-12-31`
        : new Date(Date.UTC(Number(rangeYear), Number(rangeMonth), 0)).toISOString().slice(0, 10);
      setDateRange({ startDate: firstDay, endDate: lastDay < today ? lastDay : today });
    }
    setMode(value);
  };
  const range = mode === 'range';
  const periodLabel = range
    ? startDate && endDate ? `${startDate} 至 ${endDate}` : startDate ? `${startDate} 起` : endDate ? `截至 ${endDate}` : '所有報價日期'
    : mode === 'month' ? `${year} 年 ${Number(month)} 月` : `${year} 年`;
  const invalidRange = Boolean(range && startDate && endDate && startDate > endDate);
  const filteredRows = rows.filter((row) =>
    (status === ALL_STATUSES || row.status === status) &&
    (manager === ALL_STATUSES || row.managers.some(({ value }) => value === manager)) &&
    (installation === ALL_STATUSES || row.installations.some(({ value }) => value === installation)) &&
    (transport === ALL_STATUSES || row.transports.some(({ value }) => value === transport)));
  const selectedRows = filteredRows.filter(({ date }) => date && date <= today && (
    range ? (!startDate || date >= startDate) && (!endDate || date <= endDate) : date.startsWith(selectedPeriod)
  ));
  const missingDates = filteredRows.filter((row) => !row.date).length;
  const summary = summarizeQuoteCosts(selectedRows);
  const transportReady = orders !== null && orders.every((order) => order.transport_supplier_id !== undefined);
  const reload = () => {
    setResult(null);
    setPitchingRows(null);
    setOrders(null);
    setOrdersError(false);
    setManager(ALL_STATUSES);
    setInstallation(ALL_STATUSES);
    setTransport(ALL_STATUSES);
    setRequest((value) => value + 1);
  };

  return (
    <div className="h-full overflow-y-auto bg-background fds-page-padding">
      <div className="space-y-4">
        <div className="fds-page-header">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="fds-page-title">運輸及安裝成本分析</h1>
          </div>
          <p className="fds-page-description">按報價日期統計毛利欄的運輸及安裝成本，以及佔客戶合約金額的比例。</p>
          {dates.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              同一報價編號只計最新有效版本。各項佔比按有填寫相關成本及正數合約金額的報價加權計算。成本金額合計包含所有有填寫該項成本的報價。歷史報價儲存的 0 按零成本計算。
              {missingDates > 0 && ` 有 ${missingDates} 張報價缺少有效日期，未計入期間統計。`}
            </p>
          )}
        </div>

        {!result ? (
          <div role="status" className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> 載入報價成本…
          </div>
        ) : result.error ? (
          <div role="alert" className="rounded-xl border bg-card p-5 text-sm">
            <p className="mb-3 text-destructive">無法載入報價成本。</p>
            <Button variant="outline" size="sm" onClick={reload}>重新載入</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <ToggleGroup type="single" variant="outline" value={mode} aria-label="統計週期"
                onValueChange={changeMode}>
                <ToggleGroupItem value="month">按月</ToggleGroupItem>
                <ToggleGroupItem value="year">按年</ToggleGroupItem>
                <ToggleGroupItem value="range">日期範圍</ToggleGroupItem>
              </ToggleGroup>
              {!range && year && <ReportSelect label="年份" value={year} options={[...years].reverse().map((value) => ({ value, label: `${value} 年` }))} onChange={(value) => { setYear(value); setMonth(''); }} />}
              {mode === 'month' && month && <ReportSelect label="月份" value={month} options={months.map((value) => ({ value, label: `${Number(value)} 月` }))} onChange={setMonth} />}
              {range && (
                <>
                  <label className="grid gap-1 text-sm text-muted-foreground">
                    報價開始日期
                    <Input type="date" value={startDate} max={endDate || today} onChange={(event) => setDateRange({ startDate: event.target.value, endDate })} className="bg-card text-foreground" />
                  </label>
                  <label className="grid gap-1 text-sm text-muted-foreground">
                    報價結束日期
                    <Input type="date" value={endDate} min={startDate || undefined} max={today} onChange={(event) => setDateRange({ startDate, endDate: event.target.value })} className="bg-card text-foreground" />
                  </label>
                </>
              )}
              <ReportSelect label="報價狀態" value={status} options={[{ value: ALL_STATUSES, label: '所有狀態' }, ...statuses.map((value) => ({ value, label: value }))]} onChange={setStatus} />
              <ReportSelect label="項目經理" value={manager} options={[{ value: ALL_STATUSES, label: '所有項目經理' }, ...assignmentFilters.managers]} onChange={setManager} disabled={!pitchingRows || (!orders && !ordersError)} />
              <ReportSelect label="安裝團隊" value={installation} options={[{ value: ALL_STATUSES, label: '所有安裝團隊' }, ...assignmentFilters.installations]} onChange={setInstallation} disabled={!orders || !pitchingRows} />
              <ReportSelect label="運輸供應商" value={transport} options={[{ value: ALL_STATUSES, label: '所有運輸供應商' }, ...assignmentFilters.transports]} onChange={setTransport} disabled={!transportReady || !pitchingRows} />
            </div>
            {ordersError && <p role="status" className="text-sm text-muted-foreground">無法載入 PMS 訂單資料，暫不能按安裝團隊或運輸供應商篩選。 <Button variant="link" size="sm" onClick={reload}>重試</Button></p>}

            {invalidRange ? (
              <p role="alert" className="text-sm text-destructive">開始日期不可遲於結束日期。</p>
            ) : dates.length === 0 ? (
              <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                此範圍沒有可用的報價日期。{missingDates > 0 && ` 有 ${missingDates} 張報價缺少有效日期。`}
              </p>
            ) : <>
            <section aria-label={`${periodLabel} 摘要`} className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 xl:grid-cols-4">
              <div className="bg-card px-4 py-4">
                <p className="text-sm text-muted-foreground">報價總額</p>
                <p className={`mt-2 text-xl font-semibold tabular-nums ${contractAmountClass}`}>{formatMoney(summary.amount)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{summary.count} 張報價</p>
              </div>
              {summary.metrics.map(({ key, label, cost, ratio, eligible }) => (
                <div key={key} className={`px-4 py-4 ${metricSummaryBackgrounds[key]}`}>
                  <p className={`text-sm font-medium ${metricTextClasses[key]}`}>{label}</p>
                  <p className={`mt-2 text-xl font-semibold tabular-nums ${cost === null ? 'text-muted-foreground' : metricTextClasses[key]}`}>{formatMoney(cost)}</p>
                  <p className="mt-1 text-sm tabular-nums">
                    <span className={`font-semibold ${ratio === null ? 'text-muted-foreground' : metricTextClasses[key]}`}>{formatPercent(ratio)}</span>
                    {' '}<span className="text-xs text-muted-foreground">· 佔比涵蓋 {eligible}／{summary.count} 張</span>
                  </p>
                </div>
              ))}
            </section>

            <QuoteDetails key={JSON.stringify([mode, selectedPeriod, startDate, endDate, status, manager, installation, transport])} rows={selectedRows} period={periodLabel} />
            </>}
          </>
        )}
      </div>
    </div>
  );
}
