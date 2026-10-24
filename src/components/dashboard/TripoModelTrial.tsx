import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Info, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Progress } from '@/components/ui/progress';
import { fetchProductImage, fetchTripoJob, prepareTripoImage, requestTripoModel, tripoActive, tripoErrorLabel, wakeModelWorker, type TripoJob } from '@/lib/tripoModels';

export function TripoModelTrial({ productId, title, prepareOrthographic, onComplete, disabled }: {
  productId: string; title: string; prepareOrthographic: () => Promise<{ url: string }>; onComplete: () => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<TripoJob | null>(null);
  const requestId = useRef<string | null>(null);
  const completed = useRef<string | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const active = tripoActive(job);
  const percent = Math.round((job?.progress ?? 0) * 100);

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

  const loadOrthographic = async () => {
    if (busy || loadingImage || active) return;
    setLoadingImage(true);
    setError('');
    setImage(null);
    setConfirmed(false);
    requestId.current = null;
    try {
      const drawing = await prepareOrthographic();
      setImage(await prepareTripoImage(await fetchProductImage(drawing.url)));
    } catch (err) { setError(err instanceof Error ? err.message : '無法準備三視圖'); }
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
        setOpen(true); setError(''); setConfirmed(false); requestId.current = null;
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
            <ModalButton variant="secondary" onClick={() => setOpen(false)}>關閉</ModalButton>
            <ModalButton onClick={() => {
              setOpen(false);
              toast.success(`Tripo 已在後台繼續生成（${percent}%），完成後會加入此產品的模型庫`);
            }}>後台運行</ModalButton>
          </>
        ) : (
          <>
            <ModalButton variant="secondary" disabled={busy || loadingImage} onClick={() => setOpen(false)}>{job ? '關閉' : '取消'}</ModalButton>
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
                先根據 2–3 張產品圖與產品描述生成或沿用三視圖，再將下方預覽的三視圖送到 Tripo。產品原圖及情境圖不會直接送到 Tripo。
              </p>
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <Button type="button" variant="outline" disabled={busy || loadingImage} onClick={() => void loadOrthographic()}>
                  {loadingImage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loadingImage ? '正在準備三視圖…' : preview ? '重新讀取三視圖' : '準備三視圖'}
                </Button>
                {!preview && <p className="text-sm leading-6 text-muted-foreground">優先沿用已生成的三視圖；沒有時會使用 Grok 分析及 Gemini 生圖。此步尚未提交 Tripo 任務。</p>}
                {preview && <>
                  <p className="text-sm font-medium">即將送到 Tripo 的三視圖</p>
                  <LoadingImage src={preview} alt="即將送到 Tripo 的同一件產品三視圖" className="max-h-80 w-auto max-w-full rounded-lg bg-white" imgClassName="object-contain" />
                  <p className="text-xs leading-5 text-muted-foreground">三個視角代表同一件產品。AI 推測的結構及尺寸仍需核對。</p>
                </>}
              </div>

              <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-6 text-foreground">
                <Checkbox className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[5px]" checked={confirmed} disabled={!image || busy || loadingImage} onCheckedChange={value => setConfirmed(value === true)} />
                <span>我已核對三視圖為同一件傢俬的不同視角，並同意本次使用 Tripo API 點數。</span>
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
