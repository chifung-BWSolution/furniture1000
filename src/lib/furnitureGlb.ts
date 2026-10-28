import { partAppearance, partPolygons, type ModelPart, type ParametricModel, type Vec3 } from '@/lib/furnitureParametric';

/**
 * glTF is Y-up, ours is Z-up: rotate -90° about X, so (x, y, z) becomes (x, z, -y).
 * A rotation keeps handedness, so the model is not mirrored and the winding stays outward.
 */
const toGltf = ([x, y, z]: Vec3): Vec3 => [x / 1000, z / 1000, -y / 1000];

/** Flat-shaded faces relative to the part center; concave faces and holes are ear-clipped. */
function partVertices(part: ModelPart): { positions: number[]; normals: number[]; indices: number[] } {
  const [cx, cy, cz] = part.position_mm;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const face of partPolygons(part)) {
    const base = positions.length / 3;
    const normal = toGltf(face.normal.map((n) => n * 1000) as Vec3);
    for (const [x, y, z] of face.points) {
      positions.push(...toGltf([x - cx, y - cy, z - cz]));
      normals.push(...normal);
    }
    for (const [i, j, k] of face.triangles) indices.push(base + i, base + j, base + k);
  }
  return { positions, normals, indices };
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** One glTF material per distinct look; parts without one keep the viewer's default. */
function materialOf(part: ModelPart): Record<string, unknown> | null {
  if (!part.color && !part.material && part.opacity === undefined) return null;
  const { color, opacity, material } = partAppearance(part);
  const rgb = [1, 3, 5].map((i) => srgbToLinear(parseInt(color.slice(i, i + 2), 16) / 255));
  const roughness = { glass: 0.08, metal: 0.35, leather: 0.5, plastic: 0.45, stone: 0.4, fabric: 0.9, mesh: 0.8, wood: 0.65 }[material ?? 'wood'] ?? 0.6;
  return {
    name: `${material ?? 'colour'}-${color.slice(1)}-${Math.round(opacity * 100)}`,
    pbrMetallicRoughness: { baseColorFactor: [...rgb, opacity], metallicFactor: material === 'metal' ? 0.85 : 0, roughnessFactor: roughness },
    ...(opacity < 1 ? { alphaMode: 'BLEND', doubleSided: true } : {}),
  };
}

function pad4(bytes: Uint8Array, fill: number): Uint8Array {
  const padded = (bytes.length + 3) & ~3;
  if (padded === bytes.length) return bytes;
  const out = new Uint8Array(padded);
  out.set(bytes);
  out.fill(fill, bytes.length);
  return out;
}

export function buildFurnitureGlb(model: ParametricModel): Blob {
  const parts = model.components;
  let positionCursor = 0;
  let indexCursor = 0;
  const positionArrays: Float32Array[] = [];
  const normalArrays: Float32Array[] = [];
  const indexArrays: Uint32Array[] = [];
  parts.forEach((part) => {
    const box = partVertices(part);
    positionArrays.push(new Float32Array(box.positions));
    normalArrays.push(new Float32Array(box.normals));
    indexArrays.push(Uint32Array.from(box.indices));
    positionCursor += box.positions.length;
    indexCursor += box.indices.length;
  });

  // 32-bit indices keep every block 4-byte aligned and allow parts above 65 535 vertices.
  const bin = new Uint8Array(positionCursor * 4 * 2 + indexCursor * 4);
  const view = new DataView(bin.buffer);
  let offset = 0;
  const meshes = parts.map((part, meshIndex) => {
    const positions = positionArrays[meshIndex];
    const normals = normalArrays[meshIndex];
    const indices = indexArrays[meshIndex];
    const positionOffset = offset;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    positions.forEach((value, index) => {
      const axis = index % 3;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
      view.setFloat32(offset, value, true);
      offset += 4;
    });
    const normalOffset = offset;
    normals.forEach((value) => {
      view.setFloat32(offset, value, true);
      offset += 4;
    });
    const indexOffset = offset;
    indices.forEach((value) => {
      view.setUint32(offset, value, true);
      offset += 4;
    });
    return {
      part,
      translation: toGltf(part.position_mm),
      positionOffset,
      normalOffset,
      indexOffset,
      positionCount: positions.length / 3,
      indexCount: indices.length,
      min,
      max,
    };
  });

  const materials: Record<string, unknown>[] = [];
  const materialIndex = (part: ModelPart): number | undefined => {
    const material = materialOf(part);
    if (!material) return undefined;
    const found = materials.findIndex((m) => m.name === material.name);
    if (found >= 0) return found;
    materials.push(material);
    return materials.length - 1;
  };

  const bufferViews = meshes.flatMap((mesh) => [
    { buffer: 0, byteOffset: mesh.positionOffset, byteLength: mesh.positionCount * 12, target: 34962 },
    { buffer: 0, byteOffset: mesh.normalOffset, byteLength: mesh.positionCount * 12, target: 34962 },
    { buffer: 0, byteOffset: mesh.indexOffset, byteLength: mesh.indexCount * 4, target: 34963 },
  ]);
  const accessors: Array<Record<string, unknown>> = [];
  const gltfMeshes = meshes.map((mesh, index) => {
    const base = index * 3;
    accessors.push(
      { bufferView: base, componentType: 5126, count: mesh.positionCount, type: 'VEC3', min: mesh.min, max: mesh.max },
      { bufferView: base + 1, componentType: 5126, count: mesh.positionCount, type: 'VEC3' },
      { bufferView: base + 2, componentType: 5125, count: mesh.indexCount, type: 'SCALAR' },
    );
    const material = materialIndex(mesh.part);
    return {
      name: mesh.part.name,
      primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, mode: 4, ...(material !== undefined ? { material } : {}) }],
    };
  });
  const json = {
    asset: { version: '2.0', generator: 'fds-parametric' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, index) => index) }],
    nodes: meshes.map((mesh, index) => ({
      name: mesh.part.name,
      mesh: index,
      translation: mesh.translation,
    })),
    meshes: gltfMeshes,
    ...(materials.length ? { materials } : {}),
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = pad4(bin, 0);
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const glb = new Uint8Array(total);
  const header = new DataView(glb.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  header.setUint32(12, jsonBytes.length, true);
  header.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  header.setUint32(binStart, binBytes.length, true);
  header.setUint32(binStart + 4, 0x004e4942, true);
  glb.set(binBytes, binStart + 8);
  return new Blob([glb], { type: 'model/gltf-binary' });
}
