import { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search,
  BookOpen,
  Factory,
  RefreshCw,
  X,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/hooks/use-app-store';
import { motion, AnimatePresence } from 'framer-motion';
import { catalogStatusLabel, listCatalogRows } from '@/lib/supplierCatalog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type SupplierKind = 'furniture' | 'material' | 'both';

interface FactoryRecord {
  id: string;
  display_name: string;
  factory_code: string | null;
  contact_person: string | null;
  phone: string | null;
  location: string | null;
  project_number: number | null;
  join_date: string | null;
  supplier_kind?: SupplierKind | null;
  used_this_year?: boolean;
  catalog_year?: number | null;
  quote_pdf_year?: number | null;
}

const KIND_LABEL: Record<SupplierKind, string> = {
  furniture: '傢私',
  material: '材料',
  both: '傢私・材料',
};

function kindLabel(kind: SupplierKind | null | undefined): string {
  return kind ? KIND_LABEL[kind] : '—';
}

function uploadYearLabel(year: number | null | undefined): string {
  return year ? String(year) : '未上傳';
}

function uploadYear(createdAt: string | null | undefined, documentYear: number | null | undefined): number | null {
  if (createdAt) {
    const year = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).format(new Date(createdAt)));
    if (Number.isFinite(year)) return year;
  }
  return documentYear ?? null;
}

type CatalogSummary = {
  hasCatalog: boolean;
  hasPriceList: boolean;
  catalogYear: number | null;
  priceListYear: number | null;
  status: string | null;
  categories: string[];
};

function formatJoinDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-HK');
}

