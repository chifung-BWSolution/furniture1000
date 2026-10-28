import { useEffect, useState } from 'react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { LoadingImage } from '@/components/ui/loading-image';
import { Input } from '@/components/ui/input';

export interface ProductCountDetection {
  product_count: number;
  possible_arrangement: boolean;
  uncertain: boolean;
  reason: string;
  per_image_counts: number[];
}
export interface ProductScopeChoice { scope: 'single' | 'arrangement'; count: number }

export function FurnitureProductScopeDialog({ detection, images, onChoose, onCancel }: {
  detection: ProductCountDetection | null;
  images: (string | File)[];
  onChoose: (choice: ProductScopeChoice) => void;
  onCancel: () => void;
}) {
  const [count, setCount] = useState('2');
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    setCount(String(Math.max(2, detection?.product_count ?? 2)));
    if (!detection) { setPreviews([]); return; }
    const urls = images.slice(0, 6).map(image => typeof image === 'string' ? image : URL.createObjectURL(image));
    setPreviews(urls);
    return () => urls.forEach((url, i) => { if (typeof images[i] !== 'string') URL.revokeObjectURL(url); });
  }, [detection]);
  const n = Number(count);
  return <Modal open={detection != null} onOpenChange={open => { if (!open) onCancel(); }} size="lg"
    title="圖片中是否有多件同款產品？"
    description="AI 可能把排列在一起的同款家具當成一件產品，請先確認本次建模範圍。"
    footer={<>
      <ModalButton onClick={() => onChoose({scope:'single',count:1})}>只生成其中一件</ModalButton>
      <ModalButton variant="secondary" disabled={!Number.isInteger(n) || n < 2 || n > 20} onClick={() => onChoose({scope:'arrangement',count:n})}>按整組生成</ModalButton>
      <ModalButton variant="secondary" onClick={onCancel}>取消</ModalButton>
    </>}
  >
    <div className="space-y-4 text-sm">
      <p>{detection?.reason}</p>
      <p className="text-muted-foreground">{detection && detection.product_count > 0 ? `AI 估計同一場景最多有 ${detection.product_count} 件；` : '目前沒有可靠的數量估計；'}不同角度及拼圖中的重複視圖不應重複計算。請以原圖自行判斷。</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{previews.map((url,i) => <LoadingImage key={i} src={url} alt={`建模參考圖 ${i+1}`} className="h-32 w-full rounded-md border" imgClassName="object-contain" />)}</div>
      <label className="flex flex-wrap items-center gap-2">整組包含的同款產品數量
        <Input className="w-24" type="number" min={2} max={20} value={count} onChange={event => setCount(event.target.value)} />
      </label>
      <p className="text-xs text-muted-foreground">若只是同一件產品的不同角度，請選「只生成其中一件」。整組會保留各件產品及排列位置。</p>
    </div>
  </Modal>;
}
