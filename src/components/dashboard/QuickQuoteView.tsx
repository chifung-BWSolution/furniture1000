import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Check, ChevronRight, ChevronLeft, Sparkles, Loader2, Search } from 'lucide-react';
import { QuotationDraftEditor } from '@/components/dashboard/QuotationDraftEditor';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { deleteDraft, loadDraft, makeDraftKey } from '@/lib/draftStore';
import { useAuth } from '@/contexts/AuthProvider';
import type { QuotationPDFData } from '@/types/quotation-pdf';
import {
  quickQuoteFormKey,
  quickQuoteStepKey,
  readQuickQuoteCopyFrom,
  readQuickQuoteStep,
  resetQuickQuoteSessionStorage,
  shouldUseLocalQuoteDraft,
  writeQuickQuoteCopyFrom,
  writeQuickQuoteEditingId,
} from '@/lib/quickQuoteSession';
import { loadQuoteCopyPayload, type QuoteCopyPayload } from '@/lib/quoteCopy';
import {
  compareQuoteVersion,
  maxQuoteVersion,
  bumpQuoteVersion,
  displayQuoteVersion,
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
import { filterIndustriesBySearch } from '@/lib/clientIndustryCatalog';
import { PmsPitchingGate } from '@/components/dashboard/PmsPitchingGate';
import { fetchLevel1CategoryOptions } from '@/lib/productCategoryOptions';
import { generateQuoteId } from '@/lib/quoteRoutes';

const LazyQuotationPDFPreviewModal = lazy(() =>
  import('@/components/dashboard/QuotationPDFPreview').then((mod) => ({
    default: mod.QuotationPDFPreviewModal,
  })),
);

function getNextQuoteVersion(version: string): string {
  return bumpQuoteVersion(version);
}

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
  // Step 2
  serviceScope: string[];
  officeArea: string;
  headcount: string;
  // Step 3
  workPeriod: string;
  validityDays: string;
  remarks: string;
}

/** Fallback when not opened from a PMS pitching (no industry catalog loaded). */
const FALLBACK_INDUSTRIES = ['餐飲', '辦公', '零售', '醫療', '教育', '酒店', '住宅', '其他'];
const OFFICE_FURNITURE_GRADE_LABEL = '辦公室傢俬級別';
const QUOTATION_TYPES = ['國際品牌', '本地品牌', '基本傢俬'];

const OFFICE_FURNITURE_CATEGORY_LABEL = '辦公室傢俬類別';

const WORK_PERIODS = [
  '即時 3-5天內 - 緊急',
  '7天內 - 加急',
  '7-14天內',
  '3-4星期內',
  '1-3個月內',
  '3-6個月內',
  '1年內',
];

const STEPS = [
  { id: 1, label: '基本資訊' },
  { id: 2, label: '傢俬類別' },
  { id: 3, label: '工期時間' },
  { id: 4, label: '生成報價單' },
];

