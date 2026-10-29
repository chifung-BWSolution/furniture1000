import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Copy, X } from 'lucide-react';
import { LoadingImage } from '@/components/ui/loading-image';
import { blankZoneManagerRow, MAX_FLOOR_PLAN_ZONES, normalizeZoneRect, type QuoteZoneRect, type ZoneManagerRow } from '@/lib/quoteFloorPlan';

const ZONE_COLORS = ['#7c6cf0', '#3b82c4', '#e11d48', '#22a06b', '#e0a100', '#38bdf8', '#6366f1', '#f97316'];

export function floorPlanZoneColor(index: number): string {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | { kind: 'move'; id: string; offsetX: number; offsetY: number }
  | { kind: 'resize'; id: string; corner: Corner; origin: QuoteZoneRect }
  | { kind: 'draw'; id: string; x0: number; y0: number };

type FloorPlanZoneCanvasProps = {
  src: string;
  zones: ZoneManagerRow[];
  activeId: string | null;
  createId: () => string;
  onChange: (zones: ZoneManagerRow[]) => void;
  onActive: (id: string) => void;
  disabled?: boolean;
  deleteLabel?: string;
  className?: string;
  onCopyRegion?: (id: string) => void;
  regionDisplay?: (id: string, index: number) => { colorIndex: number; number: number };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointerPct(event: ReactPointerEvent, frame: HTMLElement): { x: number; y: number } {
  const box = frame.getBoundingClientRect();
  const width = box.width || 1;
  const height = box.height || 1;
  return {
    x: clamp(((event.clientX - box.left) / width) * 100, 0, 100),
    y: clamp(((event.clientY - box.top) / height) * 100, 0, 100),
  };
}

function cornerHit(
  event: ReactPointerEvent,
  frame: HTMLElement,
  rect: QuoteZoneRect,
): Corner | null {
  const box = frame.getBoundingClientRect();
  const px = event.clientX - box.left;
  const py = event.clientY - box.top;
  const points: [Corner, number, number][] = [
    ['nw', (rect.x / 100) * box.width, (rect.y / 100) * box.height],
    ['ne', ((rect.x + rect.w) / 100) * box.width, (rect.y / 100) * box.height],
    ['sw', (rect.x / 100) * box.width, ((rect.y + rect.h) / 100) * box.height],
    ['se', ((rect.x + rect.w) / 100) * box.width, ((rect.y + rect.h) / 100) * box.height],
  ];
  for (const [corner, cx, cy] of points) {
    if (Math.hypot(px - cx, py - cy) <= 14) return corner;
  }
  return null;
}

function inside(rect: QuoteZoneRect, point: { x: number; y: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function resized(origin: QuoteZoneRect, corner: Corner, point: { x: number; y: number }): QuoteZoneRect {
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.w;
  let bottom = origin.y + origin.h;
  if (corner === 'nw' || corner === 'sw') left = point.x;
  else right = point.x;
  if (corner === 'nw' || corner === 'ne') top = point.y;
  else bottom = point.y;
  const x = Math.min(left, right);
  const y = Math.min(top, bottom);
  return {
    x: clamp(x, 0, 100),
    y: clamp(y, 0, 100),
    w: clamp(Math.abs(right - left), 0, 100 - clamp(x, 0, 100)),
    h: clamp(Math.abs(bottom - top), 0, 100 - clamp(y, 0, 100)),
  };
}

export function FloorPlanZoneCanvas({
  src,
  zones,
  activeId,
  createId,
  onChange,
  onActive,
  disabled = false,
  deleteLabel = '刪除空間',
  className,
  onCopyRegion,
  regionDisplay,
}: FloorPlanZoneCanvasProps) {
  const maskId = useId().replace(/:/g, '');
  const frameRef = useRef<HTMLDivElement>(null);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<{ id: string; rect: QuoteZoneRect } | null>(null);
  const [draft, setDraft] = useState<{ id: string; rect: QuoteZoneRect } | null>(null);
  const [ready, setReady] = useState(false);

  const setDraftRect = (value: { id: string; rect: QuoteZoneRect } | null) => {
    draftRef.current = value;
    setDraft(value);
  };

  useEffect(() => {
    setReady(false);
  }, [src]);

  const commit = (id: string, rect: QuoteZoneRect, creating: boolean) => {
    const current = zonesRef.current;
    const next = current.some((row) => row.id === id)
      ? current.map((row) => (row.id === id ? { ...row, rect } : row))
      : creating
        ? [...current, { ...blankZoneManagerRow(id), rect }]
        : current;
    zonesRef.current = next;
    onChange(next);
  };

  const removeZone = (id: string) => {
    const next = zonesRef.current.filter((row) => row.id !== id);
    zonesRef.current = next;
    onChange(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !ready || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-zone-delete], [data-zone-copy]')) return;
    const frame = frameRef.current;
    if (!frame) return;
    const point = pointerPct(event, frame);
    const ordered = zonesRef.current
      .map((row, index) => ({ row, index }))
      .filter((entry): entry is { row: ZoneManagerRow & { rect: QuoteZoneRect }; index: number } => entry.row.rect != null)
      .reverse();
    for (const entry of ordered) {
      const corner = cornerHit(event, frame, entry.row.rect);
      if (corner) {
        dragRef.current = { kind: 'resize', id: entry.row.id, corner, origin: entry.row.rect };
        onActive(entry.row.id);
        frame.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    for (const entry of ordered) {
      if (!inside(entry.row.rect, point)) continue;
      dragRef.current = {
        kind: 'move',
        id: entry.row.id,
        offsetX: point.x - entry.row.rect.x,
        offsetY: point.y - entry.row.rect.y,
      };
      onActive(entry.row.id);
      frame.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (zonesRef.current.length >= MAX_FLOOR_PLAN_ZONES) return;
    const id = createId();
    const rect = { x: point.x, y: point.y, w: 0, h: 0 };
    dragRef.current = { kind: 'draw', id, x0: point.x, y0: point.y };
    setDraftRect({ id, rect });
    frame.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;
    const point = pointerPct(event, frame);
    if (drag.kind === 'move') {
      const current = zonesRef.current.find((row) => row.id === drag.id)?.rect;
      if (!current) return;
      const x = clamp(point.x - drag.offsetX, 0, 100 - current.w);
      const y = clamp(point.y - drag.offsetY, 0, 100 - current.h);
      commit(drag.id, { ...current, x, y }, false);
      return;
    }
    if (drag.kind === 'resize') {
      commit(drag.id, resized(drag.origin, drag.corner, point), false);
      return;
    }
    const x = Math.min(drag.x0, point.x);
    const y = Math.min(drag.y0, point.y);
    setDraftRect({
      id: drag.id,
      rect: { x, y, w: Math.abs(point.x - drag.x0), h: Math.abs(point.y - drag.y0) },
    });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === 'draw') {
      const pending = draftRef.current;
      setDraftRect(null);
      const rect = pending ? normalizeZoneRect(pending.rect, 3) : null;
      if (!rect || zonesRef.current.length >= MAX_FLOOR_PLAN_ZONES) return;
      const next = [...zonesRef.current, { ...blankZoneManagerRow(pending.id), rect }];
      zonesRef.current = next;
      onChange(next);
      onActive(pending.id);
      return;
    }
    const current = zonesRef.current.find((row) => row.id === drag.id);
    const rect = current?.rect ? normalizeZoneRect(current.rect) : null;
    if (!rect) {
      const next = zonesRef.current.filter((row) => row.id !== drag.id);
      zonesRef.current = next;
      onChange(next);
      return;
    }
    if (current && (current.rect.x !== rect.x || current.rect.y !== rect.y || current.rect.w !== rect.w || current.rect.h !== rect.h)) {
      commit(drag.id, rect, false);
    }
  };

  return (
    <div className={`flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30 p-2 ${className ?? ''}`}>
      <div
        ref={frameRef}
        role="application"
        aria-label="Floor plan zones"
        className={`relative inline-block max-w-full touch-none select-none ${disabled ? '' : 'cursor-crosshair'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <LoadingImage
          src={src}
          alt=""
          className="max-h-[408px] max-w-full"
          imgClassName="object-contain"
          draggable={false}
          onLoad={() => setReady(true)}
        />
        {ready ? (
          <div className="absolute inset-0">
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              <defs>
                <mask id={maskId}>
                  <rect x="0" y="0" width="100" height="100" fill="white" />
                  {zones.map((zone) => zone.rect ? (
                    <rect key={zone.id} x={zone.rect.x} y={zone.rect.y} width={zone.rect.w} height={zone.rect.h} fill="black" />
                  ) : null)}
                  {draft ? (
                    <rect x={draft.rect.x} y={draft.rect.y} width={draft.rect.w} height={draft.rect.h} fill="black" />
                  ) : null}
                </mask>
              </defs>
              <rect x="0" y="0" width="100" height="100" fill="rgba(15,23,42,0.38)" mask={`url(#${maskId})`} />
            </svg>
            {zones.map((zone, index) => {
              if (!zone.rect) return null;
              const display = regionDisplay?.(zone.id, index) ?? { colorIndex: index, number: index + 1 };
              const color = floorPlanZoneColor(display.colorIndex);
              const active = zone.id === activeId;
              return (
                <div
                  key={zone.id}
                  className="absolute box-border"
                  style={{
                    left: `${zone.rect.x}%`,
                    top: `${zone.rect.y}%`,
                    width: `${zone.rect.w}%`,
                    height: `${zone.rect.h}%`,
                    border: `2px solid ${color}`,
                    background: active ? `${color}33` : `${color}1f`,
                    boxShadow: active ? `0 0 0 1px ${color}` : undefined,
                  }}
                >
                  {disabled ? null : (
                    <>
                      <span className="absolute inset-x-0 top-0 z-[2] h-2 cursor-move" />
                      <span className="absolute inset-x-0 bottom-0 z-[2] h-2 cursor-move" />
                      <span className="absolute inset-y-0 left-0 z-[2] w-2 cursor-move" />
                      <span className="absolute inset-y-0 right-0 z-[2] w-2 cursor-move" />
                    </>
                  )}
                  {zone.name ? (
                    <span
                      className="pointer-events-none absolute left-0 top-0 z-[1] max-w-full truncate px-1 py-0.5 font-body text-[10px] font-medium leading-none text-white"
                      style={{ background: color }}
                    >
                      {zone.name}
                    </span>
                  ) : null}
                  <span
                    className="pointer-events-none absolute left-1/2 top-1/2 z-[1] flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-body text-xs font-semibold leading-none text-white shadow-sm"
                    style={{ background: color }}
                  >
                    {display.number}
                  </span>
                  {(['nw', 'ne', 'sw', 'se'] as Corner[]).map((corner) => (
                    <span
                      key={corner}
                      className={`absolute z-[3] h-2.5 w-2.5 border border-white ${corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'}`}
                      style={{
                        background: color,
                        left: corner === 'nw' || corner === 'sw' ? -5 : undefined,
                        right: corner === 'ne' || corner === 'se' ? -5 : undefined,
                        top: corner === 'nw' || corner === 'ne' ? -5 : undefined,
                        bottom: corner === 'sw' || corner === 'se' ? -5 : undefined,
                      }}
                    />
                  ))}
                  {!disabled && onCopyRegion ? <button type="button" data-zone-copy={zone.id} aria-label="複製區域"
                    className="absolute -left-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white text-primary shadow"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); onCopyRegion(zone.id); }}><Copy className="h-3 w-3" /></button> : null}
                  {disabled ? null : (
                    <button
                      type="button"
                      data-zone-delete={zone.id}
                      aria-label={deleteLabel}
                      className="absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white text-rose-500 shadow"
                      onPointerDown={(pointerEvent) => {
                        pointerEvent.stopPropagation();
                      }}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        removeZone(zone.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
            {draft ? (
              <div
                className="pointer-events-none absolute box-border border-2 border-dashed border-violet-500 bg-violet-500/15"
                style={{
                  left: `${draft.rect.x}%`,
                  top: `${draft.rect.y}%`,
                  width: `${draft.rect.w}%`,
                  height: `${draft.rect.h}%`,
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
