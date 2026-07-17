import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { extractPmsPitchingIdFromProjectData, extractPmsProjectIdFromProjectData } from '@/lib/pmsQuotePrefill';
import { useAuth } from '@/contexts/AuthProvider';
import { usePmsStaffName } from '@/hooks/use-pms-staff-name';
import { withInsertAuditFields } from '@/lib/pmsAudit';
import { quoteItemHasBase64Images } from '@/lib/quoteImageStorage';
import { fetchQuoteStaffFilterOptions } from '@/lib/quoteStaffOptions';
import { StaffNameCombobox } from '@/components/dashboard/StaffNameCombobox';
import {
  replaceQuoteItems,
  resolveItemImagesToStorage,
  stripItemsFromProjectData,
  resolvePitchingCode,
  type BwfQuoteItemInput,
} from '@/lib/bwfQuoteItems';
import {
  nextQuoteVersionFromChain,
} from '@/lib/quoteVersions';
import { resolveQuoteChainId } from '@/lib/quoteChainId';

export interface SubmitReviewResult {
  quoteId: string;
  quoteUuid: string;
  version: string;
  projectData: Record<string, unknown>;
  totalAmount: number;
}

interface SubmitReviewModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: SubmitReviewResult) => void;
  totalAmount: number;
  totalCostPrice?: number | null;
  version: string;
  projectData: Record<string, unknown>;
  /** Line items persisted to bwf_quote_item (not project_data). */
  items?: BwfQuoteItemInput[];
  /** Explicit PMS pitching uuid (preferred over digging into projectData). */
  bwfPitchingId?: string | null;
  /** Explicit PMS project uuid (preferred over digging into projectData). */
  bwfProjectId?: string | null;
  /** Wizard 報價單號 — written to bwf_quote.quote_id */
  quoteId?: string | null;
  /** @deprecated Use quoteId */
  pitchingCode?: string | null;
  /** Existing chain id (= quote_id). Legacy Q-format is ignored. */
  existingQuoteId?: string | null;
  existingQuoteUuid?: string | null;
  /**
   * 複製報價單: still inserts a new version on the same quote_id chain.
   * Kept for call-site compat.
   */
  forceNewQuote?: boolean;
}

