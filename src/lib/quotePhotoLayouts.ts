/**
 * 報價單圖片排版（移植自 QMS 的 quote-photo-layouts）。
 *
 * 一個 layout group ＝ 一組排在總價之後、訂單確認及交付細節之前印刷的圖片區塊；槽位是固定
 * 長寬比盒子內的絕對矩形，所以編輯器畫布、報價頁卡片、A4 PDF 共用同一套幾何。
 */

export const PHOTO_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;
export type PhotoRatio = (typeof PHOTO_RATIOS)[number];
export type PhotoFitMode = "contain" | "cover";

export const PHOTO_RATIO_LABELS: Record<PhotoRatio, string> = {
  "1:1": "正方形",
  "3:4": "直向相片",
  "4:3": "橫向相片",
  "16:9": "寬螢幕",
  "9:16": "直向長圖",
};

export function ratioValue(ratio: PhotoRatio) {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
}

export const PHOTO_TEMPLATE_IDS = [
  "L01", "L02", "L03", "L04", "L05", "L06",
  "L07", "L08", "L09", "L10", "L11", "L12",
  "L13", "L14", "L15", "L16", "L17",
  "L18", "L19", "L20", "L21",
] as const;
export type PhotoTemplateId = (typeof PHOTO_TEMPLATE_IDS)[number];

/** Printable content width of the A4 page in millimetres (210 − 2 × 16). */
export const PDF_CONTENT_WIDTH_MM = 178;
/**
 * Content height under the repeated header.
 * 297 − 14 top − 15 bottom − 40 header. Full-page layouts stay a little
 * shorter so they fit one page without the paginator shrinking them.
 */
const PDF_CONTENT_HEIGHT_MM = 228;
const FULL_PAGE_MM = PDF_CONTENT_HEIGHT_MM - 8;
const HALF_PAGE_MM = FULL_PAGE_MM / 2;
const GAP_MM = 3;
export const GRID_ROW_HEIGHT_MM = 45;
export const GRID_COLUMNS = 3;
export const GRID_MIN_PHOTOS = 3;
export const MAX_LAYOUT_PHOTOS = 12;
export const MAX_LAYOUT_GROUPS = 12;
/** Caption band under each photo: two printed lines. */
export const CAPTION_MM = 8;
export const CAPTION_MAX = 40;
/** Printed under every Grok-generated reference image. The editor cannot hide it. */
export const AI_REFERENCE_LABEL = "AI 生成示意圖，僅供設計參考";

export type PhotoSlotRect = {
  id: string;
  /** Fractions of the block width / height. */
  x: number;
  y: number;
  w: number;
  h: number;
  ratio: PhotoRatio;
};

export type PhotoBlockGeometry = {
  /** Box height in millimetres at the full content width. */
  heightMm: number;
  slots: PhotoSlotRect[];
  /** L05 only: the text area beside the photo. */
  text?: { x: number; y: number; w: number; h: number };
  /** Height of the caption band at the bottom of every slot; 0 when captions are off. */
  captionMm: number;
};

type Cell = { id: string; col: number; row: number; colSpan?: number; rowSpan?: number; ratio: PhotoRatio };

function tracks(sizes: number[], totalMm: number) {
  const free = totalMm - GAP_MM * (sizes.length - 1);
  const sum = sizes.reduce((a, b) => a + b, 0);
  const lengths = sizes.map((size) => (free * size) / sum);
  const starts: number[] = [];
  let cursor = 0;
  for (const length of lengths) {
    starts.push(cursor);
    cursor += length + GAP_MM;
  }
  return { starts, lengths };
}

