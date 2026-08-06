import {
  httpOnlyImageForDb,
  isBase64Image,
  isHttpImageUrl,
  uploadFileToStorage,
  uploadImageSourceToStorage,
} from './imageStorage';
import {
  parseRemarksContent,
  serializeRemarksContent,
  type RemarksBlock,
} from './remarksContent';

export type QuoteImageField = 'product' | 'reference' | 'remarks';

export type QuoteItemImageFields = {
  image?: string;
  referenceImage?: string;
  remarks?: string;
  remarksImage?: string;
};

function quoteItemStorageId(quoteScope: string, itemKey: string): string {
  const scope = quoteScope.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const key = itemKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return `quote_${scope}_${key}`;
}

/** Upload a user-selected file for a quote line item; returns public Storage URL. */
export async function uploadQuoteImageFile(
  file: File,
  quoteScope: string,
  itemKey: string,
  field: QuoteImageField,
): Promise<string> {
  const id = quoteItemStorageId(quoteScope, itemKey);
  // Hairline trim runs inside uploadFileToStorage (after resize).
  return uploadFileToStorage(file, id, field);
}

async function resolveRemarksField(
  remarks: string | undefined,
  legacyImage: string | undefined,
  quoteScope: string,
  itemKey: string,
): Promise<string> {
  const blocks = parseRemarksContent(remarks, legacyImage);
  const id = quoteItemStorageId(quoteScope, itemKey);
  let imageIdx = 0;
  const resolved: RemarksBlock[] = [];

  for (const block of blocks) {
    if (block.type === 'image') {
      const url = await uploadImageSourceToStorage(block.src, id, `remarks${imageIdx}`);
      imageIdx += 1;
      if (url && isHttpImageUrl(url)) {
        resolved.push({ ...block, src: url });
      } else if (isHttpImageUrl(block.src)) {
        resolved.push(block);
      }
    } else {
      resolved.push(block);
    }
  }

  return serializeRemarksContent(resolved);
}

/** Ensure item image fields are Storage HTTP URLs (never base64) before persisting to bwf_quote. */
export async function resolveQuoteItemImages<T extends QuoteItemImageFields>(
  item: T,
  quoteScope: string,
  itemKey: string,
): Promise<T> {
  const id = quoteItemStorageId(quoteScope, itemKey);

  const [productUrl, referenceUrl, remarks] = await Promise.all([
    item.image?.trim()
      ? uploadImageSourceToStorage(item.image.trim(), id, 'product')
      : Promise.resolve(null),
    item.referenceImage?.trim()
      ? uploadImageSourceToStorage(item.referenceImage.trim(), id, 'reference')
      : Promise.resolve(null),
    resolveRemarksField(item.remarks, item.remarksImage, quoteScope, itemKey),
  ]);

  return {
    ...item,
    image: httpOnlyImageForDb(productUrl ?? item.image) ?? '',
    referenceImage: httpOnlyImageForDb(referenceUrl ?? item.referenceImage) ?? undefined,
    remarks,
    remarksImage: undefined,
  };
}

export function quoteItemHasBase64Images(item: QuoteItemImageFields): boolean {
  if (isBase64Image(item.image)) return true;
  if (isBase64Image(item.referenceImage)) return true;
  if (isBase64Image(item.remarksImage)) return true;
  if (typeof item.remarks === 'string') {
    const blocks = parseRemarksContent(item.remarks, item.remarksImage);
    return blocks.some((b) => b.type === 'image' && isBase64Image(b.src));
  }
  return false;
}

export function quoteProjectDataHasBase64Images(projectData: Record<string, unknown>): boolean {
  const items = projectData.items;
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    if (!item || typeof item !== 'object') return false;
    return quoteItemHasBase64Images(item as QuoteItemImageFields);
  });
}

/** Resolve all quote line-item images in project_data before DB write. */
export async function resolveQuoteProjectDataImages(
  projectData: Record<string, unknown>,
  quoteScope: string,
): Promise<Record<string, unknown>> {
  const items = projectData.items;
  if (!Array.isArray(items)) return projectData;

  const resolvedItems = await Promise.all(
    items.map(async (item, index) => {
      if (!item || typeof item !== 'object') return item;
      const row = item as QuoteItemImageFields & { id?: string };
      const itemKey = row.id || String(index);
      return resolveQuoteItemImages(row, quoteScope, itemKey);
    }),
  );

  return { ...projectData, items: resolvedItems };
}
