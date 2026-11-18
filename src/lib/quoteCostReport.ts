import { supabase } from '@/lib/supabase';
import { QUOTE_FREE_INSTALLATION_MIN_HKD } from '@/lib/quoteItemTotals';
import { QUOTE_TRASH_STATUS } from '@/lib/quoteTrash';
import type { CaseOrder } from '@/lib/caseShowcase';
import { pitchingDisplayTitle, type PmsPitchingListItem } from '@/lib/pmsPitchings';

type QuoteCostSource = {
  id: string;
  quote_id: string;
  version: string | null;
  status: string | null;
  bwf_pitching_id: string | null;
  bwf_project_id?: string | null;
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
    bwf_project_id: row.bwf_project_id ?? null,
    date: readQuoteDate(row.quote_date),
    amount: readAmount(row.total_amount),
    billedInstallation,
    shipping,
    installation,
    combined: shipping === null || installation === null ? null : shipping + installation,
  };
}

export type QuoteCostRow = ReturnType<typeof toQuoteCostRow>;

type FilterOption = { value: string; label: string };

function namedOption(id: string | null | undefined, name: string | null | undefined): FilterOption[] {
  const label = name?.trim();
  return label ? [{ value: id || `name:${label}`, label }] : [];
}

export function attachQuoteCostAssignments(
  rows: (QuoteCostRow & { pitching: PmsPitchingListItem | null })[],
  orders: CaseOrder[],
) {
  const byProject = new Map<string, CaseOrder[]>();
  const byPitching = new Map<string, CaseOrder[]>();
  const index = (map: Map<string, CaseOrder[]>, key: string, order: CaseOrder) => {
    const group = map.get(key);
    if (group) group.push(order);
    else map.set(key, [order]);
  };
  for (const order of orders) {
    index(byProject, order.project_id, order);
    if (order.bwf_pitching_id) index(byPitching, order.bwf_pitching_id, order);
  }
  return rows.map((row) => {
    const pitchingId = row.pitching?.id || row.bwf_pitching_id;
    const related = (row.bwf_project_id
      ? byProject.get(row.bwf_project_id)
      : pitchingId ? byPitching.get(pitchingId) : undefined) ?? [];
    const projectManagers = related.filter((order) => order.pm_name?.trim())
      .map((order) => ({ otcId: order.pm_otc_id, name: order.pm_name }));
    const assigned = projectManagers.length ? projectManagers
      : [{ otcId: row.pitching?.main_pm_otc_id, name: row.pitching?.main_pm_name }];
    return {
      ...row,
      projectName: related[0]?.project_name || (row.pitching && pitchingDisplayTitle(row.pitching)),
      managerNames: [...new Set(assigned.flatMap(({ name }) => name?.trim() ? [name.trim()] : []))],
      managers: assigned.flatMap(({ otcId, name }) => otcId ? namedOption(otcId, name) : []),
      installations: related.flatMap((order) => namedOption(order.installation_team_id, order.installation_team_name)),
      transports: related.flatMap((order) => namedOption(order.transport_supplier_id, order.transport_supplier_name)),
    };
  });
}

export type AssignedQuoteCostRow = ReturnType<typeof attachQuoteCostAssignments>[number];

export function quoteCostAssignmentOptions(rows: AssignedQuoteCostRow[], key: 'managers' | 'installations' | 'transports') {
  const options = new Map<string, FilterOption>();
  for (const row of rows) for (const option of row[key]) options.set(option.value, option);
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-HK'));
}
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
      .select('id,quote_id,version,status,bwf_pitching_id,bwf_project_id,total_amount,quote_date:project_data->quoteMeta->>date,subtotal:project_data->>subtotal,installation_fee:project_data->installationFee->>amount,project_data->gpSummary')
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