function grid(cols: number[], rows: number[], heightMm: number, cells: Cell[]): PhotoBlockGeometry {
  const x = tracks(cols, PDF_CONTENT_WIDTH_MM);
  const y = tracks(rows, heightMm);
  const span = (t: { starts: number[]; lengths: number[] }, start: number, count: number) =>
    t.starts[start + count - 1] + t.lengths[start + count - 1] - t.starts[start];
  return {
    heightMm,
    captionMm: 0,
    slots: cells.map((cell) => ({
      id: cell.id,
      x: x.starts[cell.col] / PDF_CONTENT_WIDTH_MM,
      y: y.starts[cell.row] / heightMm,
      w: span(x, cell.col, cell.colSpan ?? 1) / PDF_CONTENT_WIDTH_MM,
      h: span(y, cell.row, cell.rowSpan ?? 1) / heightMm,
      ratio: cell.ratio,
    })),
  };
}

export type PhotoTemplate = {
  id: PhotoTemplateId;
  name: string;
  /** Suggested number of photos, used by the count filter. */
  count: number;
  countLabel: string;
};

export const PHOTO_TEMPLATES: PhotoTemplate[] = [
  { id: "L18", name: "整頁單圖", count: 1, countLabel: "1 張" },
  { id: "L20", name: "整頁雙圖", count: 2, countLabel: "2 張" },
  { id: "L19", name: "半頁單圖", count: 1, countLabel: "1 張" },
  { id: "L21", name: "半頁雙圖", count: 2, countLabel: "2 張" },
  { id: "L01", name: "單張大圖", count: 1, countLabel: "1 張" },
  { id: "L02", name: "雙圖並排", count: 2, countLabel: "2 張" },
  { id: "L03", name: "主圖 + 2 小圖", count: 3, countLabel: "3 張" },
  { id: "L04", name: "4 宮格", count: 4, countLabel: "4 張" },
  { id: "L05", name: "圖文說明", count: 1, countLabel: "1 張" },
  { id: "L06", name: "混合佈局", count: 5, countLabel: "5 張" },
  { id: "L07", name: "三圖並排", count: 3, countLabel: "3 張" },
  { id: "L08", name: "雙圖直排", count: 2, countLabel: "2 張" },
  { id: "L13", name: "左大右小", count: 2, countLabel: "2 張" },
  { id: "L14", name: "左小右大", count: 2, countLabel: "2 張" },
  { id: "L09", name: "上主圖下雙圖", count: 3, countLabel: "3 張" },
  { id: "L10", name: "主圖 + 3 小圖", count: 4, countLabel: "4 張" },
  { id: "L11", name: "六宮格", count: 6, countLabel: "6 張" },
  { id: "L12", name: "連續網格", count: 6, countLabel: "3–12 張" },
  { id: "L15", name: "右主圖 + 2 小圖", count: 3, countLabel: "3 張" },
  { id: "L16", name: "上雙圖下主圖", count: 3, countLabel: "3 張" },
  { id: "L17", name: "上主圖下三圖", count: 4, countLabel: "4 張" },
];

export function templateById(id: PhotoTemplateId) {
  return PHOTO_TEMPLATES.find((template) => template.id === id) ?? PHOTO_TEMPLATES[0];
}

/** Slot ids for the continuous grid. */
export function gridSlotId(index: number) {
  return `g${index + 1}`;
}

/**
 * The fixed geometry of a template. The continuous grid is the only template
 * whose slot count changes; it is printed one row (block) at a time.
 */
export function templateGeometry(id: PhotoTemplateId, gridSlots = GRID_COLUMNS, captionMm = 0): PhotoBlockGeometry {
  const band = id === "L05" ? 0 : captionMm;
  if (band > 0) {
    const plain = templateGeometry(id, gridSlots, 0);
    const rowTracks = new Set(plain.slots.map((slot) => Math.round(slot.y * 1000))).size;
    return { ...rebuild(id, gridSlots, plain.heightMm + band * rowTracks), captionMm: band };
  }
  return rebuild(id, gridSlots, 0);
}

