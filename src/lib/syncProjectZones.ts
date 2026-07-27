/**
 * Sync project_zones rows to match room seeds derived from design_projects.meta.
 * Match by zone name (not code) — custom Chinese rooms often share codePrefix "CR".
 */
import {
  createZone,
  deleteZone,
  updateZone,
  type WriteResult,
} from '@/lib/solutionsApi';
import type { ZoneBounds } from '@/types/solutions';
import type { ProjectZone, ZoneProduct } from '@/types/solutions';

export type ZoneSeed = {
  code: string;
  name: string;
  bounds: ZoneBounds;
  roomKey?: string;
};

export async function syncProjectZones(options: {
  projectId: string;
  desired: ZoneSeed[];
  zones: ProjectZone[];
  zoneProducts: ZoneProduct[];
  /** Delete empty zones that are not in the desired list. Default true. */
  pruneEmpty?: boolean;
  /**
   * Delete leftover zones whose names are not in desired (including ones with
   * products — products are unassigned via deleteZone). Used by 設計專案 to
   * mirror 方案列表 exactly.
   */
  dropOrphanZones?: boolean;
}): Promise<WriteResult<ProjectZone[]>> {
  const {
    projectId,
    desired,
    zones,
    zoneProducts,
    pruneEmpty = true,
    dropOrphanZones = false,
  } = options;

  try {
    const zonesWithProducts = new Set(
      zoneProducts.map((p) => p.zoneId).filter(Boolean) as string[],
    );
    const kept = zones.filter((z) => zonesWithProducts.has(z.id));
    const empty = zones.filter((z) => !zonesWithProducts.has(z.id));

    if (pruneEmpty) {
      for (const zone of empty) {
        const result = await deleteZone(zone.id);
        if (!result.ok) {
          return { ok: false, error: result.error || '刪除間隔失敗' };
        }
      }
    }

    const pool = pruneEmpty ? [...kept] : [...zones];
    const usedIds = new Set<string>();

    for (let i = 0; i < desired.length; i++) {
      const seed = desired[i];
      const existing = pool.find(
        (z) => !usedIds.has(z.id) && z.name === seed.name,
      );
      if (existing) {
        usedIds.add(existing.id);
        const patch: {
          code?: string | null;
          sortOrder?: number;
          bounds?: ZoneBounds;
        } = {};
        if (existing.code !== seed.code) patch.code = seed.code;
        if (existing.sortOrder !== i) patch.sortOrder = i;
        if (Object.keys(patch).length > 0) {
          const updated = await updateZone(existing.id, patch);
          if (!updated.ok) {
            return { ok: false, error: updated.error || '更新間隔失敗' };
          }
          Object.assign(existing, {
            code: seed.code,
            sortOrder: i,
          });
        }
        continue;
      }

      const created = await createZone({
        projectId,
        name: seed.name,
        code: seed.code,
        bounds: seed.bounds,
        aiSuggested: true,
        sortOrder: i,
      });
      if (!created.ok || !created.data) {
        return { ok: false, error: created.error || '建立間隔失敗' };
      }
      pool.push(created.data);
      usedIds.add(created.data.id);
    }

    const orderedZones: ProjectZone[] = [];
    const orderedIds = new Set<string>();
    for (let i = 0; i < desired.length; i++) {
      const seed = desired[i];
      const match = pool.find(
        (z) => !orderedIds.has(z.id) && z.name === seed.name,
      );
      if (!match) continue;
      orderedIds.add(match.id);
      orderedZones.push({ ...match, code: seed.code, sortOrder: i });
    }

    // Leftover zones not in 方案列表 desired names.
    for (const zone of pool) {
      if (orderedIds.has(zone.id)) continue;
      if (dropOrphanZones) {
        const removed = await deleteZone(zone.id);
        if (!removed.ok) {
          return { ok: false, error: removed.error || '刪除多餘間隔失敗' };
        }
        continue;
      }
      const sortOrder = orderedZones.length;
      if (zone.sortOrder !== sortOrder) {
        const updated = await updateZone(zone.id, { sortOrder });
        if (!updated.ok) {
          return { ok: false, error: updated.error || '更新排序失敗' };
        }
      }
      orderedZones.push({ ...zone, sortOrder });
      orderedIds.add(zone.id);
    }

    return { ok: true, data: orderedZones };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : '同步間隔失敗',
    };
  }
}

/** True when meta room seeds are missing from the current zones list (by name). */
export function zonesMissingFromSeeds(
  desired: ZoneSeed[],
  zones: ProjectZone[],
): boolean {
  if (desired.length === 0) return false;
  const names = new Set(zones.map((z) => z.name));
  return desired.some((seed) => !names.has(seed.name));
}

/** True when zones don't match 方案列表 seeds (missing, extras, or count drift). */
export function zonesOutOfSyncWithSeeds(
  desired: ZoneSeed[],
  zones: ProjectZone[],
): boolean {
  if (zonesMissingFromSeeds(desired, zones)) return true;
  const desiredCount = new Map<string, number>();
  for (const seed of desired) {
    desiredCount.set(seed.name, (desiredCount.get(seed.name) || 0) + 1);
  }
  const zoneCount = new Map<string, number>();
  for (const zone of zones) {
    zoneCount.set(zone.name, (zoneCount.get(zone.name) || 0) + 1);
  }
  if (desiredCount.size !== zoneCount.size) return true;
  for (const [name, count] of desiredCount) {
    if ((zoneCount.get(name) || 0) !== count) return true;
  }
  for (const name of zoneCount.keys()) {
    if (!desiredCount.has(name)) return true;
  }
  return false;
}
