/**
 * 工程類型 → 間隔／功能房間模板（前端設定，寫入 design_projects.meta）
 */
import type { ZoneBounds } from '@/types/solutions';

export type ProjectEngineeringType = 'office' | 'school' | 'clinic' | 'hotel' | 'other';

export type ExistingPartitionMode =
  | 'full_demolish'
  | 'partial_demolish'
  | 'keep_all'
  | 'raise_to_ceiling'
  | 'none';

export interface RoomTypeTemplate {
  /** Stable key within a project type */
  key: string;
  label: string;
  /** Short code prefix e.g. M / B / R */
  codePrefix: string;
}

export const PROJECT_TYPE_OPTIONS: {
  id: ProjectEngineeringType;
  label: string;
  hint: string;
}[] = [
  { id: 'office', label: '辦公室', hint: '會議室、經理房、開放式工作區…' },
  { id: 'school', label: '學校', hint: '禮堂、校長室、教員室、課室…' },
  { id: 'clinic', label: '醫療診所', hint: '咨詢室、接待大堂、洗手間…' },
  { id: 'hotel', label: '酒店／接待', hint: '大堂、行政樓層、客房公區…' },
  { id: 'other', label: '其他工程', hint: '通用間隔清單' },
];

export const EXISTING_PARTITION_OPTIONS: {
  id: ExistingPartitionMode;
  label: string;
}[] = [
  { id: 'full_demolish', label: '全部清拆' },
  { id: 'partial_demolish', label: '部分清拆' },
  { id: 'keep_all', label: '全部保留' },
  { id: 'raise_to_ceiling', label: '現有間隔加高到真天花' },
  { id: 'none', label: '沒有' },
];

/** Deprecated default keys — excluded from all engineering-type presets. */
export const EXCLUDED_DEFAULT_ROOM_KEYS = new Set(['other', 'no_partition']);

const OFFICE_ROOMS: RoomTypeTemplate[] = [
  { key: 'meeting', label: '會議室', codePrefix: 'M' },
  { key: 'manager', label: '經理房', codePrefix: 'G' },
  { key: 'director', label: '董事房', codePrefix: 'B' },
  { key: 'pantry', label: '茶水間', codePrefix: 'P' },
  { key: 'server', label: '伺服器房', codePrefix: 'S' },
  { key: 'storage', label: '儲物房', codePrefix: 'ST' },
  { key: 'reception', label: '接待處', codePrefix: 'R' },
  { key: 'open', label: '開放式工作區', codePrefix: 'O' },
  { key: 'phone', label: '電話房', codePrefix: 'PH' },
  { key: 'restroom', label: '洗手間', codePrefix: 'WC' },
];

const SCHOOL_ROOMS: RoomTypeTemplate[] = [
  { key: 'hall', label: '禮堂', codePrefix: 'H' },
  { key: 'principal', label: '校長室', codePrefix: 'PR' },
  { key: 'staff', label: '教員室', codePrefix: 'T' },
  { key: 'classroom', label: '課室', codePrefix: 'C' },
  { key: 'library', label: '圖書館', codePrefix: 'L' },
  { key: 'lab', label: '實驗室', codePrefix: 'LAB' },
  { key: 'reception', label: '接待處', codePrefix: 'R' },
  { key: 'restroom', label: '洗手間', codePrefix: 'WC' },
  { key: 'storage', label: '儲物房', codePrefix: 'ST' },
];

const CLINIC_ROOMS: RoomTypeTemplate[] = [
  { key: 'consult', label: '咨詢室', codePrefix: 'CN' },
  { key: 'lobby', label: '接待大堂', codePrefix: 'R' },
  { key: 'treatment', label: '醫生房／治療室', codePrefix: 'DR' },
  { key: 'pharmacy', label: '藥房', codePrefix: 'PH' },
  { key: 'waiting', label: '候診區', codePrefix: 'W' },
  { key: 'restroom', label: '洗手間', codePrefix: 'WC' },
  { key: 'storage', label: '儲物房', codePrefix: 'ST' },
];

