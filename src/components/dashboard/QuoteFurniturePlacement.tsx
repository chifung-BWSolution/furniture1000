import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingImage } from '@/components/ui/loading-image';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, ImageOff, MapPin, X } from 'lucide-react';
import type { QuoteFloorPlan } from '@/lib/quoteFloorPlan';
import { furnitureKind, furnitureRectFromDrag, type FurniturePosition, type FurnitureBounds } from '@/lib/quoteFurniturePlacement';
import type { QuoteLocale } from '@/lib/quotationLocale';
import { placementCopy } from '@/lib/quoteSurfaceCopy';

type Selection = { positionId?: string; rect?: FurnitureBounds };
function PlacementRegion({ source, name, region, positions, editable, drawing, selections, occupiedIds, onSelect, locale = 'zh' }: {
  source: string; name: string; region: FurnitureBounds; positions: FurniturePosition[];
  editable: boolean; drawing: boolean; selections: Selection[]; occupiedIds: string[]; onSelect?: (selection: Selection) => void;
  locale?: QuoteLocale;
}) {
  const copy = placementCopy(locale);
  const [ratio, setRatio] = useState(1);
  const [dragRect, setDragRect] = useState<FurnitureBounds | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = regionRef.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: 100 * (event.clientX - box.left) / box.width, y: 100 * (event.clientY - box.top) / box.height };
  };
  const style = (rect: FurnitureBounds) => ({ left: `${100 * (rect.x - region.x) / region.w}%`, top: `${100 * (rect.y - region.y) / region.h}%`, width: `${100 * rect.w / region.w}%`, height: `${100 * rect.h / region.h}%` });
  const placed: { x: number; y: number }[] = [];
  const markers = positions.filter(p => p.x >= region.x && p.x <= region.x + region.w && p.y >= region.y && p.y <= region.y + region.h).map(position => {
    const originalX = (position.x - region.x) / region.w * size.width;
    const originalY = (position.y - region.y) / region.h * size.height;
    const clamp = (value: number, max: number) => Math.max(16, Math.min(Math.max(16, max - 16), value));
    let x = clamp(originalX, size.width), y = clamp(originalY, size.height);
    if (size.width && size.height && placed.some(p => Math.hypot(p.x - x, p.y - y) < 34)) {
      let best = { x, y, score: -Infinity };
      for (const distance of [36, 55, 74]) for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const candidate = { x: clamp(originalX + Math.cos(angle) * distance, size.width), y: clamp(originalY + Math.sin(angle) * distance, size.height) };
        const clearance = Math.min(...placed.map(p => Math.hypot(p.x - candidate.x, p.y - candidate.y)));
        const score = Math.min(clearance, 34) - Math.hypot(candidate.x - originalX, candidate.y - originalY) * 0.01;
        if (score > best.score) best = { ...candidate, score };
      }
      ({ x, y } = best);
    }
    placed.push({ x, y });
    return { position, x, y, originalX, originalY };
  });
  const aspect = ratio * region.w / region.h;
  return <div ref={regionRef} className={`relative isolate shrink-0 overflow-hidden rounded-md border border-border ${drawing ? 'touch-none cursor-crosshair select-none' : ''}`} style={{ aspectRatio: aspect, width: `min(100%, ${Math.max(1, 450 * aspect)}px)` }}
    onPointerDown={event => {
      if (!editable || !drawing || event.button !== 0) return;
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
      <LoadingImage hd src={source} alt={copy.planAlt(name)} draggable={false} className="h-full w-full" imgClassName="object-fill" onLoad={event => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
    </div>
    <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden="true">{markers.filter(marker => Math.hypot(marker.x - marker.originalX, marker.y - marker.originalY) > 8).map(marker => <line key={marker.position.id} x1={marker.originalX} y1={marker.originalY} x2={marker.x} y2={marker.y} stroke="currentColor" className="text-primary" strokeWidth="1.5" />)}</svg>
    {markers.map(({ position: p, x, y }) => <button key={p.id} type="button" disabled={!editable || occupiedIds.includes(p.id)} onPointerDown={event => event.stopPropagation()} onClick={() => onSelect?.({ positionId: p.id })} title={`${p.label} · ${p.category}${occupiedIds.includes(p.id) ? copy.occupied : ''}`} aria-label={copy.pickMarker(p.label, p.category)} aria-pressed={selections.some(selection => selection.positionId === p.id)}
      className={`absolute z-10 flex min-h-8 min-w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white px-1 text-xs font-semibold shadow-md disabled:cursor-default ${selections.some(selection => selection.positionId === p.id) ? 'bg-foreground text-background ring-2 ring-primary' : 'bg-primary text-primary-foreground'}`}
      style={{ left: x, top: y }}>{selections.some(selection => selection.positionId === p.id) ? <Check className="h-4 w-4" aria-hidden="true" /> : p.label}</button>)}
    {[...selections.map(selection => selection.rect || positions.find(p => p.id === selection.positionId)?.rect).filter((rect): rect is FurnitureBounds => !!rect), ...(dragRect ? [dragRect] : [])].map((rect, index) => <div key={index} aria-hidden className="pointer-events-none absolute z-20 border-2 border-primary bg-primary/20" style={style(rect)} />)}
  </div>;
}

export function ProductPlacementPicker({ positions, values, canSelect, unavailableReason, onManageZones, onRequestZone, onPickOnPlan, locale = 'zh' }: {
  positions: FurniturePosition[]; values: string[]; quantity: number; canSelect: boolean;
  unavailableReason?: 'no-plan' | 'no-zone' | 'no-region'; onManageZones?: () => void; locale?: QuoteLocale;
  /** 尚未選分區時，按下按鈕把上面的分區下拉標紅。 */
  onRequestZone?: () => void;
  onChange: (index: number, value: string) => void; onPickOnPlan: (index: number) => void;
}) {
  const count = values.filter(id => positions.some(position => position.id === id)).length;
  const needsZone = !canSelect && unavailableReason === 'no-zone';
  const copy = placementCopy(locale);
  return <div className="mt-3 space-y-2"><span className="block text-xs font-medium text-muted-foreground">{copy.label}</span>
    <Button type="button" variant="outline" className="h-auto min-h-[34px] w-full justify-start px-2 py-1 text-left text-xs" disabled={!canSelect && !needsZone} onClick={() => { if (needsZone) { onRequestZone?.(); return; } onPickOnPlan(0); }}>{count ? copy.selected(count) : needsZone ? copy.pickZone : copy.pick}</Button>
    {!canSelect && unavailableReason !== 'no-zone' && <div className="text-xs text-muted-foreground"><p>{unavailableReason === 'no-region' ? copy.noRegion : copy.noPlan}</p>{unavailableReason === 'no-region' && onManageZones ? <Button type="button" variant="ghost" size="sm" className="mt-1 h-auto px-0 py-1" onClick={onManageZones}>{copy.openZones}</Button> : null}</div>}
  </div>;
}

export function FurniturePlacementDialog({ plan, zoneId, zoneName, productName, productCategory, productSku, productImage, quantity, values, occupiedIds, onSave, onClose, locale = 'zh' }: {
  plan: QuoteFloorPlan; zoneId: string; zoneName: string; productName: string; productCategory?: string; productSku?: string; productImage?: string; quantity: number; values?: string[]; occupiedIds: string[];
  onSave: (selections: Selection[]) => void; onClose: () => void; locale?: QuoteLocale;
}) {
  const copy = placementCopy(locale);
  const positions = plan.placements?.positions[zoneId] || [];
  const limit = Math.max(0, Math.floor(quantity));
  const productKind = furnitureKind(`${productCategory || ''} ${productName}`);
  const availableKinds = Array.from(new Map(positions.filter(position => !occupiedIds.includes(position.id)).map(position => [furnitureKind(position.category), position.category.trim()] as const)).entries()).filter(([key]) => !!key);
  const [selectedKind, setSelectedKind] = useState(() => availableKinds.some(([key]) => key === productKind) ? productKind : '');
  const matching = positions.filter(position => selectedKind && furnitureKind(position.category) === selectedKind && !occupiedIds.includes(position.id)).slice(0, limit);
  const [selections, setSelections] = useState<Selection[]>(() => {
    const saved = values?.filter(id => positions.some(position => position.id === id) && !occupiedIds.includes(id)).slice(0, limit);
    return (saved?.length ? saved : matching.map(position => position.id)).map(positionId => ({ positionId }));
  });
  const [drawing, setDrawing] = useState(false);
  const source = plan.previewUrl || (plan.mimeType.startsWith('image/') ? plan.url : '');
  const regions = plan.regions.filter(r => r.zoneId === zoneId);
  const choose = (next: Selection) => {
    setSelections(current => next.positionId && current.some(selection => selection.positionId === next.positionId) ? current.filter(selection => selection.positionId !== next.positionId) : current.length < limit ? [...current, next] : current);
    if (next.rect) setDrawing(false);
  };
  const selectionLabel = (selection: Selection, index: number) => positions.find(position => position.id === selection.positionId)?.label || copy.newPosition(index + 1);
  const tag = (selection: Selection, index: number) => <button key={`${selection.positionId || 'new'}-${index}`} type="button" onClick={() => setSelections(current => current.filter((_, i) => i !== index))} aria-label={copy.remove(selectionLabel(selection, index))} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/20">{selectionLabel(selection, index)}<X className="h-3 w-3" /></button>;
  return <Modal open size="4xl" title={copy.title} description={copy.description} onOpenChange={open => { if (!open) onClose(); }} footer={<><Button type="button" variant="outline" onClick={onClose}>{copy.cancel}</Button><Button type="button" onClick={() => onSave(selections)}>{copy.confirm}</Button></>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-primary/10 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3"><div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background">{productImage ? <LoadingImage src={productImage} alt={productName} className="h-full w-full" imgClassName="object-contain" /> : <ImageOff className="h-5 w-5 text-muted-foreground" />}</div><div className="min-w-0"><p className="text-xs text-muted-foreground">{copy.currentItem}</p><p className="truncate text-sm font-semibold">{productName}{productSku ? ` (${productSku})` : ''}</p></div></div>
        <div className="flex min-w-0 items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-primary" /><span className="whitespace-nowrap text-sm font-semibold">{copy.selected(selections.length)}</span><div className="flex min-w-0 items-center gap-1">{selections.slice(0, 3).map(tag)}{selections.length > 3 && <Popover><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" aria-label={copy.viewAll}>+{selections.length - 3}</Button></PopoverTrigger><PopoverContent align="end" className="z-[300] max-h-60 overflow-y-auto"><div className="flex flex-wrap gap-1.5">{selections.map(tag)}</div></PopoverContent></Popover>}</div></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{drawing ? copy.drawing : copy.zoneLimit(zoneName, limit)}</span><div className="flex flex-wrap items-center gap-2"><Select value={selectedKind} onValueChange={setSelectedKind}><SelectTrigger aria-label={copy.kindLabel} className="h-9 w-36"><SelectValue placeholder={copy.kindLabel} /></SelectTrigger><SelectContent className="z-[300]">{availableKinds.map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" disabled={!source || !regions.length || (!drawing && selections.length >= limit)} onClick={() => setDrawing(value => !value)}>{drawing ? copy.cancelDraw : copy.addOne}</Button><Button type="button" variant="outline" size="sm" disabled={!matching.length} onClick={() => { setDrawing(false); setSelections(matching.map(position => ({ positionId: position.id }))); }}>{copy.selectSame(matching.length)}</Button></div></div>
      <div className="flex h-[480px] items-center justify-center gap-4 overflow-auto rounded-xl border bg-muted/30 p-3">{source && regions.map((region, regionIndex) => <PlacementRegion key={regionIndex} source={source} name={zoneName} region={region.rect} positions={positions} editable drawing={drawing} selections={selections} occupiedIds={occupiedIds} onSelect={choose} locale={locale} />)}{(!source || !regions.length) && <p className="text-sm text-muted-foreground">{copy.emptyPlan}</p>}</div>
    </div>
  </Modal>;
}
