import { uploadBlobToStorage } from '@/lib/imageStorage';
import { detectZonesFromJpegBase64, imageBlobToJpegBase64, type DetectedFloorZone } from '@/lib/quoteFloorPlan';

/** Use the quotation detector and crop its percentage bounds from the original image. */
export async function recognizePresentationFloorPlan(blob: Blob) {
  const detected = await detectZonesFromJpegBase64(await imageBlobToJpegBase64(blob));
  return cropPresentationFloorPlan(blob, detected);
}

export async function cropPresentationFloorPlan(blob: Blob, detected: DetectedFloorZone[]) {
  const bitmap = await createImageBitmap(blob);
  let failedCrops = 0;
  try {
    const zones = [];
    for (const zone of detected) {
      let imageUrl: string | undefined;
      if (zone.rect) {
        try {
          const { x, y, w, h } = zone.rect;
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 4096 / Math.max(bitmap.width * w / 100, bitmap.height * h / 100));
          canvas.width = Math.max(1, Math.round(bitmap.width * w / 100 * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * h / 100 * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('無法裁切分區截圖');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, bitmap.width * x / 100, bitmap.height * y / 100,
            bitmap.width * w / 100, bitmap.height * h / 100, 0, 0, canvas.width, canvas.height);
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