/** The template grid. A non-zero totalHeightMm replaces the base height to make room for captions. */
function rebuild(id: PhotoTemplateId, gridSlots: number, totalHeightMm: number): PhotoBlockGeometry {
  const h = (base: number) => totalHeightMm || base;
  switch (id) {
    case "L01":
      return grid([1], [1], h(70), [{ id: "s1", col: 0, row: 0, ratio: "4:3" }]);
    case "L02":
      return grid([1, 1], [1], h(65), [
        { id: "s1", col: 0, row: 0, ratio: "4:3" },
        { id: "s2", col: 1, row: 0, ratio: "4:3" },
      ]);
    case "L03":
      return grid([2, 1], [1, 1], h(75), [
        { id: "s1", col: 0, row: 0, rowSpan: 2, ratio: "4:3" },
        { id: "s2", col: 1, row: 0, ratio: "4:3" },
        { id: "s3", col: 1, row: 1, ratio: "4:3" },
      ]);
    case "L04":
      return grid([1, 1], [1, 1], h(83), [
        { id: "s1", col: 0, row: 0, ratio: "4:3" },
        { id: "s2", col: 1, row: 0, ratio: "4:3" },
        { id: "s3", col: 0, row: 1, ratio: "4:3" },
        { id: "s4", col: 1, row: 1, ratio: "4:3" },
      ]);
    case "L05": {
      const geometry = grid([3, 2], [1], h(65), [{ id: "s1", col: 0, row: 0, ratio: "4:3" }]);
      const textX = geometry.slots[0].x + geometry.slots[0].w + GAP_MM / PDF_CONTENT_WIDTH_MM;
      return { ...geometry, text: { x: textX, y: 0, w: 1 - textX, h: 1 } };
    }
    case "L06":
      return grid([2, 1, 1], [1, 1], h(80), [
        { id: "s1", col: 0, row: 0, rowSpan: 2, ratio: "4:3" },
        { id: "s2", col: 1, row: 0, ratio: "1:1" },
        { id: "s3", col: 2, row: 0, ratio: "1:1" },
        { id: "s4", col: 1, row: 1, ratio: "1:1" },
        { id: "s5", col: 2, row: 1, ratio: "1:1" },
      ]);
    case "L07":
      return grid([1, 1, 1], [1], h(55), [
        { id: "s1", col: 0, row: 0, ratio: "4:3" },
        { id: "s2", col: 1, row: 0, ratio: "4:3" },
        { id: "s3", col: 2, row: 0, ratio: "4:3" },
      ]);
    case "L08":
      return grid([1], [1, 1], h(123), [
        { id: "s1", col: 0, row: 0, ratio: "16:9" },
        { id: "s2", col: 0, row: 1, ratio: "16:9" },
      ]);
    case "L13":
      return grid([2, 1], [1], h(75), [
        { id: "s1", col: 0, row: 0, ratio: "4:3" },
        { id: "s2", col: 1, row: 0, ratio: "3:4" },
      ]);
    case "L14":
      return grid([1, 2], [1], h(75), [
        { id: "s1", col: 0, row: 0, ratio: "3:4" },
        { id: "s2", col: 1, row: 0, ratio: "4:3" },
      ]);
    case "L15":
      return grid([1, 2], [1, 1], h(75), [
        { id: "s1", col: 1, row: 0, rowSpan: 2, ratio: "4:3" },
        { id: "s2", col: 0, row: 0, ratio: "4:3" },
        { id: "s3", col: 0, row: 1, ratio: "4:3" },
      ]);
    case "L16":
      return grid([1, 1], [50, 55], h(108), [
        { id: "s1", col: 0, row: 1, colSpan: 2, ratio: "16:9" },
        { id: "s2", col: 0, row: 0, ratio: "4:3" },
        { id: "s3", col: 1, row: 0, ratio: "4:3" },
      ]);
    case "L17":
      return grid([1, 1, 1], [55, 48], h(100), [
        { id: "s1", col: 0, row: 0, colSpan: 3, ratio: "16:9" },
        { id: "s2", col: 0, row: 1, ratio: "4:3" },
        { id: "s3", col: 1, row: 1, ratio: "4:3" },
        { id: "s4", col: 2, row: 1, ratio: "4:3" },
      ]);
    case "L18":
      return grid([1], [1], h(FULL_PAGE_MM), [{ id: "s1", col: 0, row: 0, ratio: "3:4" }]);
    case "L19":
      return grid([1], [1], h(HALF_PAGE_MM), [{ id: "s1", col: 0, row: 0, ratio: "16:9" }]);
    case "L20":
      return grid([1], [1, 1], h(FULL_PAGE_MM), [
        { id: "s1", col: 0, row: 0, ratio: "16:9" },
        { id: "s2", col: 0, row: 1, ratio: "16:9" },
      ]);
    case "L21":
      return grid([1, 1], [1], h(HALF_PAGE_MM), [
        { id: "s1", col: 0, row: 0, ratio: "3:4" },
        { id: "s2", col: 1, row: 0, ratio: "3:4" },
      ]);
    case "L09":
      return grid([1, 1], [55, 50], h(108), [
        { id: "s1", col: 0, row: 0, colSpan: 2, ratio: "16:9" },
        { id: "s2", col: 0, row: 1, ratio: "4:3" },
        { id: "s3", col: 1, row: 1, ratio: "4:3" },
      ]);
    case "L10":
      return grid([2, 1], [1, 1, 1], h(80), [
        { id: "s1", col: 0, row: 0, rowSpan: 3, ratio: "4:3" },
        { id: "s2", col: 1, row: 0, ratio: "16:9" },
        { id: "s3", col: 1, row: 1, ratio: "16:9" },
        { id: "s4", col: 1, row: 2, ratio: "16:9" },
      ]);
    case "L11":
      return grid([1, 1, 1], [1, 1], h(83), [
        { id: "s1", col: 0, row: 0, ratio: "4:3" },
        { id: "s2", col: 1, row: 0, ratio: "4:3" },
        { id: "s3", col: 2, row: 0, ratio: "4:3" },
        { id: "s4", col: 0, row: 1, ratio: "4:3" },
        { id: "s5", col: 1, row: 1, ratio: "4:3" },
        { id: "s6", col: 2, row: 1, ratio: "4:3" },
      ]);
    case "L12": {
      const count = Math.max(GRID_MIN_PHOTOS, Math.min(MAX_LAYOUT_PHOTOS, gridSlots));
      const rows = Math.ceil(count / GRID_COLUMNS);
      const height = h(rows * GRID_ROW_HEIGHT_MM + (rows - 1) * GAP_MM);
      return grid(
        Array.from({ length: GRID_COLUMNS }, () => 1),
        Array.from({ length: rows }, () => 1),
        height,
        Array.from({ length: count }, (_, index) => ({
          id: gridSlotId(index),
          col: index % GRID_COLUMNS,
          row: Math.floor(index / GRID_COLUMNS),
          ratio: "4:3" as PhotoRatio,
        })),
      );
    }
  }
}

