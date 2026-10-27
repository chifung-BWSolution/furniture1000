// ============================================================================
// FDS 2.1 — 客戶簡報（F-AI-009）
// Canva AI POST /v1/generations（canvaNativeDesign.ts）。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight,
  ExternalLink, FileText, FolderKanban, Hash, Languages, Lightbulb, Link2,
  ListChecks, Loader2, MoreHorizontal, Package, Palette, Presentation as PresentationIcon,
  RefreshCcw, Save, Settings2, Trash2, Unlink, ZoomIn, ZoomOut,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { LoadingImage } from '@/components/ui/loading-image';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
  createNativeCanvaDesign, fetchCanvaGenerationStatus, defaultBrief, exportCanvaSessionPdf,
  exportCanvaSessionPptx, listCanvaDesignExports, listCanvaDesignSessions,
  listCanvaSessionVersions, probeCanvaNative, proPdfHandoffPath, saveCanvaDraft,
  type CanvaDesignBrief, type CanvaDesignExportRow, type CanvaDesignSession,
  type CanvaSessionVersionRow,
} from '@/lib/canvaNativeDesign';
import { MultiSelect } from '@/components/ui/multi-select';
import { fetchCaseShowcase, type CaseBrand } from '@/lib/caseShowcase';
import { fetchZones } from '@/lib/solutionsApi';
import {
  buildFiveSectionOutline,
  EMPTY_COMPANY_PROFILE,
  loadPresentationCompanyProfile,
  savePresentationCompanyProfile,
  type PresentationCompanyProfile,
} from '@/lib/presentationFiveSection';

// 傢俬官網與 Branding Works 設計工程／集團官網、HKPIDA 名錄資料整理。
const WEBSITE_COMPANY_PROFILE: PresentationCompanyProfile = {
  background: 'BW Furniture（Branding Works Furniture & Office Design）專注香港辦公室及商業傢俬方案，擁有超過 16 年行業經驗、逾 1,000 個空間實績，已服務超過 3,000 家香港企業與機構，整合空間設計、裝修工程與傢俬配置。',
  strengths: '自設「老木匠」傢俬廠房，採用工廠直供模式，配合一對一專員服務。提供超過 1,000 款傢俬，結合現貨及度身訂造選擇，並由產品開發、設計及客戶服務團隊協作跟進。',
  services: '免費上門度尺、空間規劃、報價預算、辦公室設計及裝修配套、傢俬訂製、送貨與安裝；接受企業、機構及政府部門的報價邀請與投標文件，並支援 P-Card 採購付款。',
  qualifications: 'Branding Works 設計工程業務的專業資歷：志豐集團官網記載，志豐商業工程設計於 2020 年獲得 ISO 9001:2015 品質管理體系認證；香港專業室內設計師協會（HKPIDA）企業會員名錄列有 Branding Works 志豐設計工程中心，會員編號 C2604-5。',
  capabilities: '整合辦公室動線、空間規劃、固定裝潢及活動傢俬，提供辦公枱、會議枱、辦公椅、儲物櫃、接待家具與靜音艙等配置。訂造可選微甲醛 E0 板材，並提供阻燃、防刮材料選項及電腦定位排孔工序；按產品及項目需要確認規格。',
};

const MAX_ITEMS = 30;
const PRESENTATION_PATH = '/fds/pm/presentation';
const TITLE_MAX = 100;
const PURPOSE_MAX = 200;
const CONTENT_MAX = 1000;
const SIDEBAR_PREVIEW = 3;
const AI_DOC_HREF = 'https://github.com/chifung-BWSolution/furniture1000/blob/develop/docs/prd/FDS-2.1-Canva-AI生成.md';
const LANGUAGE_OPTIONS = ['繁體中文', '簡體中文', 'English', '中英對照'];
const STYLE_OPTIONS = ['專業、簡潔', '現代、簡約、專業', '簡約現代', '高端精品', '活潑清晰'];
const WIZARD_STEPS = [
  {
    title: '簡報內容與設計要求',
    subtitle: '填寫專業資訊與設計需求',
    hint: '請填寫專業資訊與設計需求，這些內容將作為 Canva AI 生成簡報的依據，協助產出更符合需求的專業簡報。',
  },
  {
    title: '確認五段大綱',
    subtitle: '生成簡報內容框架',
    hint: '系統已根據您填寫的需求資料，為您生成簡報的五段內容大綱。您可以核對各段落，或重新整理大綱。',
  },
  {
    title: '帶入 FDS 產品',
    subtitle: '選擇產品加入簡報',
    hint: '可選。點選產品卡片加入，每一件已選產品會成為自己的一頁，並帶入簡報中。',
  },
  {
    title: 'AI 生成與匯出',
    subtitle: '產生 Canva 簡報並匯出',
    hint: '點擊「開始 AI 生成」，系統將根據前面設定的內容，在 Canva 中建立專業簡報，生成完成後可進行編輯與匯出。',
  },
] as const;

