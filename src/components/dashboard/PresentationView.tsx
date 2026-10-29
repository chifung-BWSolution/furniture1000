import { generateQuoteReferenceImage } from '@/lib/quotePhotoLibrary';
import { gammaEmbedUrl } from '@/lib/gammaPreview';
import { PresentationImageField } from './PresentationImageField';
import { PresentationZoneManager } from './PresentationZoneManager';
import { floorPlanZoneColor } from './FloorPlanZoneCanvas';
import { cropPresentationFloorPlan, presentationZoneBounds, recognizePresentationFloorPlan } from '@/lib/presentationFloorPlan';
// ============================================================================
// FDS 2.1 — 客戶簡報（F-AI-009）
// Gamma AI POST /v1/generations（canvaNativeDesign.ts）。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight, Box, Building2, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FolderInput,
  ExternalLink, FileText, FolderKanban, Hash, Image, Languages, LayoutTemplate, Lightbulb, Link2,
  ListChecks, Loader2, MapPin, MoreHorizontal, Package, Palette, Plus, Presentation as PresentationIcon,
  RefreshCcw, Save, Settings2, Trash2, Unlink, ZoomIn, ZoomOut,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingImage } from '@/components/ui/loading-image';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { confirm } from '@/components/ui/confirm-dialog';
import { PresentationQuoteImportModal } from '@/components/dashboard/PresentationQuoteImportModal';
import {
  loadPresentationQuote,
  type PresentationQuoteOption,
} from '@/lib/presentationQuoteImport';
import { PresentationOutlineStep } from '@/components/dashboard/PresentationOutlineStep';
import { PresentationProductPicker } from '@/components/dashboard/PresentationProductPicker';
import { PresentationSearchCombobox } from '@/components/dashboard/PresentationSearchCombobox';
import type { SearchProduct } from '@/lib/productSearch';
import {
  canvaDisconnect, exchangeCanvaCode, fetchCanvaStatus,
  readCanvaOauthCallback, startCanvaConnect, clearCanvaOauthState, type CanvaStatus,
} from '@/lib/canvaPresentation';
import {
  clientContentDefault,
  clientPurposeDefault,
  loadPresentationClients,
  loadPresentationProjects,
  nextFieldValue,
  projectContentDefault,
  projectOptionHint,
  projectPurposeDefault,
  type PresentationClientOption,
  type PresentationProjectOption,
} from '@/lib/presentationClients';
import {
  createNativeCanvaDesign, fetchCanvaDesignPages, fetchCanvaGenerationStatus, defaultBrief, exportCanvaSessionPdf,
  exportCanvaSessionPptx, listCanvaDesignExports, listCanvaDesignSessions,
  listCanvaSessionVersions, probeCanvaNative, proPdfHandoffPath, saveCanvaDraft, removeGammaDesign,
  type CanvaDesignBrief, type CanvaDesignExportRow, type CanvaDesignSession,
  type CanvaSessionVersionRow,
} from '@/lib/canvaNativeDesign';
import { MultiSelect } from '@/components/ui/multi-select';
import { fetchCaseShowcase, photoUrls, type CasePhotoProject, type CaseBrand } from '@/lib/caseShowcase';
import { fetchZones } from '@/lib/solutionsApi';
import {
  EMPTY_COMPANY_PROFILE,
  loadPresentationCompanyProfile,
  savePresentationCompanyProfile,
  WEBSITE_COMPANY_PROFILE,
  type PresentationCompanyProfile,
} from '@/lib/presentationFiveSection';
import {
  draftFor,
  emptyProductDraft,
  imageLooksCutout,
  presentationGenerateBlock,
  presentationOutlineMarkdown,
  type PresentationProductDraft,
  type PresentationZoneDraft,
} from '@/lib/presentationOutlineModel';

const MAX_ITEMS = 30;
const PRESENTATION_PATH = '/fds/pm/presentation';
const TITLE_MAX = 100;
const PURPOSE_MAX = 200;
const CONTENT_MAX = 1000;
const SIDEBAR_PREVIEW = 3;
const AI_DOC_HREF = 'https://github.com/chifung-BWSolution/furniture1000/blob/develop/docs/prd/FDS-2.1-Gamma-AI生成.md';
const LANGUAGE_OPTIONS = ['繁體中文', '簡體中文', 'English', '中英對照'];
const STYLE_OPTIONS = ['專業、簡潔', '現代、簡約、專業', '簡約現代', '高端精品', '活潑清晰'];
const WIZARD_STEPS = [
  {
    title: '項目資料與分區',
    subtitle: '填寫項目並建立分區',
    hint: '填寫項目資料、客戶，並建立可自訂名稱的分區。',
  },
  {
    title: '選擇產品',
    subtitle: '把家具分到分區',
    hint: '從產品資料庫選擇家具，並指定所屬分區。',
  },
  {
    title: '即將生成的大綱',
    subtitle: '列出並修改每一段',
    hint: '以下是即將送給 Gamma 的大綱。每一段都可以改；改過只會在這份簡報。',
  },
  {
    title: '生成及匯出',
    subtitle: '用改過的大綱生成',
    hint: '用上一步的大綱在 Gamma 建立簡報。完成後可預覽、編輯與匯出。',
  },
] as const;

const GEN_PHASES = ['解析需求', '生成內容', '建立 Gamma 簡報', '完成並預覽'] as const;

type Status = 'idle' | 'creating' | 'exporting';

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('revoked_access_token') || raw.includes('Access token is revoked')) {
    return 'Gamma 授權已失效，請重新連接。';
  }
  return raw;
}

function optionsWithCurrent(options: string[], current?: string): string[] {
  const value = current?.trim();
  if (value && !options.includes(value)) return [value, ...options];
  return options;
}

function ConnectionHint({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150}>
      <HoverCardTrigger asChild onFocus={() => setOpen(true)} onClick={() => setOpen((value) => !value)}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-80 max-w-[calc(100vw-2rem)] text-xs leading-relaxed">
        {content}
      </HoverCardContent>
    </HoverCard>
  );
}

function CanvaMark({ className }: { className?: string }) {
  return <img src="/canva-logo.svg" alt="Gamma" className={className} />;
}

function sessionTitle(session: CanvaDesignSession): string {
  const title = (session.brief as CanvaDesignBrief | null)?.title?.trim();
  return title || '未命名';
}

/** Gamma thumbnail URLs expire about 15 minutes after they are issued. */
function sessionThumbnail(session: CanvaDesignSession): string | null {
  // An explicit null means the live metadata lookup failed. Never fall back
  // to an older signed URL embedded in the saved brief/report.
  if (session.thumbnail_url === null) return null;
  const extra = session as CanvaDesignSession & {
    thumbnail_url?: unknown;
    thumbnail?: unknown;
  };
  const brief = (session.brief ?? {}) as CanvaDesignBrief & {
    thumbnailUrl?: unknown;
    thumbnail_url?: unknown;
  };
  const report = session.populate_report ?? {};
  const candidates = [
    extra.thumbnail_url,
    extra.thumbnail,
    brief.thumbnailUrl,
    brief.thumbnail_url,
    report.thumbnail_url,
    report.thumbnail,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && /^https:\/\//i.test(value)) return value;
  }
  return null;
}

function isCanvaDesign(session: CanvaDesignSession): boolean {
  return Boolean(session.canva_design_id || session.edit_url);
}

function DesignThumbnail({ url }: { url: string | null }) {
  if (url) {
    return (
      <LoadingImage
        src={url}
        alt=""
        className="h-12 w-16 shrink-0 rounded-md"
        imgClassName="object-cover"
      />
    );
  }
  return (
    <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <PresentationIcon className="h-4 w-4" />
    </span>
  );
}

function designStatusLine(session: CanvaDesignSession): string {
  const pages = (session.brief as CanvaDesignBrief | null)?.pageCount;
  const exported = session.status === 'exported' || Boolean(session.export_download_url);
  const state = exported ? '已匯出 PPTX' : 'Gamma 編輯中';
  return typeof pages === 'number' && pages > 0 ? `${pages} 頁・${state}` : state;
}

function formatRecentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const zone = 'Asia/Hong_Kong';
  const time = new Intl.DateTimeFormat('zh-HK', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const yesterday = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - 86_400_000));
  if (dayKey === today) return `今天 ${time}`;
  if (dayKey === yesterday) return `昨天 ${time}`;
  const month = Number(dayKey.slice(5, 7));
  const day = Number(dayKey.slice(8, 10));
  return `${month}月${day}日 ${time}`;
}