export type PhotoPlacement = {
  slotId: string;
  assetId: string;
  ratio: PhotoRatio;
  fitMode: PhotoFitMode;
  /** 1 – 3, relative to the cover fit. */
  scale: number;
  /** 0 – 1, the visible point of the photo (object-position). */
  offsetX: number;
  offsetY: number;
  title?: string;
  caption?: string;
};

export type PhotoLayoutGroup = {
  id: string;
  templateId: PhotoTemplateId;
  /** Continuous grid only: number of slots. */
  gridSlots?: number;
  /** Print each photo's caption in a band under the photo (not L05, which has side text). */
  captions?: boolean;
  placements: PhotoPlacement[];
};

export function slotIdsFor(group: Pick<PhotoLayoutGroup, "templateId" | "gridSlots">) {
  return templateGeometry(group.templateId, group.gridSlots).slots.map((slot) => slot.id);
}

export function groupCaptionMm(group: Pick<PhotoLayoutGroup, "templateId" | "captions">) {
  return group.captions && group.templateId !== "L05" ? CAPTION_MM : 0;
}

export function groupGeometry(group: Pick<PhotoLayoutGroup, "templateId" | "gridSlots" | "captions">) {
  return templateGeometry(group.templateId, group.gridSlots, groupCaptionMm(group));
}

