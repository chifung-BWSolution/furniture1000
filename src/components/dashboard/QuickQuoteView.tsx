import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Check, ChevronRight, ChevronLeft, Sparkles, Loader2 } from 'lucide-react';
import { QuotationDraftEditor } from '@/components/dashboard/QuotationDraftEditor';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { loadDraft } from '@/lib/draftStore';

interface QuoteFormData {
  company: string;
  projectManager: string;
  projectName: string;
  clientName: string;
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
  budgetMin: string;
  budgetMax: string;
  workPeriod: string;
  validityDays: string;
  remarks: string;
}

const INDUSTRIES = ['餐飲', '辦公', '零售', '醫療', '教育', '酒店', '住宅', '其他'];
const QUOTATION_TYPES = [
  '商業設計工程',
  '小型工程',
  '傢俬採購',
];

const SERVICE_SCOPES = ['辦公枱', '辦公椅', '儲物櫃', '軟裝', '師傅安裝', '拉線', '其他'];

const WORK_PERIODS = [
  { value: 'urgent', label: '急件 (1-2個月)' },
  { value: 'normal', label: '正常 (3-6個月)' },
  { value: 'flexible', label: '可協調' },
];

const STEPS = [
  { id: 1, label: '基本資訊' },
  { id: 2, label: '空間與工程' },
  { id: 3, label: '時間與預算' },
  { id: 4, label: '生成報價單' },
];

interface QuickQuoteViewProps {
  editingQuoteId?: string | null;
  onClearEditingQuote?: () => void;
}

const STEP_STORAGE_KEY = 'bwf:quickQuote:currentStep';
const FORM_STORAGE_KEY = 'bwf:quickQuote:formData';

