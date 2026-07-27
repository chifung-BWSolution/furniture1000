import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

const ALLOWED_IMAGE_MIME = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/tiff',
  'image/svg+xml',
];
const ALLOWED_IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'svg'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPT_IMAGE_INPUT =
  '.png,.jpg,.jpeg,.webp,.tiff,.tif,.svg,image/png,image/jpeg,image/webp,image/tiff,image/svg+xml';

function validateImageFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const typeOk =
    ALLOWED_IMAGE_MIME.includes(file.type) || ALLOWED_IMAGE_EXT.includes(ext);
  if (!typeOk) {
    return '不支援的格式。支援：PNG、JPG、JPEG、WEBP、TIFF、SVG';
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `檔案過大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限為 5 MB`;
  }
  return null;
}

export function ProductImageUploadModal({
  open,
  onClose,
  onSelectFile,
  title = '上傳圖片',
  previewUrl,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onSelectFile: (file: File) => void | Promise<void>;
  title?: string;
  previewUrl?: string;
  busy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const isBusy = busy || localBusy;

  const handleFile = async (file: File) => {
    const err = validateImageFile(file);
    if (err) {
      toast.error('無法上傳圖片', { description: err });
      return;
    }
    try {
      setLocalBusy(true);
      await onSelectFile(file);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '上傳失敗';
      toast.error('無法上傳圖片', { description: msg });
    } finally {
      setLocalBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue;
        event.preventDefault();
        const file = item.getAsFile();
        if (file) void handleFile(file);
        return;
      }
    };
    window.addEventListener('paste', handler);
    dropRef.current?.focus();
    return () => window.removeEventListener('paste', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paste while open only
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isBusy, onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-card p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-foreground">
            {title}
          </h3>
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="rounded p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="關閉"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {previewUrl ? (
          <div className="mb-4 flex max-h-[50vh] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/20 p-3">
            <img
              src={previewUrl}
              alt=""
              className="max-h-[46vh] max-w-full object-contain"
            />
          </div>
        ) : null}

        <button
          ref={dropRef}
          type="button"
          disabled={isBusy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 transition-colors ${
            dragActive
              ? 'border-primary bg-primary/5'
              : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {isBusy ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-primary" />
          )}
          <span className="font-body text-sm font-medium text-foreground">
            {isBusy
              ? '上傳中...'
              : previewUrl
                ? '點擊、拖放或貼上 (Ctrl+V) 更換圖片'
                : '點擊、拖放或貼上 (Ctrl+V) 圖片'}
          </span>
          <span className="font-body text-xs text-muted-foreground">
            支援 PNG、JPG、JPEG、WEBP、TIFF、SVG（最大 5 MB）
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_IMAGE_INPUT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleFile(file);
          }}
        />
      </div>
    </div>
  );
}
