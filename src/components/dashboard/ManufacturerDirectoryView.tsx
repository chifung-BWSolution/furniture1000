import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, useReducedMotion } from 'framer-motion';
import { loadManufacturerDirectory, type DirectoryDocumentLink, type DirectoryFactory } from '@/lib/manufacturerDirectory';
import { catalogStatusLabel, listCatalogRows, openSupplierCatalog } from '@/lib/supplierCatalog';
import { canManageSupplierDocuments, enqueueSupplierDocumentParse } from '@/lib/supplierDocuments';
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

function uploadYearLabel(year: number | null | undefined, hasDocument = false): string {
  return year ? String(year) : hasDocument ? '年份未填' : '未上傳';
}

function shanghaiYearOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(date));
  return Number.isInteger(year) ? year : null;
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

function attachDirectoryFiles(
  summary: Record<string, CatalogSummary>,
  factories: FactoryRecord[],
): Record<string, CatalogSummary> {
  const next = { ...summary };
  for (const factory of factories) {
    const current = next[factory.id] ?? {
      hasCatalog: false,
      hasPriceList: false,
      catalogYear: null,
      priceListYear: null,
      catalogFile: null,
      priceListFile: null,
      status: null,
      categories: [],
    };
    const catalogLink = linkToFile(factory.catalog_file);
    const quoteLink = linkToFile(factory.quote_file);
    if (catalogLink && !current.catalogFile?.storagePath) {
      current.hasCatalog = true;
      current.catalogYear = catalogLink.year ?? current.catalogYear;
      current.catalogFile = catalogLink;
    }
    if (quoteLink && !current.priceListFile?.storagePath) {
      current.hasPriceList = true;
      current.priceListYear = quoteLink.year ?? current.priceListYear;
      current.priceListFile = quoteLink;
    }
    if (current.catalogFile || current.priceListFile) next[factory.id] = current;
  }
  return next;
}

function linkToFile(link: DirectoryDocumentLink | null | undefined): CatalogFileRef | null {
  if (!link?.storage_path) return null;
  return {
    id: link.id,
    storagePath: link.storage_path,
    year: link.document_year,
    status: 'pending',
    createdAt: link.created_at ?? '',
  };
}

function preferFile(current: CatalogFileRef | null, next: CatalogFileRef): CatalogFileRef {
  if (!current) return next;
  const yearDiff = (next.year ?? -1) - (current.year ?? -1);
  if (yearDiff !== 0) return yearDiff > 0 ? next : current;
  return next.createdAt > current.createdAt ? next : current;
}

function DocumentYearCell({
  file,
  documentYear,
  uploadYear,
  onOpen,
}: {
  file: CatalogFileRef | null;
  documentYear: number | null | undefined;
  uploadYear: number | null | undefined;
  onOpen: (storagePath: string) => void;
}) {
  const linkedYear = file?.year ?? documentYear ?? null;
  const uploadedYear = shanghaiYearOf(file?.createdAt) ?? uploadYear ?? null;
  const canOpen = Boolean(file?.storagePath);
  if (!canOpen && linkedYear == null && uploadedYear == null) {
    return <span className="font-mono-data text-[11px] text-muted-foreground">未上傳</span>;
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      {canOpen ? (
        <button
          type="button"
          className="font-mono-data text-[11px] text-primary underline underline-offset-2 hover:text-primary/80"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(file!.storagePath);
          }}
        >
          {linkedYear != null ? String(linkedYear) : '查看'}
        </button>
      ) : (
        <span className={cn('font-mono-data text-[11px]', linkedYear != null ? 'text-foreground' : 'text-muted-foreground')}>
          {uploadYearLabel(linkedYear, Boolean(file))}
        </span>
      )}
      {uploadedYear != null ? (
        <span className="font-mono-data text-[10px] text-muted-foreground">上傳 {uploadedYear}</span>
      ) : null}
    </div>
  );
}

function formatJoinDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-HK');
}

