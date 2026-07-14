import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type ListSortDir = 'asc' | 'desc';

export function formatListDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

export function formatListMoney(value: number | string | null | undefined): string {
  if (value == null || value === '') return 'N/A';
  const n =
    typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 'N/A';
  return n.toLocaleString('en-HK', { maximumFractionDigits: 0 });
}

export function pitchingStatusBadgeClass(stage: string | null | undefined): string {
  const s = (stage || '').toLowerCase();
  if (s.includes('close') || s.includes('結案') || s.includes('lost')) {
    return 'bg-rose-500 text-white border-rose-500';
  }
  if (s.includes('enquir') || s.includes('查詢')) {
    return 'bg-amber-100 text-amber-900 border-amber-200';
  }
  if (s.includes('quote') || s.includes('報價')) {
    return 'bg-sky-100 text-sky-900 border-sky-200';
  }
  if (s.includes('win') || s.includes('得標') || s.includes('confirm')) {
    return 'bg-emerald-100 text-emerald-900 border-emerald-200';
  }
  return 'bg-muted text-muted-foreground border-border';
}

export function pitchingStatusLabel(stage: string | null | undefined): string {
  if (!stage?.trim()) return '—';
  const s = stage.trim();
  if (/case\s*closed/i.test(s)) return '結案';
  return s;
}

export function quoteStatusBadgeClass(status: string): string {
  switch (status) {
    case '待審核':
      return 'bg-amber-100 text-amber-900 border-amber-200';
    case '已通過':
      return 'bg-emerald-100 text-emerald-900 border-emerald-200';
    case '已退回':
      return 'bg-rose-500 text-white border-rose-500';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function compareNullable(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: ListSortDir,
): number {
  const emptyA = a == null || a === '';
  const emptyB = b == null || b === '';
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return dir === 'asc' ? a - b : b - a;
  }
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  const cmp = sa.localeCompare(sb, 'zh-HK');
  return dir === 'asc' ? cmp : -cmp;
}

export function SortHeaderIcon({
  active,
  dir,
}: {
  active: boolean;
  dir: ListSortDir;
}) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === 'asc' ? (
    <ArrowUp className="h-3 w-3 text-primary" />
  ) : (
    <ArrowDown className="h-3 w-3 text-primary" />
  );
}