const HOTEL_ROOMS: RoomTypeTemplate[] = [
  { key: 'lobby', label: '大堂', codePrefix: 'L' },
  { key: 'lounge', label: '休閒區', codePrefix: 'LZ' },
  { key: 'meeting', label: '會議室', codePrefix: 'M' },
  { key: 'admin', label: '後勤／辦公', codePrefix: 'A' },
  { key: 'pantry', label: '茶水間', codePrefix: 'P' },
  { key: 'storage', label: '儲物房', codePrefix: 'ST' },
  { key: 'restroom', label: '洗手間', codePrefix: 'WC' },
];

const OTHER_ROOMS: RoomTypeTemplate[] = [
  { key: 'open', label: '開放區', codePrefix: 'O' },
  { key: 'meeting', label: '會議室', codePrefix: 'M' },
  { key: 'storage', label: '儲物房', codePrefix: 'ST' },
  { key: 'reception', label: '接待處', codePrefix: 'R' },
  { key: 'restroom', label: '洗手間', codePrefix: 'WC' },
];

export function roomsForProjectType(type: ProjectEngineeringType): RoomTypeTemplate[] {
  switch (type) {
    case 'office':
      return OFFICE_ROOMS;
    case 'school':
      return SCHOOL_ROOMS;
    case 'clinic':
      return CLINIC_ROOMS;
    case 'hotel':
      return HOTEL_ROOMS;
    default:
      return OTHER_ROOMS;
  }
}

export function projectTypeLabel(type: ProjectEngineeringType | string | null | undefined): string {
  return PROJECT_TYPE_OPTIONS.find((o) => o.id === type)?.label || '未設定';
}

/** Guess type from project/client name when meta missing. */
export function inferProjectType(name: string, clientCompany?: string | null): ProjectEngineeringType {
  const text = `${name} ${clientCompany || ''}`.toLowerCase();
  if (/學校|小學|中學|禮堂|課室|school|university|幼稚園/.test(text)) return 'school';
  if (/診所|醫院|醫療|診所|clinic|hospital|牙科|醫/.test(text)) return 'clinic';
  if (/酒店|酒店|hotel|大堂|客房/.test(text)) return 'hotel';
  if (/辦公|辦公室|office|商務|cowork|共享/.test(text)) return 'office';
  return 'office';
}

/** All template rooms at quantity 0 — used when switching to an unsaved 工程類型. */
export function zeroRoomCounts(type: ProjectEngineeringType): Record<string, number> {
  const rooms = roomsForProjectType(type);
  const counts: Record<string, number> = {};
  for (const r of rooms) counts[r.key] = 0;
  return counts;
}

/**
 * Default room counts for a brand-new project / first load of a type.
 * Room types come from the engineering-type template; quantities start at 0.
 * Switching types also uses zero counts; after「儲存」, reopen uses saved meta.
 */
export function defaultRoomCounts(type: ProjectEngineeringType): Record<string, number> {
  return zeroRoomCounts(type);
}

/** Per-engineering-type room draft stored in design_projects.meta.roomsByType. */
export interface TypeRoomsSnapshot {
  roomOrder: string[];
  roomCounts: Record<string, number>;
  customRooms: RoomTypeTemplate[];
}

export function codePrefixFromLabel(label: string): string {
  const latin = label.trim().match(/[A-Za-z]+/)?.[0];
  if (latin) return latin.slice(0, 2).toUpperCase();
  const digits = label.trim().match(/[0-9]+/)?.[0];
  if (digits) return `R${digits.slice(0, 2)}`;
  return 'CR';
}

export function normalizeRoomOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

/** Sanitize design_projects.meta.roomLabelOverrides (template room renames). */
export function normalizeRoomLabelOverrides(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const roomKey = String(key || '').trim();
    const label = String(raw || '').trim();
    if (!roomKey || !label) continue;
    next[roomKey] = label;
  }
  return next;
}

