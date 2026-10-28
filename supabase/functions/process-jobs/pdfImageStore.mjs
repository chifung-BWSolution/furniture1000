export const PDF_IMAGE_COLOR_VERSION = 'rgb-v1';

/**
 * Prepare one unit without exceeding Edge's CPU budget. At most one picture is
 * decoded per invocation. The caller checkpoints the same unit on null; once all
 * pictures are ready, cached RGB bytes are loaded for the vision model.
 * @param {any} options
 */
export async function preparePdfUnitImages({ admin, documentId, document, pages,
  collectImages, normalizeImage, hashBytes, minPixels = 100, validateImage = null, rejectedHashes = [], maxImageBytes = 4 * 1024 * 1024,
  totalBytes = 12 * 1024 * 1024, maxImages = 10, logoPages = 3 }) {
  if (!document || pages.length === 0) return [];
  const found = new Map();
  for (const page of pages) for (const image of collectImages(document, page)) {
    if (image.width < minPixels || image.height < minPixels || image.bytes.length > maxImageBytes) continue;
    const hash = await hashBytes(image.bytes);
    if (rejectedHashes.includes(hash)) continue;
    const existing = found.get(hash);
    if (existing) existing.pages.add(page);
    else found.set(hash, { page, pages: new Set([page]), image });
  }
  if (found.size === 0) return [];
  const { data, error } = await admin.from('supplier_document_images')
    .select('id, content_hash, storage_path, public_url, byte_size').eq('document_id', documentId)
    .in('content_hash', [...found.keys()]);
  if (error) throw new Error(`image lookup failed: ${error.message}`);
  const byHash = new Map((data ?? []).map(row => [row.content_hash, row]));
  const bucket = admin.storage.from('product-images');
  const ready = [];
  let decoded = false;
  for (const [hash, entry] of found) {
    const row = byHash.get(hash);
    const storagePath = `supplier-extracts/${documentId}/${hash}-${PDF_IMAGE_COLOR_VERSION}.jpg`;
    const publicUrl = bucket.getPublicUrl(storagePath).data.publicUrl;
    let size = row?.byte_size;
    if (row?.storage_path !== storagePath) {
      if (decoded) return null;
      const bytes = await normalizeImage(document, entry.image);
      if (validateImage && !(await validateImage(bytes, entry.page))) {
        rejectedHashes.push(hash);
        return null;
      }
      const upload = async path => {
        const { error } = await bucket.upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '60', upsert: true });
        if (error) throw new Error(`image upload failed: ${error.message}`);
      };
      // Previously imported products may contain the old URL directly. Keep it
      // usable, while the versioned URL bypasses cached dark thumbnails in review.
      if (row?.storage_path && row.storage_path !== storagePath) await upload(row.storage_path);
      await upload(storagePath);
      size = bytes.length;
      decoded = true;
    }
    const { data: recorded, error: recordError } = await admin.rpc('fds_supplier_document_image_record', {
      p_document_id: documentId, p_content_hash: hash, p_pages: [...entry.pages], p_page_no: entry.page,
      p_storage_path: storagePath, p_public_url: publicUrl, p_width: entry.image.width,
      p_height: entry.image.height, p_byte_size: size,
    });
    if (recordError) throw new Error(`image record failed: ${recordError.message}`);
    if (!recorded?.id) throw new Error(`image record failed: no row for ${hash}`);
    if (Number(recorded.page_occurrences) >= logoPages) continue;
    ready.push({ id: recorded.id, page_no: entry.page, area: entry.image.area, size, storagePath });
  }
  // Reserve the final invocation's CPU for PDF context/model response handling.
  if (decoded) return null;
  const result = [];
  for (const image of ready.sort((a, b) => a.page_no - b.page_no || b.area - a.area)) {
    if (result.length >= maxImages) break;
    if (image.size > maxImageBytes || image.size > totalBytes) continue;
    const { data: blob, error } = await bucket.download(image.storagePath);
    if (error || !blob) throw new Error(`normalized image download failed: ${error?.message ?? 'empty'}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > maxImageBytes || bytes.length > totalBytes) continue;
    totalBytes -= bytes.length;
    result.push({ id: image.id, page_no: image.page_no, area: image.area, bytes });
  }
  return result;
}