/** The photo part of a slot, above its caption band. */
export function imageRect(slot: PhotoSlotRect, geometry: PhotoBlockGeometry): PhotoSlotRect {
  if (!geometry.captionMm) return slot;
  return { ...slot, h: Math.max(0.01, slot.h - geometry.captionMm / geometry.heightMm) };
}

export function defaultPlacement(slot: PhotoSlotRect, assetId: string): PhotoPlacement {
  return { slotId: slot.id, assetId, ratio: slot.ratio, fitMode: "contain", scale: 1, offsetX: 0.5, offsetY: 0.5 };
}

export function newLayoutGroup(templateId: PhotoTemplateId = "L03"): PhotoLayoutGroup {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, templateId, gridSlots: templateId === "L12" ? 6 : undefined, placements: [] };
}

/**
 * Move a group to another template. Photos follow the slot order; any that no
 * longer fit return to the tray. A changed slot ratio resets to contain.
 */
export function switchTemplate(group: PhotoLayoutGroup, templateId: PhotoTemplateId) {
  const ordered = slotIdsFor(group)
    .map((slotId) => group.placements.find((placement) => placement.slotId === slotId))
    .filter((placement): placement is PhotoPlacement => Boolean(placement));
  const gridSlots = templateId === "L12"
    ? Math.max(GRID_MIN_PHOTOS, Math.min(MAX_LAYOUT_PHOTOS, Math.ceil(Math.max(ordered.length, 6) / GRID_COLUMNS) * GRID_COLUMNS))
    : undefined;
  const slots = templateGeometry(templateId, gridSlots).slots;
  const placements = ordered.slice(0, slots.length).map((placement, index) => {
    const slot = slots[index];
    const sameRatio = placement.ratio === slot.ratio;
    return {
      ...placement,
      slotId: slot.id,
      ratio: slot.ratio,
      fitMode: sameRatio ? placement.fitMode : "contain",
      scale: sameRatio ? placement.scale : 1,
    } satisfies PhotoPlacement;
  });
  return {
    group: { ...group, templateId, gridSlots, captions: templateId === "L05" ? undefined : group.captions, placements },
    displaced: ordered.slice(slots.length).map((placement) => placement.assetId),
  };
}

export function countPlacements(groups: PhotoLayoutGroup[]) {
  return groups.reduce((sum, group) => sum + group.placements.length, 0);
}

/** Unique asset ids in print order; this is the quotation's photo selection. */
export function layoutAssetIds(groups: PhotoLayoutGroup[]) {
  const ids: string[] = [];
  for (const group of groups) {
    for (const slotId of slotIdsFor(group)) {
      const placement = group.placements.find((entry) => entry.slotId === slotId);
      if (placement && !ids.includes(placement.assetId)) ids.push(placement.assetId);
    }
  }
  return ids;
}

/** Print blocks. The continuous grid becomes one block per row. */
export type PhotoPrintBlock = {
  key: string;
  templateId: PhotoTemplateId;
  geometry: PhotoBlockGeometry;
  placements: PhotoPlacement[];
};

