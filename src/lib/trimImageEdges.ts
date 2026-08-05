/**
 * Trim solid near-black (or near-white) edge strips that often appear as a
 * 1px "border" after resize/export. When the tiny strip is scaled up in the UI
 * it becomes a thick visible line even though native viewers look clean.
 */

const DEFAULT_MAX_TRIM_PX = 4;
const DEFAULT_DARK = 24;
const DEFAULT_LIGHT = 250;
/** Column/row must be at least this fraction solid to count as a trim edge. */
const SOLID_RATIO = 0.92;

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取圖片'));
    };
    img.src = url;
  });
}

function isNearBlack(r: number, g: number, b: number, a: number, dark: number): boolean {
  if (a < 10) return true;
  return r <= dark && g <= dark && b <= dark;
}

function isNearWhite(r: number, g: number, b: number, a: number, light: number): boolean {
  if (a < 10) return false;
  return r >= light && g >= light && b >= light;
}

function columnIsSolid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  kind: 'dark' | 'light',
  dark: number,
  light: number,
): boolean {
  let hits = 0;
  for (let y = 0; y < height; y += 1) {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const ok =
      kind === 'dark'
        ? isNearBlack(r, g, b, a, dark)
        : isNearWhite(r, g, b, a, light);
    if (ok) hits += 1;
  }
  return hits / height >= SOLID_RATIO;
}

function rowIsSolid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  y: number,
  kind: 'dark' | 'light',
  dark: number,
  light: number,
): boolean {
  let hits = 0;
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const ok =
      kind === 'dark'
        ? isNearBlack(r, g, b, a, dark)
        : isNearWhite(r, g, b, a, light);
    if (ok) hits += 1;
  }
  return hits / width >= SOLID_RATIO;
}

function findTrimBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxTrimPx: number,
  dark: number,
  light: number,
): { x: number; y: number; w: number; h: number } | null {
  let left = 0;
  let right = width - 1;
  let top = 0;
  let bottom = height - 1;

  const trimSide = (kind: 'dark' | 'light') => {
    while (
      left <= right &&
      left - 0 < maxTrimPx &&
      columnIsSolid(data, width, height, left, kind, dark, light)
    ) {
      left += 1;
    }
    while (
      right >= left &&
      width - 1 - right < maxTrimPx &&
      columnIsSolid(data, width, height, right, kind, dark, light)
    ) {
      right -= 1;
    }
    while (
      top <= bottom &&
      top < maxTrimPx &&
      rowIsSolid(data, width, height, top, kind, dark, light)
    ) {
      top += 1;
    }
    while (
      bottom >= top &&
      height - 1 - bottom < maxTrimPx &&
      rowIsSolid(data, width, height, bottom, kind, dark, light)
    ) {
      bottom -= 1;
    }
  };

  // Prefer removing dark hairline borders (the reported bug); then light ones.
  trimSide('dark');
  trimSide('light');

  if (left === 0 && right === width - 1 && top === 0 && bottom === height - 1) {
    return null;
  }
  if (right < left || bottom < top) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function canvasToFile(
  canvas: HTMLCanvasElement,
  source: File,
): Promise<File> {
  const type =
    source.type === 'image/png' || source.type === 'image/webp'
      ? source.type
      : 'image/jpeg';
  const quality = type === 'image/jpeg' ? 0.92 : undefined;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('無法輸出修剪後圖片'));
          return;
        }
        const name =
          type === source.type
            ? source.name
            : source.name.replace(/\.[^.]+$/, '') +
              (type === 'image/png' ? '.png' : '.jpg');
        resolve(new File([blob], name, { type, lastModified: Date.now() }));
      },
      type,
      quality,
    );
  });
}

/**
 * Crop solid near-black/near-white edge strips (up to a few px).
 * Returns the original file when no trim is needed or processing fails.
 */
export async function trimImageSolidEdgeBorders(
  file: File,
  opts?: {
    maxTrimPx?: number;
    darkThreshold?: number;
    lightThreshold?: number;
  },
): Promise<File> {
  if (typeof document === 'undefined') return file;
  if (!file.type.startsWith('image/')) return file;
  // Skip SVG / GIF (animation / vector).
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;

  const maxTrimPx = opts?.maxTrimPx ?? DEFAULT_MAX_TRIM_PX;
  const dark = opts?.darkThreshold ?? DEFAULT_DARK;
  const light = opts?.lightThreshold ?? DEFAULT_LIGHT;

  try {
    const img = await loadImageFromBlob(file);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width < 8 || height < 8) return file;

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    const box = findTrimBox(data, width, height, maxTrimPx, dark, light);
    if (!box || (box.w === width && box.h === height)) return file;

    const out = document.createElement('canvas');
    out.width = box.w;
    out.height = box.h;
    const outCtx = out.getContext('2d');
    if (!outCtx) return file;
    outCtx.drawImage(
      source,
      box.x,
      box.y,
      box.w,
      box.h,
      0,
      0,
      box.w,
      box.h,
    );
    return canvasToFile(out, file);
  } catch {
    return file;
  }
}
