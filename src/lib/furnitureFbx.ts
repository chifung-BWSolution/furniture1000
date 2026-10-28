import { partAppearance, partPolygons, type ModelPart, type ParametricModel, type Vec3 } from '@/lib/furnitureParametric';

/**
 * FBX ASCII 7.4, Y-up, metres — the same frame as the GLB preview.
 * UnitScaleFactor 100 means one file unit is one metre (FBX counts from centimetres).
 */
const toYUp = ([x, y, z]: Vec3): Vec3 => [x / 1000, z / 1000, -y / 1000];

function num(n: number): string {
  const text = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function meshOf(part: ModelPart): { vertices: number[]; indices: number[] } {
  const [cx, cy, cz] = part.position_mm;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const face of partPolygons(part)) {
    const base = vertices.length / 3;
    for (const point of face.points) vertices.push(...toYUp([point[0] - cx, point[1] - cy, point[2] - cz]));
    for (const [i, j, k] of face.triangles) {
      // FBX marks the last vertex of a polygon by storing ~(index).
      indices.push(base + i, base + j, -(base + k + 1));
    }
  }
  return { vertices, indices };
}

const safeName = (name: string) => name.replace(/["\r\n:]/g, ' ').slice(0, 80);

export function buildFurnitureFbx(model: ParametricModel): Blob {
  const objects: string[] = [];
  const connections: string[] = [];
  const rootId = 1;
  objects.push(`Model: ${rootId}, "Model::${safeName(model.label)}", "Null" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
\t\t}
\t\tShading: Y
\t\tCulling: "CullingOff"
\t}`);
  const materialIds = new Map<string, number>();
  const materialOf = (part: ModelPart): number | null => {
    if (!part.color && !part.material && part.opacity === undefined) return null;
    const { color, opacity, material } = partAppearance(part);
    const key = `${material ?? 'colour'}-${color.slice(1)}-${Math.round(opacity * 100)}`;
    const known = materialIds.get(key);
    if (known) return known;
    const id = 500000 + materialIds.size;
    materialIds.set(key, id);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
    objects.push(`Material: ${id}, "Material::${key}", "" {
\t\tVersion: 102
\t\tShadingModel: "phong"
\t\tMultiLayer: 0
\t\tProperties70:  {
\t\t\tP: "DiffuseColor", "Color", "", "A",${num(r)},${num(g)},${num(b)}
\t\t\tP: "TransparencyFactor", "Number", "", "A",${num(1 - opacity)}
\t\t\tP: "Opacity", "double", "Number", "",${num(opacity)}
\t\t}
\t}`);
    return id;
  };
  model.components.forEach((part, index) => {
    const modelId = 1000 + index * 2;
    const geometryId = modelId + 1;
    const [px, py, pz] = toYUp(part.position_mm);
    const mesh = meshOf(part);
    const materialId = materialOf(part);
    objects.push(`Model: ${modelId}, "Model::${safeName(part.name)}", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",${num(px)},${num(py)},${num(pz)}
\t\t}
\t\tShading: Y
\t\tCulling: "CullingOff"
\t}`);
    objects.push(`Geometry: ${geometryId}, "Geometry::${safeName(part.name)}", "Mesh" {
\t\tVertices: ${mesh.vertices.map(num).join(',')}
\t\tPolygonVertexIndex: ${mesh.indices.join(',')}
\t\tGeometryVersion: 124${materialId ? `
\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "AllSame"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: 0
\t\t}
\t\tLayer: 0 {
\t\t\tVersion: 100
\t\t\tLayerElement:  {
\t\t\t\tType: "LayerElementMaterial"
\t\t\t\tTypedIndex: 0
\t\t\t}
\t\t}` : ''}
\t}`);
    connections.push(`\tC: "OO",${geometryId},${modelId}`);
    if (materialId) connections.push(`\tC: "OO",${materialId},${modelId}`);
    connections.push(`\tC: "OO",${modelId},${rootId}`);
  });

  const text = `; FBX 7.4.0 project file
; FDS parametric furniture. Units are metres. This is a generated mesh, not a native SketchUp file.
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreator: "FDS"
}
GlobalSettings:  {
\tVersion: 1000
\tProperties70:  {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "UpAxisSign", "int", "Integer", "",1
\t\tP: "FrontAxis", "int", "Integer", "",2
\t\tP: "FrontAxisSign", "int", "Integer", "",1
\t\tP: "CoordAxis", "int", "Integer", "",0
\t\tP: "CoordAxisSign", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",100
\t\tP: "OriginalUnitScaleFactor", "double", "Number", "",100
\t}
}
Definitions:  {
\tVersion: 100
\tCount: ${materialIds.size ? 3 : 2}
\tObjectType: "Model" { Count: ${model.components.length + 1} }
\tObjectType: "Geometry" { Count: ${model.components.length} }${materialIds.size ? `
\tObjectType: "Material" { Count: ${materialIds.size} }` : ''}
}
Objects:  {
\t${objects.join('\n\t')}
}
Connections:  {
${connections.join('\n')}
}
`;
  return new Blob([text], { type: 'application/octet-stream' });
}