export function applyRoomLabelOverrides(
  rooms: RoomTypeTemplate[],
  overrides?: Record<string, string> | null,
): RoomTypeTemplate[] {
  if (!overrides || Object.keys(overrides).length === 0) return rooms;
  return rooms.map((room) => {
    const label = overrides[room.key]?.trim();
    if (!label || label === room.label) return room;
    return {
      ...room,
      label,
      codePrefix: codePrefixFromLabel(label),
    };
  });
}

/**
 * Merge template + custom rooms, honoring a saved roomOrder when present.
 * - roomOrder == null → return all template + custom rooms
 * - roomOrder is an array (even empty) → only those keys (deleted rooms stay hidden)
 */
export function orderedRoomsForProjectType(
  type: ProjectEngineeringType,
  customRooms: RoomTypeTemplate[] = [],
  roomOrder?: string[] | null,
): RoomTypeTemplate[] {
  const rooms = [...roomsForProjectType(type), ...customRooms];
  if (roomOrder == null) return rooms;
  const byKey = new Map(rooms.map((room) => [room.key, room]));
  return roomOrder
    .map((key) => byKey.get(key))
    .filter((room): room is RoomTypeTemplate => Boolean(room));
}

/**
 * Allocate a unique zone code for a project.
 * Chinese custom rooms often share prefix "CR"; codes must still be unique
 * across the whole project (CR1, CR2, …) so sync does not skip creates.
 */
export function allocateUniqueZoneCode(
  prefix: string,
  usedCodes: Set<string>,
): string {
  const base = (prefix || 'CR').trim().toUpperCase() || 'CR';
  let n = 1;
  let code = `${base}${n}`;
  while (usedCodes.has(code)) {
    n += 1;
    code = `${base}${n}`;
  }
  usedCodes.add(code);
  return code;
}

/** Layout seeds for floor-plan generator from selected room counts. */
export function zoneSeedsFromRoomCounts(
  type: ProjectEngineeringType,
  counts: Record<string, number>,
  customRooms: RoomTypeTemplate[] = [],
  roomOrder?: string[] | null,
  labelOverrides?: Record<string, string> | null,
): { code: string; name: string; bounds: ZoneBounds; roomKey: string }[] {
  const rooms = applyRoomLabelOverrides(
    orderedRoomsForProjectType(type, customRooms, roomOrder),
    labelOverrides,
  );
  const seeds: { code: string; name: string; bounds: ZoneBounds; roomKey: string }[] = [];
  const active = rooms.filter(
    (r) =>
      (counts[r.key] || 0) > 0 && !EXCLUDED_DEFAULT_ROOM_KEYS.has(r.key),
  );
  const usedCodes = new Set<string>();
  let index = 0;
  for (const room of active) {
    const qty = counts[room.key] || 0;
    for (let i = 0; i < qty; i++) {
      const col = index % 3;
      const row = Math.floor(index / 3);
      seeds.push({
        code: allocateUniqueZoneCode(room.codePrefix, usedCodes),
        name: qty > 1 ? `${room.label} ${i + 1}` : room.label,
        bounds: {
          x: 6 + col * 31,
          y: 8 + row * 30,
          w: 28,
          h: 26,
        },
        roomKey: room.key,
      });
      index += 1;
    }
  }
  if (seeds.length === 0) {
    // Explicit empty roomOrder means user cleared all rooms — do not invent a fallback.
    if (roomOrder != null) return [];
    seeds.push({
      code: 'O1',
      name: '開放區',
      bounds: { x: 10, y: 10, w: 80, h: 70 },
      roomKey: 'open',
    });
  }
  return seeds;
}

export interface ProjectPartitionMeta {
  projectType?: ProjectEngineeringType;
  existingPartition?: ExistingPartitionMode;
  roomCounts?: Record<string, number>;
  customRooms?: RoomTypeTemplate[];
  roomOrder?: string[];
  /** Drafts per 工程類型 so switching back restores that type's last edit/save. */
  roomsByType?: Partial<Record<ProjectEngineeringType, TypeRoomsSnapshot>>;
}
