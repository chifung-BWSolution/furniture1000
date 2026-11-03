import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Copy, X } from 'lucide-react';
import type { FurnitureBounds } from '@/lib/quoteFurniturePlacement';
import { LoadingImage } from '@/components/ui/loading-image';
import { blankZoneManagerRow, MAX_FLOOR_PLAN_ZONES, normalizeZoneRect, type QuoteZoneRect, type ZoneManagerRow } from '@/lib/quoteFloorPlan';

const ZONE_COLORS = ['#7c6cf0', '#3b82c4', '#e11d48', '#22a06b', '#e0a100', '#38bdf8', '#6366f1', '#f97316'];

export function floorPlanZoneColor(index: number): string {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | { kind: 'move'; id: string; offsetX: number; offsetY: number }
  | { kind: 'furniture-move'; id: string; offsetX: number; offsetY: number; rect: FurnitureBounds }
  | { kind: 'resize'; id: string; corner: Corner; origin: QuoteZoneRect }
  | { kind: 'draw'; id: string; x0: number; y0: number };

export type FloorPlanFurnitureMarker = { id: string; label: string; x: number; y: number; angle: number | null; description: string; color: string; rect?: FurnitureBounds };

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
  furnitureMarkers?: FloorPlanFurnitureMarker[];
  showFurniture?: boolean;
  activeFurnitureId?: string | null;
  furnitureFocusRequest?: number;
  regionDisplay?: (id: string, index: number) => { colorIndex: number; number: number };
  panEnabled?: boolean;
  onDrawFurniture?: (rect: FurnitureBounds) => void;
  onMoveFurniture?: (id: string, rect: FurnitureBounds) => void;
  onBeforeEdit?: () => void;
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
  furnitureMarkers = [],
  showFurniture = false,
  activeFurnitureId,
  furnitureFocusRequest = 0,
  panEnabled = false,
  onDrawFurniture,
  onMoveFurniture,
  onBeforeEdit,
}: FloorPlanZoneCanvasProps) {
  const maskId = useId().replace(/:/g, '');
  const frameRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);
  const [focusZooming, setFocusZooming] = useState(false);
  const [baseWidth, setBaseWidth] = useState<number | null>(null);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const dragRef = useRef<Drag | null>(null);
  const dragRecordedRef = useRef(false);
  const draftRef = useRef<{ id: string; rect: QuoteZoneRect } | null>(null);
  const [draft, setDraft] = useState<{ id: string; rect: QuoteZoneRect } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !viewportSize.width || !viewportSize.height) return;
    viewport.scrollLeft = viewportSize.width * 0.5;
    viewport.scrollTop = viewportSize.height * 0.5;
  }, [src, viewportSize.width, viewportSize.height]);

  const setDraftRect = (value: { id: string; rect: QuoteZoneRect } | null) => {
    draftRef.current = value;
    setDraft(value);
  };

  useEffect(() => {
    setReady(false);
    const img = frameRef.current?.querySelector('img');
    let cancelled = false;
    const markReady = () => { if (!cancelled && img?.complete && img.naturalWidth > 0) setReady(true); };
    markReady();
    if (img && typeof img.decode === 'function') void img.decode().then(markReady, () => {});
    setZoom(1);
    zoomRef.current = 1;
    setBaseWidth(null);
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      const frame = frameRef.current;
      if (!frame || !ready || dragRef.current) return;
      event.preventDefault();
      const oldZoom = zoomRef.current;
      const nextZoom = clamp(oldZoom * Math.exp(-event.deltaY * 0.0015), 1, 4);
      if (nextZoom === oldZoom) return;
      const viewportBox = viewport.getBoundingClientRect();
      const x = event.clientX - viewportBox.left;
      const y = event.clientY - viewportBox.top;
      const frameBox = frame.getBoundingClientRect();
      const relativeX = (event.clientX - frameBox.left) / frameBox.width;
      const relativeY = (event.clientY - frameBox.top) / frameBox.height;
      if (baseWidth === null) setBaseWidth(frameBox.width / oldZoom);
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        const nextBox = frame.getBoundingClientRect();
        viewport.scrollLeft += nextBox.left + relativeX * nextBox.width - viewportBox.left - x;
        viewport.scrollTop += nextBox.top + relativeY * nextBox.height - viewportBox.top - y;
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [ready, baseWidth]);

  useEffect(() => {
    if (!activeFurnitureId || !showFurniture) return;
    const viewport = viewportRef.current;
    const frame = frameRef.current;
    if (!viewport || !frame) return;
    const marker = furnitureMarkers.find(item => item.id === activeFurnitureId);
    if (!marker) return;
    if (baseWidth === null) setBaseWidth(frame.getBoundingClientRect().width / zoomRef.current);
    const previousZoom = zoomRef.current;
    const nextZoom = Math.max(previousZoom, 2);
    const animateZoom = nextZoom !== previousZoom && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setFocusZooming(animateZoom);
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        const frameBox = frame.getBoundingClientRect();
        const viewBox = viewport.getBoundingClientRect();
        viewport.scrollTo({ left: viewport.scrollLeft + frameBox.left + frameBox.width * marker.x / 100 - viewBox.left - viewport.clientWidth / 2, top: viewport.scrollTop + frameBox.top + frameBox.height * marker.y / 100 - viewBox.top - viewport.clientHeight / 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        setFocusZooming(false);
      });
    }, animateZoom ? 320 : 0);
    return () => window.clearTimeout(timer);
  }, [activeFurnitureId, furnitureFocusRequest, showFurniture]);

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
    onBeforeEdit?.();
    const next = zonesRef.current.filter((row) => row.id !== id);
    zonesRef.current = next;
    onChange(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !ready || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-zone-delete], [data-zone-copy]')) return;
    const frame = frameRef.current;
    if (!frame) return;
    dragRecordedRef.current = false;
    const point = pointerPct(event, frame);
    if (showFurniture) {
      if (!onDrawFurniture) return;
      dragRef.current = { kind: 'draw', id: 'furniture-draft', x0: point.x, y0: point.y };
      setDraftRect({ id: 'furniture-draft', rect: { x: point.x, y: point.y, w: 0, h: 0 } });
      frame.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
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
    if (drag.kind !== 'draw' && !dragRecordedRef.current) {
      onBeforeEdit?.();
      dragRecordedRef.current = true;
    }
    const point = pointerPct(event, frame);
    if (drag.kind === 'furniture-move') {
      onMoveFurniture?.(drag.id, { ...drag.rect, x: clamp(point.x - drag.offsetX, 0, 100 - drag.rect.w), y: clamp(point.y - drag.offsetY, 0, 100 - drag.rect.h) });
      return;
    }
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
    if (drag.kind === 'furniture-move') return;
    if (drag.kind === 'draw') {
      const pending = draftRef.current;
      setDraftRect(null);
      if (drag.id === 'furniture-draft') {
        const rect = pending ? normalizeZoneRect(pending.rect, 0.2) : null;
        if (rect) onDrawFurniture?.(rect);
        return;
      }
      const rect = pending ? normalizeZoneRect(pending.rect, 3) : null;
      if (!rect || zonesRef.current.length >= MAX_FLOOR_PLAN_ZONES) return;
      onBeforeEdit?.();
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
    <div ref={viewportRef} className={`flex h-full w-full overflow-auto rounded-lg border border-border bg-muted/30 p-2 ${panEnabled ? 'cursor-grab active:cursor-grabbing touch-none' : ''} ${className ?? ''}`}
      onPointerDownCapture={event => {
        if (!panEnabled || event.button !== 0) return;
        const viewport = event.currentTarget;
        panRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => {
        const pan = panRef.current;
        if (!pan) return;
        event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x);
        event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y);
      }}
      onPointerUp={() => { panRef.current = null; }}
      onPointerCancel={() => { panRef.current = null; }}>
      <div className="flex shrink-0 box-content" style={{ minWidth: '100%', minHeight: '100%', padding: `${viewportSize.height * 0.5}px ${viewportSize.width * 0.5}px` }}>
      <div
        ref={frameRef}
        role="application"
        aria-label="Floor plan zones"
        className={`relative m-auto inline-block shrink-0 touch-none select-none ${baseWidth === null ? 'max-w-full' : ''} ${disabled || showFurniture ? '' : 'cursor-crosshair'}`}
        style={{ zoom, transition: focusZooming ? 'zoom 300ms ease-out' : undefined, ...(baseWidth !== null ? { width: baseWidth } : {}) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <LoadingImage
          src={src}
          alt=""
          className="max-h-[464px] max-w-full"
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
                  {showFurniture ? furnitureMarkers.map(marker => marker.rect ? <rect key={marker.id} x={marker.rect.x} y={marker.rect.y} width={marker.rect.w} height={marker.rect.h} fill="black" /> : <circle key={marker.id} cx={marker.x} cy={marker.y} r="1.5" fill="black" />) : zones.map((zone) => zone.rect ? (
                    <rect key={zone.id} x={zone.rect.x} y={zone.rect.y} width={zone.rect.w} height={zone.rect.h} fill="black" />
                  ) : null)}
                  {draft ? (
                    <rect x={draft.rect.x} y={draft.rect.y} width={draft.rect.w} height={draft.rect.h} fill="black" />
                  ) : null}
                </mask>
              </defs>
              <rect x="0" y="0" width="100" height="100" fill="rgba(15,23,42,0.38)" mask={`url(#${maskId})`} />
            </svg>
            {!showFurniture ? zones.map((zone, index) => {
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
                  {!showFurniture ? <span
                    className="pointer-events-none absolute left-1/2 top-1/2 z-[1] flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-body text-xs font-semibold leading-none text-white shadow-sm"
                    style={{ background: color }}
                  >
                    {display.number}
                  </span> : null}
                  {!disabled && (['nw', 'ne', 'sw', 'se'] as Corner[]).map((corner) => (
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
            }) : null}
            {showFurniture ? furnitureMarkers.map(marker => (
              <div key={marker.id} className="contents">
              {marker.rect ? <div aria-hidden className={`absolute box-border ${disabled ? 'pointer-events-none' : 'cursor-move'}`} style={{ left: `${marker.rect.x}%`, top: `${marker.rect.y}%`, width: `${marker.rect.w}%`, height: `${marker.rect.h}%`, border: `${marker.id === activeFurnitureId ? 3 : 2}px solid ${marker.color}`, background: `${marker.color}26` }} onPointerDown={event => {
                if (disabled || !onMoveFurniture || !marker.rect || event.button !== 0 || !frameRef.current) return;
                event.stopPropagation(); event.preventDefault();
                dragRecordedRef.current = false;
                const point = pointerPct(event, frameRef.current);
                dragRef.current = { kind: 'furniture-move', id: marker.id, rect: marker.rect, offsetX: point.x - marker.rect.x, offsetY: point.y - marker.rect.y };
                frameRef.current.setPointerCapture(event.pointerId);
              }} /> : null}
              <span key={marker.id} data-furniture-marker={marker.id} title={marker.description} aria-label={marker.description}
                className={`absolute z-20 flex h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white shadow-md ${marker.id === activeFurnitureId ? 'ring-2 ring-foreground ring-offset-2' : ''}`}
                style={{ left: `${marker.x}%`, top: `${marker.y}%`, background: marker.color }}
                onPointerDown={event => event.stopPropagation()}>
                {marker.id === activeFurnitureId ? <span className="absolute left-full top-1/2 ml-1 -translate-y-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold leading-none text-background shadow">{marker.label}</span> : null}
              </span>
              </div>
            )) : null}
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
    </div>
  );
}
