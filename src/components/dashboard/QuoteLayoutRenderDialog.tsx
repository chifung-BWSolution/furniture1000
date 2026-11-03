import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { QuoteFloorPlan } from '@/lib/quoteFloorPlan';
import { DEFAULT_LAYOUT_STYLE } from '@/lib/quoteLayoutRender';

export function QuoteLayoutRenderDialog({ plan, onChange, onClose, title = '渲染圖設置' }: {
  title?: string;
  plan: QuoteFloorPlan;
  onChange: (plan: QuoteFloorPlan) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState(plan.rendering || { style: DEFAULT_LAYOUT_STYLE, notes: {}, images: {} });
  return <Modal open size="lg" title={title} onOpenChange={open => { if (!open) onClose(); }} footer={<Button onClick={onClose}>完成</Button>}>
    <label className="block space-y-2">
      <span className="text-sm font-medium">全案統一風格</span>
      <Textarea value={state.style} maxLength={1000} rows={4} onChange={e => {
        const next = { ...state, style: e.target.value };
        setState(next);
        onChange({ ...plan, rendering: next });
      }} />
    </label>
  </Modal>;
}
