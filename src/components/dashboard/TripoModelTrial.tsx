import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Check, ChevronRight, CloudUpload, Images, Info, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Progress } from '@/components/ui/progress';
import { fetchProductImage, fetchTripoJob, prepareTripoImage, requestTripoModel, tripoActive, tripoErrorLabel, wakeModelWorker, type TripoJob } from '@/lib/tripoModels';
import { cn } from '@/lib/utils';

export function TripoModelTrial({ productId, title, images, onComplete, disabled }: {
  productId: string; title: string; images?: string[]; onComplete: () => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<Blob | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [showAllImages, setShowAllImages] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<TripoJob | null>(null);
  const requestId = useRef<string | null>(null);
  const completed = useRef<string | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const input = useRef<HTMLInputElement>(null);
  const active = tripoActive(job);
  const percent = Math.round((job?.progress ?? 0) * 100);
  const existingImages = Array.from(new Set((images ?? []).filter(url => /^https?:\/\//i.test(url)))).slice(0, 8);

  useEffect(() => {
    if (!image) { setPreview(''); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const refresh = useCallback(async () => {
    const next = await fetchTripoJob(productId);
    setJob(next);
    setError('');
    return next;
  }, [productId]);

  useEffect(() => {
    let cancelled = false;
    void fetchTripoJob(productId).then(next => { if (!cancelled) setJob(next); })
      .catch(() => { if (!cancelled) setError('暫時讀不到 Tripo 任務，請按刷新'); });
    return () => { cancelled = true; };
  }, [productId]);

  useEffect(() => {
    if (!active) return;
    wakeModelWorker();
    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetchTripoJob(productId).then(next => {
        if (cancelled) return;
        setJob(next);
        setError('');
        if (tripoActive(next)) wakeModelWorker();
      }).catch(() => { if (!cancelled) setError('暫時讀不到進度；任務會在背景繼續，請按刷新'); });
    }, 8000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active, productId]);

  useEffect(() => {
    if (job?.status === 'succeeded' && completed.current !== job.id) {
      completed.current = job.id;
      completeRef.current();
    }
  }, [job]);

  const chooseFile = async (file: File) => {
    setLoadingImage(true);
    setError('');
    setImage(null);
    setSourceUrl(null);
    setConfirmed(false);
    requestId.current = null;
    try { setImage(await prepareTripoImage(file)); }
    catch (err) { setError(err instanceof Error ? err.message : '無法讀取圖片'); }
    finally { setLoadingImage(false); }
  };

  /** Reuse one of the product's own photos instead of asking for a new upload. */
  const chooseExisting = async (url: string) => {
    if (busy || loadingImage) return;
    if (sourceUrl === url) {
      setImage(null); setSourceUrl(null); setConfirmed(false); requestId.current = null; setError('');
      return;
    }
    setLoadingImage(true);
    setError('');
    setImage(null);
    setSourceUrl(null);
    setConfirmed(false);
    requestId.current = null;
    try {
      setImage(await prepareTripoImage(await fetchProductImage(url)));
      setSourceUrl(url);
    } catch (err) { setError(err instanceof Error ? err.message : '無法讀取產品原圖'); }
    finally { setLoadingImage(false); }
  };

  const submit = async () => {
    if (!image || !confirmed || active || busy || loadingImage) return;
    setBusy(true);
    setError('');
    // A new ID per attempt: a finished job keeps its own ID, so retrying the same
    ///image must create a new job. The DB still refuses a second active job.
    requestId.current = crypto.randomUUID();
    try {
      await requestTripoModel(productId, image, requestId.current);
      toast.success('Tripo 任務已提交，可在此查看進度或放到後台');
      try { await refresh(); }
      catch { setError('已提交，但暫時讀不到進度；請按刷新'); }
    } catch (err) { setError(err instanceof Error ? err.message : '提交失敗'); }
    finally { setBusy(false); }
  };

  const statusLabel = active
    ? `Tripo 生成中 · ${percent}%`
    : job?.status === 'succeeded' ? 'Tripo GLB 已加入模型庫，可在「下載模型」取得'
      : job?.status === 'failed' ? 'Tripo 生成失敗，可換圖再試'
        : job?.status === 'cancelled' ? 'Tripo 任務已取消，可換圖再試'
          : 'Tripo 任務狀態';

  return (
    <>
      <Button size="sm" variant="outline" className="h-10 shrink-0 whitespace-nowrap rounded-lg" disabled={disabled || busy || loadingImage} onClick={() => {
        setOpen(true); setError(''); setConfirmed(false); setImage(null); setSourceUrl(null); setShowAllImages(false); setDragging(false); requestId.current = null;
      }}>
        {active ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Box className="mr-1 h-3.5 w-3.5" />}
        Tripo 生成
      </Button>
      <Modal open={open} onOpenChange={next => { if (!busy && !loadingImage) setOpen(next); }} size="4xl"
        className="max-w-[min(960px,calc(100vw-2rem))]"
        icon={<Box className="h-7 w-7" />}
        title={<span className="block text-[22px] leading-tight tracking-tight sm:text-[26px]">Tripo 圖轉 3D 試用</span>}
        description={<span className="block text-[13px] leading-6 sm:text-[15px]">{title}</span>}
        headerClassName="gap-4 px-6 pt-6 pb-5 sm:gap-5 sm:px-9 sm:pt-8 sm:pb-7"
        bodyClassName="px-6 pb-7 sm:px-9 sm:pb-8"
        footerClassName="px-6 py-4 sm:px-9 sm:py-5"
        footer={active ? (
          <>
            <ModalButton variant="ghost" onClick={() => setOpen(false)}>關閉</ModalButton>
            <ModalButton onClick={() => {
              setOpen(false);
              toast.success(`Tripo 已在後台繼續生成（${percent}%），完成後會加入此產品的模型庫`);
            }}>後台運行</ModalButton>
          </>
        ) : (
          <>
            <ModalButton variant="ghost" disabled={busy || loadingImage} onClick={() => setOpen(false)}>{job ? '關閉' : '取消'}</ModalButton>
            <ModalButton disabled={!image || !confirmed || busy || loadingImage} onClick={() => void submit()}>{busy ? '處理中…' : '確認並使用 API 點數生成'}</ModalButton>
          </>
        )}>
        <div className="space-y-6">
          {job && (
            <div className="rounded-xl border border-border bg-muted/40 p-4 text-[13px] text-muted-foreground" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-foreground">{statusLabel}</span>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => void refresh().catch(() => setError('讀取失敗，請稍後重試'))} aria-label="刷新 Tripo 任務">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              {active && <Progress value={percent} className="mt-2.5 h-1.5" />}
              {job.status === 'succeeded' && job.result?.credits_consumed != null && <p className="mt-1.5">本次消耗 {job.result.credits_consumed} API 點數。尺寸尚未校正。</p>}
              {(error || job.error) && <p className="mt-1.5 text-destructive">{tripoErrorLabel(error || job.error || '')}</p>}
            </div>
          )}

          {active ? (
            <p className="text-[15px] leading-7 text-muted-foreground">生成期間可關閉視窗或選「後台運行」，任務會繼續；完成後自動加入此產品的模型庫。未校正尺寸，暫不輸出 SKP。</p>
          ) : (
            <>
              <p className="text-[15px] leading-7 text-muted-foreground">
                請上傳清晰的產品圖片，且只包含一件傢俬。若原圖有多張桌子在同一張圖片中，請先準備單張桌子的參考圖；若缺少角度，AI 會自動推測並補齊。
              </p>

              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="單件傢俬參考圖" onChange={event => {
                const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseFile(file);
              }} />

              <div
                role="button"
                tabIndex={0}
                aria-label="上載單件傢俬參考圖"
                aria-disabled={busy || loadingImage}
                onClick={() => { if (!busy && !loadingImage) input.current?.click(); }}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  if (!busy && !loadingImage) input.current?.click();
                }}
                onDragOver={event => {
                  event.preventDefault();
                  if (!busy && !loadingImage) setDragging(true);
                }}
                onDragLeave={event => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDragging(false);
                }}
                onDrop={event => {
                  event.preventDefault();
                  setDragging(false);
                  if (busy || loadingImage) return;
                  const file = event.dataTransfer.files?.[0];
                  if (file) void chooseFile(file);
                }}
                className={cn(
                  'flex min-h-[208px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed px-6 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
                  dragging ? 'border-primary bg-primary/10' : 'border-primary/35 bg-primary/[0.04] hover:border-primary/55 hover:bg-primary/[0.07]',
                  (busy || loadingImage) && 'pointer-events-none opacity-70',
                )}
              >
                {loadingImage ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">處理參考圖…</span>
                  </>
                ) : preview ? (
                  <>
                    <LoadingImage src={preview} alt="即將送到 Tripo 的單件參考圖" className="max-h-44 w-auto max-w-full rounded-lg" imgClassName="object-contain shadow-sm" />
                    <span className="text-[13px] font-medium text-primary">點擊更換參考圖</span>
                  </>
                ) : (
                  <>
                    <CloudUpload className="h-12 w-12 text-primary" strokeWidth={1.5} />
                    <span className="text-lg font-bold text-foreground">拖拽圖片到此處</span>
                    <span className="text-[15px] text-muted-foreground">
                      或 <span className="font-semibold text-primary underline underline-offset-4">點擊上傳</span>
                    </span>
                    <span className="text-[13px] text-muted-foreground">支援 JPG / PNG，建議清晰單件產品圖</span>
                  </>
                )}
              </div>

              {existingImages.length > 0 && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-[15px] font-semibold text-foreground">或選擇現有產品原圖</h3>
                    {existingImages.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setShowAllImages(value => !value)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary/[0.07] px-3 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <Images className="h-4 w-4" />
                        {showAllImages ? '收起產品圖庫' : '從產品圖庫選擇'}
                        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showAllImages && 'rotate-90')} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(showAllImages ? existingImages : existingImages.slice(0, 4)).map((url, index) => {
                      const selected = sourceUrl === url;
                      return (
                        <button
                          key={url}
                          type="button"
                          disabled={busy || loadingImage}
                          aria-pressed={selected}
                          aria-label={`使用第 ${index + 1} 張產品原圖`}
                          title="使用這張產品原圖"
                          onClick={() => void chooseExisting(url)}
                          className={cn(
                            'relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted/40 transition',
                            selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50',
                            (busy || loadingImage) && 'opacity-60',
                          )}
                        >
                          <LoadingImage src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                          {selected && (
                            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-6 text-foreground">
                <Checkbox className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[5px]" checked={confirmed} disabled={!image || busy || loadingImage} onCheckedChange={value => setConfirmed(value === true)} />
                <span>我確認參考圖只包含要生成的單件傢俬，並同意本次使用 Tripo API 點數。</span>
              </label>

              <div className="flex gap-3 rounded-xl bg-primary/[0.05] px-4 py-3.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-[13px] leading-6 text-muted-foreground">
                  標準材質：約 30,000 面，預計每次 30 API 點數（約 US$0.30）。實際扣點以 Tripo 為準。<br />
                  完成後儲存 GLB；尺寸未校正，暫不輸出 SKP。關閉頁面後任務仍會繼續。
                </p>
              </div>
            </>
          )}

          {!job && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
