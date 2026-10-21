import { useEffect, useState } from 'react';
import { Box, Loader2, RotateCcw } from 'lucide-react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { GlbViewport, type ViewportTool } from '@/components/dashboard/GlbViewport';
import type { ModelFormat, ProductModelFile } from '@/lib/productModels';
import { signedModelUrl } from '@/lib/productModels';

function canPreview(format: ModelFormat): boolean {
  return format === 'glb';
}

export function ProductModelPreviewModal({
  file,
  open,
  onOpenChange,
}: {
  file: ProductModelFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<ViewportTool>('rotate');
  const [resetKey, setResetKey] = useState(0);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open || !file) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!canPreview(file.format)) {
      setUrl(null);
      setError(
        file.format === 'skp'
          ? 'SKP 預覽尚待系統轉換（T-807）；可先下載原檔在 SketchUp 開啟。'
          : 'FBX 暫不提供瀏覽器預覽，請下載後在 3D 軟件開啟。',
      );
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    signedModelUrl(file.storage_path)
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
  }, [open, file?.id, file?.storage_path, file?.format]);

  const title = file?.file_name ?? (file ? `${file.format.toUpperCase()} 模型` : '模型預覽');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      icon={<Box className="h-6 w-6" />}
      title={title}
      description="拖曳旋轉、滾輪縮放；預覽與下載使用相同權限與簽名連結。"
      footer={
        <>
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
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/80">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          {error && !loading && (
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