export function ManufacturerDirectoryView() {
  const store = useAppStore();
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'missing-catalog' | 'missing-price-list'>('all');
  const [catalogByFactory, setCatalogByFactory] = useState<Record<string, CatalogSummary>>({});

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'supabase-functions-fetch-manufacturer-directory'
      );

      if (error) {
        console.error('[ManufacturerDirectory] Edge function error:', error);
        const errMsg = typeof error === 'object' && error.message
          ? error.message
          : 'Edge function invocation failed';
        toast.error(`Failed to fetch manufacturer data: ${errMsg}`);
        return;
      }

      if (data?.error) {
        console.error('[ManufacturerDirectory] Server error:', data.error);
        toast.error(`Server error: ${data.error}`);
        return;
      }

      if (data) {
        setFactories(data.factories || []);
      }
      try {
        const catalogs = await listCatalogRows();
        const statusRank: Record<string, number> = {
          processing: 5,
          pending: 4,
          failed: 3,
          review_required: 2,
          completed: 1,
        };
        const summary: Record<string, CatalogSummary> = {};
        for (const row of catalogs) {
          const factoryId = row.factory_id;
          if (!factoryId) continue;
          const current = summary[factoryId] ?? {
            hasCatalog: false,
            hasPriceList: false,
            catalogYear: null,
            priceListYear: null,
            status: null,
            categories: [],
          };
          const year = uploadYear(row.created_at, row.document_year);
          if (row.doc_type === 'price_list') {
            current.hasPriceList = true;
            if (year != null && (current.priceListYear == null || year > current.priceListYear)) {
              current.priceListYear = year;
            }
          } else {
            current.hasCatalog = true;
            if (year != null && (current.catalogYear == null || year > current.catalogYear)) {
              current.catalogYear = year;
            }
          }
          current.categories = [...new Set([...current.categories, ...(row.product_categories || [])])];
          if ((statusRank[row.processing_status] ?? 0) > (statusRank[current.status ?? ''] ?? 0)) {
            current.status = row.processing_status;
          }
          summary[factoryId] = current;
        }
        setCatalogByFactory(summary);
      } catch (catalogError) {
        console.error('[ManufacturerDirectory] Catalog summary failed:', catalogError);
      }
    } catch (err) {
      console.error('[ManufacturerDirectory] Network error:', err);
      toast.error('Network error fetching manufacturer data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredFactories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = factories.filter((factory) => {
      const catalog = catalogByFactory[factory.id];
      if (catalogFilter === 'missing-catalog' && catalog?.hasCatalog) return false;
      if (catalogFilter === 'missing-price-list' && catalog?.hasPriceList) return false;
      if (!q) return true;
      return (
        factory.display_name?.toLowerCase().includes(q) ||
        factory.factory_code?.toLowerCase().includes(q) ||
        factory.contact_person?.toLowerCase().includes(q) ||
        factory.phone?.toLowerCase().includes(q) ||
        factory.location?.toLowerCase().includes(q) ||
        kindLabel(factory.supplier_kind).toLowerCase().includes(q) ||
        catalog?.categories.some((category) => category.toLowerCase().includes(q))
      );
    });
    rows.sort((a, b) => {
      const used = Number(Boolean(b.used_this_year)) - Number(Boolean(a.used_this_year));
      if (used !== 0) return used;
      return (a.display_name || '').localeCompare(b.display_name || '', 'zh-HK');
    });
    return rows;
  }, [factories, searchQuery, catalogFilter, catalogByFactory]);

  const handleViewDetail = (factory: FactoryRecord) => {
    const slug = factory.factory_code || factory.id;
    store.setFactoryDetailCode(slug);
    store.setCurrentView('factory-detail');
  };

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">廠家目錄</h1>
            <p className="font-body text-xs text-muted-foreground">
              類型為傢私或材料 · 今年報價代表本年報價單有此廠家 · 圖冊／報價單 PDF 顯示上傳年份 · {factories.length} records
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          <span className="font-mono-data text-xs">Refresh</span>
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋廠家名稱或代號..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 font-body text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={catalogFilter} onValueChange={(value) => setCatalogFilter(value as 'all' | 'missing-catalog' | 'missing-price-list')}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="文件" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部廠家</SelectItem>
            <SelectItem value="missing-catalog">未有圖冊</SelectItem>
            <SelectItem value="missing-price-list">未有報價單</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="font-mono-data text-xs">
          {filteredFactories.length} / {factories.length}
        </Badge>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-display text-xs font-semibold min-w-[180px]">
                  廠家名稱
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[88px]">
                  類型
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[88px]">
                  今年報價
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[80px]">
                  圖冊
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[96px]">
                  報價單PDF
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[90px]">
                  解析
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[90px]">
                  廠家代號
                </TableHead>
                <TableHead className="font-display text-xs font-semibold min-w-[100px]">
                  聯絡人
                </TableHead>
                <TableHead className="font-display text-xs font-semibold min-w-[110px]">
                  電話
                </TableHead>
                <TableHead className="font-display text-xs font-semibold min-w-[100px]">
                  地點
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[80px]">
                  訂單數
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[110px]">
                  加入日期
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[90px] text-right">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence>
                {filteredFactories.map((factory, index) => (
                  <motion.tr
                    key={factory.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ delay: Math.min(index, 12) * 0.02 }}
                    className="group cursor-pointer border-b border-border/50 hover:bg-muted/30 transition-colors"
                    onClick={() => handleViewDetail(factory)}
                  >
                    <TableCell className="font-body text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <Factory className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {factory.display_name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'font-body text-[10px]',
                          factory.supplier_kind === 'material' && 'border-amber-500/40 text-amber-700 dark:text-amber-300',
                          factory.supplier_kind === 'furniture' && 'border-primary/40 text-primary',
                          factory.supplier_kind === 'both' && 'border-violet-500/40 text-violet-700 dark:text-violet-300',
                        )}
                      >
                        {kindLabel(factory.supplier_kind)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'font-body text-[10px]',
                          factory.used_this_year
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'text-muted-foreground',
                        )}
                      >
                        {factory.used_this_year ? '有' : '無'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'font-mono-data text-[11px]',
                          catalogByFactory[factory.id]?.hasCatalog ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {uploadYearLabel(
                          catalogByFactory[factory.id]?.hasCatalog
                            ? catalogByFactory[factory.id]?.catalogYear
                            : null,
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'font-mono-data text-[11px]',
                          catalogByFactory[factory.id]?.hasPriceList ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {uploadYearLabel(
                          catalogByFactory[factory.id]?.hasPriceList
                            ? catalogByFactory[factory.id]?.priceListYear
                            : null,
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-body text-xs text-muted-foreground">
                        {catalogStatusLabel(catalogByFactory[factory.id]?.status)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono-data text-[10px]">
                        {factory.factory_code || '—'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-body text-xs text-muted-foreground">
                        {factory.contact_person || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono-data text-xs text-muted-foreground">
                        {factory.phone || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-body text-xs text-muted-foreground">
                        {factory.location || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono-data text-xs text-muted-foreground">
                        {factory.project_number ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono-data text-[11px] text-muted-foreground">
                        {formatJoinDate(factory.join_date)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDetail(factory);
                        }}
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span className="ml-1 text-xs">查看</span>
                      </Button>
                    </TableCell>
                  </motion.tr>
                ))}
              </AnimatePresence>

              {filteredFactories.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={13} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Search className="h-8 w-8 opacity-30" />
                      <p className="font-body text-sm">沒有找到匹配的廠家</p>
                      <p className="font-mono-data text-[11px]">
                        No manufacturers found matching your search
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
