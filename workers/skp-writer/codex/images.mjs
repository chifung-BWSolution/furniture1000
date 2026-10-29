// Downloads the product reference images for a Codex job. The Worker sits on the office network,
// so every hop is checked against private address ranges and redirects are followed by hand.
import { lookup } from 'node:dns/promises';
import { writeFile } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';

export const MAX_REFERENCES = 8;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const TYPES = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
};

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') ||
    v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

export async function assertPublicUrl(raw, resolve = lookup) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('reference_url_invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('reference_url_invalid');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('reference_host_private');
  const addresses = net.isIP(host) ? [{ address: host }] : await resolve(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('reference_host_private');
  return url;
}

async function readLimited(response, limit) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) throw new Error('reference_too_large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('reference_empty');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error('reference_too_large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function fetchImage(raw, { fetchImpl = fetch, resolve = lookup, limit = MAX_IMAGE_BYTES, timeoutMs = 30_000 } = {}) {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current, resolve);
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('reference_redirect_invalid');
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new Error(`reference_http_${response.status}`);
    const mime = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const type = TYPES[mime];
    if (!type) throw new Error('reference_type_invalid');
    const bytes = await readLimited(response, limit);
    if (bytes.length < 16 || !type.magic(bytes)) throw new Error('reference_content_invalid');
    return { bytes, mime, ext: type.ext, finalUrl: url.toString() };
  }
  throw new Error('reference_redirect_loop');
}

/**
 * references: [{ url, order, source }] from the job snapshot.
 * Failed images are reported, not fatal; the caller decides whether enough remain.
 */
export async function downloadReferences(references, dir, options = {}) {
  const saved = [];
  const failed = [];
  let total = 0;
  for (const ref of (references ?? []).slice(0, MAX_REFERENCES)) {
    try {
      const image = await fetchImage(ref.url, { ...options, limit: Math.min(MAX_IMAGE_BYTES, MAX_TOTAL_BYTES - total) });
      total += image.bytes.length;
      const name = `ref-${String(saved.length + 1).padStart(2, '0')}.${image.ext}`;
      const path = join(dir, name);
      await writeFile(path, image.bytes);
      saved.push({ path, name, url: ref.url, source: ref.source ?? null, mime: image.mime, size_bytes: image.bytes.length });
    } catch (error) {
      failed.push({ url: ref.url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { saved, failed };
}
