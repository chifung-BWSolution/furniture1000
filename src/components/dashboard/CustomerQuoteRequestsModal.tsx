import { useEffect, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CUSTOMER_REQUEST_STATUS_LABELS,
  CUSTOMER_REQUEST_STATUS_OPTIONS,
  customerRequestErrorMessage,
  formatRequestMoney,
  formatRequestTime,
  listCustomerQuoteRequests,
  requestLineLabel,
  requestNotifyLabel,
  selectedRequestLines,
  setCustomerQuoteRequestStatus,
  type CustomerQuoteRequest,
  type CustomerQuoteRequestStatus,
} from '@/lib/customerQuoteRequests';

/**
 * FDS-14：PM 查看客戶提交的選品／數量／需求。
 * 這裡只改提交記錄的處理狀態；正式報價的單價、明細與總額不會被客戶提交改寫。
 */
export function CustomerQuoteRequestsModal({
  open,
  quote,
  onOpenChange,
}: {
  open: boolean;
  quote: { id: string; quoteId: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [requests, setRequests] = useState<CustomerQuoteRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const quoteId = quote?.id ?? '';

  useEffect(() => {
    if (!open || !quoteId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setRequests([]);
    void listCustomerQuoteRequests(quoteId)
      .then((rows) => {
        if (!cancelled) setRequests(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(customerRequestErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, quoteId]);

  const changeStatus = async (request: CustomerQuoteRequest, status: CustomerQuoteRequestStatus) => {
    setSavingId(request.id);
    setError('');
    try {
      await setCustomerQuoteRequestStatus(request.id, status);
      setRequests((current) => current.map((row) => (row.id === request.id ? { ...row, status } : row)));
      toast.success(`已標記為「${CUSTOMER_REQUEST_STATUS_LABELS[status]}」`);
    } catch (err) {
      setError(customerRequestErrorMessage(err));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="4xl"
      icon={<MessageSquare className="h-6 w-6" />}
      title="客戶提交"
      description={quote ? `${quote.quoteId} · 客戶的選品、數量與需求（不會改寫正式報價）` : undefined}
      footer={
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          關閉
        </Button>
      }
    >
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在讀取客戶提交
        </p>
      ) : (
        <div className="space-y-3">
          {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">這張報價還沒有客戶提交。客戶用分享連結提交後會出現在這裡。</p>
          ) : (
            <ul className="space-y-3">
              {requests.map((request) => {
                const lines = selectedRequestLines(request.lines);
                return (
                  <li key={request.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-md border bg-muted/50 px-2 py-0.5 text-xs font-medium">
                        {CUSTOMER_REQUEST_STATUS_LABELS[request.status] ?? request.status}
                      </span>
                      <span className="text-muted-foreground">{formatRequestTime(request.submitted_at)}</span>
                      <span className="text-muted-foreground">選品合計（參考）{formatRequestMoney(request.total_cents)}</span>
                      <span className={request.pm_notified_at ? 'text-emerald-700' : 'text-amber-700'}>
                        {requestNotifyLabel(request)}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <Select
                          value={request.status}
                          disabled={savingId === request.id}
                          onValueChange={(value) => void changeStatus(request, value as CustomerQuoteRequestStatus)}
                        >
                          <SelectTrigger className="h-8 w-[150px]" aria-label="客戶提交處理狀態">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CUSTOMER_REQUEST_STATUS_OPTIONS.map((status) => (
                              <SelectItem key={status} value={status}>
                                {CUSTOMER_REQUEST_STATUS_LABELS[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {savingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      </span>
                    </div>
                    {lines.length > 0 ? (
                      <ul className="list-inside list-disc text-sm">
                        {lines.map((line, index) => (
                          <li key={`${request.id}-${index}`}>{requestLineLabel(line)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">客戶沒有勾選項目，只留下需求說明。</p>
                    )}
                    {request.note ? (
                      <p className="rounded-md bg-muted/40 px-2.5 py-2 text-sm">
                        <span className="font-medium">客戶需求：</span>
                        {request.note}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