export function printBlocks(group: PhotoLayoutGroup): PhotoPrintBlock[] {
  const filled = group.placements.length > 0;
  if (!filled) return [];
  if (group.templateId !== "L12") {
    return [{ key: group.id, templateId: group.templateId, geometry: groupGeometry(group), placements: group.placements }];
  }
  const ordered = slotIdsFor(group)
    .map((slotId) => group.placements.find((placement) => placement.slotId === slotId))
    .filter((placement): placement is PhotoPlacement => Boolean(placement));
  const row = templateGeometry("L12", GRID_COLUMNS, groupCaptionMm(group));
  const blocks: PhotoPrintBlock[] = [];
  for (let start = 0; start < ordered.length; start += GRID_COLUMNS) {
    const chunk = ordered.slice(start, start + GRID_COLUMNS).map((placement, index) => ({
      ...placement,
      slotId: row.slots[index].id,
    }));
    blocks.push({ key: `${group.id}-${start}`, templateId: "L12", geometry: row, placements: chunk });
  }
  return blocks;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** Parse stored or frozen layouts. Unknown templates and slots are dropped. */
export function parsePhotoLayouts(value: unknown): PhotoLayoutGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: PhotoLayoutGroup[] = [];
  for (const entry of value.slice(0, MAX_LAYOUT_GROUPS)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const templateId = PHOTO_TEMPLATE_IDS.find((id) => id === row.templateId);
    const id = typeof row.id === "string" && row.id ? row.id : null;
    if (!templateId || !id) continue;
    const gridSlots = templateId === "L12"
      ? Math.round(clamp(row.gridSlots, GRID_MIN_PHOTOS, MAX_LAYOUT_PHOTOS, 6))
      : undefined;
    const slotIds = new Set(slotIdsFor({ templateId, gridSlots }));
    const seen = new Set<string>();
    const placements: PhotoPlacement[] = [];
    for (const raw of Array.isArray(row.placements) ? row.placements : []) {
      if (!raw || typeof raw !== "object") continue;
      const p = raw as Record<string, unknown>;
      const slotId = typeof p.slotId === "string" ? p.slotId : "";
      const assetId = typeof p.assetId === "string" ? p.assetId : "";
      if (!slotIds.has(slotId) || seen.has(slotId) || !assetId) continue;
      seen.add(slotId);
      placements.push({
        slotId,
        assetId,
        ratio: PHOTO_RATIOS.find((ratio) => ratio === p.ratio) ?? "4:3",
        fitMode: p.fitMode === "cover" ? "cover" : "contain",
        scale: clamp(p.scale, 1, 3, 1),
        offsetX: clamp(p.offsetX, 0, 1, 0.5),
        offsetY: clamp(p.offsetY, 0, 1, 0.5),
        title: templateId === "L05" ? text(p.title, 80) : undefined,
        caption: text(p.caption, templateId === "L05" ? 240 : CAPTION_MAX),
      });
    }
    const captions = row.captions === true && templateId !== "L05" ? true : undefined;
    groups.push({ id, templateId, gridSlots, captions, placements });
  }
  return groups;
}

export function parseZonePhotoLayouts(value: unknown): Record<string, PhotoLayoutGroup[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, PhotoLayoutGroup[]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = key.trim();
    if (!id) continue;
    const groups = parsePhotoLayouts(raw);
    if (groups.length) next[id] = groups;
  }
  return next;
}

/** Drop layouts whose zone title is gone. `liveIds` includes the unzoned bucket when that should stay. */
export function pruneZonePhotoLayouts(
  layouts: Record<string, PhotoLayoutGroup[]>,
  liveIds: Iterable<string>,
): Record<string, PhotoLayoutGroup[]> {
  const live = new Set(liveIds);
  const next: Record<string, PhotoLayoutGroup[]> = {};
  for (const [id, groups] of Object.entries(layouts)) {
    if (!live.has(id) || groups.length === 0) continue;
    next[id] = groups;
  }
  return next;
}

/**
 * The visible frame inside a slot. Contain fills the slot and letterboxes the
 * whole photo; cover crops to the chosen ratio, centred in the slot.
 */
export function frameInSlot(slot: PhotoSlotRect, blockHeightMm: number, placement: PhotoPlacement) {
  if (placement.fitMode === "contain") return { left: 0, top: 0, width: 1, height: 1 };
  const slotAspect = (slot.w * PDF_CONTENT_WIDTH_MM) / (slot.h * blockHeightMm);
  const target = ratioValue(placement.ratio);
  if (target > slotAspect) {
    const height = slotAspect / target;
    return { left: 0, top: (1 - height) / 2, width: 1, height };
  }
  const width = target / slotAspect;
  return { left: (1 - width) / 2, top: 0, width, height: 1 };
}
