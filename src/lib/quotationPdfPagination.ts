/**
 * 報價單 PDF 的分頁計算（PRD 第五章）。
 *
 * 每一個「區塊」（Item 列、分區小計、安裝費列、總金額、圖片組、條款段落…）
 * 都自帶量測好的高度，這裡只負責把它們裝進一頁頁，不涉及內容渲染。
 *
 * 規則：
 * 1. 區塊不切割（切割由呼叫方用「分段」表達，例如超長 Item 拆成多段）。
 * 2. 當前頁放不下就整塊移到下一頁。
 * 3. 首頁與續頁可用高度不同（首頁有完整頁首，續頁有簡化頁首 + 重複表頭）。
 * 4. `keepWithNext` 的區塊（例如條款小標）與下一個區塊綁在一起，避免標題孤立在頁尾。
 * 5. 最後一頁內容過少時，把前一頁尾部區塊往下搬，減少孤立頁。
 */

export type PdfLayoutBlock = {
  /** 唯一 key（React key）。 */
  key: string;
  /** 量測後的高度（pt）。 */
  heightPt: number;
  /** true＝必須與下一個區塊同頁（標題與首段）。 */
  keepWithNext?: boolean;
};

export type PdfPaginationOptions = {
  /** 第 pageIndex 頁（0 起）可用高度。 */
  capacityForPage: (pageIndex: number) => number;
  /** 最後一頁填充率低於此值時嘗試平衡（0–1）。設 0 可關閉。 */
  balanceThreshold?: number;
};

export type PdfPageOf<T> = {
  blocks: T[];
  heightPt: number;
  /** 這一頁有沒有任何區塊超過可用高度（代表需要呼叫方縮小或分段）。 */
  overflow: boolean;
};

export function paginatePdfBlocks<T extends PdfLayoutBlock>(
  blocks: T[],
  options: PdfPaginationOptions,
): PdfPageOf<T>[] {
  const balanceThreshold = options.balanceThreshold ?? 0.25;

  // 1. 先把 keepWithNext 的區塊併成不可分離的叢集。
  const clusters: T[][] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const cluster = [block];
    while (blocks[index]?.keepWithNext && index + 1 < blocks.length) {
      index += 1;
      const next = blocks[index];
      cluster.push(next);
      // 若下一個自己也 keepWithNext，繼續併。
      if (!next.keepWithNext) break;
    }
    clusters.push(cluster);
  }

  const clusterHeight = (cluster: T[]) =>
    cluster.reduce((sum, block) => sum + Math.max(0, block.heightPt), 0);

  // 2. 依序裝頁。
  const pages: PdfPageOf<T>[] = [];
  let current: T[] = [];
  let currentHeight = 0;
  let overflow = false;

  const flush = () => {
    pages.push({ blocks: current, heightPt: currentHeight, overflow });
    current = [];
    currentHeight = 0;
    overflow = false;
  };

  for (const cluster of clusters) {
    const height = clusterHeight(cluster);
    const capacity = options.capacityForPage(pages.length);

    if (current.length && currentHeight + height > capacity) {
      // 情況 B：當前頁不夠，整塊移到下一頁。
      flush();
    }

    const nextCapacity = options.capacityForPage(pages.length);
    if (!current.length && height > nextCapacity) {
      // 情況 C：單一叢集比整頁還高 —— 照樣放在這一頁，並標記 overflow，
      // 呼叫方應該把超長 Item 先切成多段再進來。
      current.push(...cluster);
      currentHeight += height;
      overflow = true;
      flush();
      continue;
    }

    current.push(...cluster);
    currentHeight += height;
  }
  if (current.length) flush();
  if (pages.length === 0) pages.push({ blocks: [], heightPt: 0, overflow: false });

  if (balanceThreshold > 0 && pages.length > 1) {
    balanceLastPage(pages, options, balanceThreshold);
  }

  return pages;
}

/**
 * 最後一頁太空時，把前一頁尾部的區塊搬到最後一頁，
 * 避免「只有一兩行」的孤立頁（PRD 5.2 第 5 點）。
 */
function balanceLastPage<T extends PdfLayoutBlock>(
  pages: PdfPageOf<T>[],
  options: PdfPaginationOptions,
  threshold: number,
): void {
  const last = pages[pages.length - 1];
  const prev = pages[pages.length - 2];
  if (!prev || prev.blocks.length < 2) return;

  const lastCapacity = options.capacityForPage(pages.length - 1);
  const prevCapacity = options.capacityForPage(pages.length - 2);
  const MIN_KEEP_RATIO = 0.6;

  let guard = 0;
  while (
    last.heightPt < lastCapacity * threshold &&
    prev.blocks.length > 1 &&
    guard < 20
  ) {
    guard += 1;
    const moved = prev.blocks[prev.blocks.length - 1];
    const prevAfter = prev.heightPt - moved.heightPt;
    if (prevAfter < prevCapacity * MIN_KEEP_RATIO) break;
    if (last.heightPt + moved.heightPt > lastCapacity) break;
    prev.blocks.pop();
    prev.heightPt = prevAfter;
    last.blocks.unshift(moved);
    last.heightPt += moved.heightPt;
  }
}

/** 把超長 Item 的高度需求切成多段：每段最多一段頁高。 */
export function splitHeightIntoSegments(
  totalHeightPt: number,
  firstCapacityPt: number,
  nextCapacityPt: number,
): number[] {
  const segments: number[] = [];
  let remaining = totalHeightPt;
  let capacity = firstCapacityPt;
  let guard = 0;
  while (remaining > 0 && guard < 100) {
    guard += 1;
    const slice = Math.min(remaining, Math.max(40, capacity));
    segments.push(slice);
    remaining -= slice;
    capacity = nextCapacityPt;
  }
  return segments.length ? segments : [totalHeightPt];
}
