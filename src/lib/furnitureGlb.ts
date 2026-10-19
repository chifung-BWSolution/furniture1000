import type { ModelPart, ParametricModel } from '@/lib/furnitureParametric';

/** glTF is Y-up. Our parts are Z-up, so height becomes Y and depth becomes Z. */
function boxVertices(part: ModelPart): { positions: number[]; normals: number[]; indices: number[] } {
  const [w, d, h] = part.size_mm.map((n) => n / 1000);
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const faces: Array<{ n: [number, number, number]; corners: Array<[number, number, number]> }> = [
    { n: [0, 0, 1], corners: [[hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz], [hx, -hy, hz]] },
    { n: [0, 0, -1], corners: [[-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [-hx, -hy, -hz]] },
    { n: [1, 0, 0], corners: [[hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz], [hx, -hy, -hz]] },
    { n: [-1, 0, 0], corners: [[-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz], [-hx, -hy, hz]] },
    { n: [0, 1, 0], corners: [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, -1, 0], corners: [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, faceIndex) => {
    const base = faceIndex * 4;
    for (const [x, y, z] of face.corners) {
      positions.push(x, y, z);
      normals.push(...face.n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions, normals, indices };
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
  const indexArrays: Uint16Array[] = [];
  parts.forEach((part) => {
    const box = boxVertices(part);
    positionArrays.push(new Float32Array(box.positions));
    normalArrays.push(new Float32Array(box.normals));
    indexArrays.push(Uint16Array.from(box.indices.map((index) => index)));
    positionCursor += box.positions.length;
    indexCursor += box.indices.length;
  });

  const positionBytes = positionCursor * 4;
  const normalBytes = positionCursor * 4;
  const indexBytes = indexCursor * 2;
  const bin = new Uint8Array(positionBytes + normalBytes + indexBytes);
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
      view.setUint16(offset, value, true);
      offset += 2;
    });
    const [px, py, pz] = part.position_mm;
    return {
      part,
      translation: [px / 1000, pz / 1000, py / 1000],
      positionOffset,
      normalOffset,
      indexOffset,
      positionCount: positions.length / 3,
      indexCount: indices.length,
      min,
      max,
    };
  });

  const bufferViews = meshes.flatMap((mesh, index) => [
    { buffer: 0, byteOffset: mesh.positionOffset, byteLength: mesh.positionCount * 12, target: 34962 },
    { buffer: 0, byteOffset: mesh.normalOffset, byteLength: mesh.positionCount * 12, target: 34962 },
    { buffer: 0, byteOffset: mesh.indexOffset, byteLength: mesh.indexCount * 2, target: 34963 },
  ].map((viewItem, viewIndex) => ({ ...viewItem, name: `${index}-${viewIndex}` })));
  const accessors: Array<Record<string, unknown>> = [];
  const gltfMeshes = meshes.map((mesh, index) => {
    const base = index * 3;
    accessors.push(
      { bufferView: base, componentType: 5126, count: mesh.positionCount, type: 'VEC3', min: mesh.min, max: mesh.max },
      { bufferView: base + 1, componentType: 5126, count: mesh.positionCount, type: 'VEC3' },
      { bufferView: base + 2, componentType: 5123, count: mesh.indexCount, type: 'SCALAR' },
    );
    return {
      name: mesh.part.name,
      primitives: [{ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, mode: 4 }],
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
    accessors,
    bufferViews: bufferViews.map(({ name: _name, ...viewItem }) => viewItem),
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
