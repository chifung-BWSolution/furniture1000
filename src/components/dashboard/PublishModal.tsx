import { Product } from '@/types/product';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Database, AlertTriangle, ShieldCheck } from 'lucide-react';

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  products: Product[];
}

export function PublishModal({ open, onClose, onConfirm, products }: PublishModalProps) {
  const newProducts = products;

  const payload = newProducts.map(p => ({
    id: p.id,
    title: p.title,
    category: p.category || p.collection || '',
    factory_name: p.factoryName || p.factoriesDisplayName || '',
    image_url: p.imageUrl,
    description: p.descriptionHtml || p.description,
    material: p.material || '',
    dimension_l_mm: p.dimensionLMm || null,
    dimension_w_mm: p.dimensionWMm || null,
    dimension_h_mm: p.dimensionHMm || null,
    cost_price: p.costPrice || null,
    sale_price: p.salePrice || p.price || null,
    shopify_price: p.shopifyPrice || p.price || null,
    shopify_compare_at_price: p.shopifyCompareAtPrice || p.compareAtPrice || null,
    delivery_days: p.deliveryDays || null,
    shopify_id: p.shopifyProductId || null,
    production_lead_time: p.productionLeadTime ?? null,
    total_lead_time: (p.productionLeadTime != null && p.shippingDays != null)
      ? (p.productionLeadTime + p.shippingDays)
      : (p.productionLeadTime ?? p.shippingDays ?? null),
    shipping_days: p.shippingDays ?? null,
    shipping_fee: p.shippingFee ?? null,
    remarks: p.remarks || null,
  }));

  const jsonString = JSON.stringify({ products: payload }, null, 2);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            確認上傳到全域資料庫
          </DialogTitle>
          <DialogDescription className="font-body">
            {newProducts.length > 0
              ? `即將上傳 ${newProducts.length} 個產品到全域資料庫 (bwf_product_master)`
              : '沒有產品可上傳'}
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 space-y-2">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500 font-body">
            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              <strong>安全模式：</strong>產品將以 UPSERT 方式寫入全域資料庫，不會影響現有記錄。
            </span>
          </div>

          {newProducts.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500 font-body">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              沒有已選產品。請先選擇要上傳的產品。
            </div>
          )}
        </div>

        {newProducts.length > 0 && (
          <ScrollArea className="h-[300px] rounded-lg border border-border bg-background p-1">
            <pre className="p-4 font-mono-data text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
              <code>{syntaxHighlight(jsonString)}</code>
            </pre>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="font-body">
            取消
          </Button>
          <Button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={newProducts.length === 0}
            className="gap-2 bg-primary font-display font-bold text-primary-foreground animate-pulse-glow"
          >
            <Database className="h-4 w-4" />
            {newProducts.length > 0
              ? `上傳 ${newProducts.length} 個產品到資料庫`
              : '沒有產品可上傳'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function syntaxHighlight(json: string): string {
  return json
    .replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?)/g, (match) => {
      if (/:$/.test(match)) {
        return match; // key
      }
      return match; // string value
    });
}