export function QuickQuoteView({ editingQuoteId, onClearEditingQuote }: QuickQuoteViewProps) {
  const [currentStep, setCurrentStep] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const saved = sessionStorage.getItem(STEP_STORAGE_KEY);
    const n = saved ? parseInt(saved, 10) : 1;
    return Number.isFinite(n) && n >= 1 && n <= 4 ? n : 1;
  });
  const [isQuotationReady, setIsQuotationReady] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(STEP_STORAGE_KEY) === '4';
  });
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(STEP_STORAGE_KEY, String(currentStep));
  }, [currentStep]);

  const [loadedQuoteData, setLoadedQuoteData] = useState<{
    quoteId: string;
    version: string;
    status: string;
    totalAmount: number;
    submitter: string;
    projectData: Record<string, unknown>;
  } | null>(null);
  const [formData, setFormData] = useState<QuoteFormData>(() => {
    const defaults: QuoteFormData = {
      company: 'Branding Works Design Ltd',
      projectManager: '',
      projectName: '',
      clientName: '',
      clientPhone: '',
      clientEmail: '',
      clientIndustry: [],
      clientIndustryOther: '',
      quotationType: [],
      serviceScope: [],
      officeArea: '',
      headcount: '',
      budgetMin: '',
      budgetMax: '',
      workPeriod: '',
      validityDays: '30',
      remarks: '',
    };
    if (typeof window === 'undefined') return defaults;
    try {
      const raw = sessionStorage.getItem(FORM_STORAGE_KEY);
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
    return defaults;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData));
    } catch {
      // ignore
    }
  }, [formData]);
  const [errors, setErrors] = useState<Partial<Record<keyof QuoteFormData, string>>>({});

  // Load existing quote when editingQuoteId is provided
  useEffect(() => {
    if (!editingQuoteId) {
      // Reset if no quote ID
      setLoadedQuoteData(null);
      return;
    }

    const loadQuote = async () => {
      setIsLoadingQuote(true);
      try {
        // 1) Check IndexedDB for a local draft first
        let cachedDraft: Awaited<ReturnType<typeof loadDraft>> = null;
        try {
          cachedDraft = await loadDraft(editingQuoteId);
        } catch {
          // IndexedDB unavailable — fall through to API
        }

        // 2) Always fetch from server to get quoteId, version, status, etc.
        const { data, error } = await supabase
          .from('bwf_quote')
          .select('*')
          .eq('quote_id', editingQuoteId)
          .single();

        if (error) throw error;
        if (!data) throw new Error('報價單不存在');

        // 3) If local draft exists and is newer than the server data, use it
        const serverProjectData = data.project_data as Record<string, unknown>;
        let projectDataToUse = serverProjectData;
        let usingLocalDraft = false;

        if (cachedDraft && cachedDraft.updatedAt) {
          const serverUpdatedAt = data.updated_at ? new Date(data.updated_at as string).getTime() : 0;
          if (cachedDraft.updatedAt > serverUpdatedAt) {
            // Build projectData from cached draft so QuotationDraftEditor hydrates from it
            projectDataToUse = {
              formData: cachedDraft.formData,
              companyInfo: cachedDraft.companyInfo,
              clientInfo: cachedDraft.clientInfo,
              quoteMeta: cachedDraft.quoteMeta,
              deliveryDetails: cachedDraft.deliveryDetails,
              termsContent: cachedDraft.termsContent,
              items: cachedDraft.items,
              subtotal: cachedDraft.subtotal,
            };
            usingLocalDraft = true;
          }
        }

        const savedFormData = projectDataToUse.formData as QuoteFormData | undefined;

        // Hydrate form data from saved state
        if (savedFormData) {
          setFormData({
            company: savedFormData.company || 'Branding Works Design Ltd',
            projectManager: savedFormData.projectManager || '',
            projectName: savedFormData.projectName || '',
            clientName: savedFormData.clientName || '',
            clientPhone: savedFormData.clientPhone || '',
            clientEmail: savedFormData.clientEmail || '',
            clientIndustry: savedFormData.clientIndustry || [],
            clientIndustryOther: savedFormData.clientIndustryOther || '',
            quotationType: savedFormData.quotationType || [],
            serviceScope: savedFormData.serviceScope || [],
            officeArea: savedFormData.officeArea || '',
            headcount: savedFormData.headcount || '',
            budgetMin: savedFormData.budgetMin || '',
            budgetMax: savedFormData.budgetMax || '',
            workPeriod: savedFormData.workPeriod || '',
            validityDays: savedFormData.validityDays || '30',
            remarks: savedFormData.remarks || '',
          });
        }

        setLoadedQuoteData({
          quoteId: data.quote_id,
          version: data.version,
          status: data.status,
          totalAmount: data.total_amount,
          submitter: data.submitter,
          projectData: projectDataToUse,
        });

        if (usingLocalDraft) {
          toast.info('已從本地草稿恢復', {
            description: `上次本地儲存於 ${new Date(cachedDraft!.updatedAt).toLocaleString('zh-HK')}`,
          });
        }

        // Skip directly to step 4 editor
        setIsQuotationReady(true);
        setCurrentStep(4);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '無法載入報價單';
        toast.error('載入失敗', { description: message });
        // Go back to list
        onClearEditingQuote?.();
      } finally {
        setIsLoadingQuote(false);
      }
    };

    loadQuote();
  }, [editingQuoteId, onClearEditingQuote]);

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
    if (!formData.projectName.trim()) {
      newErrors.projectName = '請填寫專案名稱';
    }
    if (!formData.clientName.trim()) {
      newErrors.clientName = '請填寫客戶名稱';
    }
    if (!formData.clientPhone.trim()) {
      newErrors.clientPhone = '請填寫客戶電話';
    }
    if (!formData.clientEmail.trim()) {
      newErrors.clientEmail = '請填寫客戶電郵';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.clientEmail)) {
      newErrors.clientEmail = '請輸入有效的電郵地址';
    }
    if (formData.clientIndustry.length === 0) {
      newErrors.clientIndustry = '請選擇至少一個客戶產業';
    }
    if (formData.quotationType.length === 0) {
      newErrors.quotationType = '請選擇至少一個報價類型';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = (): boolean => {
    const newErrors: Partial<Record<keyof QuoteFormData, string>> = {};

    if (formData.serviceScope.length === 0) {
      newErrors.serviceScope = '請選擇至少一個服務範圍';
    }


    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = (): boolean => {
    const newErrors: Partial<Record<keyof QuoteFormData, string>> = {};

    if (formData.budgetMin.trim() && !/^\d+$/.test(formData.budgetMin.trim())) {
      newErrors.budgetMin = '請輸入有效數字';
    }
    if (formData.budgetMax.trim() && !/^\d+$/.test(formData.budgetMax.trim())) {
      newErrors.budgetMax = '請輸入有效數字';
    }
    if (
      formData.budgetMin.trim() &&
      formData.budgetMax.trim() &&
      /^\d+$/.test(formData.budgetMin.trim()) &&
      /^\d+$/.test(formData.budgetMax.trim()) &&
      parseInt(formData.budgetMin) > parseInt(formData.budgetMax)
    ) {
      newErrors.budgetMax = '預算上限必須大於下限';
    }
    if (!formData.workPeriod) {
      newErrors.workPeriod = '請選擇工期需求';
    }
    if (!formData.validityDays.trim()) {
      newErrors.validityDays = '請填寫有效期限';
    } else if (!/^\d+$/.test(formData.validityDays.trim())) {
      newErrors.validityDays = '請輸入有效數字';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 1 && validateStep1()) {
      setCurrentStep(2);
    } else if (currentStep === 2 && validateStep2()) {
      setCurrentStep(3);
    } else if (currentStep === 3 && validateStep3()) {
      setIsQuotationReady(true);
      setCurrentStep(4);
    }
  };

  // Loading state for fetching an existing quote
  if (isLoadingQuote) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="font-mono-data text-xs text-muted-foreground">載入報價單中...</span>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="h-full overflow-y-auto bg-background p-5">
      <div className={cn('mx-auto', currentStep === 4 ? 'max-w-7xl' : 'max-w-3xl')}>
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {currentStep === 4 ? '報價單草稿編輯' : '建立新報價單'}
          </h1>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            {currentStep === 4
              ? '請確認並編輯以下報價單內容，完成後可提交審核'
              : '填寫專案資料，AI 將為您生成專業報價'}
          </p>
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

                {/* Client Name */}
                <div>
                  <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                    客戶名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.clientName}
                    onChange={(e) => updateField('clientName', e.target.value)}
                    placeholder="客戶姓名"
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

              {/* Project Name (full width) */}
              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                  專案名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.projectName}
                  onChange={(e) => updateField('projectName', e.target.value)}
                  placeholder="例：太古城中心辦公室裝修工程"
                  className={cn(
                    'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                    errors.projectName ? 'border-red-500' : 'border-border'
                  )}
                />
                {errors.projectName && (
                  <p className="mt-1 text-xs text-red-500">{errors.projectName}</p>
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
                    客戶電郵 <span className="text-red-500">*</span>
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

              {/* Client Industry Tags */}
              <div>
                <label className="mb-2 block font-body text-sm font-medium text-foreground">
                  客戶產業 <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {INDUSTRIES.map((industry) => (
                    <button
                      key={industry}
                      type="button"
                      onClick={() => toggleTag('clientIndustry', industry)}
                      className={cn(
                        'rounded-full border px-4 py-1.5 font-body text-sm font-medium transition-all',
                        formData.clientIndustry.includes(industry)
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'
                      )}
                    >
                      {industry}
                    </button>
                  ))}
                  {formData.clientIndustry.includes('其他') && (
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

              {/* Quotation Type Tags */}
              <div>
                <label className="mb-2 block font-body text-sm font-medium text-foreground">
                  報價類型 <span className="text-red-500">*</span>
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
              {/* Service Scope Selection */}
              <div>
                <div className="mb-3 flex items-baseline gap-2">
                  <label className="font-body text-sm font-medium text-foreground">
                    服務範圍 <span className="text-red-500">*</span>
                  </label>
                  <span className="font-body text-xs text-muted-foreground">— 傢俬採購</span>
                  <span className="ml-1 font-body text-xs text-muted-foreground">(可多選)</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {SERVICE_SCOPES.map((scope) => (
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
                {errors.serviceScope && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.serviceScope}</p>
                )}
              </div>

              {/* Project Specifications */}
              <div className="space-y-5 pt-2">
                <h3 className="font-body text-sm font-semibold text-foreground">專案資料</h3>

                {/* Office Area */}
                <div>
                  <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                    辦公空間面積 (坪)
                  </label>
                  <input
                    type="text"
                    value={formData.officeArea}
                    onChange={(e) => updateField('officeArea', e.target.value)}
                    placeholder="請輸入辦公空間面積 (坪)"
                    className={cn(
                      'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                      errors.officeArea ? 'border-red-500' : 'border-border'
                    )}
                  />
                  {errors.officeArea && (
                    <p className="mt-1 text-xs text-red-500">{errors.officeArea}</p>
                  )}
                </div>

                {/* Headcount */}
                <div>
                  <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                    使用人數 (人)
                  </label>
                  <input
                    type="text"
                    value={formData.headcount}
                    onChange={(e) => updateField('headcount', e.target.value)}
                    placeholder="請輸入使用人數 (人)"
                    className={cn(
                      'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                      errors.headcount ? 'border-red-500' : 'border-border'
                    )}
                  />
                  {errors.headcount && (
                    <p className="mt-1 text-xs text-red-500">{errors.headcount}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              {/* Budget Range */}
              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                  預算區間 HK$
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <input
                      type="text"
                      value={formData.budgetMin}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        updateField('budgetMin', val);
                      }}
                      placeholder="例：50000"
                      className={cn(
                        'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                        errors.budgetMin ? 'border-red-500' : 'border-border'
                      )}
                    />
                    <span className="mt-1 block font-body text-xs text-muted-foreground">預算下限</span>
                    {errors.budgetMin && (
                      <p className="mt-0.5 text-xs text-red-500">{errors.budgetMin}</p>
                    )}
                  </div>
                  <div>
                    <input
                      type="text"
                      value={formData.budgetMax}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        updateField('budgetMax', val);
                      }}
                      placeholder="例：200000"
                      className={cn(
                        'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                        errors.budgetMax ? 'border-red-500' : 'border-border'
                      )}
                    />
                    <span className="mt-1 block font-body text-xs text-muted-foreground">預算上限</span>
                    {errors.budgetMax && (
                      <p className="mt-0.5 text-xs text-red-500">{errors.budgetMax}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Work Period Dropdown */}
              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
                  工期需求 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.workPeriod}
                  onChange={(e) => updateField('workPeriod', e.target.value)}
                  className={cn(
                    'w-full rounded-lg border bg-background px-4 py-2.5 font-body text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none',
                    !formData.workPeriod && 'text-muted-foreground/60',
                    errors.workPeriod ? 'border-red-500' : 'border-border'
                  )}
                >
                  <option value="" disabled>
                    請選擇工期
                  </option>
                  {WORK_PERIODS.map((period) => (
                    <option key={period.value} value={period.value}>
                      {period.label}
                    </option>
                  ))}
                </select>
                {errors.workPeriod && (
                  <p className="mt-1 text-xs text-red-500">{errors.workPeriod}</p>
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
                    <span className="block font-body text-xs text-white/50">專案名稱</span>
                    <span className="mt-0.5 block font-mono-data text-sm text-white/90 truncate">
                      {formData.projectName || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-body text-xs text-white/50">客戶</span>
                    <span className="mt-0.5 block font-mono-data text-sm text-white/90 truncate">
                      {formData.clientName || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-body text-xs text-white/50">面積</span>
                    <span className="mt-0.5 block font-mono-data text-sm text-white/90">
                      {formData.officeArea ? `${formData.officeArea} 坪` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-body text-xs text-white/50">服務項目</span>
                    <span className="mt-0.5 block font-mono-data text-sm text-white/90">
                      {formData.serviceScope.length > 0
                        ? `${formData.serviceScope.length} 項`
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
              onBack={() => {
                if (loadedQuoteData) {
                  setLoadedQuoteData(null);
                  onClearEditingQuote?.();
                } else {
                  setCurrentStep(3);
                }
              }}
              existingQuote={loadedQuoteData || undefined}
            />
          </div>
        )}
      </div>
    </div>
    </>
  );
}
