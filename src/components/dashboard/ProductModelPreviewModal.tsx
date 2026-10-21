import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Loader2, RotateCcw } from 'lucide-react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { GlbViewport, type ViewportTool } from '@/components/dashboard/GlbViewport';
import type { ProductModelFile, SkpPreviewStatus } from '@/lib/productModels';
import {
  fetchSkpPreviewStatus,
  previewGlbPath,
  requestSkpPreview,
  signedModelUrl,
  skpPreviewPending,
} from '@/lib/productModels';

const PREVIEW_POLL_MS = 3500;

function previewLabel(preview: SkpPreviewStatus | null | undefined): string {
  if (!preview || preview.status === 'none') return '尚未建立預覽';
  if (preview.status === 'ready') return '可預覽';
  if (preview.status === 'pending') return '等待轉換…';
  if (preview.status === 'queued') return '排隊轉換中…';
  if (preview.status === 'running') return '正在轉換 SKP…';
  if (preview.status === 'failed') return preview.error ?? '預覽轉換失敗';
  return '處理中…';
}

export function ProductModelPreviewModal({
  file,
  open,
  onOpenChange,
  onPreviewChange,
}: {
  file: ProductModelFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when preview status changes so the parent can refresh the file list. */
  onPreviewChange?: () => void;
}) {
  const [preview, setPreview] = useState<SkpPreviewStatus | null>(file?.preview ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<ViewportTool>('rotate');
  const [resetKey, setResetKey] = useState(0);
  const [status, setStatus] = useState('');
  const [retryBusy, setRetryBusy] = useState(false);
  const onPreviewChangeRef = useRef(onPreviewChange);
  onPreviewChangeRef.current = onPreviewChange;
  const previewStatusRef = useRef(preview?.status);
  previewStatusRef.current = preview?.status;
  const autoRequestedId = useRef<string | null>(null);

  const glbPath = file ? previewGlbPath({ ...file, preview: preview ?? file.preview }) : null;

  const refreshPreview = useCallback(async (productModelId: string) => {
    const next = await fetchSkpPreviewStatus(productModelId);
    const prev = previewStatusRef.current;
    previewStatusRef.current = next.status;
    setPreview(next);
    if (prev !== next.status && (next.status === 'ready' || next.status === 'failed')) {
      onPreviewChangeRef.current?.();
    }
  }, []);

  useEffect(() => {
    if (!open || !file) {
      setUrl(null);
      setError(null);
      setLoading(false);
      setPreview(null);
      return;
    }
    setPreview(file.preview ?? null);
  }, [open, file?.id]);

  useEffect(() => {
    if (!open || !file) return;
    if (file.format === 'fbx') {
      setUrl(null);
      setError('FBX 暫不提供瀏覽器預覽，請下載後在 3D 軟件開啟。');
      return;
    }
    const path = previewGlbPath({ ...file, preview: preview ?? file.preview });
    if (!path) {
      setUrl(null);
      setError(null);
      if (file.format === 'skp') {
        const p = preview ?? file.preview;
        if (p?.status === 'failed') setError(p.error ?? '預覽轉換失敗');
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    signedModelUrl(path)
      .then((signed) => {
        if (!cancelled) {
          setUrl(signed);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, file, preview, glbPath]);

  useEffect(() => {
    if (!open) autoRequestedId.current = null;
  }, [open]);

  useEffect(() => {
    const productModelId = file?.id;
    const format = file?.format;
    const filePreviewStatus = file?.preview?.status;
    if (!open || !productModelId || format !== 'skp') return;
    const currentStatus = preview?.status ?? filePreviewStatus;
    if (currentStatus === 'ready' || currentStatus === 'failed') return;
    let cancelled = false;
    if ((!currentStatus || currentStatus === 'none') && autoRequestedId.current !== productModelId) {
      autoRequestedId.current = productModelId;
      void requestSkpPreview(productModelId)
        .then((next) => {
          if (cancelled) return;
          previewStatusRef.current = next.status;
          setPreview(next);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        });
    }
    const timer = window.setInterval(() => {
      void refreshPreview(productModelId).catch(() => undefined);
    }, PREVIEW_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, file?.id, file?.format, file?.preview?.status, preview?.status, refreshPreview]);

  const title = file?.file_name ?? (file ? `${file.format.toUpperCase()} 模型` : '模型預覽');
  const hint = file?.format === 'skp' ? previewLabel(preview ?? file.preview) : '';

  const retry = async () => {
    if (!file) return;
    setRetryBusy(true);
    try {
      const next = await requestSkpPreview(file.id);
      setPreview(next);
      onPreviewChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      icon={<Box className="h-6 w-6" />}
      title={title}
      description={
        file?.format === 'skp'
          ? '上傳的 SKP 會由 Windows Worker 透過 SketchUp 轉成 GLB 預覽；與原檔下載權限相同。'
          : '拖曳旋轉、滾輪縮放；預覽與下載使用相同權限與簽名連結。'
      }
      footer={
        <>
          {(preview?.status === 'failed' || error) && file?.format === 'skp' && (
            <ModalButton variant="secondary" disabled={retryBusy} onClick={() => void retry()}>
              {retryBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              重試預覽
            </ModalButton>
          )}
          <ModalButton variant="secondary" onClick={() => setResetKey((n) => n + 1)}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            重設視角
          </ModalButton>
          <ModalButton variant="ghost" onClick={() => onOpenChange(false)}>
            關閉
          </ModalButton>
        </>
      }
    >
      <div className="space-y-3">
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {(['rotate', 'pan', 'zoom'] as ViewportTool[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`rounded-md border px-2.5 py-1 ${tool === mode ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200'}`}
              onClick={() => setTool(mode)}
            >
              {mode === 'rotate' ? '旋轉' : mode === 'pan' ? '平移' : '縮放'}
            </button>
          ))}
          {status && <span className="ml-auto self-center">{status}</span>}
        </div>
        <div className="relative h-[min(420px,55vh)] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {(loading || (file?.format === 'skp' && !url && !error && skpPreviewPending({ ...file, preview: preview ?? file.preview }))) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-50/80">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">{hint || '載入預覽…'}</span>
            </div>
          )}
          {error && !loading && !url && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-destructive">
              {error}
            </p>
          )}
          {url && !error && (
            <GlbViewport
              url={url}
              tool={tool}
              wireframe={false}
              showMaterial={true}
              resetKey={resetKey}
              onProgress={(label) => setStatus(label)}
              onReady={() => setStatus('可預覽')}
              onFailed={(message) => setError(message)}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
