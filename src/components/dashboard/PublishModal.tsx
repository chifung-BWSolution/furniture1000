import { Product } from '@/types/product';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Upload, AlertTriangle, ShieldCheck } from 'lucide-react';

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  products: Product[];
}

export function PublishModal({ open, onClose, onConfirm, products }: PublishModalProps) {
  if (!open) return null;

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
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      size="2xl"
      icon={<Upload className="h-6 w-6" />}
      title="確認上傳到 Shopify"
      description={
        newProducts.length > 0
          ? `即將上傳 ${newProducts.length} 個產品到 Shopify（準備上載內容）`
          : '沒有產品可上傳'
      }
      footer={
        <>
          <ModalButton
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={newProducts.length === 0}
          >
            <Upload className="h-4 w-4" />
            {newProducts.length > 0
              ? `上傳 ${newProducts.length} 個產品到 Shopify`
              : '沒有產品可上傳'}
          </ModalButton>
          <ModalButton variant="secondary" onClick={onClose}>
            取消
          </ModalButton>
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500 font-body">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <strong>安全模式：</strong>已有 Shopify ID 的產品會被跳過，避免重複建立。
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
        <ScrollArea className="mt-2 h-[300px] rounded-lg border border-border bg-background p-1">
          <pre className="p-4 font-mono-data text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
            <code>{jsonString}</code>
          </pre>
        </ScrollArea>
      )}
    </Modal>
  );
}