function formatStamp(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}年${pick('month')}月${pick('day')}日 ${pick('hour')}:${pick('minute')}`;
}

function versionStatusLabel(status: string): { label: string; dot: string } {
  if (status === 'creating' || status === 'exporting') return { label: status === 'exporting' ? '匯出中' : '生成中', dot: 'bg-orange-400' };
  if (status === 'exported') return { label: '已匯出', dot: 'bg-sky-500' };
  if (status === 'ready') return { label: '已完成', dot: 'bg-emerald-500' };
  if (status === 'failed') return { label: '生成失敗', dot: 'bg-red-500' };
  return { label: '草稿', dot: 'bg-slate-300' };
}

function generationPhase(session: CanvaDesignSession | null, generating: boolean): number {
  if (session?.canva_design_id) return 4;
  const job = String(session?.populate_report?.generation_status ?? '');
  if (job === 'in_progress' || job === 'success') return 3;
  if (session?.populate_report?.generation_job_id || job === 'queued' || job === 'accepted') return 2;
  if (generating || session?.status === 'creating') return 1;
  return 0;
}

function ZoneEmptyArt() {
  return (
    <svg viewBox="0 0 140 88" className="h-16 w-28" aria-hidden>
      <rect x="28" y="14" width="78" height="54" rx="8" fill="#eef2ff" stroke="#c7d2fe" />
      <rect x="40" y="26" width="30" height="22" rx="3" fill="none" stroke="#818cf8" strokeDasharray="3 2" />
      <path d="M78 48h16M86 40v16" stroke="#a5b4fc" strokeWidth="1.5" />
      <path d="M96 58l10 12" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
      <path d="M108 68l6 2-4 5z" fill="#6366f1" />
    </svg>
  );
}

function StepIndicator({
  step,
  onSelect,
}: {
  step: number;
  onSelect: (next: number) => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <ol aria-label="簡報步驟" className="grid h-16 min-w-0 grid-cols-1 gap-1.5 rounded-2xl border border-border/80 bg-card p-1.5 shadow-sm sm:grid-cols-[repeat(4,minmax(0,1fr))]">
      {WIZARD_STEPS.map((item, index) => {
        const n = index + 1;
        const current = n === step;
        const done = n < step;
        const mark = done ? 'done' : current ? 'current' : 'waiting';
        return (
          <li key={item.title} className="min-w-0">
            <button
              type="button"
              aria-current={current ? 'step' : undefined}
              onClick={() => onSelect(n)}
              className={cn(
                'flex h-full w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors duration-300',
                current
                  ? 'border-indigo-500 bg-indigo-50 shadow-sm dark:bg-indigo-950/50'
                  : done
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
                    : 'border-transparent bg-muted/50',
              )}
            >
              <motion.span
                key={mark}
                initial={reduceMotion ? false : { scale: 0.55, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 28 }}
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  current
                    ? 'bg-indigo-600 text-white'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
              </motion.span>
              <span className="min-w-0">
                <span className={cn(
                  'block truncate text-[13px] font-semibold leading-tight',
                  current ? 'text-indigo-950 dark:text-indigo-50' : done ? 'text-emerald-950 dark:text-emerald-50' : 'text-muted-foreground',
                )}
                >
                  {item.title}
                </span>
                <span className="mt-0.5 hidden truncate text-[11px] leading-tight text-muted-foreground xl:block">
                  {item.subtitle}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs leading-relaxed text-indigo-950 dark:bg-indigo-950/40 dark:text-indigo-100">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
      <p><span className="font-semibold">小提醒：</span>{children}</p>
    </div>
  );
}

function SectionIntro({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="mb-4 flex gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-200">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function CanvaConnectionCard({
  compact,
  canva,
  connected,
  canImport,
  disabled,
  showGenerationWarning,
  generationProbe,
  onConnect,
  onRefresh,
  onDisconnect,
}: {
  compact: boolean;
  canva: CanvaStatus | null;
  connected: boolean;
  canImport: boolean;
  disabled: boolean;
  showGenerationWarning: boolean;
  generationProbe: { ok?: boolean; message?: string; missing_scopes?: string[] } | null;
  onConnect: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const reduce = useReducedMotion();
  const account = `${canva?.account_name || 'chifung.login'}（admin / 傢俬組）`;
  const statusKey = !canva ? 'loading' : showGenerationWarning ? 'warn' : connected ? 'on' : 'off';
  const settle = reduce ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' as const };

  return (
    <section
      id="canva-connection"
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm',
        compact ? 'h-16 px-3 py-0' : 'p-4',
      )}
    >
      <motion.span
        key={compact ? 'compact-ring' : 'full-ring'}
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        initial={reduce ? false : {
          boxShadow: connected
            ? 'inset 0 0 0 2px rgba(16,185,129,0.65)'
            : 'inset 0 0 0 2px rgba(99,102,241,0.4)',
        }}
        animate={{ boxShadow: 'inset 0 0 0 0px rgba(16,185,129,0)' }}
        transition={{ duration: 0.85, ease: 'easeOut' }}
      />
      <div className={cn('flex', compact ? 'h-full items-center gap-2' : 'flex-col items-center gap-3 text-center')}>
        <div
          className={cn(
            'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-md ring-4 dark:bg-indigo-950',
            compact ? 'h-8 w-8 ring-2 ring-emerald-100 dark:ring-emerald-500/20' : 'h-16 w-16 ring-indigo-50 dark:ring-indigo-500/20',
            connected && !compact ? 'ring-emerald-100' : '',
          )}
        >
          <CanvaMark className={compact ? 'h-auto w-6' : 'h-auto w-14'} />
        </div>
        <div className={cn('relative z-10 min-w-0', compact ? 'flex-1 text-left' : '')}>
          <div className={cn('flex items-center gap-1.5', compact ? 'flex-nowrap' : 'flex-wrap justify-center')}>
            <h3 className={cn('font-bold text-foreground', compact ? 'truncate text-xs' : 'text-base')}>Gamma 連接</h3>
            <AnimatePresence mode="wait">
              {connected && (
                <motion.span
                  key={statusKey}
                  initial={reduce ? false : { opacity: 0, scale: 0.82, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.9, y: -4 }}
                  transition={settle}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                    showGenerationWarning
                      ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200',
                  )}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {showGenerationWarning ? '需要設定' : '已連接'}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <p className={cn('truncate text-muted-foreground', compact ? 'text-[10px] leading-tight' : 'mt-1 text-sm')}>{account}</p>
          {!compact && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              AI 生成需要帳戶具備 Gamma AI 與 Magic Design 功能。
            </p>
          )}
        </div>
        {compact && connected && (
          <div className="flex shrink-0 items-center">
            <Button type="button" variant="ghost" className="h-8 w-8 px-0" aria-label="重新檢查" onClick={onRefresh}>
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" className="h-8 w-8 px-0" aria-label="解除連接" onClick={onDisconnect} disabled={disabled}>
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {!compact && (
        <div className="mt-4 space-y-2">
          {!canva && (
            <p className="text-center text-sm text-muted-foreground">
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
              偵測中…
            </p>
          )}
          {canva && (!canva.configured || !canImport) && (
            <ConnectionHint content={!canva.configured ? (
              <p>請設定 CANVA_CLIENT_ID／CANVA_CLIENT_SECRET，並在 Gamma 設定 redirect URI：{`${window.location.origin}${PRESENTATION_PATH}`}。 <a className="underline" href={AI_DOC_HREF} target="_blank" rel="noreferrer">查看設定文件</a></p>
            ) : '僅 admin／傢俬組可使用 Gamma 簡報功能。'}>
              <Button type="button" variant="outline" className="w-full">{!canva.configured ? '尚未配置' : '權限不足'}</Button>
            </ConnectionHint>
          )}
          {canva?.configured && canImport && !connected && (
            <Button type="button" className="w-full bg-indigo-600 text-white hover:bg-indigo-500" onClick={onConnect} disabled={disabled}>
              <Link2 className="h-4 w-4" /> 連接 Gamma
            </Button>
          )}
          {connected && (
            <div className="grid grid-cols-2 gap-2">
              <ConnectionHint content={showGenerationWarning ? (
                <p>{generationProbe?.message ?? '無法確認 Gamma AI 生成權限。'}{generationProbe?.missing_scopes?.length ? ` 缺少 scope：${generationProbe.missing_scopes.join(', ')}。` : ''} <a className="underline" href={AI_DOC_HREF} target="_blank" rel="noreferrer">查看文件</a></p>
              ) : generationProbe?.ok ? '已連接 Gamma，可以 AI 生成簡報。' : '已連接 Gamma，正在確認 AI 生成權限。'}>
                <Button type="button" variant="outline" className="h-9 w-full bg-background px-1 text-xs" onClick={onRefresh}>
                  <RefreshCcw className="h-3.5 w-3.5" />
                  重新檢查
                </Button>
              </ConnectionHint>
              <Button type="button" variant="outline" className="h-9 bg-background px-1 text-xs" onClick={onDisconnect} disabled={disabled}>
                <Unlink className="h-3.5 w-3.5" />
                解除連接
              </Button>
            </div>
          )}
        </div>
      )}
      {compact && canva?.configured && canImport && !connected && (
        <Button type="button" className="mt-3 w-full bg-indigo-600 text-white hover:bg-indigo-500" onClick={onConnect} disabled={disabled}>
          <Link2 className="h-4 w-4" /> 連接 Gamma
        </Button>
      )}
    </section>
  );
}

function Field({
  label,
  required,
  hint,
  counter,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  counter?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium text-foreground">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </Label>
        {counter ? <span className="text-xs tabular-nums text-muted-foreground">{counter}</span> : null}
      </div>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PresentationView() {
  const [pickerNonce, setPickerNonce] = useState(0);
  const [selected, setSelected] = useState<SearchProduct[]>([]);
  const [canva, setCanva] = useState<CanvaStatus | null>(null);
  const [canImport, setCanImport] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [canvaLink, setCanvaLink] = useState<{ edit_url: string; title?: string } | null>(null);
  const oauthHandledRef = useRef(false);
  const statusRequestRef = useRef(0);

  const [brief, setBrief] = useState<CanvaDesignBrief>(() => defaultBrief());
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const [companyProfile, setCompanyProfile] = useState<PresentationCompanyProfile>(EMPTY_COMPANY_PROFILE);
  const [companySaving, setCompanySaving] = useState(false);
  const [companyPage, setCompanyPage] = useState(false);
  const [companyDraft, setCompanyDraft] = useState<PresentationCompanyProfile>(EMPTY_COMPANY_PROFILE);
  const [floorZones, setFloorZones] = useState<{ code: string | null; name: string }[]>([]);
  const [floorPresent, setFloorPresent] = useState(false);
  const [caseBrands, setCaseBrands] = useState<CaseBrand[]>([]);
  const [casePhotoProjects, setCasePhotoProjects] = useState<CasePhotoProject[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchCaseShowcase<CasePhotoProject>('photos', controller.signal).then(result => setCasePhotoProjects(result.items)).catch(error => { if (!controller.signal.aborted) toast.error('完工照片案例載入失敗', { description: errorText(error) }); });
    return () => controller.abort();
  }, []);
  const availableCases = useMemo<CaseBrand[]>(() => [
    ...caseBrands,
    ...casePhotoProjects.filter(project => photoUrls(project.completion_photos).length > 0).map(project => ({
      id: `photo-project:${project.id}`,
      brand_name_cn: project.real_customer_display_name || project.project_name,
      brand_name_en: null,
      company_name: project.real_customer_display_name,
      display_name: [project.real_customer_display_name || project.project_name, project.project_code].filter(Boolean).join(' · '),
      branding_icon: null, view_system: null, project_count: 1,
      recent_projects: [{ id: project.id, project_code: project.project_code, project_name: project.project_name, signed_date: null }],
      project_type_ids: [], service_type_ids: [], industries: project.industries,
      filter_projects: [{ signed_date: null, estimated_income: null, furniture_types: project.furniture_types ?? [] }],
    })),
  ], [caseBrands, casePhotoProjects]);
  const [caseNote, setCaseNote] = useState('');
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 340, damping: 32 };
  const fiveRef = useRef({
    company: EMPTY_COMPANY_PROFILE,
    floorZones: [] as { code: string | null; name: string }[],
    floorPresent: false,
    cases: [] as CaseBrand[],
    photoProjects: [] as CasePhotoProject[],
    caseIds: [] as string[],
    products: [] as SearchProduct[],
  });
  fiveRef.current = {
    company: companyProfile,
    floorZones,
    floorPresent,
    cases: availableCases,
    photoProjects: casePhotoProjects,
    caseIds: selectedCaseIds,
    products: selected,
  };
  const autoPurpose = useRef<string | null>(null);
  const autoContent = useRef<string | null>(null);
  const [clients, setClients] = useState<PresentationClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState('');
  const [projects, setProjects] = useState<PresentationProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [wizardStep, setWizardStep] = useState(1);
  const [zones, setZones] = useState<PresentationZoneDraft[]>([]);
  const [includeFloor, setIncludeFloor] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [zoneManagerOpen, setZoneManagerOpen] = useState(false);
  const [quoteImportOpen, setQuoteImportOpen] = useState(false);
  const [recognizingFloor, setRecognizingFloor] = useState(false);
  const floorRecognitionRequest = useRef(0);
  useEffect(() => () => { floorRecognitionRequest.current += 1; }, []);
  const recognizeFloor = async (blob: Blob) => {
    const request = ++floorRecognitionRequest.current;
    zonesSeeded.current = true;
    setRecognizingFloor(true);
    try {
      const result = await recognizePresentationFloorPlan(blob);
      if (request !== floorRecognitionRequest.current) return;
      setZones((current) => {
        const next = [...current];
        for (const detected of result.zones) {
          const index = next.findIndex((zone) => zone.name.trim().toLowerCase() === detected.name.toLowerCase());
          if (index >= 0) {
            next[index] = { ...next[index], rect: detected.rect, rects: detected.rect ? [detected.rect] : [], ...(detected.imageUrl ? { imageUrl: detected.imageUrl } : {}) };
          } else {
            next.push({ id: crypto.randomUUID(), ...detected });
          }
        }
        return next;
      });
      setZoneManagerOpen(true);
      if (!result.zones.length) toast.message('未找到已標示名稱的分區，請在分區管理中框選或新增');
      else {
        const missing = result.zones.filter((zone) => !zone.imageUrl).length;
        toast.success(`已識別 ${result.zones.length} 個分區`, {
          description: missing ? `${missing} 個分區未能產生截圖，請手動補圖${result.failedCrops ? '或重新識別' : ''}。` : '已加入對應的分區截圖，請檢查名稱與範圍。',
        });
      }
    } catch (error) {
      if (request === floorRecognitionRequest.current) toast.error('分區識別失敗，平面圖已保留', { description: errorText(error) });
    } finally {
      if (request === floorRecognitionRequest.current) setRecognizingFloor(false);
    }
  };
  const trackUpload = useCallback((delta: number) => setPendingUploads((count) => Math.max(0, count + delta)), []);
  const [productZone, setProductZone] = useState<Record<string, string>>({});
  const [productDrafts, setProductDrafts] = useState<Record<string, PresentationProductDraft>>({});
  const [companyIntro, setCompanyIntro] = useState('');
  const [qualifications, setQualifications] = useState('');
  const [servicesText, setServicesText] = useState('');
  const [caseDrafts, setCaseDrafts] = useState<Record<string, { title: string; body: string }>>({});
  const zonesSeeded = useRef(false);
  const outlineStateRef = useRef({
    zones,
    includeFloor,
    productZone,
    productDrafts,
    companyIntro,
    qualifications,
    servicesText,
    caseDrafts,
  });
  outlineStateRef.current = {
    zones,
    includeFloor,
    productZone,
    productDrafts,
    companyIntro,
    qualifications,
    servicesText,
    caseDrafts,
  };
  const [outline, setOutline] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CanvaDesignSession[]>([]);
  const [designSearch, setDesignSearch] = useState('');
  const [activeSession, setActiveSession] = useState<CanvaDesignSession | null>(null);
  const [versionNote, setVersionNote] = useState('');
  const [versionRows, setVersionRows] = useState<CanvaSessionVersionRow[]>([]);
  const [exportRows, setExportRows] = useState<CanvaDesignExportRow[]>([]);
  const [generationProbe, setGenerationProbe] = useState<Awaited<ReturnType<typeof probeCanvaNative>> | null>(null);
  const [generationPending, setGenerationPending] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [statusReadError, setStatusReadError] = useState('');
  const [listDrawer, setListDrawer] = useState<null | 'drafts' | 'designs'>(null);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewPage, setPreviewPage] = useState(0);
  const [pageThumbs, setPageThumbs] = useState<(string | null)[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesNote, setPagesNote] = useState('');
  const sessionLimitRef = useRef(12);

  useEffect(() => {
    let cancelled = false;
    setClientsLoading(true);
    setClientsError('');
    setClients([]);
    const timer = window.setTimeout(() => {
      void loadPresentationClients(brief.client ?? '')
        .then((rows) => {
          if (!cancelled) setClients(rows);
        })
        .catch((err: unknown) => {
          if (!cancelled) setClientsError(err instanceof Error ? err.message : '載入 PMS 客戶失敗');
        })
        .finally(() => {
          if (!cancelled) setClientsLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [brief.client]);

  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    setProjectsError('');
    setProjects([]);
    const timer = window.setTimeout(() => {
      void loadPresentationProjects({ search: brief.project ?? '', customerId: brief.pmsClientId })
        .then((rows) => { if (!cancelled) setProjects(rows); })
        .catch((err: unknown) => {
          if (!cancelled) setProjectsError(err instanceof Error ? err.message : '載入 PMS 專案失敗');
        })
        .finally(() => { if (!cancelled) setProjectsLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [brief.project, brief.pmsClientId]);

  const refreshStatus = useCallback(async () => {
    const requestId = ++statusRequestRef.current;
    const [statusValue, role] = await Promise.all([
      fetchCanvaStatus(),
      supabase.rpc('bwf_has_role', { p_roles: ['admin', 'uploader'] }),
    ]);
    if (requestId !== statusRequestRef.current) return;
    setCanva(statusValue);
    const allowed = Boolean(role.data);
    setCanImport(allowed);
    if (allowed) {
      const probe = await probeCanvaNative().catch(() => null);
      setGenerationProbe(probe);
    } else {
      setGenerationProbe(null);
    }
  }, []);

  const refreshSessions = useCallback(async (limit?: number) => {
    const next = limit ?? sessionLimitRef.current;
    sessionLimitRef.current = next;
    try {
      const rows = await listCanvaDesignSessions(next);
      setSessions(rows);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSessions();
    }, 10 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSessions();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshSessions]);

  const generating = generationPending || activeSession?.status === 'creating';
  useEffect(() => {
    if (!sessionId || !generating) return;
    let cancelled = false;
    let timer: number;
    const check = async () => {
      try {
        const current = await fetchCanvaGenerationStatus(sessionId);
        if (cancelled) return;
        setActiveSession(current);
        setStatusReadError(current.status === 'creating' && Date.now() - Date.parse(current.updated_at) > 150_000
          ? '暫時未收到任務更新；請稍後重新查詢狀態，毋須再次生成。' : '');
        if (current.canva_design_id && current.edit_url) {
          setCanvaLink({ edit_url: current.edit_url, title: current.brief.title });
          setGenerationError('');
        }
        if ((!generationPending && current.status === 'failed') || current.canva_design_id) {
          setGenerationPending(false);
          setStatus('idle');
          void refreshSessions();
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setStatusReadError(`無法更新任務狀態：${errorText(err)}。正在重新查詢，毋須再次生成。`);
      }
      if (!cancelled) timer = window.setTimeout(check, 3000);
    };
    void check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sessionId, generating, generationPending, refreshSessions]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('code')) return;
    if (oauthHandledRef.current) return;
    oauthHandledRef.current = true;
    const cb = readCanvaOauthCallback();
    const code = url.searchParams.get('code')!;
    const clean = () => {
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      url.searchParams.delete('scope');
      url.searchParams.delete('error');
      window.history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : ''));
    };
    if (!cb.valid || !cb.verifier) {
      toast.error('Gamma 授權失敗', { description: 'state 驗證不符或授權被取消' });
      clearCanvaOauthState();
      clean();
      return;
    }
    (async () => {
      try {
        const redirectUri = `${window.location.origin}${PRESENTATION_PATH}`;
        const connected = await exchangeCanvaCode(code, cb.verifier, redirectUri);
        statusRequestRef.current += 1;
        setCanva((current) => ({ ...current, ...connected, configured: current?.configured ?? true }));
        toast.success('Gamma 已連接', { description: connected.account_name ? `帳戶：${connected.account_name}` : 'chifung.login' });
      } catch (err) {
        toast.error('Gamma 授權失敗', { description: errorText(err) });
      } finally {
        clearCanvaOauthState();
        clean();
        refreshStatus();
      }
    })();
  }, [refreshStatus]);

  useEffect(() => {
    refreshStatus();
    refreshSessions();
  }, [refreshStatus, refreshSessions]);

  useEffect(() => {
    let cancelled = false;
    void loadPresentationCompanyProfile()
      .then((profile) => {
        if (!cancelled) {
          setCompanyProfile(profile);
          setCompanyIntro((current) => current || profile.background);
          setQualifications((current) => current || profile.qualifications);
          setServicesText((current) => current || profile.services);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error('公司介紹未能載入', { description: errorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchCaseShowcase<CaseBrand>('brands')
      .then((result) => {
        if (!cancelled) {
          setCaseBrands(result.items);
          setCaseNote('');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setCaseNote(err instanceof Error ? err.message : '案例未能載入');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const projectId = brief.projectId;
    if (!projectId) {
      setFloorZones([]);
      setFloorPresent(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [zones, plan] = await Promise.all([
        fetchZones(projectId),
        supabase.from('design_projects').select('floor_plan_url').eq('id', projectId).maybeSingle(),
      ]);
      if (cancelled) return;
      const nextZones = zones.map((zone) => ({ code: zone.code, name: zone.name }));
      const url = typeof plan.data?.floor_plan_url === 'string' ? plan.data.floor_plan_url.trim() : '';
      setFloorZones(nextZones);
      setFloorPresent(Boolean(url) || nextZones.length > 0);
      if (!zonesSeeded.current && nextZones.length > 0) {
        zonesSeeded.current = true;
        setZones(nextZones.map((zone) => ({ id: crypto.randomUUID(), name: zone.name || zone.code || '分區' })));
        setIncludeFloor(Boolean(url));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brief.projectId]);

  const disabled = status !== 'idle' || generating || pendingUploads > 0 || recognizingFloor;
  const connected = canva?.connected ?? false;
  const canvaPathReady = Boolean(canva?.configured && canImport && connected);

  const nativeTitleOk = Boolean(brief.title.trim() || brief.client?.trim() || brief.project?.trim());

  const outlineInput = useCallback(() => {
    const briefNow = briefRef.current;
    const current = fiveRef.current;
    const state = outlineStateRef.current;
    const chosen = new Set(current.caseIds);
    return {
      title: briefNow.title.trim() || briefNow.project?.trim() || '',
      client: briefNow.client?.trim() || '',
      includeFloor: state.includeFloor,
      floorImageUrl: briefNow.floorImageUrl,
      floorEffectImageUrl: briefNow.floorEffectImageUrl,
      zones: state.zones,
      products: current.products,
      productZone: state.productZone,
      drafts: state.productDrafts,
      company: current.company,
      companyIntro: state.companyIntro,
      qualifications: state.qualifications,
      services: state.servicesText,
      cases: current.cases.filter((item) => chosen.has(item.id)).map((item) => ({
        id: item.id,
        photos: [...new Set(current.photoProjects.filter(project => item.recent_projects.some(recent => recent.id === project.id)).flatMap(project => photoUrls(project.completion_photos)))].slice(0, 6),
        title: state.caseDrafts[item.id]?.title ?? (item.brand_name_cn || item.brand_name_en || item.company_name || '未命名案例'),
        body: state.caseDrafts[item.id]?.body ?? [
          item.industries?.[0] ? `行業：${item.industries[0]}` : '',
          ...[...new Set((item.filter_projects ?? []).flatMap((project) => project.furniture_types ?? []))].slice(0, 16).map((line) => `- ${line}`),
        ].filter(Boolean).join('\n'),
      })),
    };
  }, []);

  const syncOutline = useCallback(() => {
    const next = presentationOutlineMarkdown(outlineInput());
    setOutline(next);
    setBrief((b) => ({ ...b, outline: next, outlineOnly: true }));
    return next;
  }, [outlineInput]);

  const generateBlock = presentationGenerateBlock(outlineInput());
  const canCreateNative = nativeTitleOk && !generateBlock && canvaPathReady;

  const ensureDrafts = useCallback(() => {
    setProductDrafts((current) => {
      const next = { ...current };
      for (const product of fiveRef.current.products) {
        if (!next[product.id]) next[product.id] = emptyProductDraft(product);
      }
      return next;
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (!canImport || pendingUploads > 0) return;
    setStatus('creating');
    try {
      const markdown = presentationOutlineMarkdown(outlineInput());
      const payload: CanvaDesignBrief = {
        ...brief,
        outline: markdown,
        outlineOnly: true,
        presentationDraft: { zones, products: selected.map(({ id, title, model, sku, image_url, image_urls, dimension_l_mm, dimension_w_mm, dimension_h_mm, material, color, created_at, on_shopify, in_catalog, exact }) => ({ id, title, model, sku, image_url, image_urls, dimension_l_mm, dimension_w_mm, dimension_h_mm, material, color, created_at, on_shopify, in_catalog, exact })), productZone, productDrafts, includeFloor, companyIntro, qualifications, services: servicesText, caseIds: selectedCaseIds, caseDrafts },
        confirmedAt: new Date().toISOString(),
      };
      const { session_id } = await saveCanvaDraft(
        payload,
        selected.map((p) => p.id),
        sessionId ?? undefined,
      );
      setSessionId(session_id);
      toast.success('草稿已儲存');
      await refreshSessions();
    } catch (err) {
      toast.error('儲存失敗', { description: errorText(err) });
    } finally {
      setStatus('idle');
    }
  }, [brief, selected, sessionId, canImport, refreshSessions, outlineInput, zones, productZone, productDrafts, includeFloor, companyIntro, qualifications, servicesText, selectedCaseIds, caseDrafts, pendingUploads]);

  const createNative = useCallback(async () => {
    if (!canCreateNative || disabled) return;
    if (activeSession?.canva_design_id) return;
    const block = presentationGenerateBlock(outlineInput());
    if (block) {
      toast.error(block);
      return;
    }
    setStatus('creating');
    setGenerationPending(true);
    setGenerationError('');
    setStatusReadError('');
    setCanvaLink(null);
    setActiveSession(null);
    let taskSessionId: string | null = null;
    try {
      const markdown = syncOutline();
      const payload: CanvaDesignBrief = {
        ...brief,
        title: brief.title.trim() || `${brief.client ?? ''} ${brief.project ?? ''}`.trim() || '客戶簡報',
        outline: markdown,
        outlineOnly: true,
        presentationDraft: { zones, products: selected.map(({ id, title, model, sku, image_url, image_urls, dimension_l_mm, dimension_w_mm, dimension_h_mm, material, color, created_at, on_shopify, in_catalog, exact }) => ({ id, title, model, sku, image_url, image_urls, dimension_l_mm, dimension_w_mm, dimension_h_mm, material, color, created_at, on_shopify, in_catalog, exact })), productZone, productDrafts, includeFloor, companyIntro, qualifications, services: servicesText, caseIds: selectedCaseIds, caseDrafts },
        confirmedAt: new Date().toISOString(),
      };
      const { session_id } = await saveCanvaDraft(
        payload,
        selected.map((p) => p.id),
        sessionId ?? undefined,
      );
      setSessionId(session_id);
      taskSessionId = session_id;
      const session = await createNativeCanvaDesign(session_id);
      setActiveSession(session);
      if (session.edit_url) {
        setCanvaLink({ edit_url: session.edit_url, title: payload.title });
        toast.success('AI 已生成簡報', {
          description: 'AI 已生成，請在 Gamma 微調後匯出。',
        });
      }
      await refreshSessions();
      await refreshStatus();
    } catch (err) {
      // A browser timeout is not evidence that Gamma failed. Reconcile with the task.
      const current = taskSessionId ? await fetchCanvaGenerationStatus(taskSessionId).catch(() => null) : null;
      if (current) setActiveSession(current);
      if (current?.canva_design_id && current.edit_url) {
        setCanvaLink({ edit_url: current.edit_url, title: current.brief.title });
        setGenerationError('');
        return;
      }
      if (current?.status === 'creating') {
        setStatusReadError('生成請求連線已中斷，正在查詢 Gamma 任務狀態，毋須再次生成。');
        return;
      }
      const msg = current?.error || errorText(err);
      setGenerationError(msg);
      if (msg.includes('design_already_exists') || msg.includes('design_exists') || msg.includes('已有 Gamma 設計')) {
        toast.message('此草稿已有 Gamma 設計', { description: '請用「新版本」另建設計，勿覆蓋 Gamma 內修改。' });
      } else {
        toast.error('AI 生成失敗', { description: msg });
      }
    } finally {
      setGenerationPending(false);
      setStatus('idle');
    }
  }, [canCreateNative, disabled, activeSession, brief, selected, sessionId, refreshSessions, refreshStatus, outlineInput, syncOutline, zones, productZone, productDrafts, includeFloor, companyIntro, qualifications, servicesText, selectedCaseIds, caseDrafts, pendingUploads]);

  const refreshSessionDetail = useCallback(async (sid: string) => {
    try {
      const [vers, exps] = await Promise.all([
        listCanvaSessionVersions(sid),
        listCanvaDesignExports(sid),
      ]);
      setVersionRows(vers);
      setExportRows(exps);
    } catch {
      setVersionRows([]);
      setExportRows([]);
    }
  }, []);

  const exportPptx = useCallback(async (sid: string) => {
    setStatus('exporting');
    try {
      const res = await exportCanvaSessionPptx(sid);
      if (res.export_download_url) {
        window.open(res.export_download_url, '_blank', 'noopener,noreferrer');
        toast.success('PPTX 匯出完成', { description: '請在 PowerPoint 驗證 Gamma 最後修改是否可編輯。' });
      }
      await refreshSessions();
      await refreshSessionDetail(sid);
    } catch (err) {
      toast.error('匯出 PPTX 失敗', { description: errorText(err) });
    } finally {
      setStatus('idle');
    }
  }, [refreshSessions, refreshSessionDetail]);

  const exportPdf = useCallback(async (sid: string) => {
    setStatus('exporting');
    try {
      const res = await exportCanvaSessionPdf(sid);
      if (res.export_download_url) {
        window.open(res.export_download_url, '_blank', 'noopener,noreferrer');
        toast.success('PDF 匯出完成', { description: '附加格式；客戶簡報驗收仍以 PPTX 為準。' });
      }
      await refreshSessionDetail(sid);
    } catch (err) {
      toast.error('匯出 PDF 失敗', { description: errorText(err) });
    } finally {
      setStatus('idle');
    }
  }, [refreshSessionDetail]);

  const restorePresentationDraft = (brief: CanvaDesignBrief) => {
    const draft = brief.presentationDraft;
    setZones(draft?.zones ?? []);
    setSelected(draft?.products ?? []);
    setProductZone(draft?.productZone ?? {});
    setProductDrafts(draft?.productDrafts ?? {});
    setIncludeFloor(draft?.includeFloor ?? false);
    setCompanyIntro(draft?.companyIntro ?? '');
    setQualifications(draft?.qualifications ?? '');
    setServicesText(draft?.services ?? '');
    setSelectedCaseIds(draft?.caseIds ?? []);
    setCaseDrafts(draft?.caseDrafts ?? {});
    zonesSeeded.current = Boolean(draft);
  };

  const loadSession = (s: CanvaDesignSession) => {
    if (disabled) return;
    setGenerationError('');
    setStatusReadError('');
    setCanvaLink(null);
    autoPurpose.current = null;
    autoContent.current = null;
    setSessionId(s.id);
    setBrief({ ...defaultBrief(), ...(s.brief as CanvaDesignBrief) });
    restorePresentationDraft(s.brief as CanvaDesignBrief);
    setOutline(String((s.brief as CanvaDesignBrief).outline ?? ''));
    setVersionNote(s.version_note ?? '');
    setActiveSession(s);
    setWizardStep(isCanvaDesign(s) || s.status === 'creating' || s.status === 'failed' ? 4 : 1);
    if (s.edit_url) setCanvaLink({ edit_url: s.edit_url, title: (s.brief as CanvaDesignBrief).title });
    refreshSessionDetail(s.id);
  };

  const newVersion = async (parent: CanvaDesignSession) => {
    if (disabled) return;
    setGenerationError('');
    setStatusReadError('');
    setCanvaLink(null);
    autoPurpose.current = null;
    autoContent.current = null;
    setSessionId(null);
    setBrief({ ...(parent.brief as CanvaDesignBrief), confirmedAt: undefined });
    restorePresentationDraft(parent.brief as CanvaDesignBrief);
    setOutline(String((parent.brief as CanvaDesignBrief).outline ?? ''));
    setActiveSession(null);
    try {
      const { session_id } = await saveCanvaDraft(
        parent.brief as CanvaDesignBrief,
        parent.product_ids ?? [],
        undefined,
        parent.id,
        versionNote.trim() || `自 v${parent.content_version ?? 1} 複製`,
      );
      setSessionId(session_id);
      setWizardStep(4);
      toast.message('已建立新版本草稿', { description: '確認後可再次建立 Gamma 設計，不覆蓋舊設計。' });
      await refreshSessions();
      await refreshSessionDetail(session_id);
    } catch (err) {
      toast.error('無法建立新版本', { description: errorText(err) });
    }
  };

  const connect = async () => {
    try {
      const redirectUri = `${window.location.origin}${PRESENTATION_PATH}`;
      const authorizeUrl = await startCanvaConnect(redirectUri);
      window.location.href = authorizeUrl;
    } catch (err) {
      toast.error('無法啟動 Gamma 授權', { description: errorText(err) });
    }
  };

  const disconnect = async () => {
    try {
      await canvaDisconnect();
      await refreshStatus();
      toast.message('已解除 Gamma 連接');
    } catch (err) {
      toast.error('解除失敗', { description: errorText(err) });
    }
  };

  const clearForm = () => {
    if (disabled) return;
    setGenerationError('');
    setStatusReadError('');
    autoPurpose.current = null;
    autoContent.current = null;
    setBrief(defaultBrief());
    setOutline('');
    setZones([]);
    setIncludeFloor(false);
    setProductZone({});
    setProductDrafts({});
    setCompanyIntro('');
    setQualifications('');
    setServicesText('');
    setCaseDrafts({});
    zonesSeeded.current = false;
    setSelected([]);
    setPickerNonce((nonce) => nonce + 1);
    setSessionId(null);
    setActiveSession(null);
    setCanvaLink(null);
    setVersionNote('');
    setVersionRows([]);
    setExportRows([]);
    setWizardStep(1);
  };

  const applyAuto = (purposeSuggestion: string, contentSuggestion: string) => {
    const current = briefRef.current;
    const purposeNext = nextFieldValue(current.purpose, purposeSuggestion, autoPurpose.current, PURPOSE_MAX);
    const contentNext = nextFieldValue(current.content, contentSuggestion, autoContent.current, CONTENT_MAX);
    autoPurpose.current = purposeNext.auto;
    autoContent.current = contentNext.auto;
    return { purpose: purposeNext.value, content: contentNext.value };
  };

  const selectClient = (client: PresentationClientOption) => {
    const filled = applyAuto(clientPurposeDefault(client), clientContentDefault(client));
    const sameClient = briefRef.current.pmsClientId === client.id;
    setBrief({
      ...briefRef.current,
      client: client.name,
      clientId: undefined,
      pmsClientId: client.id,
      project: sameClient ? briefRef.current.project : '',
      projectId: undefined,
      pmsProjectId: sameClient ? briefRef.current.pmsProjectId : undefined,
      purpose: filled.purpose,
      content: filled.content,
    });
  };

  const applyQuoteImport = async (quote: PresentationQuoteOption): Promise<boolean> => {
    const current = briefRef.current;
    const hasExisting = zones.length > 0 || selected.length > 0 || Boolean(current.floorImageUrl);
    if (hasExisting) {
      const accepted = await confirm({
        title: '以這張報價單更新簡報？',
        description: '報價單裡的平面圖、分區和產品會取代目前已填的對應內容。標題、目的和原文若已填寫會保留。',
        confirmLabel: '導入',
      });
      if (!accepted) return false;
    }
    const imported = await loadPresentationQuote(quote.id, MAX_ITEMS);
    const latest = briefRef.current;
    if (imported.zones.length) zonesSeeded.current = true;
    const clientChanged = Boolean(imported.client) && imported.client !== (latest.client ?? '');
    const projectChanged = Boolean(imported.project) && imported.project !== (latest.project ?? '');
    setBrief({
      ...latest,
      client: imported.client || latest.client,
      clientId: clientChanged ? undefined : latest.clientId,
      pmsClientId: imported.pmsClientId || (clientChanged ? undefined : latest.pmsClientId),
      project: imported.project || latest.project,
      projectId: imported.projectId || (projectChanged ? undefined : latest.projectId),
      pmsProjectId: imported.pmsProjectId || (projectChanged ? undefined : latest.pmsProjectId),
      title: latest.title.trim() ? latest.title : imported.title,
      purpose: latest.purpose?.trim() ? latest.purpose : imported.purpose,
      content: latest.content?.trim() ? latest.content : imported.content,
      coverImageUrl: latest.coverImageUrl || imported.coverImageUrl || undefined,
      floorImageUrl: imported.floorImageUrl || latest.floorImageUrl,
      floorEffectImageUrl: imported.floorImageUrl && imported.floorImageUrl !== latest.floorImageUrl ? undefined : latest.floorEffectImageUrl,
    });
    if (imported.floorImageUrl) setIncludeFloor(true);
    if (imported.zones.length) {
      setZones(imported.zones);
      if (!imported.products.length && selected.length) {
        const first = imported.zones[0]?.id;
        if (first) setProductZone(Object.fromEntries(selected.map((product) => [product.id, first])));
      }
    }
    if (imported.products.length) {
      setSelected(imported.products);
      setProductDrafts(imported.productDrafts);
      setProductZone(imported.productZone);
      setPickerNonce((nonce) => nonce + 1);
    }
    const brought = [
      imported.floorImageUrl ? '平面圖' : '',
      imported.zones.length ? `${imported.zones.length} 個分區` : '',
      imported.products.length ? `${imported.products.length} 件產品` : '',
    ].filter(Boolean);
    const skipped = imported.skippedProducts ? `另有 ${imported.skippedProducts} 件超出上限，未帶入。` : '';
    if (brought.length) {
      toast.success(`已從 ${imported.quoteId || '報價單'} ${imported.versionLabel} 導入`, {
        description: [brought.join('、'), skipped].filter(Boolean).join(' '),
      });
    } else {
      toast.message(`已帶入 ${imported.quoteId || '報價單'} 的客戶與專案資料`, {
        description: '這張報價單沒有可導入的平面圖、分區或產品。',
      });
    }
    if (imported.floorImageUrl && !imported.floorIsImage) {
      toast.message('平面圖是 PDF，已帶入檔案。若要自動框選分區，請先在報價單產生預覽圖。');
    } else if (imported.floorIsImage && imported.floorImageUrl) {
      const needsDetection = imported.zones.length === 0 || imported.zones.some((zone) => !zone.rect);
      const needsCrop = imported.zones.some((zone) => zone.rect && !zone.imageUrl);
      if (needsDetection) {
        try {
          const response = await fetch(imported.floorImageUrl);
          if (!response.ok) throw new Error('無法讀取平面圖');
          await recognizeFloor(await response.blob());
        } catch (error) {
          toast.error('平面圖已帶入，分區識別未完成', { description: errorText(error) });
        }
      } else if (needsCrop) {
        const request = ++floorRecognitionRequest.current;
        setRecognizingFloor(true);
        try {
          const response = await fetch(imported.floorImageUrl);
          if (!response.ok) throw new Error('無法讀取平面圖');
          const cropped = await cropPresentationFloorPlan(
            await response.blob(),
            imported.zones.map((zone) => ({ name: zone.name, rect: zone.rect ?? null })),
          );
          if (request !== floorRecognitionRequest.current) return true;
          setZones((list) => list.map((zone, index) => {
            const imageUrl = cropped.zones[index]?.imageUrl;
            return imageUrl && !zone.imageUrl ? { ...zone, imageUrl } : zone;
          }));
          if (cropped.failedCrops) toast.message('部分分區未能產生截圖，可在分區管理補圖');
        } catch (error) {
          if (request === floorRecognitionRequest.current) {
            toast.error('分區截圖失敗', { description: errorText(error) });
          }
        } finally {
          if (request === floorRecognitionRequest.current) setRecognizingFloor(false);
        }
      }
    }
    return true;
  };

  const selectProject = (project: PresentationProjectOption) => {
    const current = briefRef.current;
    const owner = project.client ?? null;
    const filled = applyAuto(
      projectPurposeDefault(project),
      owner
        ? projectContentDefault(owner, project)
        : (project.note ? `客戶備註：${project.note}` : ''),
    );
    setBrief({
      ...current,
      client: owner ? owner.name : current.client,
      clientId: undefined,
      pmsClientId: owner ? owner.id : current.pmsClientId,
      project: project.name,
      projectId: undefined,
      pmsProjectId: project.id,
      purpose: filled.purpose,
      content: filled.content,
    });
  };

  const goToStep = useCallback((next: number) => {
    if (pendingUploads > 0) return;
    const target = Math.min(WIZARD_STEPS.length, Math.max(1, next));
    if (target >= 3) {
      ensureDrafts();
      syncOutline();
      void (async () => {
        for (const product of fiveRef.current.products) {
          const draft = outlineStateRef.current.productDrafts[product.id] ?? emptyProductDraft(product);
          if (draft.noBackground || draft.sampleImageUrl || !draft.imageUrl) continue;
          const cutout = await imageLooksCutout(draft.imageUrl).catch(() => true);
          if (cutout) {
            setProductDrafts((current) => {
              const latest = current[product.id] ?? draft;
              if (latest.imageUrl !== draft.imageUrl || latest.sampleImageUrl) return current;
              return { ...current, [product.id]: { ...latest, noBackground: true } };
            });
          }
        }
      })();
    }
    setWizardStep(target);
  }, [ensureDrafts, syncOutline, pendingUploads]);

  const openDesignRow = (session: CanvaDesignSession) => {
    if (session.edit_url) {
      window.open(session.edit_url, '_blank', 'noopener,noreferrer');
    } else {
      toast.error('尚未有 Gamma 編輯連結');
    }
  };

  const removeDesignRow = async (session: CanvaDesignSession) => {
    const accepted = await confirm({
      title: '從 FDS 移除此設計？',
      description: '此操作會刪除 FDS 的簡報記錄及相關匯出記錄。Gamma 工作區中的原文件不會被刪除。',
      confirmLabel: '移除',
      destructive: true,
    });
    if (!accepted) return;
    try {
      await removeGammaDesign(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      toast.success('已從 FDS 移除');
    } catch (err) {
      toast.error('未能移除設計', { description: errorText(err) });
    }
  };

  const titleCount = brief.title.length;
  const purposeCount = (brief.purpose ?? '').length;
  const contentCount = (brief.content ?? '').length;
  const draftSessions = useMemo(() => sessions.filter((s) => !isCanvaDesign(s)), [sessions]);
  const designSessions = useMemo(() => sessions.filter(isCanvaDesign), [sessions]);
  const visibleDrafts = draftSessions.slice(0, SIDEBAR_PREVIEW);
  const visibleDesigns = designSessions.slice(0, SIDEBAR_PREVIEW);
  const phase = generationPhase(activeSession, generating);
  const gammaPreview = activeSession?.populate_report?.provider === 'gamma'
    ? gammaEmbedUrl(activeSession.view_url || activeSession.edit_url)
    : null;
  const previewPages = pageThumbs.length > 0 ? pageThumbs.length : 1;
  const previewIndex = Math.min(previewPage, previewPages - 1);
  const previewSrc = pageThumbs[previewIndex] || (previewIndex === 0 ? (activeSession ? sessionThumbnail(activeSession) : null) : null);
  useEffect(() => {
    setPreviewPage(0);
  }, [activeSession?.id]);
  useEffect(() => {
    const sessionId = activeSession?.id;
    const designId = activeSession?.canva_design_id;
    if (!sessionId || !designId || activeSession.status === 'creating') {
      setPageThumbs([]);
      setPagesNote('');
      setPagesLoading(false);
      return;
    }
    let cancelled = false;
    setPagesLoading(true);
    setPagesNote('');
    fetchCanvaDesignPages(sessionId)
      .then((pages) => {
        if (cancelled) return;
        const last = pages.reduce((max, page) => Math.max(max, page.page), 0);
        const thumbs: (string | null)[] = Array.from({ length: last }, () => null);
        for (const page of pages) {
          if (page.page >= 1 && page.page <= thumbs.length) thumbs[page.page - 1] = page.thumbnail_url;
        }
        setPageThumbs(thumbs);
        if (thumbs.length <= 1 && !thumbs[0]) setPagesNote('尚未取得各頁預覽，暫時只顯示封面。');
      })
      .catch(() => {
        if (!cancelled) setPagesNote('無法載入各頁預覽，暫時只顯示封面。');
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeSession?.id, activeSession?.canva_design_id, activeSession?.status, activeSession?.thumbnail_url]);
  const openList = (kind: 'drafts' | 'designs') => {
    setListDrawer(kind);
    void refreshSessions(40);
  };
  const languageOptions = optionsWithCurrent(LANGUAGE_OPTIONS, brief.language);
  const styleOptions = optionsWithCurrent(STYLE_OPTIONS, brief.style);
  const showGenerationWarning = Boolean(canImport && generationProbe && !generationProbe.ok);

  if (companyPage) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
        <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-6 fds-page-padding">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold">公司介紹配置</h2>
              <p className="text-sm text-muted-foreground">統一管理簡報的公司介紹，保存後套用至所有新簡報。</p>
            </div>
            <Button type="button" variant="outline" disabled={companySaving} onClick={() => setCompanyPage(false)}>返回簡報</Button>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">可直接編輯下方內容，或套用官網整理的介紹。</p>
              <Button type="button" variant="outline" disabled={companySaving} onClick={() => setCompanyDraft({ ...WEBSITE_COMPANY_PROFILE })}>
                套用官網介紹
              </Button>
            </div>
            <details className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-foreground">資料來源與套用說明</summary>
              <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>套用會替換編輯中的內容，保存後才會生效。</p>
                <p className="flex flex-wrap gap-x-4 gap-y-2">
                  <a className="underline underline-offset-4" href="https://brandingworks-furniture.com/" target="_blank" rel="noreferrer">傢俬官網</a>
                  <a className="underline underline-offset-4" href="https://www.bwoffice.asia/pages/contact-bwoffice-team" target="_blank" rel="noreferrer">公司實績與服務</a>
                  <a className="underline underline-offset-4" href="https://www.bwoffice.asia/pages/furniture-factory" target="_blank" rel="noreferrer">自設廠房與材料</a>
                  <a className="underline underline-offset-4" href="https://www.chifung-asia.com/pages/history" target="_blank" rel="noreferrer">集團認證紀錄</a>
                  <a className="underline underline-offset-4" href="https://www.hkpida.org/member/member-designcompany.html" target="_blank" rel="noreferrer">HKPIDA 企業會員名錄</a>
                </p>
              </div>
            </details>
          </div>
          <div className="grid gap-6">
            {([
              ['background', '背景'], ['strengths', '優勢'], ['services', '主要服務'],
              ['qualifications', '專業資質'], ['capabilities', '相關能力'],
            ] as const).map(([key, label]) => (
              <Field key={key} label={label} counter={`${companyDraft[key].length}/2000`} hint={key === 'qualifications' ? '資歷來源為 Branding Works 設計工程業務；證書有效期及適用範圍以實際文件為準。' : undefined}>
                <Textarea aria-label={label} className="min-h-[7rem] resize-y rounded-lg bg-card text-sm leading-7" maxLength={2000}
                  value={companyDraft[key]} onChange={(event) => setCompanyDraft((current) => ({
                    ...current, [key]: event.target.value.slice(0, 2000),
                  }))} />
              </Field>
            ))}
          </div>
        </div>
        </div>
        <div className="shrink-0 border-t bg-card">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <p className="text-xs text-muted-foreground">保存後供所有新簡報共用</p>
          <Button type="button" className="shrink-0" disabled={companySaving} onClick={() => {
            setCompanySaving(true);
            void savePresentationCompanyProfile(companyDraft)
              .then(() => {
                setCompanyProfile({ ...companyDraft });
                setCompanyIntro((current) => !current || current === companyProfile.background ? companyDraft.background : current);
                setQualifications((current) => !current || current === companyProfile.qualifications ? companyDraft.qualifications : current);
                setServicesText((current) => !current || current === companyProfile.services ? companyDraft.services : current);
                setCompanyPage(false);
                toast.success('公司介紹已保存');
              })
              .catch((err: unknown) => toast.error('公司介紹未能保存', { description: errorText(err) }))
              .finally(() => setCompanySaving(false));
          }}>
            {companySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存公司介紹
          </Button>
          </div>
        </div>
      </div>
    );
  }

  const draftList = (rows: CanvaDesignSession[]) => (
    rows.length === 0 ? (
      <p className="py-6 text-center text-sm text-muted-foreground">尚無草稿</p>
    ) : (
      <ul className="space-y-1">
        {rows.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => { loadSession(s); setListDrawer(null); }}
              className="flex w-full items-start gap-3 rounded-xl px-1 py-2 text-left hover:bg-muted/60"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{sessionTitle(s)}</span>
                  <Badge className="shrink-0 border-transparent bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/50 dark:text-orange-200">{s.status === 'creating' ? '生成中' : s.status === 'failed' ? '生成失敗' : '草稿'}</Badge>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{formatRecentTime(s.updated_at || s.created_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  );

  const designList = (rows: CanvaDesignSession[]) => (
    rows.length === 0 ? (
      <p className="py-6 text-center text-sm text-muted-foreground">尚無 Gamma 設計</p>
    ) : (
      <ul className="space-y-1">
        {rows.map((s) => (
          <li key={s.id}>
            <div className="flex items-start gap-1 rounded-xl hover:bg-muted/60">
              <button type="button" onClick={() => openDesignRow(s)} className="flex min-w-0 flex-1 items-start gap-3 px-1 py-2 text-left">
                <DesignThumbnail url={sessionThumbnail(s)} />
                <span className="min-w-0 flex-1">
                  <span title={sessionTitle(s)} className="block truncate text-sm font-medium text-foreground">{sessionTitle(s)}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{designStatusLine(s)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">FDS 更新：{formatRecentTime(s.updated_at || s.created_at)}</span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="mt-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${sessionTitle(s)} 的操作`}><MoreHorizontal className="h-4 w-4" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!s.edit_url} onSelect={() => openDesignRow(s)}>在 Gamma 編輯</DropdownMenuItem>
                  <DropdownMenuItem disabled={!s.edit_url} onSelect={() => { void navigator.clipboard.writeText(s.edit_url!).then(() => toast.success('已複製連結')).catch(() => toast.error('無法複製連結')); }}>複製連結</DropdownMenuItem>
                  <DropdownMenuItem disabled={!s.export_download_url} onSelect={() => { if (s.export_download_url) window.open(s.export_download_url, '_blank', 'noopener,noreferrer'); }}>下載首次生成的 PPTX</DropdownMenuItem>
                  {s.populate_report?.provider === 'gamma' && <DropdownMenuItem className="text-destructive" onSelect={() => { void removeDesignRow(s); }}>從 FDS 移除</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </li>
        ))}
      </ul>
    )
  );

  const recentCard = (title: string, kind: 'drafts' | 'designs', preview: ReactNode) => (
    <motion.section
      layout
      layoutId={kind === 'drafts' ? 'recent-drafts' : 'recent-designs'}
      transition={panelTransition}
      className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => openList(kind)}>
          查看全部
        </button>
      </div>
      {preview}
    </motion.section>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className={cn('min-h-0 flex-1 overscroll-y-none', wizardStep === 2 ? 'overflow-hidden' : 'overflow-y-auto')}>
      <LayoutGroup id="presentation-canva">
      <div className={cn(
        'mx-auto grid w-full max-w-none items-start gap-4 fds-page-padding lg:grid-cols-[minmax(0,1fr)_22rem]',
        wizardStep === 2 && 'h-full min-h-0 grid-rows-[minmax(0,1fr)] items-stretch overflow-hidden',
      )}>
        <div className={cn('flex min-w-0 flex-col gap-4', wizardStep === 2 && 'h-full min-h-0 overflow-hidden')}>
          <StepIndicator step={wizardStep} onSelect={goToStep} />
          <section className={cn(
            'rounded-2xl border border-border/80 bg-card shadow-sm',
            wizardStep === 2 || wizardStep === 3 ? 'rounded-none border-0 bg-transparent p-0 shadow-none' : 'p-4 sm:p-6',
            wizardStep === 2 && 'flex min-h-0 flex-1 flex-col overflow-hidden',
          )}>
            <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={wizardStep}
              className={wizardStep === 2 ? 'h-full min-h-0' : undefined}
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -14 }}
              transition={panelTransition}
            >
            {wizardStep === 1 && (
            <div className="space-y-4">
              <SectionIntro icon={<FileText className="h-5 w-5" />} title={WIZARD_STEPS[0].title} hint={WIZARD_STEPS[0].hint} />
              <Tip>填寫越完整，AI 生成的簡報內容會越貼近您的需求，包含內容架構、設計風格與產品建議。</Tip>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 dark:border-border dark:bg-card">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">從現有報價單導入</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">帶入平面圖、分區、報價產品，以及單價、數量、尺寸、備註和聯絡資料。</p>
                </div>
                <Button type="button" variant="outline" className="bg-white dark:bg-background" disabled={disabled} onClick={() => setQuoteImportOpen(true)}>
                  <FolderInput className="h-4 w-4" />
                  選擇報價單
                </Button>
              </div>
              <Field label="簡報標題" required counter={`${titleCount}/${TITLE_MAX}`}>
                <Input
                  className="h-10 rounded-lg bg-background"
                  value={brief.title}
                  aria-required
                  maxLength={TITLE_MAX}
                  onChange={(e) => setBrief((b) => ({ ...b, title: e.target.value.slice(0, TITLE_MAX) }))}
                  placeholder="例：2026 Q3 方案匯報"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="客戶" hint="搜尋 PMS 客戶，或直接輸入新客戶">
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <PresentationSearchCombobox
                    inputClassName="pl-9"
                    ariaLabel="客戶"
                    value={brief.client ?? ''}
                    placeholder="請輸入客戶名稱"
                    loading={clientsLoading}
                    filterLocally={false}
                    emptyText={clientsError || '沒有相符客戶，可直接使用輸入的名稱'}
                    options={clients.map((client) => ({
                      id: client.id,
                      label: client.name,
                      hint: [client.contactPerson, client.projects.length ? `${client.projects.length} 個專案` : '']
                        .filter(Boolean)
                        .join(' · ') || null,
                    }))}
                    onText={(value) => setBrief((current) => ({
                      ...current,
                      client: value,
                      clientId: current.client === value ? current.clientId : undefined,
                      pmsClientId: current.client === value ? current.pmsClientId : undefined,
                      project: current.client === value ? current.project : '',
                      projectId: current.client === value ? current.projectId : undefined,
                      pmsProjectId: current.client === value ? current.pmsProjectId : undefined,
                    }))}
                    onPick={(option) => {
                      const client = clients.find((row) => row.id === option.id);
                      if (client) selectClient(client);
                    }}
                  />
                  </div>
                </Field>
                <Field
                  label="專案"
                  hint={brief.pmsClientId ? '搜尋此客戶的 PMS 專案，也可直接輸入' : '搜尋 PMS 專案名稱或編號，或直接輸入'}
                >
                  <div className="relative">
                    <FolderKanban className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <PresentationSearchCombobox
                    inputClassName="pl-9"
                    ariaLabel="專案"
                    value={brief.project ?? ''}
                    placeholder="請輸入專案名稱"
                    loading={projectsLoading}
                    filterLocally={false}
                    emptyText={projectsError || (brief.pmsClientId
                      ? '此客戶沒有相符 PMS 專案，可直接輸入'
                      : '沒有相符 PMS 專案，可直接輸入')}
                    options={projects.map((project) => ({
                      id: project.id,
                      label: project.name,
                      hint: [project.code, project.client?.name || project.customerName, projectOptionHint(project)].filter(Boolean).join(' · ') || null,
                    }))}
                    onText={(value) => setBrief((current) => ({
                      ...current,
                      project: value,
                      projectId: current.project === value ? current.projectId : undefined,
                      pmsProjectId: current.project === value ? current.pmsProjectId : undefined,
                    }))}
                    onPick={(option) => {
                      const project = projects.find((row) => row.id === option.id);
                      if (project) selectProject(project);
                    }}
                  />
                  </div>
                </Field>
              </div>
              <Field label="簡報目的" counter={`${purposeCount}/${PURPOSE_MAX}`}>
                <Textarea
                  className="min-h-[5.5rem] rounded-lg bg-background"
                  value={brief.purpose ?? ''}
                  maxLength={PURPOSE_MAX}
                  onChange={(e) => setBrief((b) => ({ ...b, purpose: e.target.value.slice(0, PURPOSE_MAX) }))}
                  placeholder="向客戶介紹方案重點、空間規劃、風格與預算說明"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="語言">
                  <div className="relative">
                    <Languages className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Select
                    value={brief.language || '繁體中文'}
                    onValueChange={(value) => setBrief((b) => ({ ...b, language: value }))}
                  >
                    <SelectTrigger className="h-10 rounded-lg bg-background pl-9">
                      <SelectValue placeholder="選擇語言" />
                    </SelectTrigger>
                    <SelectContent>
                      {languageOptions.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                </Field>
                <Field label="風格">
                  <div className="relative">
                    <Palette className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Select
                    value={brief.style || '專業、簡潔'}
                    onValueChange={(value) => setBrief((b) => ({ ...b, style: value }))}
                  >
                    <SelectTrigger className="h-10 rounded-lg bg-background pl-9">
                      <SelectValue placeholder="選擇風格" />
                    </SelectTrigger>
                    <SelectContent>
                      {styleOptions.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                </Field>
                <Field label="期望頁數">
                  <div className="relative">
                    <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-10 rounded-lg bg-background pl-9 pr-32"
                    type="number"
                    min={4}
                    max={40}
                    value={brief.pageCount ?? ''}
                    onChange={(e) => setBrief((b) => ({ ...b, pageCount: Number(e.target.value) || undefined }))}
                    aria-describedby="presentation-page-count-hint"
                    placeholder="12"
                  />
                    <span id="presentation-page-count-hint" className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs text-muted-foreground">含最後 3 頁</span>
                  </div>
                </Field>
              </div>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-border dark:bg-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#efedff] text-[#5b4dff] dark:bg-indigo-950/60 dark:text-indigo-200">
                      <Image className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">上傳簡報素材</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">上傳封面圖與整體平面圖，讓系統自動識別分區並生成對應截圖。</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <PresentationImageField
                    variant="dropzone"
                    icon={<Image className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
                    hint="支援 JPG、PNG、PDF。建議比例 16:9"
                    onUploadState={trackUpload}
                    label="封面圖（可選）"
                    value={brief.coverImageUrl}
                    disabled={disabled}
                    onChange={(url) => setBrief((current) => ({ ...current, coverImageUrl: url }))}
                  />
                  <PresentationImageField
                    variant="dropzone"
                    icon={<FileText className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
                    hint="支援 JPG、PNG、PDF"
                    onUploadState={trackUpload}
                    label="整體平面圖（可選）"
                    value={brief.floorImageUrl}
                    disabled={disabled}
                    onUploaded={recognizeFloor}
                    onChange={(url) => { setBrief((current) => ({ ...current, floorImageUrl: url, floorEffectImageUrl: undefined })); setIncludeFloor(Boolean(url)); }}
                  />
                </div>
              </div>
              <label className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-[#f3f1ff] px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/40">
                <Checkbox
                  className="mt-0.5"
                  checked={includeFloor}
                  onCheckedChange={(value) => setIncludeFloor(value === true)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">這份簡報包含整體平面圖</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground" role="status" aria-live="polite">
                    {recognizingFloor ? '正在識別分區並產生對應截圖，請稍候…' : '上傳後自動識別分區，並在下方加入對應截圖。'}
                  </span>
                </span>
              </label>
              <div className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-border dark:bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#efedff] text-[#5b4dff] dark:bg-indigo-950/60 dark:text-indigo-200">
                      <Box className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">分區管理（{zones.length}）</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">框選平面圖、調整分區與對應截圖。</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {brief.floorImageUrl ? (
                      <Button type="button" variant="outline" disabled={disabled} onClick={async () => {
                        const source = brief.floorImageUrl;
                        if (!source) return;
                        trackUpload(1);
                        try {
                          const asset = await generateQuoteReferenceImage({ purpose: 'floor_plan', model: 'gemini', aspectRatio: '16:9', referenceUrls: [source], prompt: '風格：淺橡木地板、米白與自然木色家具、深灰牆體、柔和日光和接觸陰影，少量綠植。正交頂視、建築模型質感、乾淨米色背景。以原圖佈局為最高優先，僅供提案效果參考。' });
                          setBrief((current) => current.floorImageUrl === source ? { ...current, floorEffectImageUrl: asset.url } : current);
                          toast.success('俯視效果圖已生成', { description: '請核對牆體、門窗與家具位置後儲存草稿。' });
                        } catch (error) { toast.error('效果圖生成失敗', { description: errorText(error) }); }
                        finally { trackUpload(-1); }
                      }}>生成俯視效果圖</Button>
                    ) : null}
                    {brief.floorImageUrl && zones.some((zone) => zone.rect) ? (
                      <Button type="button" variant="outline" disabled={disabled} onClick={async () => {
                        const request = ++floorRecognitionRequest.current;
                        setRecognizingFloor(true);
                        try {
                          const sourceZones = [...zones];
                          const response = await fetch(brief.floorImageUrl!);
                          if (!response.ok) throw new Error('無法讀取原始平面圖');
                          const result = await cropPresentationFloorPlan(await response.blob(), sourceZones.map((zone) => ({ name: zone.name, rect: presentationZoneBounds(zone.rects ?? (zone.rect ? [zone.rect] : [])), rects: zone.rects })));
                          if (request !== floorRecognitionRequest.current) return;
                          const images = new Map(sourceZones.map((zone, index) => [zone.id, result.zones[index]?.imageUrl]));
                          setZones((current) => current.map((zone) => images.get(zone.id) ? { ...zone, imageUrl: images.get(zone.id) } : zone));
                          toast.success('已更新分區高清截圖', { description: result.failedCrops ? '部分截圖失敗，已保留原圖。' : '按原有分區裁切，請儲存草稿；已有簡報需要建立新版本重新生成。' });
                        } catch (error) { toast.error('高清截圖失敗', { description: errorText(error) }); }
                        finally { if (request === floorRecognitionRequest.current) setRecognizingFloor(false); }
                      }}>更新高清截圖</Button>
                    ) : null}
                    {brief.floorImageUrl ? (
                      <Button type="button" variant="outline" className="bg-white dark:bg-background" disabled={disabled || recognizingFloor} onClick={async () => {
                        trackUpload(1);
                        try {
                          const response = await fetch(brief.floorImageUrl!);
                          if (!response.ok) throw new Error('無法讀取平面圖');
                          await recognizeFloor(await response.blob());
                        } catch (error) { toast.error('無法重新識別分區', { description: errorText(error) }); }
                        finally { trackUpload(-1); }
                      }}>重新識別</Button>
                    ) : null}
                    <Button type="button" className="bg-indigo-600 text-white hover:bg-indigo-500" disabled={disabled} onClick={() => setZoneManagerOpen(true)}>
                      <LayoutTemplate className="h-4 w-4" aria-hidden />
                      分區管理
                    </Button>
                  </div>
                </div>
                {!zones.length && !brief.floorImageUrl ? (
                  <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center dark:border-border">
                    <ZoneEmptyArt />
                    <p className="mt-3 text-sm font-semibold text-foreground">尚未建立分區。</p>
                    <p className="mt-1 text-xs text-muted-foreground">上傳平面圖自動識別，或開啟分區管理新增。</p>
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-3 gap-3">
                      {!zones.length ? <p className="col-span-3 py-6 text-sm text-muted-foreground">尚未建立分區。上傳平面圖自動識別，或開啟分區管理新增。</p> : null}
                      {zones.map((zone, index) => <button type="button" key={zone.id} disabled={disabled} onClick={() => setZoneManagerOpen(true)} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left hover:bg-muted/30 dark:border-border">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-white" style={{ background: floorPlanZoneColor(index) }}>{index + 1}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{zone.name || '未命名分區'}</span><span className="text-xs text-muted-foreground">{[zone.spaceType, zone.quantity ? '數量 ' + zone.quantity : '', !zone.imageUrl ? '尚未有截圖' : ''].filter(Boolean).join(' · ')}</span></span>
                        {zone.imageUrl ? <LoadingImage src={zone.imageUrl} alt={zone.name} className="h-16 w-24 shrink-0 rounded border" imgClassName="object-contain" /> : null}
                      </button>)}
                  </div>
                )}
              </div>
              {brief.floorEffectImageUrl ? (
                <div className="rounded-xl border border-border p-3">
                  <p className="mb-2 text-sm font-medium">俯視效果圖 · AI 生成，僅供設計參考，請核對原圖佈局</p>
                  <LoadingImage src={brief.floorEffectImageUrl} alt="平面圖俯視效果圖" className="max-h-[480px] w-full" imgClassName="object-contain" />
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">生成簡報時，「項目平面圖」頁會用這張效果圖取代原本的平面圖。</p>
                </div>
              ) : null}
              {zoneManagerOpen ? <PresentationZoneManager zones={zones} floorUrl={brief.floorImageUrl} onClose={() => setZoneManagerOpen(false)} onSave={(next) => {
                setZones(next);
                const ids = new Set(next.map((zone) => zone.id));
                setProductZone((current) => Object.fromEntries(Object.entries(current).filter(([, id]) => ids.has(id))));
              }} /> : null}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 dark:border-border dark:bg-card">
                <div className="flex min-w-0 gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#efedff] text-[#5b4dff] dark:bg-indigo-950/60 dark:text-indigo-200">
                    <FileText className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">公司介紹</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">簡報末尾預留服務承諾、資質及公司介紹三頁；未填內容會標示待補充。</p>
                  </div>
                </div>
                <Button type="button" variant="outline" className="bg-white dark:bg-background" disabled={disabled} onClick={() => {
                  setCompanyDraft(Object.values(companyProfile).some((value) => value.trim())
                    ? { ...companyProfile } : { ...WEBSITE_COMPANY_PROFILE });
                  setCompanyPage(true);
                }}>
                  <Settings2 className="h-4 w-4" />
                  配置公司介紹
                </Button>
              </div>
              <Field label="參考案例（最多 8 個）" counter={`${selectedCaseIds.length}/8`}>
                {caseNote ? <p className="text-sm text-destructive">{caseNote}</p> : (
                  <MultiSelect label="參考案例" placeholder={availableCases.length ? '搜尋案例名稱或項目編號' : '沒有可選案例'}
                    options={availableCases.map((item) => ({
                      value: item.id,
                      label: item.display_name || item.brand_name_cn || item.brand_name_en || item.company_name || '未命名案例',
                      description: [item.id.startsWith('photo-project:') ? '有完工照片' : '', item.industries?.join(' · '), ...item.recent_projects.map(project => project.project_name)].filter(Boolean).join(' · '),
                    }))}
                    value={selectedCaseIds} onValueChange={setSelectedCaseIds} maxSelected={8} disabled={disabled || !availableCases.length} />
                )}
              </Field>
              <Field label="簡報原文" counter={`${contentCount}/${CONTENT_MAX}`}>
                <Textarea
                  className="min-h-[8rem] rounded-lg bg-background"
                  value={brief.content ?? ''}
                  maxLength={CONTENT_MAX}
                  onChange={(e) => setBrief((b) => ({ ...b, content: e.target.value.slice(0, CONTENT_MAX) }))}
                  placeholder="可貼上客戶提供的簡報原文、聯絡方式或補充說明"
                />
              </Field>
            </div>
            )}
            {wizardStep === 2 && (
              <div className="h-full min-h-0">
                <PresentationProductPicker
                  key={pickerNonce}
                  selected={selected}
                  maxItems={MAX_ITEMS}
                  zones={zones}
                  productZone={productZone}
                  zoneDisabled={disabled || zones.length === 0}
                  onZoneChange={(productId, zoneId) => setProductZone((current) => ({ ...current, [productId]: zoneId }))}
                  onChange={(products) => {
                    const list = typeof products === 'function' ? products(selected) : products;
                    setSelected(list);
                    setProductDrafts((current) => {
                      const drafts = { ...current };
                      for (const product of list) {
                        if (!drafts[product.id]) drafts[product.id] = emptyProductDraft(product);
                      }
                      return drafts;
                    });
                    setProductZone((current) => {
                      const assigned = { ...current };
                      const first = zones[0]?.id;
                      for (const product of list) {
                        if (!assigned[product.id] && first) assigned[product.id] = first;
                      }
                      return assigned;
                    });
                  }}
                />
              </div>
            )}
            {wizardStep === 3 && (
              <div className="space-y-4">
                <SectionIntro icon={<ListChecks className="h-5 w-5" />} title={WIZARD_STEPS[2].title} hint={WIZARD_STEPS[2].hint} />
                <PresentationOutlineStep
                  title={brief.title}
                  floorReferenceUrl={brief.floorImageUrl}
                  onProcessing={trackUpload}
                  client={brief.client ?? ''}
                  companyIntro={companyIntro}
                  qualifications={qualifications}
                  services={servicesText}
                  includeFloor={includeFloor}
                  zones={zones}
                  products={selected}
                  productZone={productZone}
                  drafts={productDrafts}
                  disabled={disabled}
                  onTitle={(value) => setBrief((current) => ({ ...current, title: value.slice(0, TITLE_MAX) }))}
                  onClient={(value) => setBrief((current) => ({ ...current, client: value }))}
                  cases={outlineInput().cases}
                  onCase={(id, value) => setCaseDrafts((current) => ({ ...current, [id]: value }))}
                  onCompanyIntro={setCompanyIntro}
                  onQualifications={setQualifications}
                  onServices={setServicesText}
                  onZoneName={(id, name) => setZones((current) => current.map((zone) => zone.id === id ? { ...zone, name } : zone))}
                  onZonePatch={(id, patch) => setZones((current) => current.map((zone) => zone.id === id ? { ...zone, ...patch } : zone))}
                  onReorder={setZones}
                  onDraft={(productId, patch) => setProductDrafts((current) => {
                    const product = selected.find((item) => item.id === productId);
                    const base = current[productId] ?? (product ? emptyProductDraft(product) : null);
                    if (!base) return current;
                    return { ...current, [productId]: { ...base, ...patch } };
                  })}
                  onZone={(productId, zoneId) => setProductZone((current) => ({ ...current, [productId]: zoneId }))}
                />
              </div>
            )}
            {wizardStep === 4 && (
            <div className="space-y-4">
              <SectionIntro icon={<PresentationIcon className="h-5 w-5" />} title={WIZARD_STEPS[3].title} hint={WIZARD_STEPS[3].hint} />
              <p className="text-sm text-muted-foreground">大綱與圖片會交由 Gamma 排版，完成後請檢查產品圖片、平面圖與文字。</p>
              {generateBlock ? <p className="text-sm text-destructive">{generateBlock}</p> : null}
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="min-w-0 flex-1">
                  <Field label="新版本備註">
                    <Input
                      className="h-10 rounded-lg bg-background"
                      value={versionNote}
                      onChange={(e) => setVersionNote(e.target.value)}
                      placeholder="例：調整設計風格，加入最新產品圖片"
                    />
                  </Field>
                </div>
                <div className="shrink-0">
                  <Field label="版本名稱">
                    <p className="flex h-10 items-center px-1 text-sm font-medium tabular-nums text-foreground">
                      v{activeSession?.content_version ?? 1}
                    </p>
                  </Field>
                </div>
                <Button
                  type="button"
                  className="h-10 bg-indigo-600 px-6 text-white hover:bg-indigo-500"
                  disabled={!canCreateNative || disabled || Boolean(activeSession?.canva_design_id)}
                  onClick={createNative}
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PresentationIcon className="h-4 w-4" />}
                  {generating ? '生成中' : '開始 AI 生成'}
                </Button>
                {activeSession?.canva_design_id && (
                  <Button type="button" variant="outline" className="h-10 bg-background" disabled={disabled} onClick={() => newVersion(activeSession)}>
                    新版本
                  </Button>
                )}
              </div>
              {(phase > 0 || activeSession?.status === 'failed' || generationError) && (
                <div role="status" aria-live="polite" className="space-y-3 rounded-xl border bg-muted/30 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {activeSession?.status === 'failed' ? 'Gamma 生成失敗' : phase >= 4 ? 'Gamma 簡報已完成' : '正在生成簡報…'}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {phase >= 4 ? '您的 Gamma 簡報已成功生成，可前往編輯或匯出檔案。' : 'AI 正在根據您的內容於 Gamma 中建立簡報，請稍候。'}
                      </p>
                    </div>
                    {phase > 0 && phase < 4 && (
                      <p className="text-xs text-muted-foreground">每 3 秒自動更新一次</p>
                    )}
                    {phase >= 4 && activeSession?.updated_at && (
                      <p className="text-xs text-muted-foreground">完成時間：{formatStamp(activeSession.updated_at)}</p>
                    )}
                  </div>
                  {Array.isArray(activeSession?.populate_report?.product_assets) && (activeSession.populate_report.product_assets as { product_id: string }[]).length > 0 && (
                    <ol className="relative ml-1 space-y-0 border-l border-indigo-200 py-1 pl-5 dark:border-indigo-800">
                      <AnimatePresence initial={false}>
                        {(activeSession.populate_report.product_assets as { product_id: string; name: string; url?: string; asset_id?: string; error?: string }[]).map((asset, index, list) => {
                          const ok = Boolean(asset.asset_id);
                          const label = ok
                            ? '已上傳至 Gamma'
                            : asset.error?.includes('missing_asset_write_scope')
                              ? '請重新連接 Gamma 以授權上傳圖片'
                              : '上傳失敗，請手動上傳原圖';
                          return (
                            <motion.li
                              key={asset.product_id}
                              layout
                              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
                              className={cn('relative', index < list.length - 1 && 'pb-4')}
                            >
                              <span className={cn(
                                'absolute -left-[1.45rem] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-background',
                                ok ? 'bg-indigo-500' : 'bg-red-500',
                              )} />
                              <p className="text-sm leading-5 text-foreground">
                                {asset.name}
                                <span className="text-muted-foreground">：{label}</span>
                                {asset.url && /^https:\/\//i.test(asset.url) ? (
                                  <a className="ml-2 text-indigo-600 underline underline-offset-2 dark:text-indigo-300" href={asset.url} target="_blank" rel="noopener noreferrer">開啟原圖</a>
                                ) : null}
                              </p>
                            </motion.li>
                          );
                        })}
                      </AnimatePresence>
                    </ol>
                  )}
                  {phase > 0 && phase < 4 && (
                    <ol className="grid gap-2 sm:grid-cols-4">
                      {GEN_PHASES.map((label, index) => {
                        const n = index + 1;
                        const done = phase > n;
                        const current = phase === n;
                        return (
                          <li key={label} className="min-w-0">
                            <div className={cn('mb-1 h-1 rounded-full', done || current ? 'bg-indigo-500' : 'bg-muted')} />
                            <p className={cn('truncate text-[11px] font-medium', current ? 'text-indigo-700 dark:text-indigo-200' : 'text-muted-foreground')}>
                              {n}. {label}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{done ? '已完成' : current ? '進行中' : '等待中'}</p>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {activeSession?.populate_report?.generation_job_id && phase < 4 && (
                    <p className="break-all text-xs text-muted-foreground">
                      Gamma 任務：{String(activeSession.populate_report.generation_job_id)}
                    </p>
                  )}
                  {(activeSession?.error || generationError) && !activeSession?.canva_design_id && (
                    <p className="break-words text-sm text-destructive">{activeSession?.error || generationError}</p>
                  )}
                  {statusReadError && <p className="break-words text-xs text-amber-700 dark:text-amber-300">{statusReadError}</p>}
                </div>
              )}
              {!canvaPathReady && canImport && (
                <p className="text-xs text-amber-700 dark:text-amber-300">請先連接 Gamma 後再建立設計。</p>
              )}
              {activeSession?.canva_design_id && (
                <div className="flex flex-wrap gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Gamma 簡報已完成</p>
                    <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
                      可前往 Gamma 編輯；下方 PPTX 為首次生成版本，修改後請在 Gamma 匯出。
                      <a className="ml-1 underline" href={proPdfHandoffPath(brief)}>開啟專業 PDF 頁</a>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {canvaLink && (
                        <Button className="bg-emerald-600 text-white hover:bg-emerald-500" asChild>
                          <a href={canvaLink.edit_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                            在 Gamma 編輯
                          </a>
                        </Button>
                      )}
                      <Button type="button" variant="outline" className="bg-background" disabled={disabled} onClick={() => exportPptx(activeSession.id)}>
                        {status === 'exporting' && <Loader2 className="h-4 w-4 animate-spin" />}
                        匯出 PPTX（驗收用）
                      </Button>
                      <Button type="button" variant="outline" className="bg-background" disabled={disabled} onClick={() => exportPdf(activeSession.id)}>
                        匯出 PDF（附加）
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {versionRows.length > 0 && (
                <div className="rounded-xl border">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <p className="text-sm font-semibold">版本記錄</p>
                  </div>
                  <ul className="divide-y">
                    {versionRows.map((v) => {
                      const meta = versionStatusLabel(v.status);
                      return (
                        <li key={v.id}>
                          <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => {
                            const known = sessions.find((row) => row.id === v.id);
                            if (known) loadSession(known);
                          }}>
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">v{v.content_version ?? '?'}{v.version_note ? ` · ${v.version_note}` : ''}</span>
                              <span className="block text-xs text-muted-foreground">{formatStamp(v.updated_at || v.created_at)}</span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">{meta.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {exportRows.length > 0 && (
                <div className="rounded-xl border bg-background p-3 text-sm">
                  <p className="mb-2 font-medium">匯出紀錄</p>
                  <ul className="space-y-1 text-xs">
                    {exportRows.map((e) => {
                      const expired = e.url_expires_at && new Date(e.url_expires_at) < new Date();
                      return (
                        <li key={e.id} className="flex flex-wrap items-center gap-2">
                          <span className="uppercase">{e.format}</span>
                          <span className="text-muted-foreground">{formatStamp(e.created_at)}</span>
                          {e.download_url && !expired ? (
                            <a className="underline" href={e.download_url} target="_blank" rel="noreferrer">下載</a>
                          ) : (
                            <span className="text-muted-foreground">{e.error ?? '連結已過期'}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            )}
            </motion.div>
            </AnimatePresence>
          </section>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <AnimatePresence initial={false}>
          {wizardStep === 4 && (
            <motion.section
              key="canva-preview"
              layout
              initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.98 }}
              transition={panelTransition}
              className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm"
            >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-foreground">Gamma 簡報預覽</h3>
                  <div className="flex items-center gap-2">
                    {versionRows.length > 0 && (
                      <Select
                        value={activeSession?.id && versionRows.some((row) => row.id === activeSession.id) ? activeSession.id : undefined}
                        onValueChange={(id) => {
                          const known = sessions.find((row) => row.id === id);
                          if (known) loadSession(known);
                        }}
                      >
                        <SelectTrigger className="h-8 w-28 bg-background" aria-label="預覽版本">
                          <SelectValue placeholder="版本" />
                        </SelectTrigger>
                        <SelectContent>
                          {versionRows.map((row) => (
                            <SelectItem key={row.id} value={row.id}>v{row.content_version ?? '?'}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {(activeSession?.edit_url || activeSession?.view_url) && (
                      <a className="text-xs font-medium text-indigo-600 hover:underline" href={activeSession.edit_url || activeSession.view_url || '#'} target="_blank" rel="noreferrer">
                        在新分頁打開
                      </a>
                    )}
                  </div>
                </div>
                <div className="relative overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-900">
                  {gammaPreview ? (
                    <iframe key={gammaPreview} src={gammaPreview} title="Gamma 簡報預覽" className="aspect-[16/10] min-h-[360px] w-full border-0" allow="fullscreen" allowFullScreen />
                  ) : previewSrc ? (
                    <div className="transition-transform" style={{ transform: `scale(${previewZoom / 100})` }}>
                      <LoadingImage
                        key={previewSrc}
                        hd
                        src={previewSrc}
                        alt={`第 ${previewIndex + 1} 頁`}
                        className="aspect-[16/10] w-full bg-slate-100"
                        imgClassName="object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                      <PresentationIcon className="h-8 w-8 opacity-40" />
                      {pagesLoading ? '正在載入這一頁' : previewPages > 1 ? '這一頁的預覽還沒準備好' : '生成完成後在此預覽 Gamma 簡報'}
                    </div>
                  )}
                </div>
                {gammaPreview ? (
                  <p className="mt-2 text-xs text-muted-foreground">可在預覽內切換頁面。若 Gamma 要求登入或不允許內嵌，請使用「在新分頁打開」查看；文件存取權限沿用 Gamma 設定。</p>
                ) : (<>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" className="h-8 w-8 bg-background p-0" aria-label="上一頁" disabled={(pagesLoading && pageThumbs.length === 0) || previewIndex === 0} onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" className="h-8 w-8 bg-background p-0" aria-label="下一頁" disabled={(pagesLoading && pageThumbs.length === 0) || previewIndex >= previewPages - 1} onClick={() => setPreviewPage((page) => Math.min(previewPages - 1, page + 1))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{pagesLoading && pageThumbs.length === 0 ? '載入分頁' : `${previewIndex + 1} / ${previewPages}`}</span>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" className="h-8 w-8 bg-background p-0" aria-label="縮小" onClick={() => setPreviewZoom((zoom) => Math.max(60, zoom - 10))}>
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <span className="w-10 text-center text-xs tabular-nums">{previewZoom}%</span>
                    <Button type="button" variant="outline" className="h-8 w-8 bg-background p-0" aria-label="放大" onClick={() => setPreviewZoom((zoom) => Math.min(160, zoom + 10))}>
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {pagesNote && (
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">{pagesNote}</p>
                )}
                </>)}
              </motion.section>
          )}
          </AnimatePresence>
          {recentCard('最近草稿', 'drafts', draftList(visibleDrafts))}
          {recentCard('最近 Gamma 設計', 'designs', designList(visibleDesigns))}
        </aside>
      </div>
      </LayoutGroup>
      </div>
      <PresentationQuoteImportModal
        open={quoteImportOpen}
        disabled={disabled}
        onOpenChange={setQuoteImportOpen}
        onPick={applyQuoteImport}
      />
      <Sheet open={listDrawer !== null} onOpenChange={(open) => { if (!open) setListDrawer(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <SheetHeader className="space-y-1 border-b px-5 py-4 pr-12 text-left">
            <SheetTitle>{listDrawer === 'designs' ? '最近 Gamma 設計' : '最近草稿'}</SheetTitle>
            <SheetDescription>
              共 {listDrawer === 'designs' ? designSessions.length : draftSessions.length} 筆
            </SheetDescription>
          </SheetHeader>
          {listDrawer === 'designs' && <div className="px-4 pt-3"><Input aria-label="搜尋 Gamma 設計" placeholder="搜尋設計名稱" value={designSearch} onChange={(event) => setDesignSearch(event.target.value)} /></div>}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {listDrawer === 'designs' ? designList(designSessions.filter((session) => sessionTitle(session).toLocaleLowerCase().includes(designSearch.trim().toLocaleLowerCase()))) : draftList(draftSessions)}
          </div>
        </SheetContent>
      </Sheet>

          <div className={cn(
            'z-20 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-card pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_-12px_rgba(15,23,42,0.35)]',
            'px-4 sm:px-6',
          )}>
            <Button
              type="button"
              variant="outline"
              className="bg-background"
              disabled={wizardStep === 1 || disabled}
              onClick={() => goToStep(wizardStep - 1)}
            >
              上一步
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="bg-background"
                disabled={disabled}
                onClick={clearForm}
              >
                <Trash2 className="h-4 w-4" />
                清空表單
              </Button>
              <Button
                type="button"
                variant="outline"
                className="bg-background"
                disabled={disabled || !canImport}
                onClick={saveDraft}
              >
                {status === 'creating' && !generationPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                儲存草稿
              </Button>
              {wizardStep < WIZARD_STEPS.length ? (
                <Button
                  type="button"
                  className="bg-indigo-600 text-white hover:bg-indigo-500"
                  disabled={disabled}
                  onClick={() => goToStep(wizardStep + 1)}
                >
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  className="bg-indigo-600 text-white hover:bg-indigo-500"
                  disabled={!canCreateNative || disabled || Boolean(activeSession?.canva_design_id)}
                  onClick={createNative}
                >
                  {generating ? 'Gamma 任務進行中' : activeSession?.canva_design_id ? '已有 Gamma 設計' : '開始 AI 生成'}
                </Button>
              )}
            </div>
          </div>
    </div>
  );
}
