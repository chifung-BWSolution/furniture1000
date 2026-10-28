import { useEffect, useState } from 'react';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingImage } from '@/components/ui/loading-image';

export function FurnitureModelPhotoChoice({ open, images, onCancel, onChoose, onAddPhotos }: {
  open: boolean;
  images: (string | File)[];
  onCancel: () => void;
  onChoose: (images: (string | File)[]) => void;
  onAddPhotos: () => void;
}) {
  const [selected, setSelected] = useState<(string | File)[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => { if (open) setSelected([]); }, [open]);
  useEffect(() => {
    if (!open) return;
    const urls = images.map(image => typeof image === 'string' ? image : URL.createObjectURL(image));
    setPreviews(urls);
    return () => urls.forEach((url, i) => { if (typeof images[i] !== 'string') URL.revokeObjectURL(url); });
  }, [open, images]);
  const chosen = selected.filter(image => images.includes(image));
  return <Modal open={open} onOpenChange={value => { if (!value) onCancel(); }} size="lg"
    title="選擇要生成的款式"
    description="勾選同一款家具的 2–6 張不同角度圖片。例如生成單人沙發時，只選單人款的圖片，不要混入三人款。"
    footer={<>
      <ModalButton variant="secondary" onClick={onCancel}>取消</ModalButton>
      <ModalButton disabled={chosen.length < 2 || chosen.length > 6} onClick={() => onChoose(chosen)}>使用所選圖片辨認</ModalButton>
    </>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p aria-live="polite">已選 {chosen.length} / 6 張 · 最少 2 張</p>
        <ModalButton variant="secondary" onClick={onAddPhotos}>補充此款圖片</ModalButton>
      </div>
      {images.length === 0 && <p className="text-sm text-muted-foreground">尚無可用圖片，請先補充同一款家具的不同角度圖片。</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image, index) => {
          const checked = chosen.includes(image);
          return <label key={typeof image === 'string' ? image : index}
            className={`cursor-pointer rounded-lg border p-2 focus-within:ring-2 focus-within:ring-primary ${checked ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <LoadingImage src={previews[index] ?? ''} alt={`款式參考圖 ${index + 1}`} className="h-36 w-full rounded-md" imgClassName="object-contain" />
            <span className="mt-2 flex items-center gap-2 text-sm">
              <Checkbox checked={checked} disabled={!checked && chosen.length >= 6}
                onCheckedChange={value => setSelected(current => value === true ? [...current.filter(item => item !== image), image] : current.filter(item => item !== image))} />
              圖片 {index + 1}
            </span>
          </label>;
        })}
      </div>
      <p className="text-sm text-muted-foreground">只使用勾選的圖片生成。選取部分圖片時，尺寸會重新辨認，並在生成前交由你確認。</p>
    </div>
  </Modal>;
}
