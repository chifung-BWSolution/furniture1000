import { useState } from 'react';
import { FileSpreadsheet, FileText, Globe, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { confirm } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import { LoadingImage } from '@/components/ui/loading-image';
import {
  buildPublishPayload,
  downloadCaseOrdersExcel,
  publishCaseShowcase,
  type CaseExportItem,
} from '@/lib/caseExport';
import { buildCaseShowcasePdf, downloadBlob } from '@/lib/caseExportPdf';

/**
 * 成功案例 › 導出預覽（PRD F-CASE-004／F-CASE-005）。
 * 入選項目可修改對外名稱／說明／PM 顯示／相片取捨，
 * 然後匯出 Excel（訂單精選）、案例集 PDF，或發布到客戶專區。
 * 所有動作只輸出對外欄位（脫敏在 caseExport.ts 資料結構層強制）。
 */
export function CaseExportDialog({
  open,
  onOpenChange,
  items,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CaseExportItem[];
  onChange: (items: CaseExportItem[]) => void;
}) {
  const [busy, setBusy] = useState('');
  const orderCount = items.filter((i) => i.kind === 'order').length;

  const update = (key: string, patch: Partial<CaseExportItem>) => {
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };
  const remove = (key: string) => {
    onChange(items.filter((item) => item.key !== key));
  };
  const togglePhoto = (key: string, url: string, include: boolean) => {
    update(key, {
      photos: (items.find((i) => i.key === key)?.photos || []).map((p) =>
        p.url === url ? { ...p, include } : p,
      ),
    });
  };

  const exportExcel = () => {
    try {
      downloadCaseOrdersExcel(items);
      toast.success('已匯出訂單數據精選 Excel');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '匯出 Excel 失敗');
    }
  };

  const exportPdf = async () => {
    setBusy('pdf');
    try {
      const { blob, failedImageCount, requestedPhotoCount } = await buildCaseShowcasePdf(
        items,
        (message) => setBusy(message),
      );
      if (requestedPhotoCount > 0 && failedImageCount >= requestedPhotoCount) {
        toast.error(
          `匯出失敗：${failedImageCount} 張入選相片／Logo 全部無法載入，請檢查連結後重試`,
        );
        return;
      }
      downloadBlob(blob, `成功案例集-${new Date().toISOString().slice(0, 10)}.pdf`);
      if (failedImageCount > 0) {
        toast.warning(
          `已匯出 PDF，但有 ${failedImageCount} 張相片／Logo 載入失敗（已跳過），請檢查後重試`,
        );
      } else {
        toast.success('已匯出成功案例集 PDF');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '匯出 PDF 失敗，請重試');
    } finally {
      setBusy('');
    }
  };

  const publish = async () => {
    if (
      !(await confirm({
        title: '發布到客戶專區？',
        description:
          '發布後客戶專區「成功案例」頁會即時顯示這份對外內容（取代現有發布）。請確認客戶名稱及相片可對外使用。',
        confirmLabel: '發布',
      }))
    ) {
      return;
    }
    setBusy('publish');
    try {
      await publishCaseShowcase(buildPublishPayload(items));
      toast.success('已發布到客戶專區');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '發布失敗，請確認權限後重試');
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="3xl"
      title={`導出預覽 · ${items.length} 個入選項目`}
      description="修改對外顯示內容後匯出或發布；工廠、安裝團隊、內部備註、成本一律不會出現在導出內容。"
    >
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-auto pr-1">
        {items.map((item) => (
          <section
            key={item.key}
            className="space-y-3 rounded-lg border border-border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    對外名稱
                  </span>
                  <Input
                    value={item.title}
                    onChange={(event) => update(item.key, { title: event.target.value })}
                    className="text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    對外說明（可留空）
                  </span>
                  <Textarea
                    value={item.note}
                    onChange={(event) => update(item.key, { note: event.target.value })}
                    rows={2}
                    className="text-sm"
                  />
                </label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`移除 ${item.title}`}
                title="移除"
                className="h-8 w-8 shrink-0"
                onClick={() => remove(item.key)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {item.kind === 'order' && (
                <span>
                  訂單數據 · {item.orders?.length || 0} 個產品項目
                  {(item.photos || []).length > 0 &&
                    ` · ${(item.photos || []).filter((p) => p.include).length} 張相片入選`}
                </span>
              )}
              {item.kind === 'photo' && (
                <span>完工相片 · {(item.photos || []).filter((p) => p.include).length} 張入選</span>
              )}
              {item.kind === 'brand' && <span>知名客戶 Logo</span>}
              {item.kind !== 'brand' && (
                <label className="flex cursor-pointer items-center gap-2">
                  <Switch
                    checked={item.showPm}
                    onCheckedChange={(checked) => update(item.key, { showPm: checked === true })}
                    aria-label={`顯示 PM（${item.title}）`}
                  />
                  顯示 PM
                </label>
              )}
              {(item.kind === 'order' || item.kind === 'photo') && (
                <label className="flex cursor-pointer items-center gap-2">
                  <Switch
                    checked={item.showDates}
                    onCheckedChange={(checked) => update(item.key, { showDates: checked === true })}
                    aria-label={`顯示日期（${item.title}）`}
                  />
                  顯示日期
                </label>
              )}
            </div>
            {(item.photos || []).length > 0 && (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {item.photos!.map((photo) => (
                  <label
                    key={photo.url}
                    className="group relative cursor-pointer overflow-hidden rounded-md border border-border"
                  >
                    <LoadingImage
                      src={photo.url}
                      alt="完工相片"
                      loading="lazy"
                      decoding="async"
                      className={`aspect-[4/3] w-full ${photo.include ? '' : 'opacity-30'}`}
                      imgClassName="object-cover"
                    />
                    <span className="absolute left-1.5 top-1.5">
                      <Checkbox
                        aria-label={`入選此相片（${item.title}）`}
                        checked={photo.include}
                        onCheckedChange={(checked) =>
                          togglePhoto(item.key, photo.url, checked === true)
                        }
                        className="bg-background/80"
                      />
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!orderCount || Boolean(busy)}
          onClick={exportExcel}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          匯出訂單 Excel{orderCount ? `（${orderCount}）` : ''}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!items.length || Boolean(busy)}
          onClick={exportPdf}
        >
          {busy === 'pdf' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileText className="mr-2 h-4 w-4" />
          )}
          {busy === 'pdf' ? '生成中…' : '匯出案例集 PDF'}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!items.length || Boolean(busy)}
          onClick={publish}
        >
          {busy === 'publish' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Globe className="mr-2 h-4 w-4" />
          )}
          {busy === 'publish' ? '發布中…' : '發布到客戶專區'}
        </Button>
      </div>
    </Modal>
  );
}
