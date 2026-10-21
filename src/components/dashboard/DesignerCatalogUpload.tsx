import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchFactoriesWithIds, type FactoryItem } from '@/lib/factorySupabase';
import {
  listDesignerCatalogItems,
  listMyDesignerCatalogs,
  submitDesignerCatalogPdf,
  type DesignerBatchStatus,
  type DesignerCatalogBatch,
  type DesignerCatalogItem,
} from '@/lib/designerCatalogReview';

const STATUS_LABEL: Record<DesignerBatchStatus, string> = {
  parsing: '解析中',
  pending: '待審核',
  partial: '部分完成',
  approved: '已全部入庫',
  rejected: '已全部拒絕',
  failed: '解析失敗',
};

const ITEM_STATUS: Record<DesignerCatalogItem['status'], string> = {
  pending: '待審核',
  approved: '已入庫',
  rejected: '已拒絕',
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-HK', { hour12: false });
}

export function DesignerCatalogUpload() {
  const [open, setOpen] = useState(false);
  const [factories, setFactories] = useState<FactoryItem[]>([]);
  const [factoryName, setFactoryName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<DesignerCatalogBatch[]>([]);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [items, setItems] = useState<DesignerCatalogItem[] | null>(null);

  const reload = useCallback(() => {
    listMyDesignerCatalogs()
      .then(setBatches)
      .catch((err) => toast.error('讀取上載狀態失敗', { description: errorText(err) }));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!open || factories.length > 0) return;
    fetchFactoriesWithIds().then(setFactories).catch(() => setFactories([]));
  }, [open, factories.length]);

  const factoryId = useMemo(() => {
    const name = factoryName.trim();
    return factories.find((factory) => factory.display_name === name)?.factory_id || null;
  }, [factories, factoryName]);

  const toggleBatch = (batchId: string) => {
    if (openBatch === batchId) {
      setOpenBatch(null);
      setItems(null);
      return;
    }
    setOpenBatch(batchId);
    setItems(null);
    listDesignerCatalogItems(batchId)
      .then(setItems)
      .catch((err) => toast.error('讀取產品狀態失敗', { description: errorText(err) }));
  };

  const submit = async () => {
    if (!file) {
      toast.error('請先選擇 PDF');
      return;
    }
    setBusy(true);
    setProgress('準備上載…');
    try {
      const result = await submitDesignerCatalogPdf({
        file,
        factoryId,
        factoryName,
        onProgress: setProgress,
      });
      toast.success(`已送交 ${result.count} 件產品待審核`, {
        description: '這些產品尚未進入產品庫，要等管理員通過。',
      });
      setFile(null);
      setFileKey((value) => value + 1);
      setProgress('');
      reload();
    } catch (err) {
      toast.error('目錄上載失敗', { description: errorText(err) });
      setProgress('');
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FileUp className="h-4 w-4 text-primary" />
        上載產品目錄 PDF
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {batches.filter((batch) => batch.status === 'pending' || batch.status === 'parsing').length} 份待審
        </span>
        <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">
            選擇或輸入廠家後上載 PDF。系統會用與廠家上載相同的解析，把每一件產品歸入現有產品分類。結果先進入待審，不會直接出現在產品庫；你可以在下面查看自己的審核狀態。
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[16rem] flex-1 space-y-1 text-xs">
              <span className="text-muted-foreground">廠家</span>
              <Input
                list="designer-catalog-factories"
                value={factoryName}
                onChange={(event) => setFactoryName(event.target.value)}
                placeholder="選擇現有廠家，或輸入新廠家名稱"
                disabled={busy}
              />
              <datalist id="designer-catalog-factories">
                {factories.map((factory) => (
                  <option key={`${factory.factory_id}-${factory.display_name}`} value={factory.display_name} />
                ))}
              </datalist>
            </label>
            <label className="min-w-[14rem] flex-1 space-y-1 text-xs">
              <span className="text-muted-foreground">PDF</span>
              <Input
                key={fileKey}
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <Button type="button" disabled={busy || !factoryName.trim() || !file} onClick={submit}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              解析並送審
            </Button>
          </div>
          {progress && <p className="text-xs text-muted-foreground">{progress}</p>}

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">我的上載</div>
            {batches.length === 0 ? (
              <p className="text-xs text-muted-foreground">還沒有上載過目錄。</p>
            ) : (
              batches.map((batch) => (
                <div key={batch.id} className="rounded-md border border-border bg-background">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs"
                    onClick={() => toggleBatch(batch.id)}
                  >
                    <span className="font-medium">{batch.factory_name}</span>
                    <span className="truncate text-muted-foreground">{batch.file_name}</span>
                    <span className="text-muted-foreground">{formatTime(batch.created_at)}</span>
                    <span className="ml-auto">{STATUS_LABEL[batch.status]}</span>
                    <span className="text-muted-foreground">
                      待審 {batch.pending_count} · 入庫 {batch.approved_count} · 拒絕 {batch.rejected_count}
                    </span>
                  </button>
                  {batch.error_message && (
                    <p className="px-3 pb-2 text-xs text-destructive">{batch.error_message}</p>
                  )}
                  {openBatch === batch.id && (
                    <div className="space-y-1 border-t border-border px-3 py-2">
                      {items === null ? (
                        <p className="text-xs text-muted-foreground">載入中…</p>
                      ) : items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">這份目錄沒有產品列。</p>
                      ) : (
                        items.map((item) => (
                          <div key={item.id} className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            <span className="min-w-0 flex-1 truncate">{item.title}</span>
                            <span>{ITEM_STATUS[item.status]}</span>
                            {item.rejection_reason && (
                              <span className="text-destructive">原因：{item.rejection_reason}</span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
