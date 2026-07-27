import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DoorOpen,
  GripVertical,
  Loader2,
  Minus,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchZoneProducts,
  fetchZones,
  saveProject,
  updateProjectFloorPlan,
} from '@/lib/solutionsApi';
import { generateFloorPlanDataUrl } from '@/lib/floorPlanGenerator';
import {
  PROJECT_TYPE_OPTIONS,
  EXCLUDED_DEFAULT_ROOM_KEYS,
  codePrefixFromLabel,
  defaultRoomCounts,
  inferProjectType,
  normalizeRoomOrder,
  orderedRoomsForProjectType,
  projectTypeLabel,
  roomsForProjectType,
  zoneSeedsFromRoomCounts,
  zeroRoomCounts,
  type ProjectEngineeringType,
  type RoomTypeTemplate,
  type TypeRoomsSnapshot,
} from '@/lib/projectPartitionTemplates';
import { syncProjectZones } from '@/lib/syncProjectZones';
import type {
  CustomRoomType,
  DesignProject,
  ProjectZone,
  ZoneProduct,
} from '@/types/solutions';
import { toast } from 'sonner';

function normalizeCustomRooms(value: unknown): CustomRoomType[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const key = String(row.key || '').trim();
      const label = String(row.label || '').trim();
      const codePrefix = String(row.codePrefix || '').trim() || 'CR';
      if (!key || !label) return null;
      return { key, label, codePrefix };
    })
    .filter((item): item is CustomRoomType => Boolean(item));
}

function countRoomsFromZones(
  type: ProjectEngineeringType,
  zones: ProjectZone[],
  customRooms: CustomRoomType[],
): Record<string, number> {
  const rooms = [...roomsForProjectType(type), ...customRooms];
  const counts = defaultRoomCounts(type);
  for (const room of rooms) counts[room.key] = 0;
  for (const zone of zones) {
    // Match by name only — custom Chinese rooms often share codePrefix "CR".
    const match = rooms.find(
      (room) =>
        zone.name === room.label || zone.name.startsWith(`${room.label} `),
    );
    if (match) counts[match.key] = (counts[match.key] || 0) + 1;
  }
  return counts;
}

function defaultOrderFor(
  type: ProjectEngineeringType,
  customRooms: CustomRoomType[],
): string[] {
  return [
    ...roomsForProjectType(type).map((room) => room.key),
    ...customRooms.map((room) => room.key),
  ];
}

function resolveRoomOrder(
  type: ProjectEngineeringType,
  customRooms: CustomRoomType[],
  /** null = never saved → use full template; array (even empty) = honor exactly */
  savedOrder: string[] | null,
): string[] {
  if (savedOrder == null) return defaultOrderFor(type, customRooms);
  // Honor the saved list exactly — never re-inject deleted template rooms.
  const known = new Set(defaultOrderFor(type, customRooms));
  const next = savedOrder.filter(
    (key) => known.has(key) && !EXCLUDED_DEFAULT_ROOM_KEYS.has(key),
  );
  // Keep custom rooms that exist in meta but are missing from order (recovery only).
  for (const room of customRooms) {
    if (!next.includes(room.key)) next.push(room.key);
  }
  return next;
}

function countsForOrder(
  order: string[],
  savedCounts: Record<string, number> | null | undefined,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const key of order) {
    next[key] = Math.max(0, Number(savedCounts?.[key]) || 0);
  }
  return next;
}

function normalizeTypeSnapshot(value: unknown): TypeRoomsSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const customRooms = normalizeCustomRooms(row.customRooms);
  const hasOrder = Array.isArray(row.roomOrder);
  const roomOrder = hasOrder ? normalizeRoomOrder(row.roomOrder) : [];
  const roomCounts =
    row.roomCounts && typeof row.roomCounts === 'object'
      ? countsForOrder(
          roomOrder.length > 0
            ? roomOrder
            : customRooms.map((room) => room.key),
          row.roomCounts as Record<string, number>,
        )
      : {};
  return {
    roomOrder,
    roomCounts,
    customRooms: customRooms as RoomTypeTemplate[],
  };
}

