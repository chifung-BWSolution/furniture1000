/**
 * Trim solid near-black / near-white *hairline* edge strips that appear after
 * resize/JPEG export. A hairline is an edge column/row that is solid, while the
 * adjacent inward column/row is not — so real white-background product photos
 * are left untouched.
 */

const DEFAULT_MAX_TRIM_PX = 4;
const DEFAULT_DARK = 24;
const DEFAULT_LIGHT = 250;
/** Column/row must be at least this fraction solid to count as an edge. */
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
    const ok =
      kind === 'dark'
        ? isNearBlack(data[i], data[i + 1], data[i + 2], data[i + 3], dark)
        : isNearWhite(data[i], data[i + 1], data[i + 2], data[i + 3], light);
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
    const ok =
      kind === 'dark'
        ? isNearBlack(data[i], data[i + 1], data[i + 2], data[i + 3], dark)
        : isNearWhite(data[i], data[i + 1], data[i + 2], data[i + 3], light);
    if (ok) hits += 1;
  }
  return hits / width >= SOLID_RATIO;
}

/** Edge is solid AND the next inward line is not — true hairline, not a full background. */
function columnIsHairline(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edgeX: number,
  inwardX: number,
  kind: 'dark' | 'light',
  dark: number,
  light: number,
): boolean {
  if (inwardX < 0 || inwardX >= width) return false;
  return (
    columnIsSolid(data, width, height, edgeX, kind, dark, light) &&
    !columnIsSolid(data, width, height, inwardX, kind, dark, light)
  );
}

function rowIsHairline(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edgeY: number,
  inwardY: number,
  kind: 'dark' | 'light',
  dark: number,
  light: number,
): boolean {
  if (inwardY < 0 || inwardY >= height) return false;
  return (
    rowIsSolid(data, width, height, edgeY, kind, dark, light) &&
    !rowIsSolid(data, width, height, inwardY, kind, dark, light)
  );
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
      left < maxTrimPx &&
      columnIsHairline(data, width, height, left, left + 1, kind, dark, light)
    ) {
      left += 1;
    }
    while (
      right >= left &&
      width - 1 - right < maxTrimPx &&
      columnIsHairline(data, width, height, right, right - 1, kind, dark, light)
    ) {
      right -= 1;
    }
    while (
      top <= bottom &&
      top < maxTrimPx &&
      rowIsHairline(data, width, height, top, top + 1, kind, dark, light)
    ) {
      top += 1;
    }
    while (
      bottom >= top &&
      height - 1 - bottom < maxTrimPx &&
      rowIsHairline(data, width, height, bottom, bottom - 1, kind, dark, light)
    ) {
      bottom -= 1;
    }
  };

  // Dark hairlines first (common JPEG/alpha artifact), then light hairlines.
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

function toFile(blob: Blob, fallbackName = 'image.jpg'): File {
  if (blob instanceof File) return blob;
  return new File([blob], fallbackName, {
    type: blob.type || 'image/jpeg',
    lastModified: Date.now(),
  });
}

/**
 * Crop solid near-black/near-white hairline edge strips (up to a few px).
 * Returns the original file when no trim is needed or processing fails.
 */
export async function trimImageSolidEdgeBorders(
  file: File | Blob,
  opts?: {
    maxTrimPx?: number;
    darkThreshold?: number;
    lightThreshold?: number;
  },
): Promise<File> {
  if (typeof document === 'undefined') return toFile(file);
  const sourceFile = toFile(file);
  if (!sourceFile.type.startsWith('image/')) return sourceFile;
  // Skip SVG / GIF (animation / vector).
  if (sourceFile.type === 'image/svg+xml' || sourceFile.type === 'image/gif') {
    return sourceFile;
  }

  const maxTrimPx = opts?.maxTrimPx ?? DEFAULT_MAX_TRIM_PX;
  const dark = opts?.darkThreshold ?? DEFAULT_DARK;
  const light = opts?.lightThreshold ?? DEFAULT_LIGHT;

  try {
    const img = await loadImageFromBlob(sourceFile);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width < 8 || height < 8) return sourceFile;

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) return sourceFile;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    const box = findTrimBox(data, width, height, maxTrimPx, dark, light);
    if (!box || (box.w === width && box.h === height)) return sourceFile;

    const out = document.createElement('canvas');
    out.width = box.w;
    out.height = box.h;
    const outCtx = out.getContext('2d');
    if (!outCtx) return sourceFile;
    // Preserve JPEG-friendly opaque backdrop when cropping.
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, box.w, box.h);
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
    return canvasToFile(out, sourceFile);
  } catch {
    return sourceFile;
  }
}
