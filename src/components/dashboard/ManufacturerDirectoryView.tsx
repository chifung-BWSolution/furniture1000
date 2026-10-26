import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, useReducedMotion } from 'framer-motion';
import { loadManufacturerDirectory, type DirectoryFactory } from '@/lib/manufacturerDirectory';
import {
  catalogStatusLabel,
  enqueueSupplierCatalogParse,
  listCatalogRows,
  openSupplierCatalog,
  supplierDocTypeLabel,
  type SupplierDocType,
} from '@/lib/supplierCatalog';
import { canManageSupplierDocuments } from '@/lib/supplierDocuments';
import { FactoryCatalogPanel } from '@/components/dashboard/FactoryCatalogPanel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type FactoryRecord = DirectoryFactory;
type SupplierKind = NonNullable<DirectoryFactory['supplier_kind']>;

/**
 * 漸進動畫只 stagger 前幾列。
 *
 * 原本用 `index * 0.03` 沒有上限：139 列的最後一列要等 4.1 秒才開始淡入，
 * 搜尋時整張表會停在半透明的空白狀態好幾秒。
 */
const ROW_STAGGER_LIMIT = 12;
const ROW_STAGGER_STEP = 0.02;
const DIRECTORY_PAGE_SIZE = 30;

const KIND_LABEL: Record<SupplierKind, string> = {
  furniture: '傢私',
  material: '材料',
  both: '傢私・材料',
};

function kindLabel(kind: SupplierKind | null | undefined): string {
  return kind ? KIND_LABEL[kind] : '—';
}

type KindFilter = 'all' | SupplierKind | 'unknown';
type YesNoFilter = 'all' | 'yes' | 'no';
type UploadFilter = 'all' | 'uploaded' | 'missing';

function shownCatalogYear(factory: FactoryRecord, catalog: CatalogSummary | undefined): number | null {
  if (catalog?.hasCatalog) return catalog.catalogYear;
  return factory.catalog_year ?? null;
}

function shownQuoteYear(factory: FactoryRecord, catalog: CatalogSummary | undefined): number | null {
  if (catalog?.hasPriceList) return catalog.priceListYear;
  return factory.quote_pdf_year ?? null;
}

function hasUploadedCatalog(factory: FactoryRecord, catalog: CatalogSummary | undefined): boolean {
  return shownCatalogYear(factory, catalog) != null || Boolean(catalog?.catalogFile);
}

function hasUploadedQuote(factory: FactoryRecord, catalog: CatalogSummary | undefined): boolean {
  return shownQuoteYear(factory, catalog) != null || Boolean(catalog?.priceListFile);
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

type CatalogFileRef = {
  id: string;
  storagePath: string;
  year: number | null;
  status: string;
  createdAt: string;
};

type CatalogSummary = {
  hasCatalog: boolean;
  hasPriceList: boolean;
  catalogYear: number | null;
  priceListYear: number | null;
  catalogFile: CatalogFileRef | null;
  priceListFile: CatalogFileRef | null;
  status: string | null;
  categories: string[];
};

function preferFile(current: CatalogFileRef | null, next: CatalogFileRef): CatalogFileRef {
  if (!current) return next;
  const yearDiff = (next.year ?? -1) - (current.year ?? -1);
  if (yearDiff !== 0) return yearDiff > 0 ? next : current;
  return next.createdAt > current.createdAt ? next : current;
}

function DocumentYearCell({
  file,
  year,
  queueingId,
  canQueue,
  canOpen,
  onOpen,
  onQueue,
}: {
  file: CatalogFileRef | null;
  year: number | null | undefined;
  queueingId: string | null;
  canQueue: boolean;
  canOpen: boolean;
  onOpen: (storagePath: string) => void;
  onQueue: (file: CatalogFileRef) => void;
}) {
  const shownYear = file?.year ?? year;
  if (!file?.storagePath || !canOpen) {
    return (
      <span className={cn('font-mono-data text-[11px]', shownYear ? 'text-foreground' : 'text-muted-foreground')}>
        {uploadYearLabel(shownYear)}
      </span>
    );
  }
  const parsing = file.status === 'processing';
  const busy = queueingId === file.id;
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className="font-body text-[11px] text-primary underline-offset-2 hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(file.storagePath);
        }}
      >
        打開
      </button>
      <span className="font-mono-data text-[11px] text-foreground">{shownYear ? String(shownYear) : '—'}</span>
      {canQueue ? (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-1.5 text-[10px]"
          disabled={parsing || busy}
          onClick={(event) => {
            event.stopPropagation();
            onQueue(file);
          }}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : parsing ? '解析中' : '排入解析'}
        </Button>
      ) : null}
    </div>
  );
}

function formatJoinDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-HK');
}

export function ManufacturerDirectoryView({ onOpenFactory }: { onOpenFactory: (code: string) => void }) {
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const reduceMotion = useReducedMotion();
  // 只有第一次載入做漸進淡入；之後的搜尋過濾直接換畫面，
  // 免得每敲一個字都要等動畫跑完才看得到結果。
  const hasShownList = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [quoteFilter, setQuoteFilter] = useState<YesNoFilter>('all');
  const [catalogUploadFilter, setCatalogUploadFilter] = useState<UploadFilter>('all');
  const [priceListUploadFilter, setPriceListUploadFilter] = useState<UploadFilter>('all');
  const [catalogByFactory, setCatalogByFactory] = useState<Record<string, CatalogSummary>>({});
  const [uploadTarget, setUploadTarget] = useState<{ factory: FactoryRecord; docType: SupplierDocType } | null>(null);
  const [canManageDocs, setCanManageDocs] = useState(false);
  const [queueingId, setQueueingId] = useState<string | null>(null);

  const fetchData = useCallback(async (force = false) => {
    setIsLoading(true);
    try {
      // All manufacturers are loaded once, so the search below filters in the
      // browser — typing never hits the API.
      const rows = await loadManufacturerDirectory({ force });
      setFactories(rows);
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
            catalogFile: null,
            priceListFile: null,
            status: null,
            categories: [],
          };
          const year = uploadYear(row.created_at, row.document_year);
          const file: CatalogFileRef | null = row.storage_path
            ? {
                id: row.id,
                storagePath: row.storage_path,
                year,
                status: row.processing_status,
                createdAt: row.created_at,
              }
            : null;
          const isPriceList = row.doc_type === 'price_list' || row.doc_type === 'quote';
          if (isPriceList) {
            current.hasPriceList = true;
            if (year != null && (current.priceListYear == null || year > current.priceListYear)) {
              current.priceListYear = year;
            }
            if (file) current.priceListFile = preferFile(current.priceListFile, file);
          } else {
            current.hasCatalog = true;
            if (year != null && (current.catalogYear == null || year > current.catalogYear)) {
              current.catalogYear = year;
            }
            if (file) current.catalogFile = preferFile(current.catalogFile, file);
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
      setCanManageDocs(await canManageSupplierDocuments().catch(() => false));
    } catch (err) {
      console.error('[ManufacturerDirectory] Failed to load manufacturers:', err);
      toast.error('廠家目錄載入失敗，請重試');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (factories.length > 0) hasShownList.current = true;
  }, [factories.length]);

  useEffect(() => {
    setCurrentPage(1);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [searchQuery, kindFilter, quoteFilter, catalogUploadFilter, priceListUploadFilter]);

  const filteredFactories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = factories.filter((factory) => {
      const catalog = catalogByFactory[factory.id];
      if (kindFilter === 'unknown' && factory.supplier_kind) return false;
      if (kindFilter !== 'all' && kindFilter !== 'unknown' && factory.supplier_kind !== kindFilter) return false;
      if (quoteFilter === 'yes' && !factory.used_this_year) return false;
      if (quoteFilter === 'no' && factory.used_this_year) return false;
      const uploadedCatalog = hasUploadedCatalog(factory, catalog);
      const uploadedQuote = hasUploadedQuote(factory, catalog);
      if (catalogUploadFilter === 'uploaded' && !uploadedCatalog) return false;
      if (catalogUploadFilter === 'missing' && uploadedCatalog) return false;
      if (priceListUploadFilter === 'uploaded' && !uploadedQuote) return false;
      if (priceListUploadFilter === 'missing' && uploadedQuote) return false;
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
  }, [factories, searchQuery, kindFilter, quoteFilter, catalogUploadFilter, priceListUploadFilter, catalogByFactory]);

  const totalPages = Math.max(1, Math.ceil(filteredFactories.length / DIRECTORY_PAGE_SIZE));
  const visibleFactories = filteredFactories.slice(
    (currentPage - 1) * DIRECTORY_PAGE_SIZE,
    currentPage * DIRECTORY_PAGE_SIZE,
  );

  const handleViewDetail = (factory: FactoryRecord) => {
    const slug = factory.factory_code || factory.id;
    onOpenFactory(slug);
  };

  const openUpload = (factory: FactoryRecord, docType: SupplierDocType) => {
    setUploadTarget({ factory, docType });
  };

  const openFile = (storagePath: string) => {
    void openSupplierCatalog(storagePath).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : '無法打開文件');
    });
  };

  const queueParse = (file: CatalogFileRef) => {
    setQueueingId(file.id);
    void enqueueSupplierCatalogParse(file.id)
      .then(() => {
        toast.success('已排入解析任務（夜間窗口解析）');
        setCatalogByFactory((current) => {
          const next: Record<string, CatalogSummary> = {};
          for (const [factoryId, summary] of Object.entries(current)) {
            const patch = (target: CatalogFileRef | null) => (
              target?.id === file.id ? { ...target, status: 'pending' } : target
            );
            next[factoryId] = {
              ...summary,
              catalogFile: patch(summary.catalogFile),
              priceListFile: patch(summary.priceListFile),
              status: summary.catalogFile?.id === file.id || summary.priceListFile?.id === file.id
                ? 'pending'
                : summary.status,
            };
          }
          return next;
        });
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : '未能排入解析任務');
      })
      .finally(() => setQueueingId(null));
  };

  return (
    <div className="flex h-full min-h-0 flex-col fds-page-padding">
      <div className="fds-page-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div>
            <h1 className="fds-page-title"><BookOpen className="h-5 w-5 text-primary" />廠家目錄</h1>
            <p className="fds-page-description">
              類型為傢私或材料 · 今年報價代表本年報價單有此廠家 · 已上傳的圖冊／報價單可打開，年份在連結下面 · {factories.length} records
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fetchData(true)}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          <span className="font-mono-data text-xs">Refresh</span>
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
        <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as KindFilter)}>
          <SelectTrigger className="w-[132px]">
            <SelectValue placeholder="類型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部類型</SelectItem>
            <SelectItem value="furniture">傢私</SelectItem>
            <SelectItem value="material">材料</SelectItem>
            <SelectItem value="both">傢私・材料</SelectItem>
            <SelectItem value="unknown">未分類</SelectItem>
          </SelectContent>
        </Select>
        <Select value={quoteFilter} onValueChange={(value) => setQuoteFilter(value as YesNoFilter)}>
          <SelectTrigger className="w-[148px]">
            <SelectValue placeholder="今年報價" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部今年報價</SelectItem>
            <SelectItem value="yes">今年有報價</SelectItem>
            <SelectItem value="no">今年無報價</SelectItem>
          </SelectContent>
        </Select>
        <Select value={catalogUploadFilter} onValueChange={(value) => setCatalogUploadFilter(value as UploadFilter)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="圖冊" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部圖冊</SelectItem>
            <SelectItem value="uploaded">已有圖冊</SelectItem>
            <SelectItem value="missing">未有圖冊</SelectItem>
          </SelectContent>
        </Select>
        {canManageDocs ? (
          <Select value={priceListUploadFilter} onValueChange={(value) => setPriceListUploadFilter(value as UploadFilter)}>
            <SelectTrigger className="w-[148px]">
              <SelectValue placeholder="報價單PDF" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部報價單</SelectItem>
              <SelectItem value="uploaded">已有報價單</SelectItem>
              <SelectItem value="missing">未有報價單</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
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
        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
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
                <TableHead className="font-display text-xs font-semibold w-[112px]">
                  圖冊
                </TableHead>
                <TableHead className="font-display text-xs font-semibold w-[112px]">
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
                <TableHead className="font-display text-xs font-semibold w-[220px] text-right">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* No AnimatePresence here on purpose: it kept the filtered-out
                  rows mounted (invisible but still occupying the table) until
                  their staggered exit finished, so a search that matched
                  nothing left a blank table on screen for seconds. Rows that
                  no longer match are now removed straight away. */}
              {visibleFactories.map((factory, index) => {
                const catalog = catalogByFactory[factory.id];
                const catalogYear = shownCatalogYear(factory, catalog);
                const quoteYear = shownQuoteYear(factory, catalog);
                return (
                <motion.tr
                  key={factory.id}
                  initial={reduceMotion || hasShownList.current ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : {
                          duration: 0.15,
                          delay: Math.min(index, ROW_STAGGER_LIMIT) * ROW_STAGGER_STEP,
                        }
                  }
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
                    <DocumentYearCell
                      file={catalog?.catalogFile ?? null}
                      year={catalogYear}
                      queueingId={queueingId}
                      canQueue={canManageDocs}
                      canOpen
                      onOpen={openFile}
                      onQueue={queueParse}
                    />
                  </TableCell>
                  <TableCell>
                    <DocumentYearCell
                      file={catalog?.priceListFile ?? null}
                      year={quoteYear}
                      queueingId={queueingId}
                      canQueue={canManageDocs}
                      canOpen={canManageDocs}
                      onOpen={openFile}
                      onQueue={queueParse}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="font-body text-xs text-muted-foreground">
                      {catalogStatusLabel(catalog?.status)}
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
                    <div className="flex justify-end gap-1">
                      {canManageDocs ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            openUpload(factory, 'catalog');
                          }}
                        >
                          上傳圖冊
                        </Button>
                      ) : null}
                      {canManageDocs ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            openUpload(factory, 'price_list');
                          }}
                        >
                          上傳報價單
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDetail(factory);
                        }}
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span className="ml-1 text-xs">查看</span>
                      </Button>
                    </div>
                  </TableCell>
                </motion.tr>
                );
              })}

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
          {!isLoading && filteredFactories.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>共 {filteredFactories.length} 家廠家 · 第 {currentPage} / {totalPages} 頁</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => { setCurrentPage((page) => page - 1); scrollContainerRef.current?.scrollTo({ top: 0 }); }}>上一頁</Button>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => { setCurrentPage((page) => page + 1); scrollContainerRef.current?.scrollTo({ top: 0 }); }}>下一頁</Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <Dialog open={uploadTarget != null} onOpenChange={(open) => { if (!open) setUploadTarget(null); }}>
        <DialogContent
          size="3xl"
          title={uploadTarget ? `上傳${supplierDocTypeLabel(uploadTarget.docType)} · ${uploadTarget.factory.display_name}` : '上傳'}
          description="新檔另存一版，不會覆蓋舊檔，也不會立刻解析。"
        >
          {uploadTarget ? (
            <FactoryCatalogPanel
              key={`${uploadTarget.factory.id}-${uploadTarget.docType}`}
              factoryId={uploadTarget.factory.id}
              factoryName={uploadTarget.factory.display_name}
              initialDocType={uploadTarget.docType}
              embedded
              onUploaded={() => void fetchData(true)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
