import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { QuotationDraftEditor } from '@/components/dashboard/QuotationDraftEditor';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { deleteDraft, makeDraftKey } from '@/lib/draftStore';
import { useAuth } from '@/contexts/AuthProvider';
import type { QuotationPDFData } from '@/types/quotation-pdf';
import {
  markUseLocalQuoteDraft,
  quickQuoteFormKey,
  readQuickQuoteCopyFrom,
  readQuickQuoteEditingId,
  readQuickQuoteStep,
  resetQuickQuoteSessionStorage,
  shouldUseLocalQuoteDraft,
  writeQuickQuoteCopyFrom,
  writeQuickQuoteEditingId,
  writeQuickQuoteStep,
} from '@/lib/quickQuoteSession';
import { loadQuoteCopyPayload, type QuoteCopyPayload } from '@/lib/quoteCopy';
import { QuoteReferenceSetup } from '@/components/dashboard/QuoteReferenceSetup';
import {
  compareQuoteVersion,
  maxQuoteVersion,
} from '@/lib/quoteVersions';
import { unsavedGuard } from '@/lib/unsavedGuard';
import {
  migrateTermsContentToCurrent,
  type SavedTermsContent,
} from '@/lib/quotationDefaultTerms';
import { parsePmsQuotePrefill } from '@/lib/pmsQuotePrefill';
import {
  fetchPmsPitchingQuoteDefaults,
  type PmsIndustryOption,
} from '@/lib/pmsPitchingQuoteDefaults';
import {
  formatPmsPitchingLabel,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import { sortIndustryLabels } from '@/lib/clientIndustrySort';
import {
  GROUPED_INDUSTRY_LABELS,
} from '@/lib/clientIndustryGroups';
import { PmsPitchingGate } from '@/components/dashboard/PmsPitchingGate';
import { fetchLevel1CategoryOptions } from '@/lib/productCategoryOptions';
import { isLegacyQFormatQuoteId } from '@/lib/quoteChainId';
import {
  itemsFromLegacyProjectData,
  loadQuoteItems,
  type BwfQuoteItemInput,
} from '@/lib/bwfQuoteItems';
import {
  hydrateQuoteItemProductLinks,
  normalizeLegacyQuoteItemProductId,
} from '@/lib/quoteItemProductLink';

const LazyQuotationPDFPreviewModal = lazy(() =>
  import('@/components/dashboard/QuotationPDFPreview').then((mod) => ({
    default: mod.QuotationPDFPreviewModal,
  })),
);

async function fetchMaxVersionForQuote(quoteId: string): Promise<string> {
  const { data, error } = await supabase
    .from('bwf_quote')
    .select('version')
    .eq('quote_id', quoteId);
  if (error) throw error;
  return maxQuoteVersion((data || []).map((r) => String(r.version || '')));
}

interface QuoteFormData {
  company: string;
  projectManager: string;
  /** In-memory 報價單號 from PMS; becomes bwf_quote.quote_id on submit (not persisted in JSON). */
  quoteId: string;
  /** PMS pitching UUID — persisted to bwf_quote.bwf_pitching_id on save */
  pmsPitchingId?: string;
  /** PMS project UUID — persisted to bwf_quote.bwf_project_id on save */
  pmsProjectId?: string;
  /** Client company / org (公司名稱). */
  clientName: string;
  /** Contact person (客戶名稱) — from PMS customers.customer_name. */
  clientContactName: string;
  clientPhone: string;
  clientEmail: string;
  clientIndustry: string[];
  clientIndustryOther: string;
  quotationType: string[];
  // Step 2 (傢俬類別 + 工期／有效期限／備註)
  serviceScope: string[];
  officeArea: string;
  headcount: string;
  workPeriod: string;
  validityDays: string;
  remarks: string;
}

/** Fallback when not opened from a PMS pitching (no industry catalog loaded). */
const FALLBACK_INDUSTRIES = GROUPED_INDUSTRY_LABELS;

const WORK_PERIODS = [
  '即時 3-5天內 - 緊急',
  '7天內 - 加急',
  '7-14天內',
  '3-4星期內',
  '1-3個月內',
  '3-6個月內',
  '1年內',
];

interface QuickQuoteViewProps {
  /**
   * `blank`：快速報價，選定 Pitching 後直接開空白編輯器。
   * `reference`：側欄「參考過往報價」，先列 Pitching，再進配對頁。
   */
  entry?: 'blank' | 'reference';
  editingQuoteId?: string | null;
  /** When set, open this specific version row (bwf_quote.id). */
  editingQuoteUuid?: string | null;
  /** When set without uuid, open this version (e.g. v2 from /quote/Q…V2). */
  editingQuoteVersion?: string | null;
  onClearEditingQuote?: () => void;
  /** Keep AppShell editing ids in sync after 版本審核 (new version row). */
  onEditingQuotePersisted?: (quoteId: string, quoteUuid: string, version?: string) => void;
  /** Assign a quote id when entering the editor step for a new draft (updates URL + session). */
  onAssignEditingQuoteId?: (quoteId: string) => void;
  /** Increment to reset wizard to 建立新報價單 step 1. */
  freshSessionKey?: number;
}

const DEFAULT_FORM_DATA = (): QuoteFormData => ({
  company: 'Branding Works Design Ltd',
  projectManager: '',
  quoteId: '',
  pmsPitchingId: undefined,
  pmsProjectId: undefined,
  clientName: '',
  clientContactName: '',
  clientPhone: '',
  clientEmail: '',
  clientIndustry: [],
  clientIndustryOther: '',
  quotationType: [],
  serviceScope: [],
  officeArea: '',
  headcount: '',
  workPeriod: '',
  validityDays: '30',
  remarks: '',
});

/** Normalize saved/session form JSON (legacy pitchingCode/projectName → quoteId). */
function normalizeQuoteFormData(
  raw: Partial<QuoteFormData> & { projectName?: string; pitchingCode?: string },
): QuoteFormData {
  const base = DEFAULT_FORM_DATA();
  const quoteId =
    (raw.quoteId || raw.pitchingCode || raw.projectName || '').trim() || base.quoteId;
  return {
    ...base,
    ...raw,
    quoteId,
  };
}

/** Sync read of PMS deep-link prefill (avoids gate flash on /quote/quick?pmsProjectId=...). */
function readUrlPrefill(referenceEntry = false): {
  form: QuoteFormData;
  label: string | null;
  applied: boolean;
} {
  if (typeof window === 'undefined') {
    return { form: DEFAULT_FORM_DATA(), label: null, applied: false };
  }
  if (referenceEntry) {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (!path.endsWith('/quote/reference')) {
      return { form: DEFAULT_FORM_DATA(), label: null, applied: false };
    }
  }
  const prefill = parsePmsQuotePrefill(new URLSearchParams(window.location.search));
  if (!prefill?.pmsPitchingId && !prefill?.pmsProjectId) {
    return { form: DEFAULT_FORM_DATA(), label: null, applied: false };
  }
  const labelParts = [prefill.quoteId || prefill.projectName, prefill.clientName].filter(Boolean);
  return {
    form: {
      ...DEFAULT_FORM_DATA(),
      company: prefill.company || 'Branding Works Design Ltd',
      projectManager: prefill.projectManager || '',
      quoteId: prefill.quoteId || prefill.projectName || '',
      pmsPitchingId: prefill.pmsPitchingId,
      pmsProjectId: prefill.pmsProjectId,
      clientName: prefill.clientName || '',
      clientContactName: prefill.clientContactName || '',
      clientPhone: prefill.clientPhone || '',
      clientEmail: prefill.clientEmail || '',
      clientIndustry: prefill.clientIndustry || [],
      quotationType: prefill.quotationType || [],
    },
    label:
      labelParts.length > 0
        ? labelParts.join(' · ')
        : prefill.quoteId ||
          prefill.projectName ||
          prefill.pmsPitchingId ||
          prefill.pmsProjectId ||
          null,
    applied: true,
  };
}

export function QuickQuoteView({
  entry = 'blank',
  editingQuoteId,
  editingQuoteUuid,
  editingQuoteVersion,
  onClearEditingQuote,
  onEditingQuotePersisted,
  onAssignEditingQuoteId,
  freshSessionKey = 0,
}: QuickQuoteViewProps) {
  const { user, loading: authLoading } = useAuth();
  const userEmail = user?.email ?? null;
  const initialUrlPrefillRef = useRef(readUrlPrefill(entry === 'reference'));
  const pmsPrefillAppliedRef = useRef(initialUrlPrefillRef.current.applied);

  const [currentStep, setCurrentStep] = useState(1);
  const [isQuotationReady, setIsQuotationReady] = useState(false);
  /** 報價單本文已到手、正在預載明細（bwf_quote_item），完成後才顯示編輯器。 */
  const [isLoadingQuoteItems, setIsLoadingQuoteItems] = useState(false);
  const [quoteLoadError, setQuoteLoadError] = useState<string | null>(null);
  /** 在顯示編輯器前載入好的明細；undefined 代表未預載，null 代表預載失敗。 */
  const [prefetchedQuoteItems, setPrefetchedQuoteItems] = useState<{
    quoteUuid: string;
    items?: BwfQuoteItemInput[] | null;
  } | null>(null);

  const [loadedQuoteData, setLoadedQuoteData] = useState<{
    quoteId: string;
    version: string;
    status: string;
    totalAmount: number;
    submitter: string;
    projectData: Record<string, unknown>;
    bwfPitchingId?: string | null;
    bwfProjectId?: string | null;
    quoteUuid?: string;
    maxVersionInChain?: string;
    createdAt?: string | null;
    modifiedDate?: string | null;
  } | null>(null);
  const [formData, setFormData] = useState<QuoteFormData>(
    () => initialUrlPrefillRef.current.form,
  );
  const [pdfPreviewData, setPdfPreviewData] = useState<QuotationPDFData | null>(null);
  const [copyPayload, setCopyPayload] = useState<QuoteCopyPayload | null>(null);
  const [isLoadingCopy, setIsLoadingCopy] = useState(false);
  const [referenceCopyActive, setReferenceCopyActive] = useState(false);
  const [boundCustomerType, setBoundCustomerType] = useState('');
  const [boundBudget, setBoundBudget] = useState<number | string | null>(null);
  const assignedDraftQuoteIdRef = useRef<string | null>(null);

  const enterEditorStep = useCallback(
    (opts?: { quoteId?: string; assignEditingId?: boolean }) => {
      // Chain id = PMS pitching code (BWF-…). Never invent legacy QYYYY-MMDD-NNN.
      const candidates = [
        opts?.quoteId,
        formData.quoteId,
        editingQuoteId,
        assignedDraftQuoteIdRef.current,
      ]
        .map((v) => (v || '').trim())
        .filter(Boolean);
      const nextQuoteId =
        candidates.find((id) => !isLegacyQFormatQuoteId(id)) || '';

      if (!nextQuoteId) {
        toast.error('缺少報價單號', {
          description: '請返回選擇 PMS Pitching，確認報價單號後再產生報價',
        });
        return;
      }

      setIsQuotationReady(true);
      setCurrentStep(3);
      if (opts?.assignEditingId !== false) {
        writeQuickQuoteStep(userEmail, 3);
      }

      if (!editingQuoteId && !loadedQuoteData) {
        assignedDraftQuoteIdRef.current = nextQuoteId;
        // Reference copy stays on this page until the first save. Assigning the
        // pitching code now would open that pitching's saved quote.
        if (opts?.assignEditingId !== false) {
          writeQuickQuoteEditingId(userEmail, nextQuoteId);
          // Prefer local draft after AI 產生報價 — Supabase row only exists after 版本審核.
          markUseLocalQuoteDraft(userEmail, nextQuoteId);
          onAssignEditingQuoteId?.(nextQuoteId);
        }
      }

      // Keep wizard formData.quoteId aligned with the URL / draft key.
      setFormData((prev) =>
        prev.quoteId.trim() === nextQuoteId
          ? prev
          : { ...prev, quoteId: nextQuoteId },
      );
    },
    [
      editingQuoteId,
      formData.quoteId,
      loadedQuoteData,
      onAssignEditingQuoteId,
      userEmail,
    ],
  );
  const copyFromUuid = entry === 'reference' ? null : readQuickQuoteCopyFrom(userEmail);
  const [errors, setErrors] = useState<Partial<Record<keyof QuoteFormData, string>>>({});
  const [industryOptions, setIndustryOptions] = useState<string[]>(FALLBACK_INDUSTRIES);
  const [industrySearchQuery, setIndustrySearchQuery] = useState('');
  const [pmsIndustryCatalog, setPmsIndustryCatalog] = useState<PmsIndustryOption[]>([]);
  const [level1CategoryOptions, setLevel1CategoryOptions] = useState<string[]>([]);
  const [level1CategoriesLoading, setLevel1CategoriesLoading] = useState(true);
  const [selectedPitchingLabel, setSelectedPitchingLabel] = useState<string | null>(
    () => initialUrlPrefillRef.current.label,
  );
  const sessionRestoredRef = useRef(initialUrlPrefillRef.current.applied);
  const [resolvedQuoteKey, setResolvedQuoteKey] = useState<string | null>(null);
  const quoteRequestKey = editingQuoteId
    ? `${editingQuoteId}::${editingQuoteUuid || editingQuoteVersion || 'latest'}`
    : null;
  const quoteRequestPending =
    quoteRequestKey !== null && (authLoading || resolvedQuoteKey !== quoteRequestKey);
  const quoteSessionResumePending =
    entry !== 'reference' &&
    !editingQuoteId && !loadedQuoteData && !authLoading && userEmail &&
    freshSessionKey === 0 && !initialUrlPrefillRef.current.applied &&
    Boolean(readQuickQuoteEditingId(userEmail));
  const pmsDefaultsLoadedForRef = useRef<string | null>(null);
  /** True while fetching pitching/project defaults that will overwrite step-1 fields. */
  const [isLoadingPmsDefaults, setIsLoadingPmsDefaults] = useState(() =>
    Boolean(
      initialUrlPrefillRef.current.form.pmsPitchingId ||
        initialUrlPrefillRef.current.form.pmsProjectId,
    ),
  );

  const pmsDefaultsPendingRef = useRef(false);

  // PMS SSO / deep-link prefill: /quote/quick?pmsPitchingId=... and/or pmsProjectId=...
  const applyPmsPrefillFromUrl = useCallback(() => {
    if (typeof window === 'undefined') return false;
    if (entry === 'reference') {
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      if (!path.endsWith('/quote/reference')) return false;
    }
    const prefill = parsePmsQuotePrefill(new URLSearchParams(window.location.search));
    // Skip gate when either PMS id is present (project always resolves to a pitching).
    if (!prefill?.pmsPitchingId && !prefill?.pmsProjectId) return false;
    setCurrentStep(1);
    setIsQuotationReady(false);
    setFormData({
      ...DEFAULT_FORM_DATA(),
      company: prefill.company || 'Branding Works Design Ltd',
      projectManager: prefill.projectManager || '',
      quoteId: prefill.quoteId || prefill.projectName || '',
      pmsPitchingId: prefill.pmsPitchingId,
      pmsProjectId: prefill.pmsProjectId,
      clientName: prefill.clientName || '',
      clientContactName: prefill.clientContactName || '',
      clientPhone: prefill.clientPhone || '',
      clientEmail: prefill.clientEmail || '',
      clientIndustry: prefill.clientIndustry || [],
      quotationType: prefill.quotationType || [],
    });
    const labelParts = [prefill.quoteId || prefill.projectName, prefill.clientName].filter(Boolean);
    setSelectedPitchingLabel(
      labelParts.length > 0
        ? labelParts.join(' · ')
        : prefill.quoteId ||
          prefill.projectName ||
          prefill.pmsPitchingId ||
          prefill.pmsProjectId ||
          null,
    );
    pmsPrefillAppliedRef.current = true;
    sessionRestoredRef.current = true;
    return true;
  }, [entry]);

  useEffect(() => {
    if (editingQuoteId) return;
    if (pmsPrefillAppliedRef.current) return;
    applyPmsPrefillFromUrl();
  }, [editingQuoteId, freshSessionKey, applyPmsPrefillFromUrl]);

  useEffect(() => {
    if (entry === 'reference') return;
    if (authLoading || editingQuoteId || freshSessionKey > 0) return;
    if (!userEmail) return;
    // AppShell restores the saved quote id/UUID. Don't mount an empty editor
    // from the saved step while that navigation is still being applied.
    if (readQuickQuoteEditingId(userEmail)) return;
    if (sessionRestoredRef.current) return;
    if (pmsPrefillAppliedRef.current) return;

    sessionRestoredRef.current = true;
    const step = readQuickQuoteStep(userEmail);
    setCurrentStep(step);
    setIsQuotationReady(step === 3);
    try {
      const raw = sessionStorage.getItem(quickQuoteFormKey(userEmail));
      if (raw) {
        const parsed = normalizeQuoteFormData(JSON.parse(raw));
        setFormData(parsed);
        if (parsed.pmsPitchingId) {
          const label = [parsed.quoteId, parsed.clientName].filter(Boolean).join(' · ');
          setSelectedPitchingLabel(label || parsed.pmsPitchingId);
        }
      }
    } catch {
      // ignore
    }
  }, [authLoading, userEmail, editingQuoteId, freshSessionKey, entry]);

  useEffect(() => {
    let cancelled = false;
    setLevel1CategoriesLoading(true);
    fetchLevel1CategoryOptions()
      .then((options) => {
        if (!cancelled) setLevel1CategoryOptions(options);
      })
      .finally(() => {
        if (!cancelled) setLevel1CategoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetToNewQuote = useCallback(() => {
    setResolvedQuoteKey(null);
    setPrefetchedQuoteItems(null);
    setCurrentStep(1);
    setIsQuotationReady(false);
    setLoadedQuoteData(null);
    setQuoteLoadError(null);
    setCopyPayload(null);
    setReferenceCopyActive(false);
    setBoundCustomerType('');
    setBoundBudget(null);
    setFormData(DEFAULT_FORM_DATA());
    setSelectedPitchingLabel(null);
    setErrors({});
    setIndustrySearchQuery('');
    pmsDefaultsLoadedForRef.current = null;
    resetQuickQuoteSessionStorage(userEmail, { keepCopyFrom: true });
    deleteDraft(makeDraftKey(userEmail, 'NEW')).catch(() => {});
  }, [userEmail]);

  const handleSelectPitching = useCallback((item: PmsPitchingListItem) => {
    setQuoteLoadError(null);
    setSelectedPitchingLabel(formatPmsPitchingLabel(item));
    setBoundCustomerType(item.customer_type?.trim() || '');
    setBoundBudget(item.estimated_income ?? null);
    setReferenceCopyActive(false);
    pmsDefaultsLoadedForRef.current = null;
    setIsLoadingPmsDefaults(true);
    setCurrentStep(1);
    setIsQuotationReady(false);
    setFormData((prev) => ({
      ...prev,
      pmsPitchingId: item.id,
      // Related project_id is resolved by defaults fetch (may stay empty).
      pmsProjectId: undefined,
      quoteId: item.pitching_code?.trim() || prev.quoteId,
      projectManager: item.main_pm_name?.trim() || prev.projectManager,
      // Pitching list label is often company display; contact comes from defaults fetch.
      clientName: item.customer_name?.trim() || prev.clientName,
    }));
    setErrors({});
  }, []);

  /** Return to the minimal pitching search gate (change / clear selection). */
  const handleChangePitching = useCallback(() => {
    setSelectedPitchingLabel(null);
    setBoundCustomerType('');
    setBoundBudget(null);
    setReferenceCopyActive(false);
    pmsDefaultsLoadedForRef.current = null;
    setCurrentStep(1);
    setIsQuotationReady(false);
    setErrors({});
    setFormData((prev) => ({
      ...DEFAULT_FORM_DATA(),
      // keep company default; wipe pitching-linked fields
      company: prev.company || 'Branding Works Design Ltd',
    }));
  }, []);

  useEffect(() => {
    if (freshSessionKey === 0) return;
    // Never wipe an in-progress / loaded quote when the fresh-key bumps (e.g. remount).
    if (editingQuoteId || loadedQuoteData) return;
    resetToNewQuote();
    // Re-apply PMS query params after wiping local session (deep-link / SSO landing)
    pmsPrefillAppliedRef.current = false;
    pmsDefaultsLoadedForRef.current = null;
    applyPmsPrefillFromUrl();
  }, [
    freshSessionKey,
    resetToNewQuote,
    applyPmsPrefillFromUrl,
    editingQuoteId,
    loadedQuoteData,
  ]);

  // Load PMS industry catalog always; resolve project↔pitching + enrich defaults
  useEffect(() => {
    if (editingQuoteId) {
      setIsLoadingPmsDefaults(false);
      return;
    }
    const pitchingId = formData.pmsPitchingId?.trim() || '';
    const projectId = formData.pmsProjectId?.trim() || '';
    const needsPitchingDefaults = Boolean(pitchingId || projectId);
    const cacheKey = needsPitchingDefaults ? `${pitchingId}|${projectId}` : '__catalog__';
    if (pmsDefaultsLoadedForRef.current === cacheKey) {
      if (needsPitchingDefaults) setIsLoadingPmsDefaults(false);
      return;
    }
    // If we already loaded full pitching defaults, don't re-fetch catalog-only
    if (
      !needsPitchingDefaults &&
      pmsDefaultsLoadedForRef.current &&
      pmsDefaultsLoadedForRef.current !== '__catalog__'
    ) {
      return;
    }

    let cancelled = false;
    pmsDefaultsLoadedForRef.current = cacheKey;
    if (needsPitchingDefaults) {
      pmsDefaultsPendingRef.current = true;
      setIsLoadingPmsDefaults(true);
    }

    (async () => {
      try {
        const defaults = await fetchPmsPitchingQuoteDefaults(
          needsPitchingDefaults
            ? { pitchingId: pitchingId || null, projectId: projectId || null }
            : null,
        );
        if (cancelled || !defaults) return;

        if (defaults.industry_options.length > 0) {
          setPmsIndustryCatalog(defaults.industry_options);
          setIndustryOptions(
            sortIndustryLabels(defaults.industry_options.map((o) => o.display)),
          );
        }

        if (!needsPitchingDefaults) return;

        setFormData((prev) => {
          const nextPitchingId = defaults.pitching_id || prev.pmsPitchingId;
          const nextProjectId =
            defaults.project_id || prev.pmsProjectId || undefined;
          // Avoid a second fetch/lock flash when project↔pitching ids are resolved.
          pmsDefaultsLoadedForRef.current = `${(nextPitchingId || '').trim()}|${(nextProjectId || '').trim()}`;
          return {
            ...prev,
            // Persist resolved cross-link ids (project → pitching always; pitching → project if any)
            pmsPitchingId: nextPitchingId,
            pmsProjectId: nextProjectId,
            quoteId:
              defaults.pitching_code ||
              defaults.project_code ||
              prev.quoteId,
            clientName: defaults.client_name || prev.clientName,
            clientContactName:
              defaults.client_contact_name || prev.clientContactName,
            clientPhone: defaults.client_phone || prev.clientPhone,
            clientEmail: defaults.client_email || prev.clientEmail,
            clientIndustry:
              defaults.selected_industries.length > 0
                ? defaults.selected_industries
                : prev.clientIndustry,
          };
        });
        if (defaults.estimated_income != null && defaults.estimated_income !== '') {
          setBoundBudget(defaults.estimated_income);
        }

        if (defaults.pitching_code || defaults.project_code || defaults.client_name) {
          setSelectedPitchingLabel(
            [
              defaults.pitching_code || defaults.project_code,
              defaults.client_name,
            ]
              .filter(Boolean)
              .join(' · ') || null,
          );
        }
      } finally {
        if (!cancelled && needsPitchingDefaults) {
          pmsDefaultsPendingRef.current = false;
          setIsLoadingPmsDefaults(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editingQuoteId, formData.pmsPitchingId, formData.pmsProjectId]);

  useEffect(() => {
    if (entry === 'reference') return;
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(quickQuoteFormKey(userEmail), JSON.stringify(formData));
    } catch {
      // ignore
    }
  }, [formData, userEmail, entry]);

  // Load existing quote when editingQuoteId is provided.
  // Important: do NOT clear loadedQuoteData when editingQuoteId is null — a brand-new
  // quote may have just been persisted via 版本審核 while AppShell id is still catching up.
  // Also keep onClearEditingQuote out of deps (parent often passes an inline fn).
  useEffect(() => {
    if (authLoading || !editingQuoteId || !quoteRequestKey) return;
    const loadKey = quoteRequestKey;
    if (resolvedQuoteKey === loadKey) return;

    let cancelled = false;
    const loadQuote = async () => {
      setIsLoadingQuoteItems(false);
      setQuoteLoadError(null);
      try {
        let data: Record<string, unknown> | null = null;
        let maxVersionInChain: string | undefined;

        if (editingQuoteUuid) {
          const { data: row, error } = await supabase
            .from('bwf_quote')
            .select('*')
            .eq('id', editingQuoteUuid)
            .eq('quote_id', editingQuoteId)
            .maybeSingle();
          if (error) throw error;
          data = row;
        } else {
          // Match the list's numeric version order, even if an older version
          // was edited more recently. Also resolve legacy v1.N URL versions.
          const { data: rows, error } = await supabase
            .from('bwf_quote')
            .select('id,version')
            .eq('quote_id', editingQuoteId)
            .order('modified_date', { ascending: false, nullsFirst: false });
          if (error) throw error;
          if (cancelled) return;
          const versions = rows ?? [];
          maxVersionInChain = maxQuoteVersion(versions.map((row) => row.version));
          const target = editingQuoteVersion
            ? versions.find((row) => row.version === editingQuoteVersion) ??
              versions.find((row) => compareQuoteVersion(row.version, editingQuoteVersion) === 0)
            : versions.sort((a, b) => compareQuoteVersion(b.version, a.version))[0];
          if (target) {
            const { data: row, error } = await supabase
              .from('bwf_quote')
              .select('*')
              .eq('id', target.id)
              .maybeSingle();
            if (error) throw error;
            data = row;
          }
        }
        if (cancelled) return;

        if (!data) {
          // From 報價一覽 we always pass uuid/version — missing row is a real error.
          // AI 產生報價 assigns a synthetic /quote/<id> BEFORE 版本審核 writes bwf_quote.
          // That first navigation must open the local step-4 editor, not toast「報價單不存在」.
          const openedAsExisting =
            Boolean(editingQuoteUuid) || Boolean(editingQuoteVersion);
          const savedStep = readQuickQuoteStep(userEmail);
          const isAssignedDraft =
            assignedDraftQuoteIdRef.current === editingQuoteId ||
            shouldUseLocalQuoteDraft(userEmail, editingQuoteId);
          const isLegacyDraftId = /^Q\d{4}-\d{4}-\d{3}$/.test(editingQuoteId);
          const canOpenLocalDraft =
            !openedAsExisting &&
            (savedStep === 3 || isAssignedDraft || isLegacyDraftId);

          if (!canOpenLocalDraft) {
            throw new Error('報價單不存在');
          }

          try {
            const raw = sessionStorage.getItem(quickQuoteFormKey(userEmail));
            if (raw) {
              const parsed = normalizeQuoteFormData(JSON.parse(raw));
              setFormData(parsed);
              if (parsed.pmsPitchingId || parsed.pmsProjectId) {
                const label = [parsed.quoteId, parsed.clientName]
                  .filter(Boolean)
                  .join(' · ');
                setSelectedPitchingLabel(
                  label || parsed.pmsPitchingId || parsed.pmsProjectId || null,
                );
              }
              // Migrate stale /quote/Q… draft URLs to the PMS pitching code.
              const pmsCode = parsed.quoteId.trim();
              if (
                pmsCode &&
                !isLegacyQFormatQuoteId(pmsCode) &&
                isLegacyQFormatQuoteId(editingQuoteId)
              ) {
                assignedDraftQuoteIdRef.current = pmsCode;
                writeQuickQuoteEditingId(userEmail, pmsCode);
                markUseLocalQuoteDraft(userEmail, pmsCode);
                onAssignEditingQuoteId?.(pmsCode);
                setResolvedQuoteKey(`${pmsCode}::latest`);
                writeQuickQuoteStep(userEmail, 3);
                setIsQuotationReady(true);
                setCurrentStep(3);
                return;
              }
            }
          } catch {
            // ignore
          }
          assignedDraftQuoteIdRef.current = editingQuoteId;
          markUseLocalQuoteDraft(userEmail, editingQuoteId);
          setResolvedQuoteKey(loadKey);
          setLoadedQuoteData(null);
          writeQuickQuoteStep(userEmail, 3);
          setIsQuotationReady(true);
          setCurrentStep(3);
          return;
        }

        maxVersionInChain ??= await fetchMaxVersionForQuote(
          String(data.quote_id),
        );
        if (cancelled) return;

        // Prefer Supabase snapshot when not recovering mid-edit (F5).
        // Local draft restore is gated in QuotationDraftEditor via shouldUseLocalQuoteDraft.
        try {
          if (!shouldUseLocalQuoteDraft(userEmail, editingQuoteId)) {
            await deleteDraft(makeDraftKey(userEmail, editingQuoteId));
          }
        } catch {
          // IndexedDB unavailable — continue with server data
        }
        if (cancelled) return;

        const serverProjectData = (data.project_data ?? {}) as Record<string, unknown>;
        let projectDataToUse = serverProjectData;

        const quoteMetaForTerms = projectDataToUse.quoteMeta as
          | { deliveryAddress?: string }
          | undefined;
        projectDataToUse = {
          ...projectDataToUse,
          termsContent: migrateTermsContentToCurrent(
            projectDataToUse.termsContent as SavedTermsContent | undefined,
            quoteMetaForTerms?.deliveryAddress,
          ),
        };

        // 明細（bwf_quote_item）也在進編輯器前載好，頁面只會有一個 Loading。
        // project_data 仍有舊版 items 時維持原行為：不預載，由編輯器直接沿用。
        const loadedQuoteUuid = data.id as string;
        const legacyHasItems =
          itemsFromLegacyProjectData(projectDataToUse as Record<string, unknown>).length > 0;
        if (!legacyHasItems) {
          setIsLoadingQuoteItems(true);
          try {
            const rows = await loadQuoteItems(loadedQuoteUuid);
            if (cancelled) return;
            const prefetched = rows.length
              ? await hydrateQuoteItemProductLinks(
                  rows.map(normalizeLegacyQuoteItemProductId),
                )
              : [];
            if (cancelled) return;
            setPrefetchedQuoteItems({ quoteUuid: loadedQuoteUuid, items: prefetched });
          } catch (itemsError) {
            if (cancelled) return;
            console.warn('[QuickQuoteView] loadQuoteItems failed', itemsError);
            // 不要因為明細載入失敗就開不到報價單：讓編輯器顯示「重新載入明細」。
            setPrefetchedQuoteItems({ quoteUuid: loadedQuoteUuid, items: null });
          } finally {
            if (!cancelled) setIsLoadingQuoteItems(false);
          }
        } else {
          setPrefetchedQuoteItems(null);
        }

        const savedFormData = projectDataToUse.formData as
          | (Partial<QuoteFormData> & { projectName?: string; pitchingCode?: string })
          | undefined;

        // Hydrate form data from saved state
        if (savedFormData) {
          const pitchingId =
            savedFormData.pmsPitchingId ||
            (typeof data.bwf_pitching_id === 'string' ? data.bwf_pitching_id : undefined);
          const projectId =
            savedFormData.pmsProjectId ||
            (typeof data.bwf_project_id === 'string' ? data.bwf_project_id : undefined);
          const quoteIdCode =
            typeof data.quote_id === 'string' ? data.quote_id.trim() : '';
          const normalized = normalizeQuoteFormData({
            ...savedFormData,
            // In-memory 報價單號 from quote_id only (column/JSON code dropped).
            quoteId:
              quoteIdCode ||
              savedFormData.quoteId ||
              savedFormData.pitchingCode ||
              savedFormData.projectName ||
              '',
            pmsPitchingId: pitchingId,
            pmsProjectId: projectId,
          });
          setFormData(normalized);
          if (pitchingId || projectId) {
            const label = [normalized.quoteId, normalized.clientName]
              .filter(Boolean)
              .join(' · ');
            setSelectedPitchingLabel(label || pitchingId || projectId || null);
          } else {
            setSelectedPitchingLabel(null);
          }
        }

        const loadedQuoteId =
          typeof data.quote_id === 'string' ? data.quote_id.trim() : '';
        setLoadedQuoteData({
          quoteId: loadedQuoteId,
          version: data.version as string,
          status: data.status as string,
          totalAmount: data.total_amount as number,
          submitter: data.submitter as string,
          projectData: projectDataToUse,
          bwfPitchingId: (data.bwf_pitching_id as string | null) ?? null,
          bwfProjectId: (data.bwf_project_id as string | null) ?? null,
          quoteUuid: data.id as string,
          maxVersionInChain,
          createdAt: (data.created_at as string | null) ?? null,
          modifiedDate: (data.modified_date as string | null) ?? null,
        });
        // Keep wizard formData.quoteId aligned with DB quote_id even when
        // project_data.formData omitted the code (stripped on prior 版本審核).
        if (loadedQuoteId && !isLegacyQFormatQuoteId(loadedQuoteId)) {
          setFormData((prev) =>
            prev.quoteId.trim() === loadedQuoteId
              ? prev
              : { ...prev, quoteId: loadedQuoteId },
          );
        }
        setResolvedQuoteKey(loadKey);
        writeQuickQuoteStep(userEmail, 3);

        // Skip directly to editor step
        setIsQuotationReady(true);
        setCurrentStep(3);
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '無法載入報價單';
        toast.error('載入失敗', { description: message });
        setResolvedQuoteKey(loadKey);
        setLoadedQuoteData(null);
        setQuoteLoadError(message);
        setIsQuotationReady(false);
        setCurrentStep(1);
      }
    };

    void loadQuote();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAssignEditingQuoteId is only used for legacy draft migration
  }, [editingQuoteId, editingQuoteUuid, editingQuoteVersion, quoteRequestKey, resolvedQuoteKey, userEmail, authLoading]);

  // 快速報價：選定 Pitching 後直接開空白編輯器。複製報價單會先載入原單。
  // 參考過往報價停在配對頁，不在這裡開編輯器。
  const preparingEditorRef = useRef(false);
  useEffect(() => {
    if (entry === 'reference') return;
    if (currentStep === 3 || pmsDefaultsPendingRef.current || isLoadingPmsDefaults || isLoadingCopy || quoteLoadError) return;
    if (editingQuoteId || loadedQuoteData) return;
    if (!formData.pmsPitchingId && !formData.pmsProjectId) return;
    if (!formData.quoteId.trim() || preparingEditorRef.current) return;
    const sourceUuid = readQuickQuoteCopyFrom(userEmail);
    if (!sourceUuid) {
      enterEditorStep();
      return;
    }
    preparingEditorRef.current = true;
    const prepare = async () => {
      try {
        setIsLoadingCopy(true);
        setCopyPayload(await loadQuoteCopyPayload(sourceUuid));
        enterEditorStep();
      } catch (error) {
        const message = error instanceof Error ? error.message : '請重新選擇 Pitching';
        setQuoteLoadError(message);
        toast.error('無法開啟報價編輯', { description: message });
      } finally {
        preparingEditorRef.current = false;
        setIsLoadingCopy(false);
      }
    };
    void prepare();
  }, [entry, currentStep, isLoadingPmsDefaults, isLoadingCopy, quoteLoadError, editingQuoteId, loadedQuoteData, formData.pmsPitchingId, formData.pmsProjectId, formData.quoteId, enterEditorStep, userEmail]);

  const copyReferenceQuote = useCallback(async (quoteUuid: string) => {
    const payload = await loadQuoteCopyPayload(quoteUuid);
    setCopyPayload(payload);
    setReferenceCopyActive(true);
    enterEditorStep({ assignEditingId: false });
  }, [enterEditorStep]);

  // A restored step can reach the editor before AppShell supplies its quote id.
  // Once an existing version is requested, wait for that version's snapshot
  // even if the session is already on step 3.
  const waitingForListCopy =
    Boolean(copyFromUuid) &&
    !loadedQuoteData &&
    !quoteLoadError &&
    currentStep !== 3 &&
    Boolean(formData.pmsPitchingId || formData.pmsProjectId);
  const waitingToOpenBlankEditor =
    entry !== 'reference' &&
    !editingQuoteId &&
    !loadedQuoteData &&
    !quoteLoadError &&
    currentStep !== 3 &&
    Boolean(formData.pmsPitchingId?.trim() || formData.pmsProjectId?.trim());
  const blockUiForInitialLoad =
    quoteRequestPending || quoteSessionResumePending || waitingForListCopy || waitingToOpenBlankEditor ||
    ((isLoadingCopy || isLoadingPmsDefaults) && !loadedQuoteData && !quoteLoadError && currentStep !== 3);
  if (blockUiForInitialLoad) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div role="status" className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="font-mono-data text-xs text-muted-foreground">
            {isLoadingCopy
              ? '載入複製內容中...'
              : isLoadingQuoteItems
                ? '載入報價內容中...'
                : '載入報價單中...'}
          </span>
        </div>
      </div>
    );
  }

  if (quoteLoadError && !loadedQuoteData) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h2 className="font-display text-lg font-bold text-foreground">無法開啟報價單</h2>
          <p className="font-body text-sm text-muted-foreground leading-relaxed">
            {quoteLoadError}
            {editingQuoteId ? (
              <>
                <br />
                <span className="font-mono-data text-xs text-foreground/80">
                  {editingQuoteId}
                </span>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => { onClearEditingQuote?.(); resetToNewQuote(); }}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 font-body text-sm font-semibold text-primary-foreground"
          >
            返回報價單一覽
          </button>
        </div>
      </div>
    );
  }

  // Gate: pitching selection is the only first step for in-app creation.
  // PMS deep links / editing existing quotes skip this and go to the form.
  const showPitchingGate =
    !editingQuoteId &&
    !loadedQuoteData &&
    !formData.pmsPitchingId?.trim() &&
    !formData.pmsProjectId?.trim();

  if (showPitchingGate) {
    return (
      <PmsPitchingGate
        onSelect={handleSelectPitching}
        title={entry === 'reference' ? '參考過往報價' : copyFromUuid ? '複製報價單' : undefined}
        subtitle={
          entry === 'reference'
            ? '選擇現有 Pitching，再按類別、金額和尺寸配對過往報價'
            : copyFromUuid
              ? '選擇 PMS Pitching 後，將帶入新專案資料並複製原報價的產品內容與條款'
              : undefined
        }
        rowHint={entry === 'reference' ? '點擊任一列即可配對過往報價' : undefined}
      />
    );
  }

  const showReferenceSetup =
    entry === 'reference' &&
    !editingQuoteId &&
    !loadedQuoteData &&
    Boolean(formData.pmsPitchingId?.trim() || formData.pmsProjectId?.trim());

  return (
    <>
    <div className={cn('h-full min-h-0 bg-background', currentStep === 3 && 'flex flex-col overflow-hidden')}>
      {showReferenceSetup ? (
        <div className={cn('h-full min-h-0', currentStep === 3 && 'hidden')}>
          <QuoteReferenceSetup
            pitchingId={formData.pmsPitchingId?.trim() || null}
            pitchingLabel={selectedPitchingLabel}
            initialCustomerType={boundCustomerType}
            estimatedIncome={boundBudget}
            industries={formData.clientIndustry}
            industryOptions={industryOptions}
            categoryOptions={level1CategoryOptions}
            categoriesLoading={level1CategoriesLoading}
            workPeriodOptions={WORK_PERIODS}
            excludeQuoteId={editingQuoteUuid}
            onChangePitching={handleChangePitching}
            onCopyQuote={copyReferenceQuote}
          />
        </div>
      ) : null}
      {currentStep === 3 && (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col">
          <div className="tab-panel-in flex min-h-0 flex-1 flex-col">
            <QuotationDraftEditor
              formData={formData}
              onFormDataChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
              industryOptions={industryOptions}
              serviceScopeOptions={level1CategoryOptions}
              workPeriodOptions={WORK_PERIODS}
              userEmail={userEmail}
              onOpenPdfPreview={setPdfPreviewData}
              initialCopyPayload={copyPayload}
              forceNewQuote={Boolean(copyPayload && (copyFromUuid || referenceCopyActive))}
              onBack={() => {
                if (referenceCopyActive && !loadedQuoteData) {
                  setCopyPayload(null);
                  setReferenceCopyActive(false);
                  setCurrentStep(1);
                  setIsQuotationReady(false);
                  if (entry !== 'reference') writeQuickQuoteStep(userEmail, 1);
                  return;
                }
                onClearEditingQuote?.();
                resetToNewQuote();
              }}
              onQuotePersisted={(result) => {
                writeQuickQuoteCopyFrom(userEmail, null);
                setCopyPayload(null);
                setReferenceCopyActive(false);
                setLoadedQuoteData((prev) => {
                  const prevMax = prev?.maxVersionInChain || prev?.version || '';
                  const nextMax =
                    compareQuoteVersion(result.version, prevMax) >= 0
                      ? result.version
                      : prevMax || result.version;
                  return {
                    quoteId: result.quoteId,
                    quoteUuid: result.quoteUuid,
                    version: result.version,
                    status: result.status || prev?.status || '待審核',
                    totalAmount: result.totalAmount,
                    submitter: prev?.submitter ?? formData.projectManager,
                    projectData: result.projectData,
                    bwfPitchingId:
                      prev?.bwfPitchingId ?? formData.pmsPitchingId ?? null,
                    bwfProjectId:
                      prev?.bwfProjectId ?? formData.pmsProjectId ?? null,
                    maxVersionInChain: nextMax,
                  };
                });
                // Mark this version as already loaded so parent id sync does not re-fetch
                // an older uuid and wipe the just-submitted editor state.
                setResolvedQuoteKey(`${result.quoteId}::${result.quoteUuid}`);
                onEditingQuotePersisted?.(result.quoteId, result.quoteUuid, result.version);
              }}
              existingQuote={loadedQuoteData || undefined}
              initialQuoteItems={
                prefetchedQuoteItems &&
                prefetchedQuoteItems.quoteUuid === loadedQuoteData?.quoteUuid
                  ? prefetchedQuoteItems.items
                  : undefined
              }
              draftQuoteId={loadedQuoteData ? null : editingQuoteId}
            />
          </div>
        </div>
      )}
    </div>

      {pdfPreviewData && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
              <div className="text-white">Loading PDF Preview...</div>
            </div>
          }
        >
          <LazyQuotationPDFPreviewModal
            open
            onClose={() => setPdfPreviewData(null)}
            data={pdfPreviewData}
            allowCompanyChop
          />
        </Suspense>
      )}
    </>
  );
}
