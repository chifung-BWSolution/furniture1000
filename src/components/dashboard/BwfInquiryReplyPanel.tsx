import { useEffect, useState } from 'react';
import { usePlatformRole } from '@/hooks/use-platform-role';
import {
  getFurnitureInquiry,
  inquiryErrorMessage,
  inquiryStatusLabel,
  listFurnitureInquiries,
  replyFurnitureInquiry,
  type BwaInquiryDetail,
  type BwaInquirySummary,
} from '@/lib/bwaFurnitureInquiry';
import { Button } from '@/components/ui/button';

/**
 * BWF furniture staff record the selling prices they formally return.
 * The form has no cost, factory, or margin fields.
 */
export function BwfInquiryReplyPanel() {
  const { profileRole, loading: roleLoading } = usePlatformRole();
  const [rows, setRows] = useState<BwaInquirySummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BwaInquiryDetail | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const canReply = profileRole === 'admin' || profileRole === 'uploader';

  useEffect(() => {
    if (roleLoading || !canReply) return;
    let cancelled = false;
    void listFurnitureInquiries().then((result) => {
      if (cancelled) return;
      setRows(result.rows.filter((row) => row.status !== 'draft'));
      if (result.error) setMessage(inquiryErrorMessage(result.error));
    });
    return () => {
      cancelled = true;
    };
  }, [roleLoading, canReply]);

  if (roleLoading || !canReply || rows.length === 0) return null;

  const open = (id: string) => {
    setOpenId(id);
    setMessage('');
    void getFurnitureInquiry(id).then((result) => {
      if (result.error || !result.inquiry) {
        setMessage(result.error ? inquiryErrorMessage(result.error) : '找不到這張詢價。');
        return;
      }
      setDetail(result.inquiry);
      const next: Record<string, string> = {};
      for (const item of result.inquiry.items) {
        next[item.id] = item.returned_unit_price == null ? '' : String(item.returned_unit_price);
      }
      setPrices(next);
    });
  };

  const submit = async () => {
    if (!detail) return;
    const payload = detail.items
      .filter((item) => (prices[item.id] || '').trim() !== '')
      .map((item) => ({ id: item.id, returned_unit_price: Number(prices[item.id]) }));
    if (payload.length === 0 || payload.some((row) => Number.isNaN(row.returned_unit_price) || row.returned_unit_price < 0)) {
      setMessage('請填至少一個賣價。');
      return;
    }
    setSaving(true);
    const error = await replyFurnitureInquiry(detail.id, payload);
    setSaving(false);
    setMessage(error ? inquiryErrorMessage(error) : '已回覆賣價。BWA 只能看到這些賣價。');
    if (!error) {
      setRows((current) => current.map((row) => (
        row.id === detail.id ? { ...row, status: 'replied', returned_count: payload.length } : row
      )));
    }
  };

  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-bold">BWA 詢價 · 回覆賣價</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        只填正式賣價。不要在這裡填成本、廠家或毛利。
      </p>
      <ul className="mt-3 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="font-semibold">{row.bwa_project_name || '未命名工程'}</span>
              <span className="ml-2 text-xs text-muted-foreground">{inquiryStatusLabel(row.status)}</span>
            </span>
            <button type="button" className="text-xs font-semibold underline" onClick={() => open(row.id)}>
              填賣價
            </button>
          </li>
        ))}
      </ul>
      {openId && detail && detail.id === openId && (
        <div className="mt-3 space-y-2">
          {detail.items.map((item) => (
            <label key={item.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 text-sm">
              <span className="truncate">{item.name || '未命名'} · {item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
              <input
                inputMode="decimal"
                aria-label={`${item.name || '項目'} 賣價`}
                value={prices[item.id] ?? ''}
                onChange={(event) => setPrices((current) => ({ ...current, [item.id]: event.target.value }))}
                placeholder="賣價"
                className="h-9 rounded-lg border border-border bg-background px-2"
              />
            </label>
          ))}
          <Button type="button" disabled={saving} onClick={() => void submit()}>
            回覆 BWA
          </Button>
        </div>
      )}
      {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
    </section>
  );
}