interface QuickQuoteViewProps {
  editingQuoteId?: string | null;
  /** When set, open this specific version row (bwf_quote.id). */
  editingQuoteUuid?: string | null;
  /** When set without uuid, open this version (e.g. v2 from /quote/Q…V2). */
  editingQuoteVersion?: string | null;
  onClearEditingQuote?: () => void;
  /** Keep AppShell editing ids in sync after 版本審核 (new version row). */
  onEditingQuotePersisted?: (quoteId: string, quoteUuid: string, version?: string) => void;
  /** Assign a quote id when entering step 4 for a new draft (updates URL + session). */
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
function readUrlPrefill(): {
  form: QuoteFormData;
  label: string | null;
  applied: boolean;
} {
  if (typeof window === 'undefined') {
    return { form: DEFAULT_FORM_DATA(), label: null, applied: false };
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
  const initialUrlPrefillRef = useRef(readUrlPrefill());
  const pmsPrefillAppliedRef = useRef(initialUrlPrefillRef.current.applied);

  const [currentStep, setCurrentStep] = useState(1);
  const [isQuotationReady, setIsQuotationReady] = useState(false);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(quickQuoteStepKey(userEmail), String(currentStep));
  }, [currentStep, userEmail]);

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
  } | null>(null);
  const [formData, setFormData] = useState<QuoteFormData>(
    () => initialUrlPrefillRef.current.form,
  );
  const [pdfPreviewData, setPdfPreviewData] = useState<QuotationPDFData | null>(null);
  const [copyPayload, setCopyPayload] = useState<QuoteCopyPayload | null>(null);
  const [isLoadingCopy, setIsLoadingCopy] = useState(false);
  const assignedDraftQuoteIdRef = useRef<string | null>(null);

  const enterStep4 = useCallback(
    (opts?: { quoteId?: string }) => {
      setIsQuotationReady(true);
      setCurrentStep(4);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(quickQuoteStepKey(userEmail), '4');
      }

      const nextQuoteId =
        opts?.quoteId ||
        editingQuoteId ||
        assignedDraftQuoteIdRef.current ||
        generateQuoteId();

      if (!editingQuoteId && !loadedQuoteData) {
        assignedDraftQuoteIdRef.current = nextQuoteId;
        writeQuickQuoteEditingId(userEmail, nextQuoteId);
        onAssignEditingQuoteId?.(nextQuoteId);
      }
    },
    [editingQuoteId, loadedQuoteData, onAssignEditingQuoteId, userEmail],
  );
  const copyFromUuid = readQuickQuoteCopyFrom(userEmail);
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
  const loadedQuoteIdRef = useRef<string | null>(null);
  const pmsDefaultsLoadedForRef = useRef<string | null>(null);

  // PMS SSO / deep-link prefill: /quote/quick?pmsPitchingId=... and/or pmsProjectId=...
  const applyPmsPrefillFromUrl = useCallback(() => {
    if (typeof window === 'undefined') return false;
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
  }, []);

  useEffect(() => {
    if (editingQuoteId) return;
    if (pmsPrefillAppliedRef.current) return;
    applyPmsPrefillFromUrl();
  }, [editingQuoteId, freshSessionKey, applyPmsPrefillFromUrl]);

  useEffect(() => {
    if (authLoading || editingQuoteId || freshSessionKey > 0) return;
    if (!userEmail) return;
    if (sessionRestoredRef.current) return;
    if (pmsPrefillAppliedRef.current) return;

    sessionRestoredRef.current = true;
    const step = readQuickQuoteStep(userEmail);
    setCurrentStep(step);
    setIsQuotationReady(step === 4);
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
  }, [authLoading, userEmail, editingQuoteId, freshSessionKey]);

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

  const filteredIndustryOptions = useMemo(
    () =>
      filterIndustriesBySearch(
        industryOptions,
        industrySearchQuery,
        formData.clientIndustry,
      ),
    [industryOptions, industrySearchQuery, formData.clientIndustry],
  );

  const resetToNewQuote = useCallback(() => {
    setCurrentStep(1);
    setIsQuotationReady(false);
    setLoadedQuoteData(null);
    setCopyPayload(null);
    setFormData(DEFAULT_FORM_DATA());
    setSelectedPitchingLabel(null);
    setErrors({});
    setIndustrySearchQuery('');
    pmsDefaultsLoadedForRef.current = null;
    resetQuickQuoteSessionStorage(userEmail, { keepCopyFrom: true });
    deleteDraft(makeDraftKey(userEmail, 'NEW')).catch(() => {});
  }, [userEmail]);

  const handleSelectPitching = useCallback((item: PmsPitchingListItem) => {
    setSelectedPitchingLabel(formatPmsPitchingLabel(item));
    pmsDefaultsLoadedForRef.current = null;
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
    resetToNewQuote();
    // Re-apply PMS query params after wiping local session (deep-link / SSO landing)
    pmsPrefillAppliedRef.current = false;
    pmsDefaultsLoadedForRef.current = null;
    applyPmsPrefillFromUrl();
  }, [freshSessionKey, resetToNewQuote, applyPmsPrefillFromUrl]);

  // Load PMS industry catalog always; resolve project↔pitching + enrich defaults
  useEffect(() => {
    if (editingQuoteId) return;
    const pitchingId = formData.pmsPitchingId?.trim() || '';
    const projectId = formData.pmsProjectId?.trim() || '';
    const cacheKey = pitchingId || projectId ? `${pitchingId}|${projectId}` : '__catalog__';
    if (pmsDefaultsLoadedForRef.current === cacheKey) return;
    // If we already loaded full pitching defaults, don't re-fetch catalog-only
    if (
      !pitchingId &&
      !projectId &&
      pmsDefaultsLoadedForRef.current &&
      pmsDefaultsLoadedForRef.current !== '__catalog__'
    ) {
      return;
    }

    let cancelled = false;
    pmsDefaultsLoadedForRef.current = cacheKey;

    (async () => {
      const defaults = await fetchPmsPitchingQuoteDefaults(
        pitchingId || projectId
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

      if (!pitchingId && !projectId) return;

      setFormData((prev) => ({
        ...prev,
        // Persist resolved cross-link ids (project → pitching always; pitching → project if any)
        pmsPitchingId: defaults.pitching_id || prev.pmsPitchingId,
        pmsProjectId: defaults.project_id || prev.pmsProjectId || undefined,
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
      }));

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
    })();

    return () => {
      cancelled = true;
    };
  }, [editingQuoteId, formData.pmsPitchingId, formData.pmsProjectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(quickQuoteFormKey(userEmail), JSON.stringify(formData));
    } catch {
      // ignore
    }
  }, [formData, userEmail]);

  // Load existing quote when editingQuoteId is provided.
  // Important: do NOT clear loadedQuoteData when editingQuoteId is null — a brand-new
  // quote may have just been persisted via 版本審核 while AppShell id is still catching up.
  // Also keep onClearEditingQuote out of deps (parent often passes an inline fn).
  useEffect(() => {
    if (authLoading) return;
    if (!editingQuoteId) return;

    const loadKey = `${editingQuoteId}::${editingQuoteUuid || editingQuoteVersion || 'latest'}`;
    if (loadedQuoteIdRef.current === loadKey) return;

    const loadQuote = async () => {
      setIsLoadingQuote(true);
      try {
        let data: Record<string, unknown> | null = null;

        if (editingQuoteUuid) {
          const { data: row, error } = await supabase
            .from('bwf_quote')
            .select('*')
            .eq('id', editingQuoteUuid)
            .maybeSingle();
          if (error) throw error;
          data = row;
        } else if (editingQuoteVersion) {
          const { data: row, error } = await supabase
            .from('bwf_quote')
            .select('*')
            .eq('quote_id', editingQuoteId)
            .eq('version', editingQuoteVersion)
            .maybeSingle();
          if (error) throw error;
          data = row;
        } else {
          const { data: rows, error } = await supabase
            .from('bwf_quote')
            .select('*')
            .eq('quote_id', editingQuoteId)
            .order('modified_date', { ascending: false, nullsFirst: false })
            .limit(1);
          if (error) throw error;
          data = rows?.[0] ?? null;
        }

        if (!data) {
          const savedStep = readQuickQuoteStep(userEmail);
          const draftKey = makeDraftKey(userEmail, editingQuoteId);
          let hasLocalDraft = false;
          try {
            hasLocalDraft = Boolean(await loadDraft(draftKey));
          } catch {
            hasLocalDraft = false;
          }
          if (savedStep === 4 && hasLocalDraft) {
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
              }
            } catch {
              // ignore
            }
            assignedDraftQuoteIdRef.current = editingQuoteId;
            loadedQuoteIdRef.current = loadKey;
            setIsQuotationReady(true);
            setCurrentStep(4);
            return;
          }
          throw new Error('報價單不存在');
        }

        const maxVersionInChain = await fetchMaxVersionForQuote(
          String(data.quote_id),
        );

        // Prefer Supabase snapshot when not recovering mid-edit (F5).
        // Local draft restore is gated in QuotationDraftEditor via shouldUseLocalQuoteDraft.
        try {
          if (!shouldUseLocalQuoteDraft(userEmail, editingQuoteId)) {
            await deleteDraft(makeDraftKey(userEmail, editingQuoteId));
          }
        } catch {
          // IndexedDB unavailable — continue with server data
        }

        const serverProjectData = data.project_data as Record<string, unknown>;
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

        setLoadedQuoteData({
          quoteId: data.quote_id as string,
          version: data.version as string,
          status: data.status as string,
          totalAmount: data.total_amount as number,
          submitter: data.submitter as string,
          projectData: projectDataToUse,
          bwfPitchingId: (data.bwf_pitching_id as string | null) ?? null,
          bwfProjectId: (data.bwf_project_id as string | null) ?? null,
          quoteUuid: data.id as string,
          maxVersionInChain,
        });
        loadedQuoteIdRef.current = loadKey;

        // Skip directly to step 4 editor
        setIsQuotationReady(true);
        setCurrentStep(4);
      } catch (err: unknown) {
        loadedQuoteIdRef.current = null;
        const message = err instanceof Error ? err.message : '無法載入報價單';
        toast.error('載入失敗', { description: message });
        // Go back to list
        onClearEditingQuote?.();
      } finally {
        setIsLoadingQuote(false);
      }
    };

    loadQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClearEditingQuote is intentionally unstable from parent
  }, [editingQuoteId, editingQuoteUuid, editingQuoteVersion, userEmail, authLoading]);

  const updateField = (field: keyof QuoteFormData, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const toggleTag = (field: 'clientIndustry' | 'quotationType' | 'serviceScope', tag: string) => {
    setFormData((prev) => {
      const current = prev[field];
      const updated = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return { ...prev, [field]: updated };
    });
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const validateStep1 = (): boolean => {
    const newErrors: Partial<Record<keyof QuoteFormData, string>> = {};

    if (!formData.projectManager.trim()) {
      newErrors.projectManager = '請填寫項目經理姓名';
    }
    if (!formData.quoteId.trim()) {
      newErrors.quoteId = '請先選擇 PMS Pitching（報價單號）';
    }
    if (!formData.clientName.trim()) {
      newErrors.clientName = '請填寫公司名稱';
    }
    if (!formData.clientPhone.trim()) {
      newErrors.clientPhone = '請填寫客戶電話';
    }
    if (formData.clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.clientEmail)) {
      newErrors.clientEmail = '請輸入有效的電郵地址';
    }
    if (formData.clientIndustry.length === 0) {
      newErrors.clientIndustry = '請選擇至少一個客戶產業';
    }
    if (formData.quotationType.length === 0) {
      newErrors.quotationType = `請選擇至少一個${OFFICE_FURNITURE_GRADE_LABEL}`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = (): boolean => {
    const newErrors: Partial<Record<keyof QuoteFormData, string>> = {};

    if (formData.serviceScope.length === 0) {
      newErrors.serviceScope = `請選擇至少一個${OFFICE_FURNITURE_CATEGORY_LABEL}`;
    }


    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = (): boolean => {
    const newErrors: Partial<Record<keyof QuoteFormData, string>> = {};

    if (!formData.validityDays.trim()) {
      newErrors.validityDays = '請填寫有效期限';
    } else if (!/^\d+$/.test(formData.validityDays.trim())) {
      newErrors.validityDays = '請輸入有效數字';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    if (currentStep === 1 && validateStep1()) {
      setCurrentStep(2);
    } else if (currentStep === 2 && validateStep2()) {
      setCurrentStep(3);
    } else if (currentStep === 3 && validateStep3()) {
      const sourceUuid = readQuickQuoteCopyFrom(userEmail);
      if (sourceUuid) {
        setIsLoadingCopy(true);
        try {
          const payload = await loadQuoteCopyPayload(sourceUuid);
          setCopyPayload(payload);
          enterStep4();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '無法載入來源報價內容';
          toast.error('複製失敗', { description: message });
        } finally {
          setIsLoadingCopy(false);
        }
      } else {
        setCopyPayload(null);
        enterStep4();
      }
    }
  };

  // Loading state for fetching an existing quote
  if (isLoadingQuote || isLoadingCopy) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="font-mono-data text-xs text-muted-foreground">
            {isLoadingCopy ? '載入複製內容中...' : '載入報價單中...'}
          </span>
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
        title={copyFromUuid ? '複製報價單' : undefined}
        subtitle={
          copyFromUuid
            ? '選擇 PMS Pitching 後，將帶入新專案資料並複製原報價的產品內容與條款'
            : undefined
        }
      />
    );
  }

  return (
    <>
    <div className={cn('h-full overflow-y-auto bg-background', currentStep === 4 ? 'px-3 py-5' : 'p-5')}>
      <div className={cn('mx-auto', currentStep === 4 ? 'w-full max-w-none' : 'max-w-3xl')}>
        {/* Header */}
        <div className="mb-8">
          {currentStep === 4 ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (loadedQuoteData) {
                    setLoadedQuoteData(null);
                    onClearEditingQuote?.();
                  } else {
                    setCurrentStep(3);
                  }
                }}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <ChevronLeft className="h-4 w-4" />
                上一步
              </button>
              <h1 className="shrink-0 font-display text-2xl font-bold tracking-tight text-foreground">
                報價單草稿編輯
              </h1>
              {loadedQuoteData && (
                <p className="ml-6 font-body text-sm text-muted-foreground lg:ml-16">
                  <span className="font-mono-data text-xs tracking-wider text-primary">
                    {loadedQuoteData.quoteId ||
                      formData.quoteId ||
                      '—'}
                  </span>
                  <span className="mx-2 text-border">·</span>
                  目前版本{' '}
                  <span className="font-semibold">
                    {displayQuoteVersion(loadedQuoteData.version)}
                  </span>
                  <span className="mx-2 text-border">·</span>
                  送出新版本將為{' '}
                  <span className="font-semibold text-primary">
                    {getNextQuoteVersion(
                      loadedQuoteData.maxVersionInChain ||
                        loadedQuoteData.version,
                    )}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                {copyFromUuid ? '複製報價單' : '建立新報價單'}
              </h1>
              <p className="mt-1 font-body text-sm text-muted-foreground">
                {copyFromUuid
                  ? '確認新專案資料後，將複製原報價的產品內容與條款'
                  : '確認並補齊專案資料後生成報價'}
              </p>
            </>
          )}
        </div>

        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => {
              const isDisabled = step.id === 4 && !isQuotationReady;
              const isClickable = !isDisabled && step.id !== currentStep && (step.id < currentStep || (step.id === 4 && isQuotationReady));
              return (
              <div key={step.id} className="flex flex-1 items-center">
                <div
                  className={cn('flex items-center gap-3', isClickable && 'cursor-pointer')}
                  onClick={() => {
                    if (isClickable) setCurrentStep(step.id);
                  }}
                >
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all',
                      isDisabled
                        ? 'border-border/40 bg-muted/30 text-muted-foreground/40 cursor-not-allowed'
                        : currentStep === step.id
                        ? 'border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                        : currentStep > step.id
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-border bg-card text-muted-foreground'
                    )}
                  >
                    {currentStep > step.id ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      step.id
                    )}
                  </div>
                  <span
                    className={cn(
                      'font-body text-sm font-medium whitespace-nowrap',
                      isDisabled
                        ? 'text-muted-foreground/40'
                        : currentStep === step.id
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    {step.label}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={cn(
                      'mx-4 h-[2px] flex-1 rounded-full transition-colors',
                      currentStep > step.id ? 'bg-emerald-500' : 'bg-border'
                    )}
                  />
                )}
              </div>
              );
            })}
          </div>
        </div>

        {/* Form Card - only for steps 1-3 */}
        {currentStep < 4 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
          {currentStep === 1 && (
            <div className="space-y-6">
              {/* Selected PMS Pitching (chosen on gate / deep-link) */}
              <div className="flex items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-body text-[11px] font-medium uppercase tracking-wide text-primary/80">
                    PMS Pitching
                  </div>
                  <div className="mt-0.5 truncate font-mono-data text-sm font-semibold text-foreground">
                    {selectedPitchingLabel ||
                      formData.quoteId ||
                      formData.pmsPitchingId ||
                      '—'}
                  </div>
                </div>
                {!editingQuoteId && !loadedQuoteData ? (
                  <button
                    type="button"
                    onClick={handleChangePitching}
                    className="shrink-0 font-body text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    更換
                  </button>
                ) : null}
              </div>

              {/* Company (fixed) */}
              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                  選擇公司 <span className="text-red-500">*</span>
                </label>
                <div className="rounded-lg border border-border bg-muted/50 px-4 py-2.5 font-mono-data text-sm text-foreground">
                  Branding Works Design Ltd
                </div>
              </div>

              {/* Two column grid */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {/* Project Manager */}
                <div>
                  <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                    項目經理姓名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.projectManager}
                    onChange={(e) => updateField('projectManager', e.target.value)}
                    placeholder="您的姓名"
                    className={cn(
                      'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                      errors.projectManager ? 'border-red-500' : 'border-border'
                    )}
                  />
                  {errors.projectManager && (
                    <p className="mt-1 text-xs text-red-500">{errors.projectManager}</p>
                  )}
                </div>

                {/* Client company */}
                <div>
                  <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                    公司名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.clientName}
                    onChange={(e) => updateField('clientName', e.target.value)}
                    placeholder="客戶公司名稱"
                    className={cn(
                      'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                      errors.clientName ? 'border-red-500' : 'border-border'
                    )}
                  />
                  {errors.clientName && (
                    <p className="mt-1 text-xs text-red-500">{errors.clientName}</p>
                  )}
                </div>
              </div>

              {/* Contact person — defaults from PMS customers.customer_name */}
              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                  客戶名稱
                </label>
                <input
                  type="text"
                  value={formData.clientContactName}
                  onChange={(e) => updateField('clientContactName', e.target.value)}
                  placeholder="聯絡人姓名"
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Pitching code — read-only 報價單號 from PMS */}
              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                  報價單號 <span className="text-red-500">*</span>
                </label>
                <div
                  className={cn(
                    'w-full rounded-lg border bg-muted/40 px-4 py-2.5 font-mono-data text-sm text-foreground',
                    errors.quoteId ? 'border-red-500' : 'border-border',
                  )}
                >
                  {formData.quoteId || '—'}
                </div>
                {errors.quoteId && (
                  <p className="mt-1 text-xs text-red-500">{errors.quoteId}</p>
                )}
              </div>

              {/* Client Phone & Email */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                    客戶電話 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={formData.clientPhone}
                    onChange={(e) => {
                      // Allow only digits, spaces, and + for phone format
                      const val = e.target.value.replace(/[^0-9+\s]/g, '');
                      updateField('clientPhone', val);
                    }}
                    placeholder="+852 XXXX XXXX"
                    className={cn(
                      'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                      errors.clientPhone ? 'border-red-500' : 'border-border'
                    )}
                  />
                  {errors.clientPhone && (
                    <p className="mt-1 text-xs text-red-500">{errors.clientPhone}</p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                    客戶電郵
                  </label>
                  <input
                    type="email"
                    value={formData.clientEmail}
                    onChange={(e) => updateField('clientEmail', e.target.value)}
                    placeholder="client@example.com"
                    className={cn(
                      'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                      errors.clientEmail ? 'border-red-500' : 'border-border'
                    )}
                  />
                  {errors.clientEmail && (
                    <p className="mt-1 text-xs text-red-500">{errors.clientEmail}</p>
                  )}
                </div>
              </div>

              {/* Client Industry Tags — PMS nos_customer_tags (collection industry) when available */}
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="font-body text-sm font-medium text-foreground">
                    客戶產業 <span className="text-red-500">*</span>
                  </label>
                  <div className="relative w-full min-w-[200px] max-w-xs sm:w-64">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      value={industrySearchQuery}
                      onChange={(e) => setIndustrySearchQuery(e.target.value)}
                      placeholder="搜尋產業（中 / 英）"
                      aria-label="搜尋客戶產業"
                      className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {filteredIndustryOptions.length === 0 ? (
                    <p className="font-body text-sm text-muted-foreground">
                      找不到符合「{industrySearchQuery.trim()}」的產業
                    </p>
                  ) : (
                    filteredIndustryOptions.map((industry) => (
                    <button
                      key={industry}
                      type="button"
                      onClick={() => toggleTag('clientIndustry', industry)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 font-body text-sm font-medium transition-all',
                        formData.clientIndustry.includes(industry)
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                      )}
                    >
                      {industry}
                    </button>
                    ))
                  )}
                  {pmsIndustryCatalog.length === 0 &&
                    formData.clientIndustry.includes('其他') && (
                    <input
                      type="text"
                      value={formData.clientIndustryOther}
                      onChange={(e) => updateField('clientIndustryOther', e.target.value)}
                      placeholder="請填寫產業"
                      className="border-b border-border bg-transparent px-1 py-1 font-body text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none w-32"
                    />
                  )}
                </div>
                {errors.clientIndustry && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.clientIndustry}</p>
                )}
              </div>

              {/* Office furniture grade */}
              <div>
                <label className="mb-2 block font-body text-sm font-medium text-foreground">
                  {OFFICE_FURNITURE_GRADE_LABEL} <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {QUOTATION_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleTag('quotationType', type)}
                      className={cn(
                        'rounded-full border px-4 py-1.5 font-body text-sm font-medium transition-all',
                        formData.quotationType.includes(type)
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                {errors.quotationType && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.quotationType}</p>
                )}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              {/* Office furniture category */}
              <div>
                <div className="mb-3 flex items-baseline gap-2">
                  <label className="font-body text-sm font-medium text-foreground">
                    {OFFICE_FURNITURE_CATEGORY_LABEL} <span className="text-red-500">*</span>
                  </label>
                  {formData.quotationType.length > 0 && (
                    <span className="font-body text-xs text-muted-foreground">
                      — {formData.quotationType.join('、')}
                    </span>
                  )}
                  <span className="ml-1 font-body text-xs text-muted-foreground">(可多選)</span>
                </div>
                {level1CategoriesLoading ? (
                  <div className="flex items-center gap-2 py-6 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-body text-sm">載入產品分類…</span>
                  </div>
                ) : level1CategoryOptions.length === 0 ? (
                  <p className="font-body text-sm text-muted-foreground">
                    尚未設定產品分類，請至「設定 &gt; 產品分類」新增一級分類。
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {level1CategoryOptions.map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => toggleTag('serviceScope', scope)}
                        className={cn(
                          'flex items-center justify-center rounded-xl border-2 px-4 py-4 font-body text-sm font-semibold transition-all',
                          formData.serviceScope.includes(scope)
                            ? 'border-foreground bg-foreground text-background shadow-lg'
                            : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                        )}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                )}
                {errors.serviceScope && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.serviceScope}</p>
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              {/* Work Period — rectangle pill single-select */}
              <div>
                <label className="mb-2 block font-body text-sm font-medium text-foreground">
                  工期需求
                </label>
                <div className="flex flex-wrap gap-2">
                  {WORK_PERIODS.map((period) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() =>
                        updateField(
                          'workPeriod',
                          formData.workPeriod === period ? '' : period,
                        )
                      }
                      className={cn(
                        'rounded-md border px-4 py-2.5 font-body text-sm font-medium transition-all',
                        formData.workPeriod === period
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                      )}
                    >
                      {period}
                    </button>
                  ))}
                </div>
                {errors.workPeriod && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.workPeriod}</p>
                )}
              </div>

              {/* Validity Period */}
              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                  報價單有效期限 (天) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.validityDays}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    updateField('validityDays', val);
                  }}
                  placeholder="30"
                  className={cn(
                    'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                    errors.validityDays ? 'border-red-500' : 'border-border'
                  )}
                />
                {errors.validityDays && (
                  <p className="mt-1 text-xs text-red-500">{errors.validityDays}</p>
                )}
              </div>

              {/* Remarks */}
              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                  備註
                </label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) => updateField('remarks', e.target.value)}
                  placeholder="請輸入其他特殊需求或備註事項..."
                  rows={4}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              {/* Quotation Summary Card */}
              <div className="rounded-xl border border-[#2A2D3E] bg-[#0F1117] p-5">
                <h4 className="mb-4 font-body text-sm font-semibold text-white/90">
                  📋 報價單摘要
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="block font-body text-xs text-white/50">報價單號</span>
                    <span className="mt-0.5 block font-mono-data text-sm text-white/90 truncate">
                      {formData.quoteId || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-body text-xs text-white/50">公司名稱</span>
                    <span className="mt-0.5 block font-mono-data text-sm text-white/90 truncate">
                      {formData.clientName || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-body text-xs text-white/50">客戶名稱</span>
                    <span className="mt-0.5 block font-mono-data text-sm text-white/90 truncate">
                      {formData.clientContactName || '—'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="block font-body text-xs text-white/50">辦公室傢俬類別</span>
                    <span className="mt-0.5 block font-mono-data text-sm text-white/90">
                      {formData.serviceScope.length > 0
                        ? formData.serviceScope.join('、')
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}



          {/* Footer Actions - only show for steps 1-3 */}
          {currentStep < 4 && (
          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <button
              type="button"
              disabled={currentStep === 1}
              onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 font-body text-sm font-medium transition-colors',
                currentStep === 1
                  ? 'cursor-not-allowed border-border/50 text-muted-foreground/40'
                  : 'border-border text-foreground hover:bg-accent'
              )}
            >
              <ChevronLeft className="h-4 w-4" />
              上一步
            </button>

            {currentStep < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-sm font-medium text-primary-foreground shadow-md shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98]"
              >
                下一步
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-6 py-2.5 font-body text-sm font-semibold text-white shadow-md shadow-orange-500/25 transition-all hover:bg-orange-600 hover:shadow-lg hover:shadow-orange-500/30 active:scale-[0.98]"
              >
                <Sparkles className="h-4 w-4" />
                AI 產生報價
              </button>
            )}
          </div>
          )}
        </div>
        )}

        {/* Step 4: Quotation Draft Editor (full width, outside the form card) */}
        {currentStep === 4 && (
          <div className="mt-6">
            <QuotationDraftEditor
              formData={formData}
              userEmail={userEmail}
              onOpenPdfPreview={setPdfPreviewData}
              initialCopyPayload={copyPayload}
              forceNewQuote={Boolean(copyFromUuid && copyPayload)}
              onBack={() => {
                if (!unsavedGuard.confirmLeave()) return;
                if (loadedQuoteData) {
                  setLoadedQuoteData(null);
                  onClearEditingQuote?.();
                } else {
                  setCurrentStep(3);
                }
              }}
              onQuotePersisted={(result) => {
                writeQuickQuoteCopyFrom(userEmail, null);
                setCopyPayload(null);
                setLoadedQuoteData((prev) => ({
                  quoteId: result.quoteId,
                  quoteUuid: result.quoteUuid,
                  version: result.version,
                  status: '待審核',
                  totalAmount: result.totalAmount,
                  submitter: prev?.submitter ?? formData.projectManager,
                  projectData: result.projectData,
                  bwfPitchingId: prev?.bwfPitchingId ?? formData.pmsPitchingId ?? null,
                  bwfProjectId: prev?.bwfProjectId ?? formData.pmsProjectId ?? null,
                  maxVersionInChain: result.version,
                }));
                // Mark this version as already loaded so parent id sync does not re-fetch
                // an older uuid and wipe the just-submitted editor state.
                loadedQuoteIdRef.current = `${result.quoteId}::${result.quoteUuid}`;
                onEditingQuotePersisted?.(result.quoteId, result.quoteUuid, result.version);
              }}
              existingQuote={loadedQuoteData || undefined}
              draftQuoteId={loadedQuoteData ? null : editingQuoteId}
            />
          </div>
        )}
      </div>
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
          />
        </Suspense>
      )}
    </>
  );
}
