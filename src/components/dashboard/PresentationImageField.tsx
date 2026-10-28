import { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LoadingImage } from '@/components/ui/loading-image';
import { uploadFileToStorage } from '@/lib/imageStorage';

export function PresentationImageField({ label, value, disabled, onChange, onUploadState }: {
  label: string; value?: string; disabled: boolean; onChange: (url: string) => void;
  onUploadState: (delta: number) => void;
}) {
  const [uploading, setUploading] = useState(false);
  return <div className="w-full space-y-2">
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || uploading} onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
          toast.error('請選擇 20MB 以內的 JPG、PNG 或 WebP 圖片'); return;
        }
        setUploading(true);
        onUploadState(1);
        try { onChange(await uploadFileToStorage(file, crypto.randomUUID(), 'presentation', { resize: false })); }
        catch { toast.error('圖片上傳失敗，請重試'); }
        finally { setUploading(false); onUploadState(-1); }
      }} />
    </label>
    {uploading ? <p className="text-sm text-muted-foreground">上傳中，請稍候再保存草稿。</p> : null}
    {value ? <div className="space-y-2">
      <LoadingImage src={value} alt={label} className="h-36 w-full" imgClassName="object-contain" />
      <Button type="button" variant="outline" disabled={disabled || uploading} onClick={() => onChange('')}>移除圖片</Button>
    </div> : null}
  </div>;
}
