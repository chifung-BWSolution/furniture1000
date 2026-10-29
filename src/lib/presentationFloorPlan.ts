import { uploadBlobToStorage } from '@/lib/imageStorage';
import { detectZonesFromJpegBase64, imageBlobToJpegBase64, type DetectedFloorZone, type QuoteZoneRect } from '@/lib/quoteFloorPlan';

export function presentationZoneBounds(rects: QuoteZoneRect[]): QuoteZoneRect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return { x, y, w: Math.max(...rects.map((rect) => rect.x + rect.w)) - x, h: Math.max(...rects.map((rect) => rect.y + rect.h)) - y };
}

/** Use the quotation detector and crop its percentage bounds from the original image. */
export async function recognizePresentationFloorPlan(blob: Blob) {
  const detected = await detectZonesFromJpegBase64(await imageBlobToJpegBase64(blob));
  return cropPresentationFloorPlan(blob, detected);
}

export async function cropPresentationFloorPlan(blob: Blob, detected: (DetectedFloorZone & { rects?: QuoteZoneRect[] })[]) {
  const bitmap = await createImageBitmap(blob);
  let failedCrops = 0;
  try {
    const zones = [];
    for (const zone of detected) {
      let imageUrl: string | undefined;
      if (zone.rect) {
        try {
          const rects = zone.rects?.length ? zone.rects : [zone.rect];
          const sizes = rects.map((rect) => ({ width: bitmap.width * rect.w / 100, height: bitmap.height * rect.h / 100 }));
          const gap = rects.length > 1 ? 12 : 0;
          const totalWidth = sizes.reduce((sum, size) => sum + size.width, 0) + gap * (rects.length - 1);
          const maxHeight = Math.max(...sizes.map((size) => size.height));
          const scale = Math.min(1, 4096 / Math.max(totalWidth, maxHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(totalWidth * scale));
          canvas.height = Math.max(1, Math.round(maxHeight * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('無法裁切分區截圖');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          let left = 0;
          rects.forEach((rect, index) => {
            const size = sizes[index];
            ctx.drawImage(bitmap, bitmap.width * rect.x / 100, bitmap.height * rect.y / 100,
              size.width, size.height, left * scale, 0, size.width * scale, size.height * scale);
            left += size.width + gap;
          });
          const crop = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            (result) => result ? resolve(result) : reject(new Error('無法裁切分區截圖')), 'image/png',
          ));
          imageUrl = await uploadBlobToStorage(crop, crypto.randomUUID(), 'presentation-zone');
        } catch {
          failedCrops += 1;
        }
      }
      zones.push({ name: zone.name, rect: zone.rect, imageUrl });
    }
    return { zones, failedCrops };
  } finally {
    bitmap.close();
  }
}