export function SubmitReviewModal({
  open,
  onClose,
  onSuccess,
  totalAmount,
  totalCostPrice,
  version,
  projectData,
  items = [],
  bwfPitchingId,
  bwfProjectId,
  quoteId: quoteIdProp,
  pitchingCode,
  existingQuoteId,
  existingQuoteUuid: _existingQuoteUuid,
  forceNewQuote: _forceNewQuote = false,
}: SubmitReviewModalProps) {
  void _existingQuoteUuid;
  void _forceNewQuote;
  const { user } = useAuth();
  const staffName = usePmsStaffName(user?.id);
  const [submitter, setSubmitter] = useState('');
  const [staffOptions, setStaffOptions] = useState<string[]>([]);
  const [staffOptionsLoading, setStaffOptionsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Default 提交者姓名 from auth user → public.users → staff.name (same as top-nav).
  // Reset when closed so the next open always starts from the logged-in account name.
  useEffect(() => {
    if (!open) {
      setSubmitter('');
      setError('');
      return;
    }
    const defaultName = (staffName ?? user?.email ?? '').trim();
    if (!defaultName) return;
    setSubmitter((prev) => (prev.trim() ? prev : defaultName));
  }, [open, staffName, user?.email]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setStaffOptionsLoading(true);

    fetchQuoteStaffFilterOptions()
      .then((options) => {
        if (!cancelled) setStaffOptions(options);
      })
      .finally(() => {
        if (!cancelled) setStaffOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const embeddedItems = Array.isArray(projectData.items)
    ? (projectData.items as BwfQuoteItemInput[])
    : [];
  const previewItems = items.length > 0 ? items : embeddedItems;
  const hasSubmitContent = previewItems.some(
    (item) =>
      !item.isSectionTitle &&
      Boolean(String(item.name || '').trim() || (item.unitPrice ?? 0) > 0),
  );
  const emptyStateBlocked = !hasSubmitContent || totalAmount <= 0;

  const formatSubmitError = (err: unknown): string => {
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = String((err as { message?: string }).message || '').trim();
      if (msg) return msg;
    }
    if (err instanceof Error && err.message.trim()) return err.message;
    return '提交失敗，請稍後再試。畫面資料未清除，本機草稿亦保留。';
  };

  const handleSubmit = async () => {
    if (!submitter.trim()) {
      setError('請輸入您的姓名');
      return;
    }
    if (emptyStateBlocked) {
      const msg =
        '目前沒有有效報價內容或總額為 HK$0。頁面狀態可能已過期：請關閉此視窗，按「暫存草稿」或重新整理以恢復草稿後再提交。';
      setError(msg);
      toast.error('無法提交審核', { description: msg });
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const pitchingId =
        bwfPitchingId ||
        extractPmsPitchingIdFromProjectData(projectData) ||
        null;
      const projectId =
        bwfProjectId ||
        extractPmsProjectIdFromProjectData(projectData) ||
        null;

      const formDataRaw =
        (projectData.formData as Record<string, unknown> | undefined) || {};
      const code = resolvePitchingCode({
        quoteId: quoteIdProp || existingQuoteId,
        pitchingCode,
        formData: formDataRaw,
        quoteMeta: projectData.quoteMeta as Record<string, unknown> | undefined,
      });

      // Sole persisted code: bwf_quote.quote_id (no pitching_code / pitching_name columns).
      const quoteId = resolveQuoteChainId({
        code,
        existingQuoteId,
      });
      if (!quoteId) {
        throw new Error('缺少報價單號（PMS Pitching Code），無法提交');
      }

      // Always append a new version row on this quote_id chain.
      const { data: versionRows, error: versionErr } = await supabase
        .from('bwf_quote')
        .select('version')
        .eq('quote_id', quoteId);
      if (versionErr) throw versionErr;
      const chain = (versionRows || []).map((r) => String(r.version || ''));
      const resolvedVersion =
        chain.length > 0 ? nextQuoteVersionFromChain(chain) : version || 'v1';

      const sourceItems = previewItems;
      if (
        !sourceItems.some(
          (item) =>
            !item.isSectionTitle &&
            Boolean(String(item.name || '').trim() || (item.unitPrice ?? 0) > 0),
        )
      ) {
        throw new Error(
          '沒有可提交的報價品項。請關閉視窗並重新整理以恢復草稿。',
        );
      }

      // Persist PMS ids only; never mirror code/name into JSON (title = live PMS).
      const {
        quoteId: _dropFormQuoteId,
        pitchingCode: _dropPitchingCode,
        projectName: _dropProjectName,
        pitchingName: _dropPitchingName,
        ...formDataRest
      } = formDataRaw;
      void _dropFormQuoteId;
      void _dropPitchingCode;
      void _dropProjectName;
      void _dropPitchingName;
      const formData = {
        ...formDataRest,
        ...(pitchingId ? { pmsPitchingId: pitchingId } : {}),
        ...(projectId ? { pmsProjectId: projectId } : {}),
      };
      const payloadProjectData = stripItemsFromProjectData({
        ...projectData,
        formData,
      });
      if ('items' in payloadProjectData) {
        delete payloadProjectData.items;
      }

      const resolvedItems = await resolveItemImagesToStorage(sourceItems, quoteId);
      if (resolvedItems.some((item) => quoteItemHasBase64Images(item))) {
        throw new Error('部分圖片未能上傳至 Storage，請檢查網絡後重試');
      }

      if ('items' in payloadProjectData) {
        throw new Error('internal: project_data must not contain items');
      }

      const rowPayload = {
        quote_id: quoteId,
        version: resolvedVersion,
        status: '待審核',
        total_amount: totalAmount,
        cost_price: totalCostPrice ?? null,
        submitter: submitter.trim(),
        project_data: payloadProjectData,
        ...(pitchingId ? { bwf_pitching_id: pitchingId } : {}),
        ...(projectId ? { bwf_project_id: projectId } : {}),
      };

      const insertPayload = await withInsertAuditFields(rowPayload);
      const { data: inserted, error: dbError } = await supabase
        .from('bwf_quote')
        .insert(insertPayload)
        .select('id')
        .single();

      if (dbError) throw dbError;
      if (!inserted?.id) throw new Error('報價單已建立但缺少 id');
      const persistedUuid = inserted.id;

      await replaceQuoteItems(persistedUuid, resolvedItems);

      toast.success(
        resolvedVersion === 'v1' ? '報價單已提交審核' : '報價單新版本已提交審核',
        {
          description: `${quoteId} · 版本 ${resolvedVersion}`,
        },
      );
      onSuccess({
        quoteId,
        quoteUuid: persistedUuid,
        version: resolvedVersion,
        projectData: payloadProjectData,
        totalAmount,
      });
      setSubmitter('');
      onClose();
    } catch (err: unknown) {
      // Failure must NOT clear editor state or IndexedDB drafts (handled only on success).
      const message = formatSubmitError(err);
      setError(message);
      toast.error('提交失敗', {
        description: `${message}（畫面上的資料與本機草稿仍保留）`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-foreground">
            提交審核
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Warning — same muted surface as 報價總金額 below (no amber wash) */}
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
          <p className="font-body text-xs leading-relaxed text-foreground/80">
            提交後將產生版本快照{' '}
            <span className="font-semibold text-foreground">{version}</span>
            ，此版本內容將無法修改。如需修改，須建立新版本重新提交審核。
            編輯中請用「暫存草稿」，完成後再提交審核。
          </p>
        </div>

        {/* Total Amount */}
        <div className="mb-5 rounded-xl border border-border bg-muted/30 p-4">
          <label className="font-body text-xs text-muted-foreground">
            報價總金額
          </label>
          <div className="mt-1 font-display text-2xl font-bold text-foreground">
            HK$ {totalAmount.toLocaleString()}
          </div>
          {emptyStateBlocked && (
            <p className="mt-2 font-body text-xs leading-relaxed text-rose-500">
              總額為 HK$0 或沒有品項，無法提交。若你剛填過資料，頁面狀態可能已過期——請關閉、重新整理並恢復草稿後再試。
            </p>
          )}
        </div>

        {/* Submitter Input */}
        <div className="mb-6">
          <label
            htmlFor="submit-review-submitter"
            className="mb-1.5 block font-body text-sm font-medium text-foreground"
          >
            提交者姓名 <span className="text-rose-400">*</span>
          </label>
          <StaffNameCombobox
            id="submit-review-submitter"
            value={submitter}
            onChange={(next) => {
              setSubmitter(next);
              if (error) setError('');
            }}
            options={staffOptions}
            loading={staffOptionsLoading}
            placeholder="請輸入或從 PM 及設計師名單選擇"
            hasError={Boolean(error)}
          />
          {error && (
            <p className="mt-1.5 font-body text-xs text-rose-400">{error}</p>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-border px-5 py-2.5 font-body text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || emptyStateBlocked}
            className="rounded-lg bg-amber-500 px-5 py-2.5 font-body text-sm font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:bg-amber-600 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                上傳圖片並提交中...
              </span>
            ) : (
              '確認提交'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
