import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { extractPmsPitchingIdFromProjectData, extractPmsProjectIdFromProjectData } from '@/lib/pmsQuotePrefill';
import { useAuth } from '@/contexts/AuthProvider';
import { usePmsStaffName } from '@/hooks/use-pms-staff-name';
import { withInsertAuditFields, withUpdateAuditFields } from '@/lib/pmsAudit';
import { quoteItemHasBase64Images } from '@/lib/quoteImageStorage';
import {
  replaceQuoteItems,
  resolveItemImagesToStorage,
  stripItemsFromProjectData,
  resolvePitchingCode,
  resolvePitchingName,
  type BwfQuoteItemInput,
} from '@/lib/bwfQuoteItems';

export interface SubmitReviewResult {
  quoteId: string;
  quoteUuid: string;
  version: string;
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
  pitchingCode?: string | null;
  pitchingName?: string | null;
  /** When set, update the existing row instead of inserting a new quote. */
  existingQuoteId?: string | null;
  existingQuoteUuid?: string | null;
}

function generateQuoteId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 900) + 100);
  return `Q${year}-${month}${day}-${random}`;
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
  pitchingCode,
  pitchingName,
  existingQuoteId,
  existingQuoteUuid,
}: SubmitReviewModalProps) {
  const { user } = useAuth();
  const staffName = usePmsStaffName(user?.id);
  const [submitter, setSubmitter] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Default 提交者姓名 from auth user → public.users → staff.name (same as top-nav).
  // Fill when the modal opens or when staffName arrives later; never overwrite typed input.
  useEffect(() => {
    if (!open || !staffName) return;
    setSubmitter((prev) => (prev.trim() ? prev : staffName));
  }, [open, staffName]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!submitter.trim()) {
      setError('請輸入您的姓名');
      return;
    }
    setError('');
    setIsSubmitting(true);

    const pitchingId =
      bwfPitchingId ||
      extractPmsPitchingIdFromProjectData(projectData) ||
      null;
    const projectId =
      bwfProjectId ||
      extractPmsProjectIdFromProjectData(projectData) ||
      null;

    let isUpdate = !!existingQuoteId?.trim();
    let quoteId = isUpdate ? existingQuoteId!.trim() : generateQuoteId();
    let quoteUuid = existingQuoteUuid?.trim() || '';

    // Same PMS pitching → update existing quote instead of creating another row.
    if (!isUpdate && pitchingId) {
      const { data: existingByPitching } = await supabase
        .from('bwf_quote')
        .select('id, quote_id')
        .eq('bwf_pitching_id', pitchingId)
        .order('modified_date', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (existingByPitching?.quote_id && existingByPitching?.id) {
        isUpdate = true;
        quoteId = existingByPitching.quote_id;
        quoteUuid = existingByPitching.id;
      }
    }

    const formDataRaw =
      (projectData.formData as Record<string, unknown> | undefined) || {};
    const code = resolvePitchingCode({
      pitchingCode,
      formData: formDataRaw,
      quoteMeta: projectData.quoteMeta as Record<string, unknown> | undefined,
    });
    const name = resolvePitchingName({
      pitchingName,
      formData: formDataRaw,
    });

    // Prefer explicit items prop; fall back to legacy embedded project_data.items
    // (old clients / drafts) so we never drop line items on submit.
    const embeddedItems = Array.isArray(projectData.items)
      ? (projectData.items as BwfQuoteItemInput[])
      : [];
    const sourceItems = items.length > 0 ? items : embeddedItems;

    // Keep formData ids + pitching fields in sync for PMS list joins / reopen.
    const formData = {
      ...formDataRaw,
      pitchingCode: code,
      pitchingName: name,
      // Clear legacy overloaded field so it cannot be mistaken for a title
      projectName: undefined,
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

    try {
      const resolvedItems = await resolveItemImagesToStorage(sourceItems, quoteId);
      if (resolvedItems.some((item) => quoteItemHasBase64Images(item))) {
        throw new Error('部分圖片未能上傳至 Storage，請檢查網絡後重試');
      }

      if ('items' in payloadProjectData) {
        throw new Error('internal: project_data must not contain items');
      }

      const rowPayload = {
        quote_id: quoteId,
        version,
        status: '待審核',
        total_amount: totalAmount,
        cost_price: totalCostPrice ?? null,
        submitter: submitter.trim(),
        project_data: payloadProjectData,
        pitching_code: code || null,
        pitching_name: name || null,
        ...(pitchingId ? { bwf_pitching_id: pitchingId } : {}),
        ...(projectId ? { bwf_project_id: projectId } : {}),
      };

      let persistedUuid = quoteUuid;

      if (isUpdate) {
        const updatePayload = await withUpdateAuditFields(rowPayload);
        const { data: updated, error: dbError } = await supabase
          .from('bwf_quote')
          .update(updatePayload)
          .eq('quote_id', quoteId)
          .select('id')
          .single();

        if (dbError) throw dbError;
        if (!updated?.id) throw new Error('報價單已更新但缺少 id');
        persistedUuid = updated.id;
      } else {
        const insertPayload = await withInsertAuditFields(rowPayload);
        const { data: inserted, error: dbError } = await supabase
          .from('bwf_quote')
          .insert(insertPayload)
          .select('id')
          .single();

        if (dbError) throw dbError;
        if (!inserted?.id) throw new Error('報價單已建立但缺少 id');
        persistedUuid = inserted.id;
      }

      await replaceQuoteItems(persistedUuid, resolvedItems);

      toast.success(isUpdate ? '報價單已更新並提交審核' : '報價單已提交審核', {
        description: `${quoteId} · ${code || '—'} · 版本 ${version}`,
      });
      onSuccess({ quoteId, quoteUuid: persistedUuid, version });
      setSubmitter('');
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '提交失敗，請稍後再試';
      toast.error('提交失敗', { description: message });
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

        {/* Warning */}
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
          <p className="font-body text-xs leading-relaxed text-amber-200/90">
            提交後將產生版本快照{' '}
            <span className="font-semibold text-amber-400">{version}</span>
            ，此版本內容將無法修改。如需修改，須建立新版本重新提交審核。
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
        </div>

        {/* Submitter Input */}
        <div className="mb-6">
          <label className="mb-1.5 block font-body text-sm font-medium text-foreground">
            提交者姓名 <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={submitter}
            onChange={(e) => {
              setSubmitter(e.target.value);
              if (error) setError('');
            }}
            placeholder="請輸入您的姓名"
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 font-body text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
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
            onClick={handleSubmit}
            disabled={isSubmitting}
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
