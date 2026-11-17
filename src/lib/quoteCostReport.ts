import { supabase } from '@/lib/supabase';
import { QUOTE_FREE_INSTALLATION_MIN_HKD } from '@/lib/quoteItemTotals';
import { QUOTE_TRASH_STATUS } from '@/lib/quoteTrash';

type QuoteCostSource = {
  id: string;
  quote_id: string;
  version: string | null;
  status: string | null;
  bwf_pitching_id: string | null;
  quote_date: string | null;
  total_amount: number | string | null;
  subtotal: number | string | null;
  installation_fee: number | string | null;
  gpSummary: { ship?: unknown; installation?: unknown } | null;
};

function readAmount(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function readQuoteDate(value: string | null): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = slash ? `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}` : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function toQuoteCostRow(row: QuoteCostSource) {
  const shipping = readAmount(row.gpSummary?.ship);
  const installation = readAmount(row.gpSummary?.installation);
  const subtotal = readAmount(row.subtotal);
  const savedInstallationFee = readAmount(row.installation_fee);
  const billedInstallation = subtotal === null
    ? savedInstallationFee === 0 ? 0 : null
    : subtotal >= QUOTE_FREE_INSTALLATION_MIN_HKD ? 0 : savedInstallationFee ?? 0;
  return {
    id: row.id,
    quote_id: row.quote_id.trim(),
    version: row.version,
    status: row.status?.trim() || '未設定',
    bwf_pitching_id: row.bwf_pitching_id,
    date: readQuoteDate(row.quote_date),
    amount: readAmount(row.total_amount),
    billedInstallation,
    shipping,
    installation,
    combined: shipping === null || installation === null ? null : shipping + installation,
  };
}

export type QuoteCostRow = ReturnType<typeof toQuoteCostRow>;
export const quoteCostMetrics = [
  { key: 'shipping', label: '運輸成本' },
  { key: 'installation', label: '安裝成本' },
  { key: 'combined', label: '兩項合計' },
] as const;

export function costRatio(cost: number | null, amount: number | null): number | null {
  return cost === null || amount === null || amount <= 0 ? null : cost / amount;
}

export function summarizeQuoteCosts(rows: QuoteCostRow[]) {
  const amount = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const metrics = quoteCostMetrics.map((metric) => {
    let cost = 0;
    let eligibleCost = 0;
    let eligibleAmount = 0;
    let recorded = 0;
    let eligible = 0;
    for (const row of rows) {
      const value = row[metric.key];
      if (value === null) continue;
      cost += value;
      recorded++;
      if (row.amount === null || row.amount <= 0) continue;
      eligibleCost += value;
      eligibleAmount += row.amount;
      eligible++;
    }
    return { ...metric, cost: recorded ? cost : null, eligible, ratio: costRatio(eligibleCost, eligibleAmount) };
  });
  return { count: rows.length, amount, metrics };
}

export async function fetchQuoteCostRows(signal: AbortSignal): Promise<QuoteCostRow[]> {
  const pageSize = 1000;
  const latest = new Map<string, QuoteCostRow>();
  // Resolve the latest non-trash version before filtering by date or status.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('bwf_quote')
      .select('id,quote_id,version,status,bwf_pitching_id,total_amount,quote_date:project_data->quoteMeta->>date,subtotal:project_data->>subtotal,installation_fee:project_data->installationFee->>amount,project_data->gpSummary')
      .neq('status', QUOTE_TRASH_STATUS)
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
      .abortSignal(signal);
    if (error) throw error;
    const page = (data ?? []) as unknown as QuoteCostSource[];
    for (const row of page) {
      const quoteId = row.quote_id?.trim();
      if (quoteId && !latest.has(quoteId)) latest.set(quoteId, toQuoteCostRow(row));
    }
    if (page.length < pageSize) return [...latest.values()];
  }
}
