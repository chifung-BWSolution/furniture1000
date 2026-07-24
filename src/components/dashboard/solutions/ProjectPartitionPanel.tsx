import { useCallback, useEffect, useMemo, useState } from 'react';
import { DoorOpen, Loader2, Minus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createZone,
  deleteZone,
  fetchZoneProducts,
  fetchZones,
  saveProject,
  updateProjectFloorPlan,
} from '@/lib/solutionsApi';
import { generateFloorPlanDataUrl } from '@/lib/floorPlanGenerator';
import {
  PROJECT_TYPE_OPTIONS,
  codePrefixFromLabel,
  defaultRoomCounts,
  inferProjectType,
  projectTypeLabel,
  roomsForProjectType,
  zoneSeedsFromRoomCounts,
  type ProjectEngineeringType,
  type RoomTypeTemplate,
} from '@/lib/projectPartitionTemplates';
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
    const match = rooms.find(
      (room) =>
        zone.name === room.label ||
        zone.name.startsWith(`${room.label} `) ||
        zone.code?.startsWith(room.codePrefix),
    );
    if (match) counts[match.key] = (counts[match.key] || 0) + 1;
  }
  return counts;
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
  const [projectType, setProjectType] =
    useState<ProjectEngineeringType>(initialType);
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>(
    project.meta?.roomCounts || defaultRoomCounts(initialType),
  );
  const [customRooms, setCustomRooms] = useState<CustomRoomType[]>(
    normalizeCustomRooms(project.meta?.customRooms),
  );
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [zoneProducts, setZoneProducts] = useState<ZoneProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoomLabel, setNewRoomLabel] = useState('');
  const [newRoomQty, setNewRoomQty] = useState(1);

  const roomTemplates = useMemo(
    () => roomsForProjectType(projectType),
    [projectType],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchZones(project.id), fetchZoneProducts(project.id)])
      .then(([loadedZones, loadedProducts]) => {
        if (cancelled) return;
        setZones(loadedZones);
        setZoneProducts(loadedProducts);
        const type =
          project.meta?.projectType ||
          inferProjectType(project.name, project.clientCompany);
        const nextCustom = normalizeCustomRooms(project.meta?.customRooms);
        setProjectType(type);
        setCustomRooms(nextCustom);
        setRoomCounts(
          project.meta?.roomCounts &&
            Object.keys(project.meta.roomCounts).length > 0
            ? {
                ...defaultRoomCounts(type),
                ...Object.fromEntries(
                  nextCustom.map((room) => [room.key, 0]),
                ),
                ...project.meta.roomCounts,
              }
            : loadedZones.length > 0
              ? countRoomsFromZones(type, loadedZones, nextCustom)
              : defaultRoomCounts(type),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  const syncZones = useCallback(
    async (
      type: ProjectEngineeringType,
      counts: Record<string, number>,
      nextCustomRooms: CustomRoomType[],
    ): Promise<boolean> => {
      if (syncing) return false;
      setSyncing(true);
      try {
        const desired = zoneSeedsFromRoomCounts(
          type,
          counts,
          nextCustomRooms as RoomTypeTemplate[],
        );
        const zonesWithProducts = new Set(
          zoneProducts.map((p) => p.zoneId).filter(Boolean),
        );
        const kept = zones.filter((z) => zonesWithProducts.has(z.id));
        const empty = zones.filter((z) => !zonesWithProducts.has(z.id));
        for (const zone of empty) await deleteZone(zone.id);

        const nextZones = [...kept];
        for (let i = 0; i < desired.length; i++) {
          const seed = desired[i];
          const existing = kept.find(
            (z) => z.name === seed.name || z.code === seed.code,
          );
          if (existing) continue;
          const result = await createZone({
            projectId: project.id,
            name: seed.name,
            code: seed.code,
            bounds: seed.bounds,
            aiSuggested: true,
            sortOrder: i,
          });
          if (!result.ok) throw new Error(result.error || '建立間隔失敗');
          if (result.data) nextZones.push(result.data);
        }

        const meta = {
          ...project.meta,
          projectType: type,
          roomCounts: counts,
          customRooms: nextCustomRooms,
        };
        const saved = await saveProject(project.id, { meta });
        if (!saved.ok) throw new Error(saved.error || '儲存專案失敗');

        // Do not overwrite a user-uploaded PDF/JPG floor plan.
        if (
          !project.floorPlanUrl ||
          project.floorPlanType === 'image/svg+xml'
        ) {
          const dataUrl = generateFloorPlanDataUrl(nextZones, project.name);
          const floorSaved = await updateProjectFloorPlan(
            project.id,
            dataUrl,
            'image/svg+xml',
          );
          if (floorSaved.ok) {
            onProjectFloorPlanChange?.(project.id, dataUrl, 'image/svg+xml');
          }
        }
        setZones(nextZones);
        onProjectMetaChange?.(project.id, meta);
        return true;
      } catch (error) {
        toast.error('更新間隔失敗', {
          description:
            error instanceof Error ? error.message : '請稍後再試',
        });
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [
      onProjectFloorPlanChange,
      onProjectMetaChange,
      project,
      syncing,
      zoneProducts,
      zones,
    ],
  );

  const changeType = async (type: ProjectEngineeringType) => {
    const previousType = projectType;
    const previousCounts = roomCounts;
    const counts = {
      ...defaultRoomCounts(type),
      ...Object.fromEntries(
        customRooms.map((room) => [room.key, roomCounts[room.key] || 0]),
      ),
    };
    setProjectType(type);
    setRoomCounts(counts);
    if (!(await syncZones(type, counts, customRooms))) {
      setProjectType(previousType);
      setRoomCounts(previousCounts);
    }
  };

  const changeQty = async (key: string, delta: number) => {
    const previous = roomCounts;
    const next = {
      ...roomCounts,
      [key]: Math.max(0, Math.min(20, (roomCounts[key] || 0) + delta)),
    };
    setRoomCounts(next);
    if (!(await syncZones(projectType, next, customRooms))) {
      setRoomCounts(previous);
    }
  };

  const addCustomRoom = async () => {
    const label = newRoomLabel.trim();
    if (!label) {
      toast.error('請輸入房間類型');
      return;
    }
    if (
      roomTemplates.some((room) => room.label === label) ||
      customRooms.some((room) => room.label === label)
    ) {
      toast.error('此房間類型已存在');
      return;
    }
    const qty = Math.max(1, Math.min(20, Math.floor(newRoomQty || 1)));
    const key = `custom_${Date.now().toString(36)}`;
    const nextCustom = [
      ...customRooms,
      { key, label, codePrefix: codePrefixFromLabel(label) },
    ];
    const nextCounts = { ...roomCounts, [key]: qty };
    const previousCustom = customRooms;
    const previousCounts = roomCounts;
    setCustomRooms(nextCustom);
    setRoomCounts(nextCounts);
    if (!(await syncZones(projectType, nextCounts, nextCustom))) {
      setCustomRooms(previousCustom);
      setRoomCounts(previousCounts);
      return;
    }
    setShowAddRoom(false);
    setNewRoomLabel('');
    setNewRoomQty(1);
    toast.success('已新增房間並儲存', { description: `${label} × ${qty}` });
  };

  const deleteCustomRoom = async (key: string) => {
    const target = customRooms.find((room) => room.key === key);
    if (!target) return;
    if (!window.confirm(`確定刪除自訂房間「${target.label}」？`)) return;
    const previousCustom = customRooms;
    const previousCounts = roomCounts;
    const nextCustom = customRooms.filter((room) => room.key !== key);
    const nextCounts = { ...roomCounts };
    delete nextCounts[key];
    setCustomRooms(nextCustom);
    setRoomCounts(nextCounts);
    if (!(await syncZones(projectType, nextCounts, nextCustom))) {
      setCustomRooms(previousCustom);
      setRoomCounts(previousCounts);
      return;
    }
    toast.success('已刪除自訂房間', { description: target.label });
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
            在此設定工程類型及房間數量，再進入「設計專案」為每個間隔加入產品。
          </p>
        </div>
        {syncing ? (
          <span className="inline-flex items-center gap-2 text-[15px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在同步
          </span>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-[15px] font-semibold text-muted-foreground">
          工程類型（決定可見房間）
        </p>
        <div className="flex flex-wrap gap-2">
          {PROJECT_TYPE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={syncing}
              onClick={() => void changeType(option.id)}
              className={cn(
                'rounded-full border px-3.5 py-2 text-[15px] font-medium transition-colors disabled:opacity-50',
                projectType === option.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px] font-semibold text-muted-foreground">
            房間類型及數量 — {projectTypeLabel(projectType)}
          </p>
          <button
            type="button"
            disabled={syncing}
            onClick={() => setShowAddRoom((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            新增房間
          </button>
        </div>

        {showAddRoom ? (
          <div className="mb-3 rounded-xl border border-primary/25 bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">新增房間類型</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  輸入房間類型及數量後會即時顯示，並儲存至專案資料。
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
                  disabled={syncing}
                  onClick={() => void addCustomRoom()}
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 sm:w-auto"
                >
                  確定新增
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...roomTemplates, ...customRooms].map((room) => {
            const isCustom = room.key.startsWith('custom_');
            return (
              <div
                key={room.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{room.label}</span>
                  {isCustom ? (
                    <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      自訂
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void changeQty(room.key, -1)}
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
                    disabled={syncing}
                    onClick={() => void changeQty(room.key, 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary disabled:opacity-40"
                    aria-label={`增加${room.label}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  {isCustom ? (
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => void deleteCustomRoom(room.key)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/30 text-rose-700 hover:bg-rose-500/10 disabled:opacity-40"
                      aria-label={`刪除${room.label}`}
                      title="刪除自訂房間"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[15px] text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          已配置產品的間隔會保留；調整後會同步更新未配置產品的間隔。
        </p>
      </div>
    </div>
  );
}
