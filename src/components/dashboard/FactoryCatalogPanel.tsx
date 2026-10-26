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
import { useAuth } from '@/contexts/AuthProvider';
import { supabase } from '@/lib/supabase';
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

export function FactoryCatalogPanel({
  factoryId,
  factoryName,
  initialDocType = 'catalog',
  embedded = false,
  onUploaded,
}: {
  factoryId: string;
  factoryName: string;
  initialDocType?: SupplierDocType;
  embedded?: boolean;
  onUploaded?: () => void;
}) {
  const { user } = useAuth();
  const [catalogs, setCatalogs] = useState<SupplierCatalogRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [docType, setDocType] = useState<SupplierDocType>(initialDocType);
  const [year, setYear] = useState(shanghaiYear());
  const [series, setSeries] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
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
    void load();
  }, [load]);

  useEffect(() => {
    setDocType(initialDocType);
  }, [initialDocType]);

  useEffect(() => {
    const email = user?.email?.trim();
    if (!email) {
      setCanUpload(false);
      return;
    }
    let cancelled = false;
    supabase
      .from('platform_user_profiles')
      .select('role')
      .ilike('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const role = String(data?.role || '').toLowerCase();
        setCanUpload(role === 'admin' || role === 'uploader');
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

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
    if (!file) {
      toast.error(`請選擇 PDF ${docLabel}`);
      return;
    }
    setSaving(true);
    try {
      const saved = await uploadSupplierCatalog({
        factoryId,
        factoryName,
        docType,
        file,
        year,
        series,
        productCategories: selectedCategories,
        versionLabel,
        description,
      });
      setHighlightedId(saved.id);
      toast.success(`${docLabel}已保存，目前狀態：${catalogStatusLabel(saved.processing_status)}`);
      setSeries('');
      setVersionLabel('');
      setDescription('');
      setSelectedCategories([]);
      setFile(null);
      setFileKey((current) => current + 1);
      await load(true);
      onUploaded?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : '上傳失敗';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        {embedded ? null : (
          <>
            <h2 className="font-display text-base font-semibold">上傳圖冊或報價單</h2>
            <p className="mt-1 font-body text-xs text-muted-foreground">
              兩種文件用同一個畫面。新檔另存一版，不會覆蓋舊檔，也不會立刻解析。
            </p>
          </>
        )}
        {canUpload ? (
          <div className={cn('grid gap-4 md:grid-cols-2', !embedded && 'mt-4')}>
            <div className="space-y-2 md:col-span-2">
              <Label>文件類型</Label>
              <div className="flex gap-2">
                {(['catalog', 'price_list'] as const).map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={docType === type ? 'default' : 'outline'}
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
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
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
              <Button onClick={() => void handleUpload()} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                保存{docLabel}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 font-body text-sm text-muted-foreground">
            只有管理員或上載人員可以上傳。設計師與 PM 僅可查看及下載圖冊；報價單 PDF 僅限管理員或上載人員。
          </p>
        )}
      </div>

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
                  尚未上傳圖冊或報價單
                </TableCell>
              </TableRow>
            ) : (
              catalogs.map((catalog) => (
                <TableRow key={catalog.id} className={cn(catalog.id === highlightedId && 'bg-primary/5')}>
                  <TableCell>{supplierDocTypeLabel(catalog.doc_type)}</TableCell>
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
