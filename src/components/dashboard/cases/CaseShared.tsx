import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  fetchCaseShowcase,
  type CaseKind,
  type CaseResult,
} from "@/lib/caseShowcase";

export function useCaseData<T>(kind: CaseKind) {
  const [result, setResult] = useState<CaseResult<T>>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult({ items: [] });
    fetchCaseShowcase<T>(kind, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "載入失敗");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, revision]);
  return { ...result, loading, error, reload: () => setRevision((n) => n + 1) };
}

export function CaseShell({
  title,
  description,
  icon: Icon,
  loading,
  error,
  reload,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  loading: boolean;
  error: string;
  reload: () => void;
  children: ReactNode;
}) {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="fds-page-padding space-y-4">
        <section className="fds-page-header flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="fds-page-title">
              <Icon className="h-5 w-5 text-primary" />
              {title}
            </h1>
            <p className="fds-page-description">{description}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            重新整理
          </Button>
        </section>
        {loading ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-20 text-muted-foreground"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            載入中…
          </div>
        ) : error ? (
          <ErrorState description={error} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function CaseFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | { value: string; label: string }[];
}) {
  return (
    <label className="flex min-w-36 flex-1 flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="h-10 rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">全部</option>
        {options.map((option) => {
          const item =
            typeof option === "string"
              ? { value: option, label: option }
              : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function CasePagination({
  page,
  total,
  pageSize = 20,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm text-muted-foreground">
      <p role="status">
        共 {total} 筆 · 第 {page} / {pages} 頁
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          上一頁
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          下一頁
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
export function CaseEmpty() {
  return <EmptyState />;
}
export function CaseImage({
  src,
  alt,
  className = "",
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className={`flex items-center justify-center gap-2 bg-muted text-sm text-muted-foreground ${className}`}
    >
      <ImageOff className="h-5 w-5" />
      <span>暫無圖片</span>
    </div>
  );
}
export function CaseLightbox({
  value,
  onClose,
  onIndex,
}: {
  value: { title: string; urls: string[]; index: number } | null;
  onClose: () => void;
  onIndex: (index: number) => void;
}) {
  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-5xl"
        onKeyDown={(e) => {
          if (!value) return;
          if (e.key === "ArrowLeft")
            onIndex((value.index + value.urls.length - 1) % value.urls.length);
          if (e.key === "ArrowRight")
            onIndex((value.index + 1) % value.urls.length);
        }}
      >
        <DialogHeader>
          <DialogTitle>{value?.title || "完工相片"}</DialogTitle>
          <DialogDescription>
            {value ? `${value.index + 1} / ${value.urls.length}` : ""}
          </DialogDescription>
        </DialogHeader>
        {value && (
          <>
            <CaseImage
              src={value.urls[value.index]}
              alt={`${value.title} 第 ${value.index + 1} 張`}
              className="max-h-[65vh] w-full object-contain"
            />
            <div className="flex justify-between gap-3">
              <Button
                variant="outline"
                disabled={value.index === 0}
                onClick={() => onIndex(value.index - 1)}
              >
                上一張
              </Button>
              <a
                href={value.urls[value.index]}
                target="_blank"
                rel="noopener noreferrer"
                className="self-center text-sm text-primary underline underline-offset-4"
              >
                開啟原圖
              </a>
              <Button
                variant="outline"
                disabled={value.index === value.urls.length - 1}
                onClick={() => onIndex(value.index + 1)}
              >
                下一張
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
