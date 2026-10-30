import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  listPackageQuotes,
  packageQuoteErrorMessage,
  type SavedPackageQuote,
} from '@/lib/packagePricing';
import { formatPackageMoney } from '@/lib/packagePricingMath';
import { formatListDate } from '@/lib/listTableUtils';
import {
  LIST_TABLE_TH_CLASS,
  ListPageShell,
  ListRefreshButton,
  ListTableCard,
  ListTableEmptyRow,
  ListTableLoadingRow,
} from '@/components/dashboard/ListPageShell';

/** 套餐參考報價一覽（/fds/pm/package 預設畫面）。按「新增參考報價」才進編輯頁。 */
export function PackagePricingListView() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState<SavedPackageQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await listPackageQuotes();
    if (result.error) {
      setError(packageQuoteErrorMessage(result.error));
      setRows([]);
    } else {
      setRows(result.quotes);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openQuote = (id: string) => {
    navigate({ pathname: location.pathname, search: `?quote=${encodeURIComponent(id)}` });
  };
  const openNew = () => {
    navigate({ pathname: location.pathname, search: '?mode=new' });
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.title.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const visibleTotal = visible.reduce((sum, row) => sum + row.totalCents, 0);
  const filtered = visible.length !== rows.length;

  return (
    <ListPageShell
      title="參考報價"
      subtitle=""
      hideHeader
      search={query}
      onSearchChange={setQuery}
      searchPlaceholder="搜尋報價標題或單號"
      searchActions={
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" onClick={openNew}>
            新增參考報價
          </Button>
          <ListRefreshButton loading={loading} onClick={() => void load()} />
        </div>
      }
    >
      <ListTableCard
        minWidthClassName="min-w-[880px]"
        footer={
          !loading && !error
            ? filtered
              ? `搜尋到 ${visible.length} 張（全部 ${rows.length} 張），合計 ${formatPackageMoney(visibleTotal)}`
              : `共 ${visible.length} 張參考報價，合計 ${formatPackageMoney(visibleTotal)}`
            : undefined
        }
      >
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th scope="col" className={LIST_TABLE_TH_CLASS}>報價標題</th>
            <th scope="col" className={LIST_TABLE_TH_CLASS}>項目數</th>
            <th scope="col" className={LIST_TABLE_TH_CLASS}>總額</th>
            <th scope="col" className={LIST_TABLE_TH_CLASS}>更新日期</th>
            <th scope="col" className={LIST_TABLE_TH_CLASS}>客戶連結</th>
            <th scope="col" className={LIST_TABLE_TH_CLASS}>
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <ListTableLoadingRow colSpan={6} label="載入參考報價列表…" />
          ) : error ? (
            <tr>
              <td colSpan={6} className="px-4 py-16 text-center" role="alert">
                <p className="font-body text-sm text-destructive">{error}</p>
                <Button variant="outline" className="mt-3" onClick={() => void load()}>
                  重新載入
                </Button>
              </td>
            </tr>
          ) : visible.length === 0 ? (
            <ListTableEmptyRow
              colSpan={6}
              message={
                rows.length === 0
                  ? '還沒有參考報價，按「新增參考報價」建立第一張。'
                  : '沒有符合搜尋的參考報價。'
              }
            />
          ) : (
            visible.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => openQuote(row.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openQuote(row.id);
                  }
                }}
                className="cursor-pointer border-b border-border/70 transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
              >
                <td className="min-w-[220px] max-w-[420px] px-3 py-3">
                  <div className="truncate text-sm font-semibold">{row.title || '套餐參考報價'}</div>
                  <div className="truncate font-mono-data text-xs text-muted-foreground">{row.id}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs tabular-nums">
                  {row.lineCount}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono-data text-xs tabular-nums">
                  {formatPackageMoney(row.totalCents)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-mono-data text-xs">
                  {formatListDate(row.updatedAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                  {row.shareToken ? '已有客戶連結' : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation();
                      openQuote(row.id);
                    }}
                  >
                    開啟
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </ListTableCard>
    </ListPageShell>
  );
}
