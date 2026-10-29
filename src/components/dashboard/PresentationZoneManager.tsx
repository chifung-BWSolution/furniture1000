import { useState } from 'react';
import { FolderKanban, GripVertical, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FloorPlanZoneCanvas, floorPlanZoneColor } from './FloorPlanZoneCanvas';
import { blankZoneManagerRow, MAX_FLOOR_PLAN_ZONES, type ZoneManagerRow } from '@/lib/quoteFloorPlan';
import { cropPresentationFloorPlan, presentationZoneBounds } from '@/lib/presentationFloorPlan';
import type { PresentationZoneDraft } from '@/lib/presentationOutlineModel';

export function PresentationZoneManager({ zones, floorUrl, onSave, onClose }: {
  zones: PresentationZoneDraft[];
  floorUrl?: string;
  onSave: (zones: PresentationZoneDraft[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => zones.map((zone) => ({
    ...blankZoneManagerRow(zone.id, zone.name), ...zone,
    rect: zone.rect ?? null, rects: zone.rects ?? (zone.rect ? [zone.rect] : []), spaceType: zone.spaceType ?? '',
    quantity: zone.rects && zone.rects.length > 1 ? zone.rects.length : zone.quantity ?? 1,
  })));
  const [activeId, setActiveId] = useState<string | null>(zones[0]?.id ?? null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = busy;
  const update = (id: string, patch: Partial<ZoneManagerRow> & { imageUrl?: string }) =>
    setDraft((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  // Synthetic canvas IDs keep each rectangle independently editable while the list keeps one zone.
  const canvasRows = draft.flatMap((zone) => (zone.rects.length ? zone.rects : [null]).map((rect, index) => ({
    ...zone, id: `${zone.id}::${index}`, rect,
  })));
  const canvasChange = (rows: ZoneManagerRow[]) => setDraft((current) => {
    const next = current.flatMap((zone) => {
      const rects = rows.filter((row) => row.id.startsWith(`${zone.id}::`) && row.rect).map((row) => row.rect!);
      if (zone.rects.length && !rects.length) return [];
      return [{ ...zone, rects, rect: rects[0] ?? null,
        quantity: rects.length !== zone.rects.length && rects.length ? rects.length : zone.quantity }];
    });
    for (const row of rows) {
      if (!row.id.includes('::')) next.push({ ...blankZoneManagerRow(row.id), ...row, rects: row.rect ? [row.rect] : [] });
    }
    return next;
  });
  const canvasZoneId = (id: string) => id.split('::')[0];
  const copyRegion = (id: string) => {
    const [zoneId, rawIndex] = id.split('::');
    setDraft((current) => current.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const rect = zone.rects[Number(rawIndex)];
      if (!rect) return zone;
      const copy = { ...rect, x: Math.min(100 - rect.w, rect.x + 3), y: Math.min(100 - rect.h, rect.y + 3) };
      return { ...zone, rects: [...zone.rects, copy], quantity: zone.rects.length + 1 };
    }));
    setActiveId(zoneId);
  };
  const save = async () => {
    setBusy(true);
    try {
      const next = draft.map((row) => ({ ...row, name: row.name.trim(), ...(!row.rects.length && row.rect !== zones.find((zone) => zone.id === row.id)?.rect ? { imageUrl: undefined } : {}) }));
      if (next.some((row) => !row.name)) throw new Error('請填寫每個分區的名稱');
      const changed = next.filter((row) => row.rect && JSON.stringify(row.rects) !== JSON.stringify(zones.find((zone) => zone.id === row.id)?.rects ?? (zones.find((zone) => zone.id === row.id)?.rect ? [zones.find((zone) => zone.id === row.id)!.rect] : [])));
      if (floorUrl && changed.length) {
        const response = await fetch(floorUrl);
        if (!response.ok) throw new Error('無法讀取平面圖，請重試');
        const result = await cropPresentationFloorPlan(await response.blob(), changed.map((row) => ({ ...row, rect: presentationZoneBounds(row.rects) })));
        if (result.failedCrops) throw new Error('部分分區截圖產生失敗，請重新確認');
        for (let index = 0; index < changed.length; index++) {
          changed[index].imageUrl = result.zones[index].imageUrl;
        }
      }
      onSave(next);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '無法保存分區');
    } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(open) => { if (!open && !disabled) onClose(); }}
    size="4xl" className="max-w-6xl" icon={<FolderKanban className="h-5 w-5" />}
    title="分區管理" description="在平面圖上框選、移動或調整分區範圍，並在右側編輯分區資料。確認後更新對應截圖。"
    footer={<>
      <ModalButton variant="secondary" className="border-dashed sm:mr-auto" disabled={disabled || draft.length >= MAX_FLOOR_PLAN_ZONES}
        onClick={() => setDraft((current) => [...current, { ...blankZoneManagerRow(crypto.randomUUID()), rects: [] }])}><Plus className="h-4 w-4" />新增分區</ModalButton>
      <ModalButton variant="secondary" disabled={disabled} onClick={onClose}>取消</ModalButton>
      <ModalButton disabled={disabled} onClick={() => void save()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}確認</ModalButton>
    </>}>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="space-y-2 lg:sticky lg:top-0">
        <div className="h-[320px] overflow-hidden rounded-lg sm:h-[440px]">
          {floorUrl ? <FloorPlanZoneCanvas src={floorUrl} zones={canvasRows} activeId={activeId ? `${activeId}::0` : null} createId={() => crypto.randomUUID()}
            disabled={disabled} onChange={canvasChange} onActive={(id) => setActiveId(canvasZoneId(id))} onCopyRegion={copyRegion}
            regionDisplay={(id, index) => { const zoneIndex = draft.findIndex((zone) => zone.id === canvasZoneId(id)); return { colorIndex: zoneIndex < 0 ? index : zoneIndex, number: zoneIndex < 0 ? index + 1 : zoneIndex + 1 }; }} />
            : <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">上傳整體平面圖後，可在這裡框選分區。</div>}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">點選區域可調整範圍；按左上角複製可為同一分區新增區域，拖曳至所需位置。空白處拖曳可新增分區。</p>
      </div>
      <div className="min-w-0 space-y-3 overflow-x-auto">
        {!draft.length ? <p className="flex h-40 items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground">尚未建立分區，請框選或新增分區。</p> : null}
        {draft.length ? <div className="grid min-w-[28rem] grid-cols-[1.25rem_1.5rem_minmax(0,1.4fr)_minmax(0,1.2fr)_4.5rem_2rem] gap-2 text-xs text-muted-foreground lg:min-w-0">
          <span /><span /><span>空間名稱</span><span>類型</span><span>數量</span><span />
        </div> : null}
        {draft.map((zone, index) => <div key={zone.id} className={`min-w-[28rem] rounded-lg py-1 lg:min-w-0 ${activeId === zone.id ? 'bg-primary/5' : ''}`}
          onDragOver={(event) => { if (dragId && !disabled) event.preventDefault(); }}
          onDrop={(event) => {
            event.preventDefault();
            if (disabled || !dragId || dragId === zone.id) return;
            const next = [...draft];
            const from = next.findIndex((row) => row.id === dragId);
            if (from < 0) return;
            const [moved] = next.splice(from, 1);
            next.splice(index, 0, moved); setDraft(next); setDragId(null);
          }}>
          <div className="grid grid-cols-[1.25rem_1.5rem_minmax(0,1.4fr)_minmax(0,1.2fr)_4.5rem_2rem] items-center gap-2">
            <button type="button" draggable={!disabled} disabled={disabled} aria-label="拖曳調整分區順序" className="cursor-grab text-muted-foreground"
              onDragStart={(event) => { event.dataTransfer.setData('text/plain', zone.id); setDragId(zone.id); }} onDragEnd={() => setDragId(null)}><GripVertical className="h-4 w-4" /></button>
            <button type="button" disabled={disabled} aria-label={`選取分區 ${index + 1}`} onClick={() => setActiveId(zone.id)}
              className="flex h-6 w-6 items-center justify-center rounded text-xs text-white" style={{ background: floorPlanZoneColor(index) }}>{index + 1}</button>
            <Input aria-label="空間名稱" placeholder="例如：會議室" value={zone.name} disabled={disabled} onFocus={() => setActiveId(zone.id)} onChange={(event) => update(zone.id, { name: event.target.value })} />
            <Input aria-label="分區類型" placeholder="類型" value={zone.spaceType} disabled={disabled} onFocus={() => setActiveId(zone.id)} onChange={(event) => update(zone.id, { spaceType: event.target.value })} />
            <Input aria-label="分區數量" type="number" min={1} value={zone.quantity} disabled={disabled} onChange={(event) => update(zone.id, { quantity: Math.max(1, Number.parseInt(event.target.value, 10) || 1) })} className="px-1 text-center" />
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={disabled} aria-label="刪除分區" onClick={() => setDraft((current) => current.filter((row) => row.id !== zone.id))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>)}
      </div>
    </div>
  </Modal>;
}