const OUTLINE_CARDS = [
  { title: '封面', body: '專案名稱、客戶名稱、日期、品牌標識與封面主視覺。' },
  { title: '公司介紹', body: '公司背景、服務優勢、設計理念與過往經驗。' },
  { title: '平面圖', body: '空間平面配置圖、動線規劃與功能分區說明。' },
  { title: '方案', body: '設計方案構想、材質選用、傢俬配置、風格參考與預算範圍。' },
  { title: '參考案例', body: '選擇相似案例，展示實際完工效果與設計亮點。' },
] as const;

const GEN_PHASES = ['解析需求', '生成內容', '建立 Canva 簡報', '完成並預覽'] as const;

type Status = 'idle' | 'creating' | 'exporting';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  return <img src="/canva-logo.svg" alt="Canva" className={className} />;
}

function sessionTitle(session: CanvaDesignSession): string {
  const title = (session.brief as CanvaDesignBrief | null)?.title?.trim();
  return title || '未命名';
}

/** Canva thumbnail URLs expire about 15 minutes after they are issued. */
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
  const state = exported ? '已匯出 PPTX' : 'Canva 編輯中';
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
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 280, damping: 30 };

  return (
    <motion.section
      layout
      layoutId="canva-connection"
      transition={spring}
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
        <motion.div
          layout
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full bg-white shadow-md ring-4 dark:bg-indigo-950',
            compact ? 'h-8 w-8 ring-2 ring-emerald-100 dark:ring-emerald-500/20' : 'h-16 w-16 ring-indigo-50 dark:ring-indigo-500/20',
            connected && !compact ? 'ring-emerald-100' : '',
          )}
        >
          <CanvaMark className={compact ? 'h-auto w-6' : 'h-auto w-14'} />
        </motion.div>
        <div className={cn('min-w-0', compact ? 'flex-1 text-left' : '')}>
          <div className={cn('flex items-center gap-1.5', compact ? 'flex-nowrap' : 'flex-wrap justify-center')}>
            <h3 className={cn('font-bold text-foreground', compact ? 'truncate text-xs' : 'text-base')}>Canva 連接</h3>
            <AnimatePresence mode="wait">
              {connected && (
                <motion.span
                  key={statusKey}
                  initial={reduce ? false : { opacity: 0, scale: 0.82, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.9, y: -4 }}
                  transition={spring}
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
              AI 生成需要帳戶具備 Canva AI 與 Magic Design 功能。
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
              <p>請設定 CANVA_CLIENT_ID／CANVA_CLIENT_SECRET，並在 Canva 設定 redirect URI：{`${window.location.origin}${PRESENTATION_PATH}`}。 <a className="underline" href={AI_DOC_HREF} target="_blank" rel="noreferrer">查看設定文件</a></p>
            ) : '僅 admin／傢俬組可使用 Canva 簡報功能。'}>
              <Button type="button" variant="outline" className="w-full">{!canva.configured ? '尚未配置' : '權限不足'}</Button>
            </ConnectionHint>
          )}
          {canva?.configured && canImport && !connected && (
            <Button type="button" className="w-full bg-indigo-600 text-white hover:bg-indigo-500" onClick={onConnect} disabled={disabled}>
              <Link2 className="h-4 w-4" /> 連接 Canva
            </Button>
          )}
          {connected && (
            <div className="grid grid-cols-2 gap-2">
              <ConnectionHint content={showGenerationWarning ? (
                <p>{generationProbe?.message ?? '無法確認 Canva AI 生成權限。'}{generationProbe?.missing_scopes?.length ? ` 缺少 scope：${generationProbe.missing_scopes.join(', ')}。` : ''} <a className="underline" href={AI_DOC_HREF} target="_blank" rel="noreferrer">查看文件</a></p>
              ) : generationProbe?.ok ? '已連接 Canva，可以 AI 生成簡報。' : '已連接 Canva，正在確認 AI 生成權限。'}>
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
          <Link2 className="h-4 w-4" /> 連接 Canva
        </Button>
      )}
    </motion.section>
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
    caseIds: [] as string[],
    products: [] as SearchProduct[],
  });
  fiveRef.current = {
    company: companyProfile,
    floorZones,
    floorPresent,
    cases: caseBrands,
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
  const [outline, setOutline] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CanvaDesignSession[]>([]);
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
      toast.error('Canva 授權失敗', { description: 'state 驗證不符或授權被取消' });
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
        toast.success('Canva 已連接', { description: connected.account_name ? `帳戶：${connected.account_name}` : 'chifung.login' });
      } catch (err) {
        toast.error('Canva 授權失敗', { description: errorText(err) });
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
        if (!cancelled) setCompanyProfile(profile);
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
          setCaseBrands(result.items.slice(0, 40));
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
    })();
    return () => {
      cancelled = true;
    };
  }, [brief.projectId]);

  const disabled = status !== 'idle' || generating;
  const connected = canva?.connected ?? false;
  const canvaPathReady = Boolean(canva?.configured && canImport && connected);

  const nativeTitleOk = Boolean(brief.title.trim() || brief.client?.trim() || brief.project?.trim());
  const nativeContentOk = Boolean(brief.content?.trim() || outline.trim());
  const canCreateNative = nativeTitleOk && nativeContentOk && canvaPathReady;

  const composeFive = useCallback(() => {
    const current = fiveRef.current;
    const briefNow = briefRef.current;
    const chosen = new Set(current.caseIds);
    return buildFiveSectionOutline({
      title: briefNow.title.trim() || briefNow.project?.trim() || '',
      client: briefNow.client?.trim() || '',
      date: new Intl.DateTimeFormat('zh-HK', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      company: current.company,
      floorPlan: { present: current.floorPresent, zones: current.floorZones },
      products: current.products.map((product) => {
        const size = [product.dimension_l_mm, product.dimension_w_mm, product.dimension_h_mm]
          .filter((value) => value != null)
          .join('×');
        const price = product.middle_price ?? product.sale_price;
        return {
          title: product.title,
          model: product.model,
          spec: size ? `${size} mm` : product.material,
          price: price != null ? `參考價 ${price}` : null,
        };
      }),
      cases: current.cases.filter((item) => chosen.has(item.id)).map((item) => ({
        name: item.display_name || item.brand_name_cn || item.brand_name_en || item.company_name || '未命名案例',
        client: item.company_name,
        industry: item.industries?.[0] ?? null,
      })),
    });
  }, []);

  const syncOutline = useCallback(() => {
    const next = composeFive();
    setOutline(next);
    setBrief((b) => ({ ...b, outline: next }));
  }, [composeFive]);

  const saveDraft = useCallback(async () => {
    if (!canImport) return;
    setStatus('creating');
    try {
      const confirmed = composeFive();
      const payload: CanvaDesignBrief = {
        ...brief,
        outline: confirmed,
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
  }, [brief, outline, selected, sessionId, canImport, refreshSessions]);

  const createNative = useCallback(async () => {
    if (!canCreateNative || disabled) return;
    if (activeSession?.canva_design_id) return;
    setStatus('creating');
    setGenerationPending(true);
    setGenerationError('');
    setStatusReadError('');
    setCanvaLink(null);
    setActiveSession(null);
    let taskSessionId: string | null = null;
    try {
      const confirmed = composeFive();
      const payload: CanvaDesignBrief = {
        ...brief,
        title: brief.title.trim() || `${brief.client ?? ''} ${brief.project ?? ''}`.trim() || '客戶簡報',
        outline: confirmed,
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
          description: 'AI 已生成，請在 Canva 微調後匯出。',
        });
      }
      await refreshSessions();
      await refreshStatus();
    } catch (err) {
      // A browser timeout is not evidence that Canva failed. Reconcile with the task.
      const current = taskSessionId ? await fetchCanvaGenerationStatus(taskSessionId).catch(() => null) : null;
      if (current) setActiveSession(current);
      if (current?.canva_design_id && current.edit_url) {
        setCanvaLink({ edit_url: current.edit_url, title: current.brief.title });
        setGenerationError('');
        return;
      }
      if (current?.status === 'creating') {
        setStatusReadError('生成請求連線已中斷，正在查詢 Canva 任務狀態，毋須再次生成。');
        return;
      }
      const msg = current?.error || errorText(err);
      setGenerationError(msg);
      if (msg.includes('design_already_exists') || msg.includes('design_exists') || msg.includes('已有 Canva 設計')) {
        toast.message('此草稿已有 Canva 設計', { description: '請用「新版本」另建設計，勿覆蓋 Canva 內修改。' });
      } else {
        toast.error('AI 生成失敗', { description: msg });
      }
    } finally {
      setGenerationPending(false);
      setStatus('idle');
    }
  }, [canCreateNative, disabled, activeSession, brief, outline, selected, sessionId, refreshSessions, refreshStatus]);

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
        toast.success('PPTX 匯出完成', { description: '請在 PowerPoint 驗證 Canva 最後修改是否可編輯。' });
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

  const loadSession = (s: CanvaDesignSession) => {
    if (disabled) return;
    setGenerationError('');
    setStatusReadError('');
    setCanvaLink(null);
    autoPurpose.current = null;
    autoContent.current = null;
    setSessionId(s.id);
    setBrief({ ...defaultBrief(), ...(s.brief as CanvaDesignBrief) });
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
      toast.message('已建立新版本草稿', { description: '確認後可再次建立 Canva 設計，不覆蓋舊設計。' });
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
      toast.error('無法啟動 Canva 授權', { description: errorText(err) });
    }
  };

  const disconnect = async () => {
    try {
      await canvaDisconnect();
      await refreshStatus();
      toast.message('已解除 Canva 連接');
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
    const target = Math.min(WIZARD_STEPS.length, Math.max(1, next));
    if (target > wizardStep) syncOutline();
    setWizardStep(target);
  }, [syncOutline, wizardStep]);

  const openDesignRow = (session: CanvaDesignSession) => {
    loadSession(session);
    if (session.edit_url) {
      window.open(session.edit_url, '_blank', 'noopener,noreferrer');
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
  const previewPages = activeSession?.canva_design_id
    ? Math.max(1, activeSession.brief?.pageCount ?? brief.pageCount ?? 1)
    : 1;
  const previewIndex = Math.min(previewPage, previewPages - 1);
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

  const canvaCard = (
    <CanvaConnectionCard
      compact={wizardStep === 4}
      canva={canva}
      connected={connected}
      canImport={canImport}
      disabled={disabled}
      showGenerationWarning={showGenerationWarning}
      generationProbe={generationProbe}
      onConnect={() => { void connect(); }}
      onRefresh={() => { void refreshStatus(); }}
      onDisconnect={() => { void disconnect(); }}
    />
  );

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
      <p className="py-6 text-center text-sm text-muted-foreground">尚無 Canva 設計</p>
    ) : (
      <ul className="space-y-1">
        {rows.map((s) => (
          <li key={s.id}>
            <div className="flex items-start gap-1 rounded-xl hover:bg-muted/60">
              <button type="button" onClick={() => { loadSession(s); setListDrawer(null); setWizardStep(4); }} className="flex min-w-0 flex-1 items-start gap-3 px-1 py-2 text-left">
                <DesignThumbnail url={sessionThumbnail(s)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{sessionTitle(s)}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{designStatusLine(s)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{formatRecentTime(s.updated_at || s.created_at)}</span>
                </span>
              </button>
              <button
                type="button"
                className="mt-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`開啟 ${sessionTitle(s)}`}
                onClick={() => openDesignRow(s)}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-none">
      <LayoutGroup id="presentation-canva">
      <div className="mx-auto grid w-full max-w-none items-start gap-5 fds-page-padding lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <StepIndicator step={wizardStep} onSelect={goToStep} />
          <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={wizardStep}
              initial={reduceMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -14 }}
              transition={panelTransition}
            >
            {wizardStep === 1 && (
            <div className="space-y-4">
              <SectionIntro icon={<FileText className="h-5 w-5" />} title={WIZARD_STEPS[0].title} hint={WIZARD_STEPS[0].hint} />
              <Tip>填寫越完整，AI 生成的簡報內容會越貼近您的需求，包含內容架構、設計風格與產品建議。</Tip>
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
                <Field label="期望頁數" hint="建議 8–20 頁">
                  <div className="relative">
                    <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-10 rounded-lg bg-background pl-9"
                    type="number"
                    min={4}
                    max={40}
                    value={brief.pageCount ?? ''}
                    onChange={(e) => setBrief((b) => ({ ...b, pageCount: Number(e.target.value) || undefined }))}
                    placeholder="12"
                  />
                  </div>
                </Field>
              </div>
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
              <div className="space-y-4">
                <SectionIntro icon={<ListChecks className="h-5 w-5" />} title={WIZARD_STEPS[1].title} hint={WIZARD_STEPS[1].hint} />
                <Tip>簡報順序固定為封面、公司介紹、平面圖、方案、參考案例。沒有平面圖時略過該段。公司介紹會保存下來，下一份簡報繼續用。</Tip>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">公司介紹</p>
                    <p className="text-xs text-muted-foreground">所有簡報共用已保存的公司介紹。</p>
                  </div>
                  <Button type="button" variant="outline" className="bg-background" disabled={disabled} onClick={() => {
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
                    <MultiSelect label="參考案例" placeholder={caseBrands.length ? '搜尋並選擇參考案例' : '沒有可選案例'}
                      options={caseBrands.map((item) => ({
                        value: item.id,
                        label: item.display_name || item.brand_name_cn || item.brand_name_en || item.company_name || '未命名案例',
                        description: item.industries?.join(' · '),
                      }))}
                      value={selectedCaseIds} onValueChange={setSelectedCaseIds} maxSelected={8} disabled={disabled || !caseBrands.length} />
                  )}
                </Field>
                <div className="rounded-xl border">
                  <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                    <p className="text-sm font-semibold">簡報大綱內容</p>
                    <Button type="button" variant="outline" className="h-8 bg-background text-xs" disabled={disabled} onClick={() => { syncOutline(); toast.success('已重新整理五段大綱'); }}>
                      <RefreshCcw className="h-3.5 w-3.5" />
                      重新生成大綱
                    </Button>
                  </div>
                  <ol className="divide-y">
                    {OUTLINE_CARDS.map((card, index) => {
                      const skipped = card.title === '平面圖' && !floorPresent;
                      const extra = card.title === '封面'
                        ? [brief.title, brief.client].filter(Boolean).join(' · ')
                        : card.title === '方案'
                          ? (selected.length ? `已選 ${selected.length} 件產品` : '尚未選擇產品')
                          : card.title === '參考案例'
                            ? (selectedCaseIds.length ? `已選 ${selectedCaseIds.length} 個案例` : '尚未選擇案例')
                            : card.title === '平面圖'
                              ? (floorPresent ? (floorZones.length ? floorZones.map((zone) => zone.name).filter(Boolean).join('、') : '已有平面圖') : '此項目沒有平面圖，生成時略過')
                              : '';
                      return (
                        <li key={card.title} className={cn('flex gap-3 px-4 py-3', skipped && 'opacity-60')}>
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{index + 1}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-foreground">{card.title}</span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{extra || card.body}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            )}
            {wizardStep === 3 && (
              <div className="space-y-4">
                <SectionIntro icon={<Package className="h-5 w-5" />} title={WIZARD_STEPS[2].title} hint={WIZARD_STEPS[2].hint} />
                <PresentationProductPicker
                  key={pickerNonce}
                  selected={selected}
                  maxItems={MAX_ITEMS}
                  onChange={setSelected}
                />
              </div>
            )}
            {wizardStep === 4 && (
            <div className="space-y-4">
              <SectionIntro icon={<PresentationIcon className="h-5 w-5" />} title={WIZARD_STEPS[3].title} hint={WIZARD_STEPS[3].hint} />
              <Field label="新版本備註">
                <Input
                  className="h-10 rounded-lg bg-background"
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  placeholder="例：調整設計風格，加入最新產品圖片"
                />
              </Field>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Field label="版本名稱">
                    <Input
                      className="h-10 rounded-lg bg-background"
                      value={`v${activeSession?.content_version ?? 1}`}
                      readOnly
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  className="h-10 bg-indigo-600 px-6 text-white hover:bg-indigo-500 sm:mb-0"
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
                        {activeSession?.status === 'failed' ? 'Canva 生成失敗' : phase >= 4 ? 'Canva 簡報已完成' : '正在生成簡報…'}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {phase >= 4 ? '您的 Canva 簡報已成功生成，可前往編輯或匯出檔案。' : 'AI 正在根據您的內容於 Canva 中建立簡報，請稍候。'}
                      </p>
                    </div>
                    {phase > 0 && phase < 4 && (
                      <p className="text-xs text-muted-foreground">每 3 秒自動更新一次</p>
                    )}
                    {phase >= 4 && activeSession?.updated_at && (
                      <p className="text-xs text-muted-foreground">完成時間：{formatStamp(activeSession.updated_at)}</p>
                    )}
                  </div>
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
                      Canva 任務：{String(activeSession.populate_report.generation_job_id)}
                    </p>
                  )}
                  {(activeSession?.error || generationError) && !activeSession?.canva_design_id && (
                    <p className="break-words text-sm text-destructive">{activeSession?.error || generationError}</p>
                  )}
                  {statusReadError && <p className="break-words text-xs text-amber-700 dark:text-amber-300">{statusReadError}</p>}
                </div>
              )}
              {!canvaPathReady && canImport && (
                <p className="text-xs text-amber-700 dark:text-amber-300">請先連接 Canva 後再建立設計。</p>
              )}
              {activeSession?.canva_design_id && (
                <div className="flex flex-wrap gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Canva 簡報已完成</p>
                    <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
                      請先在 Canva 保存修改，再匯出。連結約 24 小時有效。
                      <a className="ml-1 underline" href={proPdfHandoffPath(brief)}>開啟專業 PDF 頁</a>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {canvaLink && (
                        <Button className="bg-emerald-600 text-white hover:bg-emerald-500" asChild>
                          <a href={canvaLink.edit_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                            在 Canva 編輯
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

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-5 lg:self-start">
          {canvaCard}
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
                  <h3 className="text-sm font-bold text-foreground">Canva 簡報預覽</h3>
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
                  {activeSession && sessionThumbnail(activeSession) ? (
                    <div className="transition-transform" style={{ transform: `scale(${previewZoom / 100})` }}>
                      <LoadingImage
                        hd
                        src={sessionThumbnail(activeSession)}
                        alt=""
                        className="aspect-[16/10] w-full bg-slate-100"
                        imgClassName="object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                      <PresentationIcon className="h-8 w-8 opacity-40" />
                      生成完成後在此預覽 Canva 簡報
                    </div>
                  )}
                  {activeSession?.brief?.title && sessionThumbnail(activeSession) && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/70 to-transparent p-4 text-white">
                      <p className="text-lg font-bold">{activeSession.brief.title}</p>
                      <p className="text-xs text-white/80">{[activeSession.brief.client, activeSession.brief.project].filter(Boolean).join(' · ')}</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" className="h-8 w-8 bg-background p-0" aria-label="上一頁" disabled={previewIndex === 0} onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" className="h-8 w-8 bg-background p-0" aria-label="下一頁" disabled={previewIndex >= previewPages - 1} onClick={() => setPreviewPage((page) => Math.min(previewPages - 1, page + 1))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{previewIndex + 1} / {previewPages}</span>
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
                {previewPages > 1 && (
                  <p className="mt-2 text-center text-[11px] text-muted-foreground">分頁以 Canva 為準，這裡顯示目前封面縮圖。</p>
                )}
              </motion.section>
          )}
          </AnimatePresence>
          {recentCard('最近草稿', 'drafts', draftList(visibleDrafts))}
          {recentCard('最近 Canva 設計', 'designs', designList(visibleDesigns))}
        </aside>
      </div>
      </LayoutGroup>
      </div>
      <Sheet open={listDrawer !== null} onOpenChange={(open) => { if (!open) setListDrawer(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <SheetHeader className="space-y-1 border-b px-5 py-4 pr-12 text-left">
            <SheetTitle>{listDrawer === 'designs' ? '最近 Canva 設計' : '最近草稿'}</SheetTitle>
            <SheetDescription>
              共 {listDrawer === 'designs' ? designSessions.length : draftSessions.length} 筆
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {listDrawer === 'designs' ? designList(designSessions) : draftList(draftSessions)}
          </div>
        </SheetContent>
      </Sheet>

          <div className="z-20 shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_-12px_rgba(15,23,42,0.35)] sm:px-6">
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
                  {generating ? 'Canva 任務進行中' : activeSession?.canva_design_id ? '已有 Canva 設計' : '開始 AI 生成'}
                </Button>
              )}
            </div>
          </div>
    </div>
  );
}
