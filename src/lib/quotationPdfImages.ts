/**
 * Item 圖例的自適應排版（PRD 第四章）。
 *
 * 輸入：同一個 Item 的 1–N 張圖片（產品圖、參考圖、備註圖、設計圖皆同一機制）
 * 輸出：一個固定寬高的圖片組，內含每張圖的絕對位置與尺寸。
 *
 * 原則：
 * 1. 一律等比縮放（不裁切、不拉伸）。
 * 2. 橫向／直向混合時，候選方案要比較「高度」與「是否把圖縮得太小」。
 * 3. 超過 3 張就分組（每組最多 3 張）再垂直堆疊。
 * 4. 全部參數可調，不寫死於元件。
 */

import { PDF_IMAGE_LIMITS, PDF_ITEM_PHOTOS } from './quotationPdfMetrics';

export type PdfImageKind = 'product' | 'reference' | 'remarks' | 'drawing' | 'other';

export type PdfImageSource = {
  url: string;
  /** 原始像素寬高（用來算比例；缺失時視為正方形）。 */
  width?: number;
  height?: number;
  kind?: PdfImageKind;
};

export type PdfImageShape = 'landscape' | 'square' | 'portrait';

/** PRD 4.6 的候選版式名稱。 */
export type PdfImageRecipe =
  | 'single'
  | 'vertical-stack'
  | 'horizontal-row'
  | 'main-with-thumbnails'
  | 'mixed-grid';

export type PdfImagePlacement = {
  url: string;
  kind?: PdfImageKind;
  leftPt: number;
  topPt: number;
  widthPt: number;
  heightPt: number;
};

export type PdfImageGallery = {
  /** 圖片組實際佔用寬度（可能小於欄寬：整組置中）。 */
  widthPt: number;
  heightPt: number;
  recipe: PdfImageRecipe;
  images: PdfImagePlacement[];
};

export type PdfImageLimits = {
  maxImageHeightPt: number;
  maxGalleryHeightPt: number;
  gapPt: number;
  minImageWidthRatio: number;
  landscapeThreshold: number;
  portraitThreshold: number;
};

export type PdfImageLayoutOptions = {
  /** 可用欄寬（已扣內距）。 */
  widthPt: number;
  limits?: Partial<PdfImageLimits>;
};

const DEFAULT_LIMITS: PdfImageLimits = {
  maxImageHeightPt: PDF_IMAGE_LIMITS.maxSingleImageHeightPt,
  maxGalleryHeightPt: PDF_IMAGE_LIMITS.maxGalleryHeightPt,
  gapPt: PDF_IMAGE_LIMITS.gapPt,
  minImageWidthRatio: PDF_IMAGE_LIMITS.minImageWidthRatio,
  landscapeThreshold: PDF_IMAGE_LIMITS.landscapeThreshold,
  portraitThreshold: PDF_IMAGE_LIMITS.portraitThreshold,
};