function normalizeRoomsByType(
  value: unknown,
): Partial<Record<ProjectEngineeringType, TypeRoomsSnapshot>> {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const next: Partial<Record<ProjectEngineeringType, TypeRoomsSnapshot>> = {};
  for (const option of PROJECT_TYPE_OPTIONS) {
    const snap = normalizeTypeSnapshot(raw[option.id]);
    if (snap) next[option.id] = snap;
  }
  return next;
}

function snapshotFromState(
  roomOrder: string[],
  roomCounts: Record<string, number>,
  customRooms: CustomRoomType[],
): TypeRoomsSnapshot {
  return {
    roomOrder: [...roomOrder],
    roomCounts: { ...roomCounts },
    customRooms: customRooms.map((room) => ({ ...room })),
  };
}

export function ProjectPartitionPanel({
  project,
  onProjectMetaChange,
  onProjectFloorPlanChange,
}: {
  project: DesignProject;
  onProjectMetaChange?: (projectId: string, meta: DesignProject['meta']) => void;
  onProjectFloorPlanChange?: (
    projectId: string,
    floorPlanUrl: string,
    floorPlanType: string,
  ) => void;
}) {
  const initialType =
    project.meta?.projectType ||
    inferProjectType(project.name, project.clientCompany);
  const initialCustom = normalizeCustomRooms(project.meta?.customRooms);
  const initialHasSavedOrder = Array.isArray(project.meta?.roomOrder);
  const initialOrder = resolveRoomOrder(
    initialType,
    initialCustom,
    initialHasSavedOrder ? normalizeRoomOrder(project.meta?.roomOrder) : null,
  );
  const initialCounts =
    initialHasSavedOrder ||
    (project.meta?.roomCounts &&
      Object.keys(project.meta.roomCounts).length > 0)
      ? countsForOrder(initialOrder, project.meta?.roomCounts)
      : defaultRoomCounts(initialType);
  const initialRoomsByType = (() => {
    const cached = normalizeRoomsByType(project.meta?.roomsByType);
    // Always hydrate the active saved type from top-level meta so reopen
    // shows the last「儲存」version, not stale per-type drafts.
    cached[initialType] = snapshotFromState(
      initialOrder,
      initialCounts,
      initialCustom,
    );
    return cached;
  })();
  const [projectType, setProjectType] =
    useState<ProjectEngineeringType>(initialType);
  const [roomCounts, setRoomCounts] =
    useState<Record<string, number>>(initialCounts);
  const [customRooms, setCustomRooms] =
    useState<CustomRoomType[]>(initialCustom);
  const [roomOrder, setRoomOrder] = useState<string[]>(initialOrder);
  const [roomsByType, setRoomsByType] =
    useState<Partial<Record<ProjectEngineeringType, TypeRoomsSnapshot>>>(
      initialRoomsByType,
    );
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [zoneProducts, setZoneProducts] = useState<ZoneProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoomLabel, setNewRoomLabel] = useState('');
  const [newRoomQty, setNewRoomQty] = useState(1);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const roomTemplates = useMemo(
    () => roomsForProjectType(projectType),
    [projectType],
  );
  const orderedRooms = useMemo(
    () =>
      orderedRoomsForProjectType(
        projectType,
        customRooms as RoomTypeTemplate[],
        roomOrder,
      ).filter((room) => !EXCLUDED_DEFAULT_ROOM_KEYS.has(room.key)),
    [projectType, customRooms, roomOrder],
  );

  const applyTypeSnapshot = (
    type: ProjectEngineeringType,
    snap: TypeRoomsSnapshot | undefined,
  ) => {
    if (snap) {
      const nextCustom = normalizeCustomRooms(snap.customRooms);
      const nextOrder = resolveRoomOrder(
        type,
        nextCustom,
        Array.isArray(snap.roomOrder) ? normalizeRoomOrder(snap.roomOrder) : null,
      );
      setCustomRooms(nextCustom);
      setRoomOrder(nextOrder);
      setRoomCounts(countsForOrder(nextOrder, snap.roomCounts));
      return;
    }
    // No draft for this type yet → show that type's default room list at qty 0.
    const nextCustom: CustomRoomType[] = [];
    const nextOrder = defaultOrderFor(type, nextCustom);
    setCustomRooms(nextCustom);
    setRoomOrder(nextOrder);
    setRoomCounts(zeroRoomCounts(type));
  };

  const changeType = (type: ProjectEngineeringType) => {
    // Single-select only: re-clicking current type is a no-op (keeps saved edits).
    if (type === projectType) return;
    // Stash the current type's draft, then load the target type's draft or
    // its template rooms with quantity 0. Unsaved leave remounts from meta.
    const nextCache = {
      ...roomsByType,
      [projectType]: snapshotFromState(roomOrder, roomCounts, customRooms),
    };
    setRoomsByType(nextCache);
    setProjectType(type);
    applyTypeSnapshot(type, nextCache[type]);
    setDirty(true);
    toast.message(`已選擇「${projectTypeLabel(type)}」`, {
      description: nextCache[type]
        ? '已還原此工程類型上次的房間設定；請按「儲存」才會寫入專案'
        : '已載入此工程類型的預設房間（數量為 0）；請按「儲存」才會寫入專案',
    });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDirty(false);
    Promise.all([fetchZones(project.id), fetchZoneProducts(project.id)])
      .then(([loadedZones, loadedProducts]) => {
        if (cancelled) return;
        setZones(loadedZones);
        setZoneProducts(loadedProducts);
        const type =
          project.meta?.projectType ||
          inferProjectType(project.name, project.clientCompany);
        const nextCustom = normalizeCustomRooms(project.meta?.customRooms);
        // Distinguish missing roomOrder (legacy) vs intentionally saved list (even empty).
        const hasSavedOrder = Array.isArray(project.meta?.roomOrder);
        const savedOrder = hasSavedOrder
          ? normalizeRoomOrder(project.meta?.roomOrder)
          : null;
        const nextOrder = resolveRoomOrder(type, nextCustom, savedOrder);
        const savedCounts =
          project.meta?.roomCounts &&
          typeof project.meta.roomCounts === 'object'
            ? project.meta.roomCounts
            : null;
        const hasSavedCounts = Boolean(
          savedCounts && Object.keys(savedCounts).length > 0,
        );

        let nextCounts: Record<string, number>;
        // Never re-merge template defaultRoomCounts over a user save — that
        // reintroduces deleted room types with qty 1 on reopen.
        if (hasSavedOrder || hasSavedCounts) {
          nextCounts = countsForOrder(nextOrder, savedCounts);
        } else if (loadedZones.length > 0) {
          nextCounts = countRoomsFromZones(type, loadedZones, nextCustom);
        } else {
          nextCounts = defaultRoomCounts(type);
        }

        const cached = normalizeRoomsByType(project.meta?.roomsByType);
        cached[type] = snapshotFromState(nextOrder, nextCounts, nextCustom);

        setProjectType(type);
        setCustomRooms(nextCustom);
        setRoomOrder(nextOrder);
        setRoomCounts(nextCounts);
        setRoomsByType(cached);

        // Existing projects may still contain removed defaults — prompt save cleanup.
        if (
          (savedOrder || []).some((key) => EXCLUDED_DEFAULT_ROOM_KEYS.has(key))
        ) {
          setDirty(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  const persistCurrentRooms = useCallback(async (): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      const nextOrder = roomOrder;
      const nextCustom = customRooms;
      const desired = zoneSeedsFromRoomCounts(
        projectType,
        roomCounts,
        nextCustom as RoomTypeTemplate[],
        nextOrder,
      );
      const synced = await syncProjectZones({
        projectId: project.id,
        desired,
        zones,
        zoneProducts,
        pruneEmpty: true,
      });
      if (!synced.ok || !synced.data) {
        throw new Error(synced.error || '同步間隔失敗');
      }
      const orderedZones = synced.data;

      // Keep counts only for currently visible rooms.
      const visibleCounts: Record<string, number> = {};
      for (const key of nextOrder) {
        visibleCounts[key] = Math.max(0, roomCounts[key] || 0);
      }

      const nextRoomsByType = {
        ...roomsByType,
        [projectType]: snapshotFromState(
          nextOrder,
          visibleCounts,
          nextCustom,
        ),
      };

      const meta = {
        ...project.meta,
        projectType,
        roomCounts: visibleCounts,
        customRooms: nextCustom,
        roomOrder: nextOrder,
        roomsByType: nextRoomsByType,
      };
      const saved = await saveProject(project.id, { meta });
      if (!saved.ok) throw new Error(saved.error || '儲存專案失敗');

      if (
        !project.floorPlanUrl ||
        project.floorPlanType === 'image/svg+xml'
      ) {
        const dataUrl = generateFloorPlanDataUrl(orderedZones, project.name);
        const floorSaved = await updateProjectFloorPlan(
          project.id,
          dataUrl,
          'image/svg+xml',
        );
        if (floorSaved.ok) {
          onProjectFloorPlanChange?.(project.id, dataUrl, 'image/svg+xml');
        }
      }

      setZones(orderedZones);
      setCustomRooms(nextCustom);
      setRoomCounts(visibleCounts);
      setRoomOrder(nextOrder);
      setRoomsByType(nextRoomsByType);
      setDirty(false);
      onProjectMetaChange?.(project.id, meta);
      toast.success('已儲存房間設定', {
        description: `${orderedRooms.length} 種房間類型已寫入專案`,
      });
      return true;
    } catch (error) {
      toast.error('儲存失敗', {
        description:
          error instanceof Error ? error.message : '請稍後再試',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    customRooms,
    onProjectFloorPlanChange,
    onProjectMetaChange,
    orderedRooms.length,
    project,
    projectType,
    roomCounts,
    roomOrder,
    roomsByType,
    saving,
    zoneProducts,
    zones,
  ]);

  const changeQty = (key: string, delta: number) => {
    setRoomCounts((current) => ({
      ...current,
      [key]: Math.max(0, Math.min(20, (current[key] || 0) + delta)),
    }));
    setDirty(true);
  };

  const addCustomRoom = () => {
    const label = newRoomLabel.trim();
    if (!label) {
      toast.error('請輸入房間類型');
      return;
    }
    if (
      roomTemplates.some((room) => room.label === label) ||
      customRooms.some((room) => room.label === label) ||
      orderedRooms.some((room) => room.label === label)
    ) {
      toast.error('此房間類型已存在');
      return;
    }
    const qty = Math.max(1, Math.min(20, Math.floor(newRoomQty || 1)));
    const key = `custom_${Date.now().toString(36)}`;
    setCustomRooms((current) => [
      ...current,
      { key, label, codePrefix: codePrefixFromLabel(label) },
    ]);
    setRoomCounts((current) => ({ ...current, [key]: qty }));
    setRoomOrder((current) => [...current, key]);
    setShowAddRoom(false);
    setNewRoomLabel('');
    setNewRoomQty(1);
    setDirty(true);
    toast.message('已加入房間', {
      description: '請按「儲存」寫入專案資料',
    });
  };

  const deleteRoom = (key: string) => {
    const target = orderedRooms.find((room) => room.key === key);
    if (!target) return;
    if (!window.confirm(`確定刪除房間類型「${target.label}」？`)) return;
    setCustomRooms((current) => current.filter((room) => room.key !== key));
    setRoomCounts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setRoomOrder((current) => current.filter((item) => item !== key));
    setDirty(true);
    toast.message('已移除房間類型', {
      description: '請按「儲存」更新專案資料',
    });
  };

  const reorderRooms = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const keys = orderedRooms.map((room) => room.key);
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(toKey);
    if (from < 0 || to < 0) return;
    const next = [...keys];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRoomOrder(next);
    setDirty(true);
  };

  if (loading) {
    return (
      <div className="flex justify-center border-t border-border py-10">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5 border-t border-border bg-muted/15 p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="inline-flex items-center gap-2 font-display text-base font-bold">
            <DoorOpen className="h-5 w-5 text-primary" />
            間隔／功能房間
          </h3>
          <p className="mt-1 text-[15px] text-muted-foreground">
            在此設定工程類型及房間數量；完成後按「儲存」寫入專案資料。
          </p>
        </div>
        {saving ? (
          <span className="inline-flex items-center gap-2 text-[15px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在儲存
          </span>
        ) : dirty ? (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700">
            尚未儲存
          </span>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-[15px] font-semibold text-muted-foreground">
          工程類型（單選；各類型有獨立預設房間，切換後請按儲存才會寫入）
        </p>
        <div className="flex flex-wrap gap-2">
          {PROJECT_TYPE_OPTIONS.map((option) => {
            const selected = projectType === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={saving}
                onClick={() => changeType(option.id)}
                aria-pressed={selected}
                className={cn(
                  'rounded-full border px-3.5 py-2 text-[15px] font-medium transition-colors disabled:opacity-50',
                  selected
                    ? 'border-primary bg-primary/10 text-primary shadow-sm'
                    : 'border-transparent bg-muted/50 text-muted-foreground/45 hover:bg-muted hover:text-muted-foreground/70',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[15px] font-semibold text-muted-foreground">
              房間類型及數量 — {projectTypeLabel(projectType)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              可拖曳排序、刪除房間；按「儲存」後才寫入資料庫
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void persistCurrentRooms()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              儲存
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setShowAddRoom((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              新增房間
            </button>
          </div>
        </div>

        {showAddRoom ? (
          <div className="mb-3 rounded-xl border border-primary/25 bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">新增房間類型</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  輸入房間類型及數量後會先顯示在列表，再按「儲存」寫入專案。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddRoom(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="關閉新增房間"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1.4fr_0.6fr_auto]">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  房間類型
                </span>
                <input
                  value={newRoomLabel}
                  onChange={(event) => setNewRoomLabel(event.target.value)}
                  placeholder="例如：培訓室"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  數量
                </span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={newRoomQty}
                  onChange={(event) =>
                    setNewRoomQty(Number(event.target.value) || 1)
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={addCustomRoom}
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 sm:w-auto"
                >
                  確定新增
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {orderedRooms.map((room) => {
            const isCustom = room.key.startsWith('custom_');
            const dragging = dragKey === room.key;
            const over = dragOverKey === room.key && dragKey !== room.key;
            return (
              <div
                key={room.key}
                draggable={!saving}
                onDragStart={(event) => {
                  setDragKey(room.key);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', room.key);
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setDragOverKey(null);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (dragOverKey !== room.key) setDragOverKey(room.key);
                }}
                onDragLeave={() => {
                  if (dragOverKey === room.key) setDragOverKey(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const fromKey =
                    event.dataTransfer.getData('text/plain') || dragKey;
                  setDragOverKey(null);
                  setDragKey(null);
                  if (fromKey) reorderRooms(fromKey, room.key);
                }}
                className={cn(
                  'flex cursor-grab items-center justify-between gap-3 rounded-xl border bg-card px-3 py-3 active:cursor-grabbing',
                  dragging
                    ? 'border-primary/50 opacity-60'
                    : over
                      ? 'border-primary bg-primary/5'
                      : 'border-border',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{room.label}</span>
                    {isCustom ? (
                      <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        自訂
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => changeQty(room.key, -1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary disabled:opacity-40"
                    aria-label={`減少${room.label}`}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-7 text-center font-mono-data text-sm font-bold">
                    {roomCounts[room.key] || 0}
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => changeQty(room.key, 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary disabled:opacity-40"
                    aria-label={`增加${room.label}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => deleteRoom(room.key)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/30 text-rose-700 hover:bg-rose-500/10 disabled:opacity-40"
                    aria-label={`刪除${room.label}`}
                    title="刪除房間類型"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {orderedRooms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            尚未有房間類型，請按「新增房間」或先儲存前選擇工程類型預設房間。
          </div>
        ) : null}
        <p className="mt-3 flex items-center gap-1.5 text-[15px] text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          切換工程類型會載入該類型房間（未設定過則數量為 0）；已儲存的類型會還原上次設定。按「儲存」才會寫入專案。
        </p>
      </div>
    </div>
  );
}
