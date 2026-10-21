import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { renderSourcePage, type NormRect, type SourcePageRequest } from '@/lib/sourcePage';

export function SourcePageDialog({
  request,
  onClose,
}: {
  request: SourcePageRequest & { title?: string | null };
  onClose: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pageNo, setPageNo] = useState<number | null>(request.pageNo ?? null);
  const [highlight, setHighlight] = useState<NormRect | null>(null);
  const [title, setTitle] = useState(request.title ?? '原文');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    renderSourcePage(request)
      .then((page) => {
        if (cancelled) {
          URL.revokeObjectURL(page.imageUrl);
          return;
        }
        objectUrl = page.imageUrl;
        setImageUrl(page.imageUrl);
        setPageNo(page.pageNo);
        setHighlight(page.highlight);
        if (page.title) setTitle(page.title);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error('無法開啟原文', { description: err instanceof Error ? err.message : String(err) });
          onCloseRef.current();
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [request.documentId, request.pageNo, request.productId]);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      size="4xl"
      icon={<FileText className="h-6 w-6" />}
      title={
        <>
          {title}
          {pageNo != null && (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              第 {pageNo} 頁
            </span>
          )}
        </>
      }
      description="供應商文件原文頁面，框線標出此產品在原文的位置。"
    >
      {!imageUrl ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在打開原文…
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg border border-border bg-white">
            <img src={imageUrl} alt={`${title} 第 ${pageNo ?? ''} 頁`} className="block w-full" />
            {highlight && (
              <div
                className="pointer-events-none absolute border-2 border-primary bg-primary/20"
                style={{
                  left: `${highlight.x * 100}%`,
                  top: `${highlight.y * 100}%`,
                  width: `${highlight.w * 100}%`,
                  height: `${highlight.h * 100}%`,
                }}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {highlight ? '框線標出此產品在原文的位置。' : '已打開對應頁。這筆資料沒有版面座標，所以沒有框線。'}
          </p>
        </div>
      )}
    </Modal>
  );
}
