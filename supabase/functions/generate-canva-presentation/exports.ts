/** T-903 — shared Canva export job runner (PPTX / PDF). */

export type CanvaExportFormat = "pptx" | "pdf";

export function exportFormatBody(format: CanvaExportFormat): Record<string, unknown> {
  if (format === "pptx") return { type: "pptx" };
  return { type: "pdf", size: "a4" };
}

export type CanvaExportJob = {
  status?: string;
  urls?: { url?: string }[];
  error?: { code?: string; message?: string };
};

export function pickDownloadUrl(job: CanvaExportJob | null): string | null {
  if (!job?.urls?.length) return null;
  return job.urls[0]?.url ?? null;
}
