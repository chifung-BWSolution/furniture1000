// File-format checks for the Codex job outputs, plus a small ZIP writer for the FBX texture bundle.
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const SKP_SIGNATURE_UTF16 = Buffer.from([
  0xff, 0xfe, 0xff, 0x0e,
  0x53, 0x00, 0x6b, 0x00, 0x65, 0x00, 0x74, 0x00, 0x63, 0x00, 0x68, 0x00,
  0x55, 0x00, 0x70, 0x00, 0x20, 0x00, 0x4d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x65, 0x00, 0x6c, 0x00,
]);
const SKP_SIGNATURE_ASCII = Buffer.from([
  0x0e, 0x53, 0x6b, 0x65, 0x74, 0x63, 0x68, 0x55, 0x70, 0x20, 0x4d, 0x6f, 0x64, 0x65, 0x6c,
]);

export function looksLikeSkp(bytes) {
  return bytes.subarray(0, SKP_SIGNATURE_UTF16.length).equals(SKP_SIGNATURE_UTF16) ||
    bytes.subarray(0, SKP_SIGNATURE_ASCII.length).equals(SKP_SIGNATURE_ASCII);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function inspectPng(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('png_invalid');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const FBX_BINARY = Buffer.from('Kaydara FBX Binary  \0', 'binary');

/** Header plus the node names every mesh export carries. Not a full FBX parser. */
export function inspectFbx(bytes) {
  const binary = bytes.subarray(0, FBX_BINARY.length).equals(FBX_BINARY);
  const ascii = !binary && /^\s*; FBX/.test(bytes.subarray(0, 64).toString('latin1'));
  if (!binary && !ascii) throw new Error('fbx_header_invalid');
  const version = binary ? bytes.readUInt32LE(23) : null;
  const hasGeometry = bytes.includes(Buffer.from('Geometry')) && bytes.includes(Buffer.from('Vertices'));
  if (!hasGeometry) throw new Error('fbx_no_geometry');
  return { encoding: binary ? 'binary' : 'ascii', version };
}

// ── glTF 2.0 binary ─────────────────────────────────────────────────────────

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  const s = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
  const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
  return multiply(t, multiply(r, s));
}

function transform(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Structure, embedded resources and world-space bounds (glTF units are metres, +Y up).
 * Bounds use each POSITION accessor's min/max corners under the node's world matrix.
 */
export function inspectGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('glb_header_invalid');
  if (bytes.readUInt32LE(4) !== 2) throw new Error('glb_version_invalid');
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('glb_length_invalid');
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > bytes.length) throw new Error('glb_json_invalid');
  let gltf;
  try {
    gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  } catch {
    throw new Error('glb_json_invalid');
  }
  const external = [
    ...(gltf.buffers ?? []).filter((b) => typeof b.uri === 'string').map((b) => b.uri),
    ...(gltf.images ?? []).filter((i) => typeof i.uri === 'string' && !i.uri.startsWith('data:')).map((i) => i.uri),
  ];
  const meshes = gltf.meshes ?? [];
  if (meshes.length === 0) throw new Error('glb_no_meshes');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const accessors = gltf.accessors ?? [];
  const visit = (index, parent, depth) => {
    if (depth > 64) throw new Error('glb_node_depth');
    const node = gltf.nodes?.[index];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));
    if (Number.isInteger(node.mesh)) {
      for (const primitive of meshes[node.mesh]?.primitives ?? []) {
        const accessor = accessors[primitive.attributes?.POSITION];
        if (!accessor?.min || !accessor?.max) continue;
        for (const cx of [accessor.min[0], accessor.max[0]]) {
          for (const cy of [accessor.min[1], accessor.max[1]]) {
            for (const cz of [accessor.min[2], accessor.max[2]]) {
              const p = transform(world, [cx, cy, cz]);
              for (let axis = 0; axis < 3; axis++) {
                min[axis] = Math.min(min[axis], p[axis]);
                max[axis] = Math.max(max[axis], p[axis]);
              }
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  for (const root of scene?.nodes ?? []) visit(root, IDENTITY, 0);
  if (!Number.isFinite(min[0])) throw new Error('glb_no_geometry');
  return {
    meshes: meshes.length,
    primitives: meshes.reduce((n, m) => n + (m.primitives?.length ?? 0), 0),
    materials: gltf.materials?.length ?? 0,
    textures: gltf.textures?.length ?? 0,
    images: gltf.images?.length ?? 0,
    external,
    bounds: { min, max, size: max.map((v, i) => v - min[i]) },
  };
}

// ── ZIP (store or deflate, no ZIP64) ────────────────────────────────────────

const DOS_DATE_1980 = (0 << 9) | (1 << 5) | 1;

export function safeEntryName(name) {
  const normal = String(name).replaceAll('\\', '/');
  if (!normal || normal.startsWith('/') || /^[a-zA-Z]:/.test(normal) || normal.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('zip_entry_invalid');
  }
  return normal;
}

/** entries: [{ name: 'model.fbx' | 'model/texture.png', data: Buffer }] */
export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(safeEntryName(entry.name), 'utf8');
    const data = entry.data;
    const deflated = deflateRawSync(data);
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
    if (offset > 0xffffffff) throw new Error('zip_too_large');
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Reads back what createZip wrote; used to check the bundle before upload. */
export function readZip(bytes) {
  const endAt = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('zip_invalid');
  const count = bytes.readUInt16LE(endAt + 10);
  let at = bytes.readUInt32LE(endAt + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error('zip_invalid');
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const compressed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    const localAt = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    const dataAt = localAt + 30 + bytes.readUInt16LE(localAt + 26) + bytes.readUInt16LE(localAt + 28);
    const body = bytes.subarray(dataAt, dataAt + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    if ((crc32(data) >>> 0) !== crc) throw new Error('zip_crc_mismatch');
    entries.push({ name: safeEntryName(name), data });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}
