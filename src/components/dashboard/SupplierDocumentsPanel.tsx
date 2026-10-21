import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { DocumentUploadProgress, type DocumentUploadStatus } from './DocumentUploadProgress';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  canManageSupplierDocuments,
  cancelProcessingJob,
  cancelSupplierDocumentParts,
  documentWorkInProgress,
  enqueueSupplierDocumentParse,
  getSupplierDocumentDownloadUrl,
  isPdfFile,
  latestJob,
  listDocumentSegments,
  listSupplierDocuments,
  uploadSupplierDocument,
  type DocumentSegment,
  type PageType,
  type ProcessingJobStatus,
  type ProcessingJobSummary,
  type SupplierDocument,
  type SupplierDocumentStatus,
} from '@/lib/supplierDocuments';

const POLL_MS = 5000;
const NO_CURRENCY = '__none__';
const CURRENCIES = ['HKD', 'RMB', 'USD', 'EUR'];

const DOC_STATUS: Record<SupplierDocumentStatus, { label: string; className: string }> = {
  uploaded: { label: '已上載', className: 'bg-muted text-muted-foreground border-border' },
  parsing: { label: '解析中', className: 'bg-sky-500/15 text-sky-600 border-sky-500/30' },
  review: { label: '待審核', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  ready: { label: '已入庫', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  failed: { label: '失敗', className: 'bg-destructive/15 text-destructive border-destructive/30' },
};

const JOB_STATUS: Record<ProcessingJobStatus, string> = {
  queued: '排隊中',
  running: '處理中',
  succeeded: '完成',
  failed: '失敗',
  cancelled: '已取消',
};

const PAGE_TYPE_LABEL: Record<PageType, string> = {
  cover: '封面',
  toc: '目錄',
  product: '產品',
  price_table: '價目表',
  terms: '條款',
  other: '其他',
};

const OCR_LABEL: Record<string, string> = {
  done: '完成',
  failed: '失敗',
  skipped: '跳過',
  unsupported: '不支援',
};

function jobProgressText(job: ProcessingJobSummary): string | null {
  const s = job.state;
  if (!s?.phase) return null;
  if (s.phase === 'structure') {
    const total = s.units?.length ?? 0;
    return `AI 提取產品 ${Math.min(total, s.cursor ?? 0)}/${total} 組`;
  }
  if (!s.page_count) return null;
  const done = Math.min(s.page_count, Math.max(0, (s.cursor ?? 1) - 1));
  return `${s.phase === 'extract' ? '提取文字' : '分類頁面'} 第 ${done}/${s.page_count} 頁`;
}

function jobResultText(job: ProcessingJobSummary): string | null {
  const r = job.result;
  if (job.status !== 'succeeded' || !r?.segments) return null;
  const ocr = Object.entries(r.ocr ?? {})
    .filter(([, n]) => n)
    .map(([k, n]) => `${OCR_LABEL[k] ?? k} ${n}`)
    .join('、');
  const items = r.items !== undefined
    ? ` · ${r.items} 件產品${r.needs_attention ? `（${r.needs_attention} 件需注意）` : ''}`
    : '';
  const currency = r.currency_suggestion ? ` · 建議幣種 ${r.currency_suggestion}` : '';
  const rate = r.success_rate != null ? ` · 提取成功率 ${Math.round(r.success_rate * 100)}%` : '';
  const duration = r.duration_seconds != null ? ` · ${r.duration_seconds}s` : '';
  const cost = job.cost_actual != null ? ` · 費用 USD ${Number(job.cost_actual).toFixed(4)}` : '';
  const usage = job.tokens != null ? ` · ${job.tokens} tokens` : '';
  const scanned = job.ocr_pages ? ` · OCR ${job.ocr_pages} 頁` : '';
  return `${r.segments} 段${items}${rate}${currency}${ocr ? ` · 掃描頁 OCR：${ocr}` : ''}${scanned}${usage}${duration}${cost}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-HK', { hour12: false });
}

interface SupplierDocumentsPanelProps {
  factoryId?: string | null;
  factoryName?: string | null;
  /** Bump to reload after documents are archived elsewhere (e.g. AI 處理上傳). */
  refreshKey?: number;
  className?: string;
  /** The unified upload surface owns file selection and metadata. */
  listOnly?: boolean;
}

export function SupplierDocumentsPanel({ factoryId, factoryName, refreshKey = 0, className, listOnly = false }: SupplierDocumentsPanelProps) {
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<SupplierDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<DocumentUploadStatus[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>(NO_CURRENCY);
  const [docType, setDocType] = useState<'quote' | 'catalog'>('quote');
  const [openSegments, setOpenSegments] = useState<{ docId: string; rows: DocumentSegment[] | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleSegments = useCallback(async (docId: string) => {
    if (openSegments?.docId === docId) {
      setOpenSegments(null);
      return;
    }
    setOpenSegments({ docId, rows: null });
    try {
      const rows = await listDocumentSegments(docId);
      setOpenSegments((cur) => (cur?.docId === docId ? { docId, rows } : cur));
    } catch (err) {
      setOpenSegments(null);
      toast.error('讀取分段失敗', { description: err instanceof Error ? err.message : String(err) });
    }
  }, [openSegments]);

  useEffect(() => {
    let cancelled = false;
    canManageSupplierDocuments().then((ok) => {
      if (!cancelled) setCanManage(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setDocs(await listSupplierDocuments({ factoryId: factoryId || null, factoryName }));
    } catch (err) {
      if (!silent) toast.error('讀取供應商文件失敗', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [factoryId, factoryName]);

  useEffect(() => {
    if (canManage) void reload();
  }, [canManage, reload, refreshKey]);

  const anyActive = docs.some(documentWorkInProgress);
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void reload(true), POLL_MS);
    return () => clearInterval(timer);
  }, [anyActive, reload]);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter(isPdfFile);
    if (inputRef.current) inputRef.current.value = '';
    if (files.length === 0) {
      toast.error('請選擇 PDF 檔');
      return;
    }
    setUploading(files.map((f) => f.name));
    let created = 0;
    for (const file of files) {
      const id = crypto.randomUUID();
      setUploadProgress(previous => [...previous, { id, name: file.name, progress: { phase: 'preparing', uploadedBytes: 0, totalBytes: file.size } }]);
      try {
        const res = await uploadSupplierDocument({
          file,
          onProgress: progress => setUploadProgress(previous => previous.map(item => item.id === id ? { ...item, progress } : item)),
          factoryId,
          factoryName,
          docType,
          currency: currency === NO_CURRENCY ? null : currency,
        });
        if (res.splitMode === 'worker') {
          toast.success(`${file.name} 已保存，改由伺服器拆檔後解析`);
          created += 1;
        } else if ((res.partCount ?? 0) > 0) {
          toast.success(res.duplicate
            ? `${file.name} 已存在，共 ${res.partCount} 段`
            : `${file.name} 已拆成 ${res.partCount} 段並開始解析`);
          if (!res.duplicate) created += 1;
        } else if (res.duplicate) {
          toast.message(`${file.name} 已存在，未重複建立`);
        } else {
          created += 1;
        }
      } catch (err) {
        setUploadProgress(previous => previous.map(item => item.id === id ? { ...item, error: '上載失敗，請重新選擇此文件以續傳' } : item));
        toast.error(`${file.name} 上載失敗`, { description: err instanceof Error ? err.message : String(err) });
      } finally {
        setUploading((prev) => prev.filter((n) => n !== file.name));
      }
    }
    if (created > 0) toast.success(`已上載 ${created} 份 PDF，解析任務已排隊`);
    void reload(true);
  }, [factoryId, factoryName, docType, currency, reload]);

  const runAction = useCallback(async (id: string, action: () => Promise<unknown>, okMessage: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(okMessage);
      await reload(true);
    } catch (err) {
      toast.error('操作失敗', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const handleDownload = useCallback(async (doc: SupplierDocument) => {
    try {
      window.open(await getSupplierDocumentDownloadUrl(doc.storage_path), '_blank', 'noopener');
    } catch (err) {
      toast.error('下載失敗', { description: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  if (canManage === false) {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5', className)}>
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="font-body text-[11px] text-muted-foreground">供應商原始文件只限 admin／傢俬組查看</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3 rounded-xl border border-border bg-card/50 p-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 text-primary" />
        <h3 className="font-display text-sm font-bold tracking-tight">{listOnly ? '文件與解析進度' : '供應商文件（原始 PDF）'}</h3>
        <span className="font-body text-[11px] text-muted-foreground truncate">
          {factoryName || factoryId || '全部廠家'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {!listOnly && <>
          <Select value={docType} onValueChange={(v) => setDocType(v as 'quote' | 'catalog')}>
            <SelectTrigger className="h-7 w-[84px] text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quote">報價單</SelectItem>
              <SelectItem value="catalog">目錄</SelectItem>
            </SelectContent>
          </Select>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-7 w-[92px] text-[11px]"><SelectValue placeholder="貨幣" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CURRENCY}>貨幣未標示</SelectItem>
              {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          </>}
          <Button variant="ghost" size="sm" aria-label="重新整理文件" className="h-7 w-7 p-0" onClick={() => void reload()} disabled={loading} title="重新整理">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
          {!listOnly && <>
          <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={() => inputRef.current?.click()} disabled={canManage === null || uploading.length > 0}>
            {uploading.length > 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            上載 PDF
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          </>}
        </div>
      </div>

      <DocumentUploadProgress uploads={uploadProgress} />

      {docs.length === 0 && !loading ? (
        <p className="py-3 text-center font-body text-[11px] text-muted-foreground">
          {listOnly ? '尚未上載 PDF。從上方加入文件後，可在這裡下載原檔及查看解析狀態。' : '尚未上載 PDF。上載後會保存原檔並排隊解析。'}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {docs.map((doc) => {
            const job = latestJob(doc);
            const active = documentWorkInProgress(doc);
            const partLabel = (doc.part_count ?? 0) > 0 ? `分段 ${doc.parts_done ?? 0}/${doc.part_count}` : null;
            const status = DOC_STATUS[doc.status];
            const busy = busyId === doc.id;
            return (
              <li key={doc.id} className="flex flex-col gap-1.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-body text-xs font-medium" title={doc.title ?? undefined}>
                    {doc.title || doc.storage_path}
                  </span>
                  <Badge className={cn('border font-mono-data text-[10px]', status.className)}>{status.label}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-data text-[10px] text-muted-foreground">
                  <span>{formatTime(doc.created_at)}</span>
                  {!factoryId && !factoryName && doc.factory_name && <span>{doc.factory_name}</span>}
                  <span>{doc.doc_type === 'catalog' ? '目錄' : '報價單'}</span>
                  <span>{formatSize(doc.file_size)}</span>
                  <span>{doc.page_count != null ? `${doc.page_count} 頁` : '頁數未知'}</span>
                  {partLabel && <span>{partLabel}</span>}
                  <span>{doc.currency || '貨幣未標示'}</span>
                  {doc.source === 'ai_processor' && <span>來自 AI 處理</span>}
                  {job && (
                    <span>
                      {job.job_type === 'needs_split' ? '拆檔' : '任務'}：{JOB_STATUS[job.status]}
                      {job.job_type === 'needs_split' && active ? ' · 等待拆成較小的 PDF' : ''}
                      {job.job_type !== 'needs_split' && active && jobProgressText(job) ? ` · ${jobProgressText(job)}` : ''}
                      {job.attempts > 1 ? `（第 ${job.attempts}/${job.max_attempts} 次）` : ''}
                    </span>
                  )}
                  {job && jobResultText(job) && <span>{jobResultText(job)}</span>}
                </div>
                {active && (doc.part_count ?? 0) > 0 && (
                  <Progress value={Math.round(((doc.parts_done ?? 0) / (doc.part_count ?? 1)) * 100)} className="h-1" />
                )}
                {active && (doc.part_count ?? 0) === 0 && job && Number(job.progress) > 0 && (
                  <Progress value={Math.round(Number(job.progress) * 100)} className="h-1" />
                )}
                {(doc.error_message || (job?.status === 'queued' && job.error)) && (
                  <div className="flex items-start gap-1.5 font-body text-[11px] text-destructive">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span className="break-all">
                      {doc.error_message || `上次失敗，將自動重試：${job?.error}`}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[10px]" onClick={() => void handleDownload(doc)}>
                    <Download className="h-3 w-3" />下載原檔
                  </Button>
                  {active ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[10px]"
                      disabled={busy}
                      onClick={() => void runAction(
                        doc.id,
                        () => (doc.part_count ?? 0) > 0 || !job || job.job_type === 'needs_split'
                          ? cancelSupplierDocumentParts(doc.id)
                          : cancelProcessingJob(job.id).then(() => undefined),
                        '已取消任務',
                      )}
                    >
                      <Ban className="h-3 w-3" />取消
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[10px]"
                      disabled={busy}
                      onClick={() => void runAction(doc.id, () => enqueueSupplierDocumentParse(doc.id), '已排隊解析')}
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : job ? <RotateCcw className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      {job ? '重新解析' : '開始解析'}
                    </Button>
                  )}
                  {job && jobResultText(job) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[10px]"
                      onClick={() => void toggleSegments(doc.id)}
                    >
                      {openSegments?.docId === doc.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      查看分段
                    </Button>
                  )}
                </div>
                {openSegments?.docId === doc.id && (
                  <div className="rounded-md bg-muted/40 px-2 py-1.5">
                    {openSegments.rows === null ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    ) : (
                      <ul className="space-y-0.5">
                        {openSegments.rows.map((s) => (
                          <li key={s.id} className="flex gap-2 font-body text-[11px]">
                            <span className="w-14 flex-shrink-0 font-mono-data text-muted-foreground">
                              {s.start_page === s.end_page ? `p.${s.start_page}` : `p.${s.start_page}–${s.end_page}`}
                            </span>
                            <span className="w-10 flex-shrink-0 text-muted-foreground">{PAGE_TYPE_LABEL[s.kind]}</span>
                            <span className="truncate">{s.title || '—'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