export function ManufacturerDirectoryView({
  onOpenFactory,
  onOpenUpload,
}: {
  onOpenFactory: (code: string) => void;
  onOpenUpload: (factory: FactoryRecord) => void;
}) {
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
  const [canQueueParse, setCanQueueParse] = useState(false);
  const queuedDocumentIds = useRef(new Set<string>());

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
          // The document's own year, not the upload date: a 2025 catalog uploaded
          // in 2026 must still show 2025.
          const year = row.document_year;
          const file: CatalogFileRef = {
            id: row.id,
            storagePath: row.storage_path ?? '',
            year,
            status: row.processing_status,
            createdAt: row.created_at,
          };
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
        setCatalogByFactory(attachDirectoryFiles(summary, rows));
      } catch (catalogError) {
        console.error('[ManufacturerDirectory] Catalog summary failed:', catalogError);
        setCatalogByFactory(attachDirectoryFiles({}, rows));
      }
      setCanQueueParse(await canManageSupplierDocuments().catch(() => false));
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

  const openUpload = (factory: FactoryRecord) => {
    onOpenUpload(factory);
  };

  const openFile = (storagePath: string) => {
    void openSupplierCatalog(storagePath).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : '無法打開文件');
    });
  };

  useEffect(() => {
    if (!canQueueParse) return;
    const waiting: { factoryId: string; id: string }[] = [];
    for (const [factoryId, summary] of Object.entries(catalogByFactory)) {
      if (!summary.catalogFile || !summary.priceListFile) continue;
      for (const file of [summary.catalogFile, summary.priceListFile]) {
        if (queuedDocumentIds.current.has(file.id)) continue;
        if (file.status === 'processing' || file.status === 'completed' || file.status === 'review_required' || file.status === 'failed') {
          queuedDocumentIds.current.add(file.id);
          continue;
        }
        waiting.push({ factoryId, id: file.id });
        queuedDocumentIds.current.add(file.id);
      }
    }
    if (!waiting.length) return;
    void (async () => {
      const queued = new Map<string, Set<string>>();
      let failed = 0;
      for (const item of waiting) {
        try {
          await enqueueSupplierDocumentParse(item.id);
          const ids = queued.get(item.factoryId) ?? new Set<string>();
          ids.add(item.id);
          queued.set(item.factoryId, ids);
        } catch {
          failed += 1;
          queuedDocumentIds.current.delete(item.id);
        }
      }
      if (queued.size) {
        setCatalogByFactory((current) => {
          const next = { ...current };
          for (const [factoryId, ids] of queued) {
            const summary = next[factoryId];
            if (!summary) continue;
            const patch = (target: CatalogFileRef | null) => (
              target && ids.has(target.id) ? { ...target, status: 'pending' } : target
            );
            const statusRank: Record<string, number> = { processing: 5, pending: 4, failed: 3, review_required: 2, completed: 1 };
            const status = (statusRank[summary.status ?? ''] ?? 0) >= statusRank.pending ? summary.status : 'pending';
            next[factoryId] = {
              ...summary,
              catalogFile: patch(summary.catalogFile),
              priceListFile: patch(summary.priceListFile),
              status,
            };
          }
          return next;
        });
      }
      if (failed) toast.error(failed === waiting.length ? '未能自動排入解析任務' : `${failed} 份文件未能排入解析任務`);
    })();
  }, [canQueueParse, catalogByFactory]);

  return (
    <div className="flex h-full min-h-0 flex-col fds-page-padding">
      <div className="fds-page-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div>
            <h1 className="fds-page-title"><BookOpen className="h-5 w-5 text-primary" />廠家目錄</h1>
            <p className="fds-page-description">
              類型為傢私或材料 · 今年報價代表本年報價單有此廠家 · 圖冊／報價單 PDF 顯示文件年份 · {factories.length} records
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
                <TableHead className="font-display text-xs font-semibold w-[210px] text-right">
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
                      {factory.used_this_year ? '有記錄' : '未見記錄'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DocumentYearCell
                      file={catalog?.catalogFile ?? null}
                      documentYear={catalog?.hasCatalog ? catalog.catalogYear : null}
                      uploadYear={catalog?.catalogFile ? factory.catalog_year : null}
                      onOpen={openFile}
                    />
                  </TableCell>
                  <TableCell>
                    <DocumentYearCell
                      file={catalog?.priceListFile ?? null}
                      documentYear={catalog?.hasPriceList ? catalog.priceListYear : null}
                      uploadYear={catalog?.priceListFile ? factory.quote_pdf_year : null}
                      onOpen={openFile}
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
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          openUpload(factory);
                        }}
                      >
                        上傳圖冊/報價單
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDetail(factory);
                        }}
                      >
                        查看
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
    </div>
  );
}
