export const PDF_EDGE_MAX_BYTES: number;
export const PDF_SPLIT_TARGET_BYTES: number;
export const PDF_SPLIT_MAX_PAGES: number;

export interface PdfPartBytes {
  partIndex: number;
  /** Original pages before this part. Original page number = local page + pageOffset. */
  pageOffset: number;
  pageCount: number;
  bytes: Uint8Array;
}

export function partStoragePath(parentPath: string, partIndex: number, partHash: string): string;
export function splitPdfUnderTarget(input: Uint8Array, targetBytes?: number, maxPages?: number): Promise<PdfPartBytes[]>;
