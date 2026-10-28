import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingImage } from '@/components/ui/loading-image';
import { uploadFileToStorage } from '@/lib/imageStorage';
import { cn } from '@/lib/utils';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function PresentationImageField({
  label,
  value,
  disabled,
  onChange,
  onUploadState,
  onUploaded,
  hidePreview = false,
  variant = 'field',
  hint,
  icon,
}: {
  label: string;
  value?: string;
  disabled: boolean;
  onChange: (url: string) => void;
  onUploadState: (delta: number) => void;
  onUploaded?: (file: File) => Promise<void>;
  hidePreview?: boolean;
  variant?: 'field' | 'dropzone';
  hint?: string;
  icon?: ReactNode;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type) || file.size > 20 * 1024 * 1024) {
      toast.error('請選擇 20MB 以內的 JPG、PNG 或 WebP 圖片');
      return;
    }
    setUploading(true);
    onUploadState(1);
    try {
      onChange(await uploadFileToStorage(file, crypto.randomUUID(), 'presentation', { resize: false }));
      await onUploaded?.(file);
    } catch {
      toast.error('圖片上傳失敗，請重試');
    } finally {
      setUploading(false);
      onUploadState(-1);
    }
  };

  const onInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await takeFile(file);
  };

  if (variant === 'dropzone') {
    return (
      <div
        className={cn(
          'rounded-xl border bg-white p-3 dark:bg-card',
          dragOver ? 'border-indigo-400 bg-indigo-50/40' : 'border-slate-200 dark:border-border',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (disabled || uploading) return;
          void takeFile(event.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled || uploading}
          onChange={(event) => void onInput(event)}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#efedff] text-[#5b4dff] dark:bg-indigo-950/60 dark:text-indigo-200">
              {icon}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{label}</p>
              {hint ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0 rounded-full border-indigo-200 bg-white px-3 text-indigo-600 hover:bg-indigo-50 dark:bg-background"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            選擇文件
          </Button>
        </div>
        <button
          type="button"
          className={cn(
            'mt-3 flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground',
            dragOver ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-slate-50/70 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-border dark:bg-muted/20',
          )}
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {value && !hidePreview ? (
            <LoadingImage src={value} alt={label} className="mb-2 h-20 w-full" imgClassName="object-contain" />
          ) : null}
          {uploading ? '上傳中，請稍候…' : '拖曳檔案至此，或點擊選擇文件'}
        </button>
        {value ? (
          <div className="mt-2 text-center">
            <Button type="button" variant="ghost" className="h-8 text-xs" disabled={disabled || uploading} onClick={() => onChange('')}>
              移除圖片
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <label className="block space-y-1 text-sm">
        <span>{label}</span>
        <Input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || uploading} onChange={(event) => void onInput(event)} />
      </label>
      {uploading ? <p className="text-sm text-muted-foreground">上傳中，請稍候再保存草稿。</p> : null}
      {value ? (
        <div className="space-y-2">
          {!hidePreview ? <LoadingImage src={value} alt={label} className="h-36 w-full" imgClassName="object-contain" /> : null}
          <Button type="button" variant="outline" disabled={disabled || uploading} onClick={() => onChange('')}>移除圖片</Button>
        </div>
      ) : null}
    </div>
  );
}
