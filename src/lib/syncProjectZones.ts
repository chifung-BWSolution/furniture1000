/**
 * Sync project_zones rows to match room seeds derived from design_projects.meta.
 *
 * FDS-10：分區可以在方案裡改名稱與代號，所以同步不能只靠名稱比對。
 * 對應順序：
 * 1. room_key（房間種類 key）—— 最可靠，改名也不影響。
 * 2. 舊資料（room_key 為 null）退回名稱比對，並順手補上 room_key。
 *
 * 名稱與代號是顯示值：對應到既有分區後，若該分區已被用戶改名／改代號，
 * 就不會被房間清單改回去。沒有產品的分區只要對上房間鍵就保留，
 * 避免改名後被刪掉再以種子名稱重建。
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

/**
 * 把種子與現有分區配對。
 *
 * - 有 room_key 的種子先找同 room_key 的分區。
 * - 找不到就退回名稱（只對還沒有 room_key 的舊資料）。
 * - 同一種類的第 n 個種子配同一種類的第 n 個分區，
 *   這樣「會議室 1／會議室 2」改名後仍各自對應原位。
 */
export function pairSeedsWithZones(
  desired: ZoneSeed[],
  pool: ProjectZone[],
): { seed: ZoneSeed; zone: ProjectZone | null }[] {
  const used = new Set<string>();
  const paired: { seed: ZoneSeed; zone: ProjectZone | null }[] = [];

  for (const seed of desired) {
    let match: ProjectZone | undefined;

    if (seed.roomKey) {
      // 1. 已記錄 room_key 的分區。
      match = pool.find(
        (zone) => !used.has(zone.id) && zone.roomKey === seed.roomKey,
      );
    }
    if (!match) {
      // 2. 舊資料：還沒有 room_key，只能按名稱對。對上後會補 room_key。
      match = pool.find(
        (zone) => !used.has(zone.id) && !zone.roomKey && zone.name === seed.name,
      );
    }

    if (match) used.add(match.id);
    paired.push({ seed, zone: match ?? null });
  }
  return paired;
}

/**
 * Empty zones that did not match a room seed.
 * Matched empty zones stay, so a rename, code, and id survive the next sync.
 */
export function emptyZoneIdsToPrune(
  desired: ZoneSeed[],
  zones: ProjectZone[],
  zoneProducts: ZoneProduct[],
): string[] {
  const withProducts = new Set(
    zoneProducts.map((product) => product.zoneId).filter(Boolean) as string[],
  );
  const matched = new Set(
    pairSeedsWithZones(desired, zones)
      .map((pair) => pair.zone?.id)
      .filter((id): id is string => Boolean(id)),
  );
  return zones
    .filter((zone) => !withProducts.has(zone.id) && !matched.has(zone.id))
    .map((zone) => zone.id);
}

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
    // Pair before deleting. An empty zone can still be the renamed room
    // (room_key, code, id). Deleting it first forces a new zone with the seed name.
    const pruneIds = pruneEmpty
      ? new Set(emptyZoneIdsToPrune(desired, zones, zoneProducts))
      : new Set<string>();
    for (const zoneId of pruneIds) {
      const result = await deleteZone(zoneId);
      if (!result.ok) {
        return { ok: false, error: result.error || '刪除間隔失敗' };
      }
    }

    const pool = zones.filter((zone) => !pruneIds.has(zone.id));
    const paired = pairSeedsWithZones(desired, pool);
    const usedIds = new Set<string>();

    for (let i = 0; i < paired.length; i++) {
      const { seed, zone: existing } = paired[i];
      if (existing) {
        usedIds.add(existing.id);
        const patch: {
          name?: string;
          code?: string | null;
          sortOrder?: number;
          bounds?: ZoneBounds;
          roomKey?: string | null;
        } = {};
        // 名稱與代號是顯示值：使用者改名後就保留，不再被種子覆蓋。
        // 舊資料（room_key 為 null）第一次對上時補上 room_key，
        // 補上之後就以 room_key 為準，改名不再影響對應。
        if (!existing.roomKey && seed.roomKey) patch.roomKey = seed.roomKey;
        if (existing.sortOrder !== i) patch.sortOrder = i;
        if (Object.keys(patch).length > 0) {
          const updated = await updateZone(existing.id, patch);
          if (!updated.ok) {
            return { ok: false, error: updated.error || '更新間隔失敗' };
          }
          Object.assign(existing, patch);
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
        roomKey: seed.roomKey ?? null,
      });
      if (!created.ok || !created.data) {
        return { ok: false, error: created.error || '建立間隔失敗' };
      }
      paired[i].zone = created.data;
      pool.push(created.data);
      usedIds.add(created.data.id);
    }

    const orderedZones: ProjectZone[] = [];
    for (let i = 0; i < paired.length; i++) {
      const { zone } = paired[i];
      if (!zone) continue;
      orderedZones.push({ ...zone, sortOrder: i });
    }

    // Leftover zones not in 方案列表 desired names.
    for (const zone of pool) {
      if (usedIds.has(zone.id)) continue;
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
      usedIds.add(zone.id);
    }

    return { ok: true, data: orderedZones };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : '同步間隔失敗',
    };
  }
}

/**
 * True when meta room seeds are missing from the current zones list.
 *
 * 比對以 room_key 為準；舊資料（room_key 為 null）才退回名稱，
 * 這樣 FDS-10 改名後不會被誤判成「缺少分區」而觸發一次改回去的同步。
 */
export function zonesMissingFromSeeds(
  desired: ZoneSeed[],
  zones: ProjectZone[],
): boolean {
  if (desired.length === 0) return false;
  return pairSeedsWithZones(desired, zones).some((pair) => !pair.zone);
}

/**
 * True when zones don't match 方案列表 seeds (missing, extras, or count drift).
 */
export function zonesOutOfSyncWithSeeds(
  desired: ZoneSeed[],
  zones: ProjectZone[],
): boolean {
  if (zonesMissingFromSeeds(desired, zones)) return true;
  const paired = pairSeedsWithZones(desired, zones);
  const matched = new Set(
    paired.map((pair) => pair.zone?.id).filter((id): id is string => Boolean(id)),
  );
  // 有多餘的分區（沒對上任何種子）也算不同步。
  return zones.some((zone) => !matched.has(zone.id));
}
