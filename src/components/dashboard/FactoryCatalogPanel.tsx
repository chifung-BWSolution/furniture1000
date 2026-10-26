import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { canManageSupplierDocuments } from '@/lib/supplierDocuments';
import { DocumentUploadProgress, type DocumentUploadStatus } from './DocumentUploadProgress';
import {
  fetchProductCategoryPairs,
  uniqueLevel1InOrder,
} from '@/lib/productCategoryOptions';
import {
  catalogStatusDetail,
  catalogStatusLabel,
  listFactoryCatalogs,
  openSupplierCatalog,
  supplierDocTypeLabel,
  uploadSupplierCatalog,
  type SupplierCatalogRow,
  type SupplierDocType,
} from '@/lib/supplierCatalog';

function shanghaiYear(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).format(new Date()),
  );
}

const ALL_DOC_TYPES: SupplierDocType[] = ['catalog', 'price_list', 'certificate'];

export function FactoryCatalogPanel({
  factoryId,
  factoryName,
  initialDocType = 'catalog',
  allowedDocTypes = ALL_DOC_TYPES,
  embedded = false,
  onUploaded,
}: {
  factoryId: string;
  factoryName: string;
  initialDocType?: SupplierDocType;
  allowedDocTypes?: SupplierDocType[];
  embedded?: boolean;
  onUploaded?: () => void;
}) {
  const [catalogs, setCatalogs] = useState<SupplierCatalogRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canUpload, setCanUpload] = useState<boolean | null>(null);
  const [docType, setDocType] = useState<SupplierDocType>(initialDocType);
  const [year, setYear] = useState(shanghaiYear());
  const [series, setSeries] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<DocumentUploadStatus[]>([]);
  const [fileKey, setFileKey] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [rows, pairs] = await Promise.all([
        listFactoryCatalogs(factoryId),
        fetchProductCategoryPairs(),
      ]);
      setCatalogs(rows);
      setCategories(uniqueLevel1InOrder(pairs));
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件載入失敗';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [factoryId]);

  useEffect(() => {
    if (canUpload) void load();
  }, [load, canUpload]);

  useEffect(() => {
    setDocType(allowedDocTypes.includes(initialDocType) ? initialDocType : allowedDocTypes[0]);
  }, [initialDocType, allowedDocTypes]);

  useEffect(() => {
    let cancelled = false;
    canManageSupplierDocuments().then(ok => { if (!cancelled) setCanUpload(ok); });
    return () => { cancelled = true; };
  }, []);

  const isCatalog = docType === 'catalog';
  const docLabel = supplierDocTypeLabel(docType);
  const selectedSet = useMemo(() => new Set(selectedCategories), [selectedCategories]);

  const toggleCategory = (name: string, checked: boolean) => {
    setSelectedCategories((current) => {
      if (checked) return current.includes(name) ? current : [...current, name];
      return current.filter((item) => item !== name);
    });
  };

  const handleUpload = async () => {
    if (!files.length) { toast.error(`請選擇 PDF ${docLabel}`); return; }
    if (!Number.isInteger(year) || year < 1990 || year > 2100) { toast.error('請填寫有效年份'); return; }
    if (isCatalog && (!series.trim() || !selectedCategories.length)) {
      toast.error('圖冊必須填寫系列及選擇主要產品類型'); return;
    }
    setSaving(true);
    const failed: File[] = [];
    let savedCount = 0;
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploads(current => [...current, { id, name: file.name, progress: { phase: 'preparing', uploadedBytes: 0, totalBytes: file.size } }]);
      try {
        const saved = await uploadSupplierCatalog({
          factoryId, factoryName, docType, file, year, series,
          productCategories: selectedCategories, versionLabel, description,
          onProgress: progress => setUploads(current => current.map(item => item.id === id ? { ...item, progress } : item)),
        });
        setHighlightedId(saved.id);
        savedCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : '上傳失敗';
        failed.push(file);
        setUploads(current => current.map(item => item.id === id ? { ...item, error: message } : item));
        toast.error(`${file.name}：${message}`);
      }
    }
    setFiles(failed);
    setFileKey(current => current + 1);
    if (savedCount) {
      toast.success(`已保存 ${savedCount} 份${docLabel}${docType === 'certificate' ? '，不安排解析' : '，等待夜間解析'}`);
      await load(true);
      onUploaded?.();
    }
    setSaving(false);
  };

  if (canUpload === null) return <p className="py-6 text-sm text-muted-foreground">正在確認文件權限…</p>;
  if (!canUpload) return <p className="py-6 text-sm text-muted-foreground">廠家原始文件可能包含內部價格，只限管理員／上載人員查看。</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        {embedded ? null : (
          <>
            <h2 className="font-display text-base font-semibold">上傳廠家文件</h2>
            <p className="mt-1 font-body text-xs text-muted-foreground">
              可一次選擇多份 PDF，共用本次填寫的資料。新檔另存，不覆蓋舊檔；圖冊與報價單在上海時間 23:00–翌日 09:00 解析，證書只保存。
            </p>
          </>
        )}
        {canUpload ? (
          <fieldset disabled={saving} className={cn('grid min-w-0 gap-4 md:grid-cols-2', !embedded && 'mt-4')}>
            <div className="space-y-2 md:col-span-2">
              <Label>文件類型</Label>
              <div className="flex gap-2">
                {allowedDocTypes.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={docType === type ? 'default' : 'outline'}
                    aria-pressed={docType === type}
                    onClick={() => setDocType(type)}
                  >
                    {supplierDocTypeLabel(type)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="catalog-file">PDF</Label>
              <Input
                id="catalog-file"
                key={fileKey}
                type="file"
                multiple
                accept="application/pdf,.pdf"
                onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setUploads([]); }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="catalog-year">年份</Label>
              <Input
                id="catalog-year"
                type="number"
                min={1990}
                max={2100}
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="catalog-series">{isCatalog ? '系列' : '系列（可空）'}</Label>
              <Input
                id="catalog-series"
                value={series}
                onChange={(event) => setSeries(event.target.value)}
                placeholder="例如 2026 辦公椅"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="catalog-version">版本（可空）</Label>
              <Input
                id="catalog-version"
                value={versionLabel}
                onChange={(event) => setVersionLabel(event.target.value)}
                placeholder="例如 A / 修訂"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{isCatalog ? '主要產品類型' : '主要產品類型（可空）'}</Label>
              {!loading && !categories.length && (
                <p className="text-sm text-muted-foreground">未取得產品分類。請重新整理；若仍無選項，請管理員檢查「產品分類」設定。報價單與證書可先保存。</p>
              )}
              <div className="flex flex-wrap gap-3">
                {categories.map((name) => (
                  <label key={name} className="flex items-center gap-2 font-body text-sm">
                    <Checkbox
                      checked={selectedSet.has(name)}
                      onCheckedChange={(checked) => toggleCategory(name, checked === true)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="catalog-description">備註</Label>
              <Textarea
                id="catalog-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div>
              {!saving && files.length > 0 && uploads.some(item => item.error) && (
                <p className="mb-2 text-sm text-destructive">有 {files.length} 份未保存，可直接重試或重新選檔。</p>
              )}
              <Button onClick={() => void handleUpload()} disabled={saving || (isCatalog && !categories.length)} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                保存{files.length > 1 ? ` ${files.length} 份` : ''}{docLabel}
              </Button>
            </div>
          </fieldset>
        ) : (
          <p className="mt-3 font-body text-sm text-muted-foreground">
            只有管理員或上載人員可以上傳。設計師與 PM 僅可查看及下載圖冊；報價單 PDF 僅限管理員或上載人員。
          </p>
        )}
      </div>

      <DocumentUploadProgress uploads={uploads} />

      {highlightedId ? (
        <UploadedStatus
          document={catalogs.find((row) => row.id === highlightedId) ?? null}
          fallbackLabel={docLabel}
        />
      ) : null}

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-display text-sm font-semibold">已上傳文件</h2>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load(true)} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            重新整理狀態
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>類型</TableHead>
              <TableHead>年份</TableHead>
              <TableHead>系列</TableHead>
              <TableHead>產品類型</TableHead>
              <TableHead>版本</TableHead>
              <TableHead>解析</TableHead>
              <TableHead>上傳時間</TableHead>
              <TableHead className="text-right">檔案</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  正在載入文件…
                </TableCell>
              </TableRow>
            ) : catalogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  尚未上傳廠家文件
                </TableCell>
              </TableRow>
            ) : (
              catalogs.map((catalog) => (
                <TableRow key={catalog.id} className={cn(catalog.id === highlightedId && 'bg-primary/5')}>
                  <TableCell>
                    <span>{supplierDocTypeLabel(catalog.doc_type)}</span>
                    <p className="mt-1 max-w-[220px] break-all text-xs text-muted-foreground">{catalog.title || '未命名文件'}</p>
                  </TableCell>
                  <TableCell className="font-mono-data text-xs">{catalog.document_year ?? '—'}</TableCell>
                  <TableCell>{catalog.series || '—'}</TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {(catalog.product_categories || []).join('、') || '—'}
                    </span>
                  </TableCell>
                  <TableCell>{catalog.version_label || '—'}</TableCell>
                  <TableCell className="min-w-[220px]">
                    <Badge variant={catalog.processing_status === 'failed' ? 'destructive' : 'secondary'}>
                      {catalogStatusLabel(catalog.processing_status)}
                    </Badge>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {catalogStatusDetail(catalog.processing_status, catalog.error_message)}
                    </p>
                  </TableCell>
                  <TableCell className="font-mono-data text-[11px] text-muted-foreground">
                    {new Date(catalog.created_at).toLocaleString('zh-HK', { timeZone: 'Asia/Shanghai' })}
                  </TableCell>
                  <TableCell className="text-right">
                    {canUpload || catalog.doc_type === 'catalog' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        onClick={() => {
                          void openSupplierCatalog(catalog.storage_path).catch((error: unknown) => {
                            toast.error(error instanceof Error ? error.message : '下載失敗');
                          });
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        下載
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function UploadedStatus({
  document,
  fallbackLabel,
}: {
  document: SupplierCatalogRow | null;
  fallbackLabel: string;
}) {
  const status = document?.processing_status ?? 'pending';
  const label = document ? supplierDocTypeLabel(document.doc_type) : fallbackLabel;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="font-body text-xs text-muted-foreground">剛剛上傳的{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="font-display text-base font-semibold">{document?.title || label}</p>
        <Badge variant={status === 'failed' ? 'destructive' : 'secondary'}>{catalogStatusLabel(status)}</Badge>
      </div>
      <p className="mt-2 font-body text-sm text-muted-foreground">
        {catalogStatusDetail(status, document?.error_message)}
      </p>
    </div>
  );
}
