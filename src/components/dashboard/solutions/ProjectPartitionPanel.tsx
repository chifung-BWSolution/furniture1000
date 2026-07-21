import { useCallback, useEffect, useMemo, useState } from 'react';
import { DoorOpen, Loader2, Minus, Plus, Sparkles } from 'lucide-react';
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
  defaultRoomCounts,
  inferProjectType,
  projectTypeLabel,
  roomsForProjectType,
  zoneSeedsFromRoomCounts,
  type ProjectEngineeringType,
} from '@/lib/projectPartitionTemplates';
import type { DesignProject, ProjectZone, ZoneProduct } from '@/types/solutions';
import { toast } from 'sonner';

function countRoomsFromZones(
  type: ProjectEngineeringType,
  zones: ProjectZone[],
): Record<string, number> {
  const rooms = roomsForProjectType(type);
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
}: {
  project: DesignProject;
  onProjectMetaChange?: (projectId: string, meta: DesignProject['meta']) => void;
}) {
  const initialType =
    project.meta?.projectType ||
    inferProjectType(project.name, project.clientCompany);
  const [projectType, setProjectType] =
    useState<ProjectEngineeringType>(initialType);
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>(
    project.meta?.roomCounts || defaultRoomCounts(initialType),
  );
  const [zones, setZones] = useState<ProjectZone[]>([]);
  const [zoneProducts, setZoneProducts] = useState<ZoneProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
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
        setProjectType(type);
        setRoomCounts(
          project.meta?.roomCounts &&
            Object.keys(project.meta.roomCounts).length > 0
            ? { ...defaultRoomCounts(type), ...project.meta.roomCounts }
            : loadedZones.length > 0
              ? countRoomsFromZones(type, loadedZones)
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
    ): Promise<boolean> => {
      if (syncing) return false;
      setSyncing(true);
      try {
        const desired = zoneSeedsFromRoomCounts(type, counts);
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
        };
        const saved = await saveProject(project.id, { meta });
        if (!saved.ok) throw new Error(saved.error || '儲存專案失敗');

        // Do not overwrite a user-uploaded PDF/JPG floor plan.
        if (
          !project.floorPlanUrl ||
          project.floorPlanType === 'image/svg+xml'
        ) {
          const dataUrl = generateFloorPlanDataUrl(nextZones, project.name);
          await updateProjectFloorPlan(
            project.id,
            dataUrl,
            'image/svg+xml',
          );
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
    [onProjectMetaChange, project, syncing, zoneProducts, zones],
  );

  const changeType = async (type: ProjectEngineeringType) => {
    const previousType = projectType;
    const previousCounts = roomCounts;
    const counts = defaultRoomCounts(type);
    setProjectType(type);
    setRoomCounts(counts);
    if (!(await syncZones(type, counts))) {
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
    if (!(await syncZones(projectType, next))) setRoomCounts(previous);
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
        <p className="mb-2 text-[15px] font-semibold text-muted-foreground">
          房間類型及數量 — {projectTypeLabel(projectType)}
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roomTemplates.map((room) => (
            <div
              key={room.key}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span className="text-sm font-medium">{room.label}</span>
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
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[15px] text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          已配置產品的間隔會保留；調整後會同步更新未配置產品的間隔。
        </p>
      </div>
    </div>
  );
}
