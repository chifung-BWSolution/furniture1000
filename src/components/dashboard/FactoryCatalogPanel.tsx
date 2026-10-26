import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
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
  catalogStatusLabel,
  listFactoryCatalogs,
  openSupplierCatalog,
  uploadSupplierCatalog,
  type SupplierCatalogRow,
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
}: {
  factoryId: string;
  factoryName: string;
}) {
  const { user } = useAuth();
  const [catalogs, setCatalogs] = useState<SupplierCatalogRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const [year, setYear] = useState(shanghaiYear());
  const [series, setSeries] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, pairs] = await Promise.all([
        listFactoryCatalogs(factoryId),
        fetchProductCategoryPairs(),
      ]);
      setCatalogs(rows);
      setCategories(uniqueLevel1InOrder(pairs));
    } catch (error) {
      const message = error instanceof Error ? error.message : '圖冊載入失敗';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [factoryId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const selectedSet = useMemo(() => new Set(selectedCategories), [selectedCategories]);

  const toggleCategory = (name: string, checked: boolean) => {
    setSelectedCategories((current) => {
      if (checked) return current.includes(name) ? current : [...current, name];
      return current.filter((item) => item !== name);
    });
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('請選擇 PDF 圖冊');
      return;
    }
    setSaving(true);
    try {
      await uploadSupplierCatalog({
        factoryId,
        factoryName,
        file,
        year,
        series,
        productCategories: selectedCategories,
        versionLabel,
        description,
      });
      toast.success('圖冊已保存。解析會在今晚 23:00 至明早 09:00（上海時間）進行，現在不會開始。');
      setSeries('');
      setVersionLabel('');
      setDescription('');
      setSelectedCategories([]);
      setFile(null);
      setFileKey((current) => current + 1);
      await load();
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
        <h2 className="font-display text-base font-semibold">上傳圖冊</h2>
        <p className="mt-1 font-body text-xs text-muted-foreground">
          新檔會另存一版，不會覆蓋舊圖冊。上傳只保存檔案，不會立刻解析。
        </p>
        {canUpload ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
              <Label htmlFor="catalog-series">系列</Label>
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
              <Label>主要產品類型</Label>
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
                保存圖冊
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 font-body text-sm text-muted-foreground">
            只有管理員或上載人員可以上傳。你可以查看及下載已保存的圖冊。
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
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
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  正在載入圖冊…
                </TableCell>
              </TableRow>
            ) : catalogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  尚未上傳圖冊
                </TableCell>
              </TableRow>
            ) : (
              catalogs.map((catalog) => (
                <TableRow key={catalog.id}>
                  <TableCell className="font-mono-data text-xs">{catalog.document_year ?? '—'}</TableCell>
                  <TableCell>{catalog.series || '—'}</TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {(catalog.product_categories || []).join('、') || '—'}
                    </span>
                  </TableCell>
                  <TableCell>{catalog.version_label || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{catalogStatusLabel(catalog.processing_status)}</Badge>
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