export function imageRatio(source: Pick<PdfImageSource, 'width' | 'height'>): number {
  const w = Number(source.width);
  const h = Number(source.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  return w / h;
}

/** Item 圖片按來源順序由左至右排列，每列最多三張，全部保持原始比例。 */
export function layoutItemPhotoRows(sources: PdfImageSource[], widthPt: number): PdfImageGallery[] {
  if (widthPt <= 0) return [];
  const images = sources.filter((source) => Boolean(source.url?.trim()));
  const rows: PdfImageGallery[] = [];
  const gap = PDF_ITEM_PHOTOS.gapPt;
  for (let start = 0; start < images.length; start += 3) {
    const group = images.slice(start, start + 3);
    const ratios = group.map(imageRatio);
    const heightPt = Math.min(PDF_ITEM_PHOTOS.maxRowHeightPt,
        (widthPt - gap * (group.length - 1)) / ratios.reduce((sum, ratio) => sum + ratio, 0));
    let leftPt = 0;
    const placements = group.map((source, index) => {
      const placement = { ...source, leftPt, topPt: 0, widthPt: heightPt * ratios[index], heightPt };
      leftPt += placement.widthPt + gap;
      return placement;
    });
    rows.push({
      recipe: group.length > 1 ? 'horizontal-row' : 'single',
      widthPt: Math.max(...placements.map((image) => image.leftPt + image.widthPt)),
      heightPt,
      images: placements,
    });
  }
  return rows;
}

export function classifyImageShape(
  ratio: number,
  limits: Pick<PdfImageLimits, 'landscapeThreshold' | 'portraitThreshold'> = DEFAULT_LIMITS,
): PdfImageShape {
  if (ratio > limits.landscapeThreshold) return 'landscape';
  if (ratio < limits.portraitThreshold) return 'portrait';
  return 'square';
}

type Cell = { index: number; leftPt: number; topPt: number; widthPt: number; heightPt: number };

type Candidate = { recipe: PdfImageRecipe; cells: Cell[]; widthPt: number; heightPt: number };

function resolveLimits(overrides?: Partial<PdfImageLimits>): PdfImageLimits {
  return { ...DEFAULT_LIMITS, ...(overrides ?? {}) };
}

/** 等比縮放：把 ratio 的圖塞進 width × height 的盒子（不超出）。 */
function fitInside(widthPt: number, heightPt: number, ratio: number) {
  const heightFromWidth = widthPt / ratio;
  if (heightFromWidth <= heightPt) return { widthPt, heightPt: heightFromWidth };
  return { widthPt: heightPt * ratio, heightPt };
}

/** 單欄垂直堆疊：每張圖吃滿寬度，過高的按 maxHeight 收窄並置中。 */
function stackCandidate(
  ratios: number[],
  indices: number[],
  box: { widthPt: number; gapPt: number; maxImageHeightPt: number },
  recipe: PdfImageRecipe,
): Candidate {
  const cells: Cell[] = [];
  let y = 0;
  for (const index of indices) {
    const ratio = ratios[index];
    const raw = box.widthPt / ratio;
    const heightPt = Math.min(raw, box.maxImageHeightPt);
    const widthPt = heightPt * ratio;
    cells.push({
      index,
      leftPt: (box.widthPt - widthPt) / 2,
      topPt: y,
      widthPt,
      heightPt,
    });
    y += heightPt + box.gapPt;
  }
  return {
    recipe,
    cells,
    widthPt: box.widthPt,
    heightPt: Math.max(0, y - box.gapPt),
  };
}

/**
 * 單列並排：寬度依比例分配，令每張圖高度一致（混合橫直向不會一高一低）。
 * `equalWidth` 模式用於同比例圖片（橫直一致），避免因微差而高低不齊。
 */
function rowCandidate(
  ratios: number[],
  indices: number[],
  box: { widthPt: number; gapPt: number; maxImageHeightPt: number },
  options: { recipe: PdfImageRecipe; equalWidth?: boolean },
): Candidate {
  const count = indices.length;
  const free = box.widthPt - box.gapPt * (count - 1);
  const weights = options.equalWidth ? indices.map(() => 1) : indices.map((i) => ratios[i]);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const heights = indices.map((i, k) => (free * weights[k]) / sum / ratios[i]);
  const rowHeight = Math.min(Math.max(...heights), box.maxImageHeightPt);
  const cells: Cell[] = [];
  let x = 0;
  indices.forEach((index, k) => {
    const ratio = ratios[index];
    const cellWidth = (free * weights[k]) / sum;
    const size = fitInside(cellWidth, rowHeight, ratio);
    cells.push({
      index,
      leftPt: x + (cellWidth - size.widthPt) / 2,
      topPt: (rowHeight - size.heightPt) / 2,
      widthPt: size.widthPt,
      heightPt: size.heightPt,
    });
    x += cellWidth + box.gapPt;
  });
  return { recipe: options.recipe, cells, widthPt: box.widthPt, heightPt: rowHeight };
}

/** 左（或右）大圖 + 另一側小圖堆疊。 */
function mainWithThumbnailsCandidate(
  ratios: number[],
  mainIndex: number,
  sideIndices: number[],
  box: { widthPt: number; gapPt: number; maxImageHeightPt: number },
  mainWidthRatio: number,
): Candidate {
  const mainWidth = box.widthPt * mainWidthRatio;
  const sideWidth = box.widthPt - mainWidth - box.gapPt;
  const main = fitInside(mainWidth, box.maxImageHeightPt, ratios[mainIndex]);
  const side = stackCandidate(ratios, sideIndices, { widthPt: sideWidth, gapPt: box.gapPt, maxImageHeightPt: box.maxImageHeightPt }, 'main-with-thumbnails');
  const heightPt = Math.max(main.heightPt, side.heightPt);
  const cells: Cell[] = [
    {
      index: mainIndex,
      leftPt: 0,
      topPt: (heightPt - main.heightPt) / 2,
      widthPt: main.widthPt,
      heightPt: main.heightPt,
    },
    ...side.cells.map((cell) => ({
      ...cell,
      leftPt: cell.leftPt + mainWidth + box.gapPt,
      topPt: cell.topPt + (heightPt - side.heightPt) / 2,
    })),
  ];
  return { recipe: 'main-with-thumbnails', cells, widthPt: box.widthPt, heightPt };
}

/** 主圖在上（滿寬）+ 其餘圖片在下一列（縮圖用等寬格子，各自等比置中）。 */
function mainOnTopCandidate(
  ratios: number[],
  mainIndex: number,
  restIndices: number[],
  box: { widthPt: number; gapPt: number; maxImageHeightPt: number },
): Candidate {
  const main = fitInside(box.widthPt, box.maxImageHeightPt, ratios[mainIndex]);
  const rest = rowCandidate(
    ratios,
    restIndices,
    { widthPt: box.widthPt, gapPt: box.gapPt, maxImageHeightPt: box.maxImageHeightPt },
    { recipe: 'main-with-thumbnails', equalWidth: true },
  );
  const topOffset = 0;
  const restTop = main.heightPt + box.gapPt;
  const cells: Cell[] = [
    {
      index: mainIndex,
      leftPt: (box.widthPt - main.widthPt) / 2,
      topPt: topOffset,
      widthPt: main.widthPt,
      heightPt: main.heightPt,
    },
    ...rest.cells.map((cell) => ({ ...cell, topPt: cell.topPt + restTop })),
  ];
  return {
    recipe: 'main-with-thumbnails',
    cells,
    widthPt: box.widthPt,
    heightPt: restTop + rest.heightPt,
  };
}

/** 圖片組總高超過上限時等比縮小（寬度一併縮，之後整組置中）。 */
function shrinkToFit(candidate: Candidate, maxHeightPt: number): Candidate {
  if (candidate.heightPt <= maxHeightPt || candidate.heightPt <= 0) return candidate;
  const scale = maxHeightPt / candidate.heightPt;
  const right = Math.max(...candidate.cells.map((cell) => cell.leftPt + cell.widthPt));
  return {
    ...candidate,
    widthPt: right * scale,
    heightPt: maxHeightPt,
    cells: candidate.cells.map((cell) => ({
      ...cell,
      leftPt: cell.leftPt * scale,
      topPt: cell.topPt * scale,
      widthPt: cell.widthPt * scale,
      heightPt: cell.heightPt * scale,
    })),
  };
}

function smallestSide(cells: Cell[]): number {
  return cells.reduce((min, cell) => Math.min(min, Math.min(cell.widthPt, cell.heightPt)), Infinity);
}

/** 候選方案是否滿足「不會使圖片過小」的硬性要求。 */
function isAcceptable(candidate: Candidate, minWidthPt: number, minScale = 0.6): boolean {
  if (!Number.isFinite(candidate.heightPt) || candidate.heightPt <= 0) return false;
  return candidate.cells.every(
    (cell) => cell.widthPt >= minWidthPt && cell.heightPt >= minWidthPt * minScale,
  );
}

/**
 * 2 張圖的規則（PRD 4.4 場景 A/B/C）。
 * 兩張橫圖 → 上下排列；兩張直圖 → 左右並排；一橫一直 → 比較高度取較矮者。
 */
function candidatePair(
  ratios: number[],
  box: { widthPt: number; gapPt: number; maxImageHeightPt: number },
  limits: PdfImageLimits,
  minWidthPt: number,
): Candidate {
  const shapes = ratios.map((ratio) => classifyImageShape(ratio, limits));
  const stack = stackCandidate(ratios, [0, 1], box, 'vertical-stack');
  const row = rowCandidate(ratios, [0, 1], box, {
    recipe: 'horizontal-row',
    equalWidth: shapes[0] === shapes[1],
  });

  if (shapes.every((shape) => shape === 'landscape')) return stack;
  if (shapes.every((shape) => shape !== 'landscape')) return isAcceptable(row, minWidthPt) ? row : stack;

  // 一橫一直（參考圖示例 3）：優先上下堆疊；若堆疊後圖片組過高，
  // 才改用左右並排（前提是並排不會讓任何一張太窄）。
  const stackTooTall = stack.heightPt > limits.maxGalleryHeightPt * 0.95;
  if (stackTooTall && isAcceptable(row, minWidthPt)) return row;
  return stack;
}

/** 3 張圖的規則（PRD 4.4 場景 D）：多個候選方案，先過濾太小的，再取最矮。 */
function candidateTriple(
  ratios: number[],
  box: { widthPt: number; gapPt: number; maxImageHeightPt: number },
  limits: PdfImageLimits,
  minWidthPt: number,
): Candidate {
  const shapes = ratios.map((ratio) => classifyImageShape(ratio, limits));
  const candidates: Candidate[] = [
    mainOnTopCandidate(ratios, 0, [1, 2], box),
    mainWithThumbnailsCandidate(ratios, 0, [1, 2], box, 0.6),
    mainWithThumbnailsCandidate(ratios, 2, [0, 1], box, 0.6),
    rowCandidate(ratios, [0, 1, 2], box, { recipe: 'mixed-grid' }),
    stackCandidate(ratios, [0, 1, 2], box, 'vertical-stack'),
  ];

  const viable = candidates.filter((candidate) => isAcceptable(candidate, minWidthPt));

  // 三張同為直向：優先多欄（較矮），但若因過窄被淘汰就退回主圖式。
  if (shapes.every((shape) => shape === 'portrait')) {
    const row = viable.find((candidate) => candidate.recipe === 'mixed-grid');
    if (row) return row;
  }

  if (!viable.length) return candidates[0];
  const floor = Math.max(minWidthPt, 42);
  const score = (candidate: Candidate) =>
    candidate.heightPt +
    candidate.cells.reduce(
      (penalty, cell) => penalty + Math.max(0, floor - Math.min(cell.widthPt, cell.heightPt)) * 2,
      0,
    );
  return viable.reduce((best, candidate) => (score(candidate) < score(best) ? candidate : best));
}

function layoutGroup(
  ratios: number[],
  indices: number[],
  box: { widthPt: number; gapPt: number; maxImageHeightPt: number },
  limits: PdfImageLimits,
): Candidate {
  const minWidthPt = box.widthPt * limits.minImageWidthRatio;
  if (indices.length === 1) {
    const ratio = ratios[indices[0]];
    const size = fitInside(box.widthPt, box.maxImageHeightPt, ratio);
    return {
      recipe: 'single',
      widthPt: size.widthPt,
      heightPt: size.heightPt,
      cells: [
        {
          index: indices[0],
          leftPt: 0,
          topPt: 0,
          widthPt: size.widthPt,
          heightPt: size.heightPt,
        },
      ],
    };
  }
  if (indices.length === 2) return candidatePair(ratios, box, limits, minWidthPt);
  return candidateTriple(ratios, box, limits, minWidthPt);
}

/**
 * 排版主入口。回傳 null 代表這個 Item 沒有圖片（PDF 不顯示任何佔位框）。
 */
export function layoutItemImages(
  sources: PdfImageSource[] | undefined | null,
  options: PdfImageLayoutOptions,
): PdfImageGallery | null {
  const widthPt = Math.max(0, options.widthPt);
  if (!widthPt) return null;

  const images = (sources ?? []).filter((source) => Boolean(source?.url?.trim()));
  if (images.length === 0) return null;

  const limits = resolveLimits(options.limits);
  const ratios = images.map((image) => imageRatio(image));
  const box = { widthPt, gapPt: limits.gapPt, maxImageHeightPt: limits.maxImageHeightPt };

  // 每組最多 3 張；超過就分組後垂直堆疊。每組保持可讀尺寸，
  // 由 Item 分頁邏輯把後續圖片列放到續頁，而不是縮小整個圖庫。
  const groups: number[][] = [];
  for (let start = 0; start < images.length; start += 3) {
    groups.push(Array.from({ length: Math.min(3, images.length - start) }, (_, k) => start + k));
  }

  const candidates = groups.map((group) => layoutGroup(ratios, group, box, limits));

  const placements: PdfImagePlacement[] = [];
  let y = 0;
  let right = 0;

  candidates.forEach((candidate, groupIndex) => {
    const group = shrinkToFit(candidate, limits.maxGalleryHeightPt);
    const offsetX = Math.max(0, (widthPt - group.widthPt) / 2);
    for (const cell of group.cells) {
      placements.push({
        url: images[cell.index].url,
        kind: images[cell.index].kind,
        leftPt: offsetX + cell.leftPt,
        topPt: y + cell.topPt,
        widthPt: cell.widthPt,
        heightPt: cell.heightPt,
      });
      right = Math.max(right, offsetX + cell.leftPt + cell.widthPt);
    }
    y += group.heightPt;
    if (groupIndex < candidates.length - 1) y += limits.gapPt * 1.5;
  });

  return {
    recipe: candidates.length > 1 ? 'mixed-grid' : candidates[0].recipe,
    widthPt: right,
    heightPt: y,
    images: placements,
  };
}

/** 分頁時需要把「圖片組」切成可放在不同頁的片段（每組 3 張最多）。 */
export function splitGalleryIntoRows(gallery: PdfImageGallery, rowHeightPt: number): PdfImageGallery[] {
  if (!gallery.images.length) return [];
  const rows: PdfImageGallery[] = [];
  const sorted = [...gallery.images].sort((a, b) => a.topPt - b.topPt);
  let current: PdfImagePlacement[] = [];
  let currentTop = sorted[0].topPt;
  for (const image of sorted) {
    if (image.topPt - currentTop > rowHeightPt && current.length) {
      rows.push(toGallery(gallery.recipe, current));
      current = [];
      currentTop = image.topPt;
    }
    current.push(image);
  }
  if (current.length) rows.push(toGallery(gallery.recipe, current));
  return rows;
}

function toGallery(recipe: PdfImageRecipe, images: PdfImagePlacement[]): PdfImageGallery {
  const top = Math.min(...images.map((image) => image.topPt));
  const width = Math.max(...images.map((image) => image.leftPt + image.widthPt));
  const bottom = Math.max(...images.map((image) => image.topPt + image.heightPt));
  return {
    recipe,
    widthPt: width,
    heightPt: bottom - top,
    images: images.map((image) => ({ ...image, topPt: image.topPt - top })),
  };
}
