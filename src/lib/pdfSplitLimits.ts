/** Keep in sync with src/lib/pdfSplitCore.mjs. Edge refuses a PDF above this size. */
export const PDF_EDGE_MAX_BYTES = 60 * 1024 * 1024;
/** Each split part is kept near this size so Edge parse_pdf stays inside its memory limit. */
export const PDF_SPLIT_TARGET_BYTES = 10 * 1024 * 1024;
/** Each split part has at most this many pages. */
export const PDF_SPLIT_MAX_PAGES = 15;
