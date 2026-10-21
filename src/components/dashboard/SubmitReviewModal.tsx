import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, ModalButton } from '@/components/ui/modal';
import { useAuth } from '@/contexts/AuthProvider';
import { usePmsStaffName } from '@/hooks/use-pms-staff-name';
import { fetchQuoteStaffFilterOptions } from '@/lib/quoteStaffOptions';
import { StaffNameCombobox } from '@/components/dashboard/StaffNameCombobox';
import type { BwfQuoteItemInput } from '@/lib/bwfQuoteItems';
import { pickQuoteChainId } from '@/lib/quoteChainId';
import { parseQuotePathname } from '@/lib/quoteRoutes';
import {
  persistBwfQuote,
  type PersistBwfQuoteResult,
} from '@/lib/persistBwfQuote';

export type SubmitReviewResult = PersistBwfQuoteResult;

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
  /** Snapshot ids when modal opens — parent remount must not wipe chain key mid-submit. */
  const lockedChainIdRef = useRef<string | null>(null);

  // Default 提交者姓名 from auth user → public.users → staff.name (same as top-nav).
  // Reset when closed so the next open always starts from the logged-in account name.
  useEffect(() => {
    if (!open) {
      setSubmitter('');
      setError('');
      lockedChainIdRef.current = null;
      return;
    }
    const meta = projectData.quoteMeta as Record<string, unknown> | undefined;
    const fromUrl = (() => {
      if (typeof window === 'undefined') return '';
      const parsed = parseQuotePathname(window.location.pathname);
      return parsed.kind === 'quote' ? parsed.quoteId : '';
    })();
    const locked = pickQuoteChainId(
      quoteIdProp,
      existingQuoteId,
      pitchingCode,
      typeof meta?.quoteNumber === 'string' ? meta.quoteNumber : null,
      typeof meta?.projectName === 'string' ? meta.projectName : null,
      fromUrl,
      lockedChainIdRef.current,
    );
    // Never clear a previously locked id if a transient re-render lost props.
    if (locked) lockedChainIdRef.current = locked;
    const defaultName = (staffName ?? user?.email ?? '').trim();
    if (!defaultName) return;
    setSubmitter((prev) => (prev.trim() ? prev : defaultName));
  }, [
    open,
    staffName,
    user?.email,
    quoteIdProp,
    existingQuoteId,
    pitchingCode,
    projectData.quoteMeta,
  ]);

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
        '目前沒有有效報價內容或總額為 HK$0。頁面狀態可能已過期：請關閉此視窗，按「保存現有版本」或重新整理以恢復草稿後再提交。';
      setError(msg);
      toast.error('無法提交審核', { description: msg });
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      const result = await persistBwfQuote({
        mode: 'new-version',
        totalAmount,
        totalCostPrice,
        projectData,
        items: previewItems,
        bwfPitchingId,
        bwfProjectId,
        quoteId: quoteIdProp,
        pitchingCode,
        existingQuoteId,
        lockedChainId: lockedChainIdRef.current,
        submitter: submitter.trim(),
      });
      lockedChainIdRef.current = result.quoteId;

      toast.success(
        result.version === 'v1' ? '報價單已提交審核' : '報價單新版本已提交審核',
        {
          description: `${result.quoteId} · 版本 ${result.version}`,
        },
      );
      onSuccess(result);
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
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      size="md"
      icon={<Send className="h-6 w-6" />}
      title="提交審核"
      description={
        <>
          提交後將產生新版本快照{' '}
          <span className="font-semibold text-foreground">{version}</span>
          ，此版本內容將無法修改。如需修改，須建立新版本重新提交審核。
          編輯中請用「保存現有版本」寫入伺服器；需要開新版本時再按「版本審核」。
        </>
      }
      footer={
        <>
          <ModalButton
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || emptyStateBlocked}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                上傳圖片並提交中...
              </span>
            ) : (
              '確認提交'
            )}
          </ModalButton>
          <ModalButton
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            取消
          </ModalButton>
        </>
      }
    >
      {/* Total Amount */}
      <div className="rounded-xl border border-border bg-muted/30 p-4">
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
        <div className="mt-4">
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
    </Modal>
  );
}
