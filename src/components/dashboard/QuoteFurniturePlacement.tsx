import { useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { LoadingImage } from '@/components/ui/loading-image';
import type { QuoteFloorPlan } from '@/lib/quoteFloorPlan';
import { furnitureRectFromDrag, type FurniturePosition, type FurnitureBounds } from '@/lib/quoteFurniturePlacement';

type Selection = { positionId?: string; rect?: FurnitureBounds };
function PlacementRegion({ source, name, region, positions, editable, selection, onSelect }: {
  source: string; name: string; region: FurnitureBounds; positions: FurniturePosition[];
  editable: boolean; selection?: Selection; onSelect?: (selection: Selection) => void;
}) {
  const [ratio, setRatio] = useState(1);
  const [dragRect, setDragRect] = useState<FurnitureBounds | null>(null);
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: 100 * (event.clientX - box.left) / box.width, y: 100 * (event.clientY - box.top) / box.height };
  };
  const style = (rect: FurnitureBounds) => ({ left: `${100 * (rect.x - region.x) / region.w}%`, top: `${100 * (rect.y - region.y) / region.h}%`, width: `${100 * rect.w / region.w}%`, height: `${100 * rect.h / region.h}%` });
  const selected = selection?.rect || positions.find(p => p.id === selection?.positionId)?.rect;
  return <div className={`relative isolate overflow-hidden rounded-md border border-border ${editable ? 'touch-none cursor-crosshair select-none' : ''}`} style={{ aspectRatio: ratio * region.w / region.h }}
    onPointerDown={event => {
      if (!editable || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { ...point(event), pointerId: event.pointerId }; setDragRect(null);
    }}
    onPointerMove={event => { if (start.current?.pointerId === event.pointerId) setDragRect(furnitureRectFromDrag(region, start.current, point(event))); }}
    onPointerCancel={() => { start.current = null; setDragRect(null); }}
    onPointerUp={event => {
      if (start.current?.pointerId !== event.pointerId) return;
      const rect = furnitureRectFromDrag(region, start.current, point(event));
      start.current = null; setDragRect(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (rect) onSelect?.({ rect });
    }}>
    <div className="pointer-events-none absolute" style={{ width: `${10000 / region.w}%`, height: `${10000 / region.h}%`, left: `${-100 * region.x / region.w}%`, top: `${-100 * region.y / region.h}%` }}>
      <LoadingImage hd src={source} alt={`${name}分區平面圖`} draggable={false} className="h-full w-full" imgClassName="object-fill" onLoad={event => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
    </div>
    {positions.filter(p => p.x >= region.x && p.x <= region.x + region.w && p.y >= region.y && p.y <= region.y + region.h).map(p => <button key={p.id} type="button" disabled={!editable} onPointerDown={event => event.stopPropagation()} onClick={() => onSelect?.({ positionId: p.id })} title={`${p.label} · ${p.category}`} aria-label={`選擇${p.label} ${p.category}`} aria-pressed={selection?.positionId === p.id}
      className={`absolute z-10 flex min-h-8 min-w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white px-1 text-xs font-semibold shadow-md disabled:cursor-default ${selection?.positionId === p.id ? 'bg-foreground text-background ring-2 ring-primary' : 'bg-primary text-primary-foreground'}`}
      style={{ left: `${100 * (p.x - region.x) / region.w}%`, top: `${100 * (p.y - region.y) / region.h}%` }}>{p.label}</button>)}
    {(dragRect || selected) && <div aria-hidden className="pointer-events-none absolute z-20 border-2 border-primary bg-primary/20" style={style((dragRect || selected)!)} />}
  </div>;
}

export function ProductPlacementPicker({ positions, values, quantity, canSelect, onChange, onPickOnPlan }: {
  positions: FurniturePosition[]; values: string[]; quantity: number; canSelect: boolean;
  onChange: (index: number, value: string) => void; onPickOnPlan: (index: number) => void;
}) {
  const count = Math.max(1, Math.min(Math.max(1, Math.floor(quantity)), values.length || 1));
  return <div className="mt-3 space-y-2"><span className="block text-xs font-medium text-muted-foreground">擺放位置</span>
    {Array.from({ length: count }, (_, index) => {
      const position = positions.find(p => p.id === values[index]);
      return <div key={index} className="flex items-center gap-1"><Button type="button" variant="outline" className="h-auto min-h-[34px] min-w-0 flex-1 justify-start whitespace-normal px-2 py-1 text-left text-xs" disabled={!canSelect} aria-label={`選擇第${index + 1}件擺放位置`} onClick={() => onPickOnPlan(index)}>{position ? `${position.label} · ${position.category}` : '選擇擺放位置'}</Button>
        {position && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(index, '')} aria-label={`清除第${index + 1}件擺放位置`}>清除</Button>}
      </div>;
    })}
    {!canSelect && <p className="text-xs text-muted-foreground">請先上傳平面圖並確認此分區範圍。</p>}
    {count < Math.floor(quantity) && canSelect && <Button type="button" variant="ghost" size="sm" onClick={() => onPickOnPlan(count)}>新增一件擺放位置</Button>}
  </div>;
}

export function FurniturePlacementDialog({ plan, zoneId, zoneName, productName, index, value, onSave, onClose }: {
  plan: QuoteFloorPlan; zoneId: string; zoneName: string; productName: string; index: number; value?: string;
  onSave: (selection: Selection & { angle: number | null }) => void; onClose: () => void;
}) {
  const positions = plan.placements?.positions[zoneId] || [];
  const existing = positions.find(p => p.id === value);
  const [selection, setSelection] = useState<Selection>(existing ? { positionId: existing.id } : {});
  const [angle, setAngle] = useState(existing?.angle == null ? '' : String(existing.angle));
  const source = plan.previewUrl || (plan.mimeType.startsWith('image/') ? plan.url : '');
  const regions = plan.regions.filter(r => r.zoneId === zoneId);
  const angleValid = !angle.trim() || (Number.isFinite(Number(angle)) && Number(angle) >= 0 && Number(angle) <= 360);
  const ready = (selection.rect || selection.positionId) && angleValid;
  const choose = (next: Selection) => {
    setSelection(next);
    const p = positions.find(p => p.id === next.positionId);
    setAngle(p?.angle == null ? '' : String(p.angle));
  };
  return <Modal open size="4xl" title={`擺放位置 · ${productName}`} description={`${zoneName} · 第${index + 1}件。拖曳框選傢俬位置，或點擊已識別的標記。確認後才會保存。`} onOpenChange={open => { if (!open) onClose(); }} footer={<><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="button" disabled={!ready} onClick={() => { onSave({ ...selection, angle: angle.trim() ? Number(angle) % 360 : null }); }}>確認位置</Button></>}>
    <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">{source && regions.map((region, regionIndex) => <PlacementRegion key={regionIndex} source={source} name={zoneName} region={region.rect} positions={positions} editable selection={selection} onSelect={choose} />)}</div>
      {!source || !regions.length ? <p className="text-sm text-muted-foreground">此分區尚未有可用平面圖，請先在分區管理框選。</p> : null}
      <p role="status" className="text-sm">{selection.rect ? '已圈選新位置；可再次拖曳調整範圍。' : selection.positionId ? `已選擇 ${positions.find(p => p.id === selection.positionId)?.label || ''}` : '尚未選擇位置。即使沒有識別標記，也可以直接拖曳圈選。'}</p>
      <label className="block max-w-xs space-y-2"><span className="text-sm font-medium">朝向角度（選填）</span><Input type="number" min={0} max={360} value={angle} placeholder="未知" onChange={event => setAngle(event.target.value)} /><span className="block text-xs text-muted-foreground">圖上方為 0°，順時針計算；無法判斷時留空。</span></label>
      {!angleValid && <p role="alert" className="text-sm text-destructive">請輸入 0 至 360 的角度，或留空。</p>}
    </div>
  </Modal>;
}
