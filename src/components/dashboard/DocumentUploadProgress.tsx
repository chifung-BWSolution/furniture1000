import { Progress } from '@/components/ui/progress';
import type { DocumentUploadProgress as UploadProgress } from '@/lib/resumableDocumentUpload';

export interface DocumentUploadStatus {
  id: string;
  name: string;
  progress: UploadProgress;
  error?: string;
}

const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const labels: Record<UploadProgress['phase'], string> = {
  preparing: '正在準備文件', uploading: '分片上傳中', retrying: '連線中斷，正在重試',
  splitting: '正在拆成較小的 PDF', registering: '上傳完成，正在登記文件', complete: '已保存',
};

export function DocumentUploadProgress({ uploads }: { uploads: DocumentUploadStatus[] }) {
  if (!uploads.length) return null;
  return <div className="space-y-4" aria-label="文件上傳進度" aria-live="polite">
    {uploads.map(({ id, name, progress, error }) => {
      const percent = progress.totalBytes ? Math.min(100, Math.floor(progress.uploadedBytes / progress.totalBytes * 100)) : 0;
      return <div key={id} className="space-y-2">
        <div className="flex items-start justify-between gap-3 text-xs">
          <span className="min-w-0 break-all font-medium">{name}</span>
          <span className="shrink-0 tabular-nums">{percent}%</span>
        </div>
        <Progress value={percent} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${name} 上傳進度`} />
        <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
          <span className={error ? 'text-destructive' : undefined}>{error || labels[progress.phase]}</span>
          <span className="tabular-nums">{size(progress.uploadedBytes)} / {size(progress.totalBytes)}</span>
        </div>
      </div>;
    })}
  </div>;
}
