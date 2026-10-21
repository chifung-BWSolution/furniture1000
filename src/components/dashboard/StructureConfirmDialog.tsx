import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Box,
  FileText,
  Info,
  Loader2,
  MousePointer2,
  Pencil,
  RectangleHorizontal,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Table2,
  X,
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { DimensionEstimate } from '@/lib/dimensionConflicts';
import {
  FURNITURE_GROUPS,
  FURNITURE_KINDS,
  STYLE_FIELDS,
  STYLE_LIMITS,
  faceNormal,
  partFaces,
  triangulateFace,
  type CustomPartSpec,
  type FurnitureKind,
  type ModelStyle,
  type ParametricModel,
  type SizeAxis,
  type StyleField,
} from '@/lib/furnitureParametric';

const TOP_OPTIONS: [ModelStyle['top'], string][] = [
  ['rect', '矩形'],
  ['L', 'L 形'],
  ['boat', '船形（兩端收窄）'],
  ['round', '圓形'],
];
const LEG_OPTIONS: [ModelStyle['legs'], string][] = [
  ['four', '四腳'],
  ['panel', '折板腳'],
  ['pedestal', '中柱'],
];
const CHAIR_BASE_OPTIONS: [ModelStyle['chair_base'], string][] = [
  ['star', '五星腳'],
  ['four', '四腳'],
  ['sled', '弓字架'],
];
const TOGGLE_LABELS: Partial<Record<StyleField, string>> = {
  cable_tray: '中間走線槽',
  screen: '屏風',
  arms: '扶手',
  frame: '金屬框架（無側板）',
};
const TOGGLE_HINTS: Partial<Record<StyleField, string>> = {
  cable_tray: '桌面設有中央走線槽，方便線路收納與佈線。',
  screen: '工作位背後加屏風。圖片及型號即使展示多人組合，預設只生成一張；需要整組時可自行調整工作位。',
  arms: '兩側加扶手。',
  frame: '改成金屬框架，不加側板。',
};
const COUNT_LABELS: Partial<Record<StyleField, string>> = {
  doors: '門',
  drawers: '抽屜',
  shelves: '層板',
  seats: '座位',
};

function countLabel(kind: FurnitureKind | null, field: StyleField): string {
  if (kind === 'desk' && field === 'seats') return '工作位';
  if (kind === 'desk' && field === 'drawers') return '活動櫃抽屜';
  return COUNT_LABELS[field] ?? field;
}
const SHAPE_LABELS: Record<CustomPartSpec['shape'], string> = { box: '方塊', cylinder: '圓柱', profile: '輪廓' };

export type StructureDraft = {
  target: 'su' | '3d';
  kind: FurnitureKind | null;
  width: string;
  depth: string;
  height: string;
  estimated: SizeAxis[];
  style: Partial<ModelStyle>;
  styleSource: 'image' | 'name';
  notes: string | null;
  parts: CustomPartSpec[];
  /** T-804: cross-view or catalogue vs image mismatches; cleared when user edits a size field. */
  dimensionConflicts?: string[];
  dimensionEstimates?: import('@/lib/dimensionConflicts').DimensionEstimate[];
};

/** Y-up metres, same mapping as the GLB writer: (x, y, z) → (x, z, −y). */
function toPreview([x, y, z]: [number, number, number]): [number, number, number] {
  return [x / 1000, z / 1000, -y / 1000];
}

function buildPreviewGeometry(model: ParametricModel): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const part of model.components) {
    const faces = part.faces_mm?.length ? part.faces_mm : partFaces(part);
    for (const face of faces) {
      if (face.length < 3) continue;
      const normal = toPreview(faceNormal(face).map((n) => n * 1000) as [number, number, number]);
      for (const [i, j, k] of triangulateFace(face)) {
        for (const index of [i, j, k]) {
          const point = face[index];
          if (!point) continue;
          positions.push(...toPreview(point));
          normals.push(...normal);
        }
      }
    }
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) {
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function StudioPreview({ model }: { model: ParametricModel | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ reset: () => void; show: (next: ParametricModel | null) => void } | null>(null);
  const [failed, setFailed] = useState(false);
  const [empty, setEmpty] = useState(model == null);
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf4f6fb, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 80);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    scene.add(new THREE.HemisphereLight(0xf7f8fc, 0xd5d8e2, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    scene.add(key);
    scene.add(key.target);
    const fill = new THREE.DirectionalLight(0xeef1f8, 0.55);
    scene.add(fill);

    const material = new THREE.MeshStandardMaterial({
      color: 0xd5dae3,
      roughness: 0.62,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x8b93a1, transparent: true, opacity: 0.45 });
    const edges = new THREE.LineSegments(new THREE.BufferGeometry(), edgeMaterial);
    scene.add(edges);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.001;
    ground.receiveShadow = true;
    scene.add(ground);

    let userMoved = false;
    let disposed = false;
    let frame = 0;
    const home = new THREE.Vector3(1.4, 0.9, -1.8);
    const target = new THREE.Vector3(0, 0.25, 0);

    const fit = () => {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      const size = new THREE.Vector3(0.8, 0.5, 0.8);
      const center = new THREE.Vector3(0, 0.25, 0);
      if (box && !box.isEmpty()) {
        box.getSize(size);
        box.getCenter(center);
      }
      const radius = Math.max(size.x, size.y, size.z, 0.2) * 0.62;
      const fov = (camera.fov * Math.PI) / 180;
      const distance = (radius / Math.sin(fov / 2)) * 1.28;
      // Product front is +Y in model space, hence -Z after the GLB coordinate mapping.
      const direction = new THREE.Vector3(0.72, 0.48, -1).normalize();
      home.copy(center).addScaledVector(direction, distance);
      target.copy(center);
      camera.near = Math.max(distance / 200, 0.01);
      camera.far = distance * 12;
      camera.position.copy(home);
      camera.updateProjectionMatrix();
      controls.target.copy(target);
      controls.minDistance = distance * 0.35;
      controls.maxDistance = distance * 4;
      controls.update();
      key.position.set(center.x + radius * 1.8, center.y + radius * 3.2, center.z + radius * 1.4);
      key.target.position.copy(center);
      fill.position.set(center.x - radius * 2, center.y + radius, center.z - radius);
      const shadow = Math.max(size.x, size.z, radius) * 2.2;
      key.shadow.camera.left = -shadow;
      key.shadow.camera.right = shadow;
      key.shadow.camera.top = shadow;
      key.shadow.camera.bottom = -shadow;
      key.shadow.camera.near = 0.05;
      key.shadow.camera.far = radius * 14;
      key.shadow.camera.updateProjectionMatrix();
      ground.scale.setScalar(Math.max(size.x, size.z) * 1.8);
    };

    const show = (next: ParametricModel | null) => {
      const geometry = next ? buildPreviewGeometry(next) : null;
      mesh.geometry.dispose();
      edges.geometry.dispose();
      if (!geometry) {
        mesh.geometry = new THREE.BufferGeometry();
        edges.geometry = new THREE.BufferGeometry();
        setEmpty(true);
        return;
      }
      mesh.geometry = geometry;
      edges.geometry = new THREE.EdgesGeometry(geometry, 18);
      setEmpty(false);
      setFailed(false);
      if (!userMoved) fit();
    };

    const reset = () => {
      userMoved = false;
      if (mesh.geometry.boundingSphere) fit();
    };

    apiRef.current = { reset, show };
    show(modelRef.current);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const onPointerDown = (event: PointerEvent) => {
      controls.mouseButtons.LEFT = event.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    };
    const onControlStart = () => {
      userMoved = true;
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      setFailed(true);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    controls.addEventListener('start', onControlStart);

    const tick = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      mesh.geometry.dispose();
      edges.geometry.dispose();
      material.dispose();
      edgeMaterial.dispose();
      (ground.material as THREE.Material).dispose();
      ground.geometry.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.show(model);
  }, [model]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={hostRef}
        className="h-full min-h-[220px] w-full cursor-grab overflow-hidden rounded-xl bg-[#f4f6fb] active:cursor-grabbing [&_canvas]:h-full [&_canvas]:w-full"
        aria-label="結構預覽，拖曳旋轉，右鍵或 Shift 拖曳平移"
        role="img"
      />
      <button
        type="button"
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg border border-slate-200/80 bg-white/90 text-slate-500 shadow-sm hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4dff]/40"
        title="重設視角"
        aria-label="重設視角"
        onClick={() => apiRef.current?.reset()}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      {(empty || failed) && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center text-[13px] leading-6 text-slate-500">
          {failed ? '這部裝置開不了 3D 預覽，仍可依左側設定生成。' : '選好類型並填上闊、深、高後，這裡會顯示結構。'}
        </p>
      )}
    </div>
  );
}

function SectionHeading({ index, icon: Icon, title }: { index: string; icon: LucideIcon; title: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="w-5 text-[11px] font-semibold tabular-nums tracking-wide text-slate-400">{index}</span>
      <Icon className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
      <h3 className="text-[13px] font-semibold text-slate-800">{title}</h3>
    </div>
  );
}

function ChoiceChip({ selected, children, onClick }: { selected: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'h-8 whitespace-nowrap rounded-lg border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4dff]/40',
        selected
          ? 'border-[#5b4dff] bg-[#5b4dff] text-white shadow-[0_1px_2px_rgba(91,77,255,0.28)]'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

export function StructureConfirmForm({
  draft,
  shownStyle,
  preview,
  generating,
  partsBusy,
  onChange,
  onGenerate,
  onCancel,
  onLoadParts,
  onResizePart,
  onRemovePart,
  fittedParts,
}: {
  draft: StructureDraft;
  shownStyle: ModelStyle | null;
  preview: ParametricModel | null;
  generating: boolean;
  partsBusy: boolean;
  onChange: (patch: Partial<StructureDraft>, editedAxis?: SizeAxis) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onLoadParts: () => void;
  onResizePart: (index: number, axis: 0 | 1 | 2, value: string) => void;
  onRemovePart: (index: number) => void;
  fittedParts: CustomPartSpec[];
}) {
  const kind = draft.kind;
  const fields = kind ? STYLE_FIELDS[kind] : [];
  const showTop = Boolean(shownStyle && fields.includes('top'));
  const showLegs = Boolean(shownStyle && fields.includes('legs'));
  const showChair = Boolean(shownStyle && fields.includes('chair_base'));
  const countFields = fields.filter((field) => COUNT_LABELS[field]);
  const toggleFields = fields.filter((field) => TOGGLE_LABELS[field]);
  const showExtra = Boolean(shownStyle && (countFields.length > 0 || toggleFields.length > 0));
  const showParts = kind === 'custom';
  const showNotes = kind != null;
  const structureWord = showTop ? '桌面結構' : '結構';
  const outputName = draft.target === 'su' ? 'SU' : '3D';
  const hasDimensionConflicts = (draft.dimensionConflicts?.length ?? 0) > 0;

  let step = 0;
  const stepNo = () => String(++step).padStart(2, '0');
  const kindNo = stepNo();
  const sizeNo = stepNo();
  const topNo = showTop ? stepNo() : '';
  const legsNo = showLegs ? stepNo() : '';
  const chairNo = showChair ? stepNo() : '';
  const extraNo = showExtra ? stepNo() : '';
  const partsNo = showParts ? stepNo() : '';
  const notesNo = showNotes ? stepNo() : '';

  return (
    <div className="flex h-full min-h-0 flex-col text-slate-900 selection:bg-[#5b4dff]/15">
      <header className="flex items-start gap-3.5 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Box className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <DialogTitle className="text-lg font-bold leading-snug tracking-tight text-slate-900">
            生成前請確認結構（{outputName}）
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-relaxed text-slate-500">
            請確認產品類型、尺寸與{structureWord}，系統將據此生成 {outputName} 模型。
          </DialogDescription>
        </div>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4dff]/40 disabled:opacity-40"
          aria-label="關閉"
          disabled={generating || partsBusy}
          onClick={onCancel}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {hasDimensionConflicts && (
        <div className="mx-5 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">多視圖或產品資料尺寸不一致，請先核對並手動修正後再生成：</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
            {draft.dimensionConflicts!.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 lg:overflow-hidden">
        <div className="grid gap-3 lg:h-full lg:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)] lg:overflow-hidden">
          <div className="rounded-2xl bg-[#f5f6fa] p-4 lg:overflow-y-auto lg:[scrollbar-color:#c9ceda_transparent] lg:[scrollbar-width:thin]">
            <section>
              <SectionHeading index={kindNo} icon={Box} title="產品分類" />
              <div className="space-y-2">
                {FURNITURE_GROUPS.map((group) => (
                  <div key={group.label} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-x-2">
                    <span className="pt-1.5 text-xs text-slate-500">{group.label}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {group.kinds.map((id) => (
                        <ChoiceChip key={id} selected={kind === id} onClick={() => onChange({ kind: id })}>
                          {FURNITURE_KINDS.find((item) => item.id === id)?.label ?? id}
                        </ChoiceChip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-4">
              <SectionHeading index={sizeNo} icon={Pencil} title="尺寸設定" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {(
                  [
                    ['width', '闊'],
                    ['depth', '深'],
                    ['height', '高'],
                  ] as [SizeAxis, string][]
                ).map(([axis, label]) => (
                  <label key={axis} className="flex items-center gap-1.5 text-[13px] text-slate-600">
                    {label}
                    <Input
                      value={draft[axis]}
                      inputMode="numeric"
                      aria-label={label}
                      className="h-8 w-[4.75rem] rounded-lg border-slate-200 bg-white px-2 text-center text-[13px] tabular-nums text-slate-900 shadow-none caret-[#5b4dff] focus-visible:ring-[#5b4dff]/40"
                      onChange={(event) => onChange({ [axis]: event.target.value.replace(/[^\d.]/g, '') }, axis)}
                    />
                    <span className="text-slate-500">mm</span>
                    {draft.estimated.includes(axis) && <span className="text-[11px] font-medium text-amber-700">估算</span>}
                  </label>
                ))}
              </div>
            </section>

            {showTop && shownStyle && (
              <section className="mt-4">
                <SectionHeading index={topNo} icon={RectangleHorizontal} title="桌面形狀" />
                <div className="flex flex-wrap gap-1.5">
                  {TOP_OPTIONS.map(([id, label]) => (
                    <ChoiceChip
                      key={id}
                      selected={shownStyle.top === id}
                      onClick={() => onChange({ style: { top: id } })}
                    >
                      {label}
                    </ChoiceChip>
                  ))}
                </div>
                {kind === 'desk' && shownStyle.top === 'L' && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-xs text-slate-600">側台方向（坐在使用位置面向桌面）</p>
                    <div className="flex gap-1.5">
                      {(['left', 'right'] as const).map((side) => (
                        <ChoiceChip key={side} selected={(shownStyle.return_side ?? 'right') === side} onClick={() => onChange({ style: { return_side: side } })}>
                          {side === 'left' ? '左側' : '右側'}
                        </ChoiceChip>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {showLegs && shownStyle && (
              <section className="mt-4">
                <SectionHeading index={legsNo} icon={Table2} title="桌腳 / 底座" />
                <div className="flex flex-wrap gap-1.5">
                  {LEG_OPTIONS.map(([id, label]) => (
                    <ChoiceChip
                      key={id}
                      selected={shownStyle.legs === id}
                      onClick={() => onChange({ style: { legs: id } })}
                    >
                      {label}
                    </ChoiceChip>
                  ))}
                </div>
              </section>
            )}

            {showChair && shownStyle && (
              <section className="mt-4">
                <SectionHeading index={chairNo} icon={Table2} title="椅腳" />
                <div className="flex flex-wrap gap-1.5">
                  {CHAIR_BASE_OPTIONS.map(([id, label]) => (
                    <ChoiceChip
                      key={id}
                      selected={shownStyle.chair_base === id}
                      onClick={() => onChange({ style: { chair_base: id } })}
                    >
                      {label}
                    </ChoiceChip>
                  ))}
                </div>
              </section>
            )}

            {showExtra && shownStyle && (
              <section className="mt-4">
                <SectionHeading index={extraNo} icon={SlidersHorizontal} title="其他設定" />
                <div className="space-y-3">
                  {countFields.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {countFields.map((field) => {
                        const [min, max] = STYLE_LIMITS[field as keyof typeof STYLE_LIMITS];
                        const offset = kind === 'shelf' && field === 'shelves' ? 2 : 0;
                        return (
                          <label key={field} className="flex items-center gap-1.5 text-[13px] text-slate-700">
                            {offset ? '層數' : countLabel(kind, field)}
                            <Input
                              type="number"
                              min={min + offset}
                              max={max + offset}
                              value={String(Number(shownStyle[field]) + offset)}
                              aria-label={offset ? '層數' : countLabel(kind, field)}
                              className="h-8 w-16 rounded-lg border-slate-200 bg-white px-2 text-center text-[13px] tabular-nums shadow-none caret-[#5b4dff] focus-visible:ring-[#5b4dff]/40"
                              onChange={(event) => {
                                const n = Number(event.target.value) - offset;
                                if (Number.isFinite(n)) {
                                  onChange({ style: { [field]: Math.min(max, Math.max(min, Math.round(n))) } });
                                }
                              }}
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {toggleFields.map((field) => (
                    <label key={field} className="flex items-start gap-2.5">
                      <Checkbox
                        checked={shownStyle[field] === true}
                        className="mt-0.5 border-slate-300 shadow-none data-[state=checked]:border-[#5b4dff] data-[state=checked]:bg-[#5b4dff]"
                        onCheckedChange={(value) => onChange({ style: { [field]: value === true } })}
                      />
                      <span>
                        <span className="block text-[13px] font-medium text-slate-800">{TOGGLE_LABELS[field]}</span>
                        {TOGGLE_HINTS[field] && <span className="mt-0.5 block text-xs leading-5 text-slate-500">{TOGGLE_HINTS[field]}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {showParts && (
              <section className="mt-4">
                <SectionHeading index={partsNo} icon={Box} title="部件清單" />
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs leading-5 text-slate-500">
                      沒有對應模板，按產品圖拆成 {draft.parts.length} 個部件。可刪掉或改尺寸再生成。
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
                      disabled={partsBusy || generating}
                      onClick={onLoadParts}
                    >
                      {partsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {draft.parts.length > 0 ? '重新辨認部件' : 'AI 拆部件'}
                    </Button>
                  </div>
                  {fittedParts.length > 0 && (
                    <ul className="space-y-1">
                      {fittedParts.map((part, index) => (
                        <li key={`${index}-${part.name}`} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white px-2 py-1.5">
                          <span className="w-24 truncate text-[13px] text-slate-800" title={part.name}>
                            {part.name}
                          </span>
                          <span className="w-8 text-xs text-slate-400">{SHAPE_LABELS[part.shape]}</span>
                          {([0, 1, 2] as const).map((axis) => (
                            <Input
                              key={`${axis}-${part.size_mm[axis]}`}
                              defaultValue={String(part.size_mm[axis])}
                              inputMode="numeric"
                              aria-label={`${part.name} ${['闊', '深', '高'][axis]}`}
                              className="h-7 w-14 rounded-md border-slate-200 bg-white px-1 text-center text-xs tabular-nums shadow-none caret-[#5b4dff] focus-visible:ring-[#5b4dff]/40"
                              onBlur={(event) => onResizePart(index, axis, event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur();
                              }}
                            />
                          ))}
                          <button
                            type="button"
                            className="ml-auto text-xs text-slate-400 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4dff]/40"
                            onClick={() => onRemovePart(index)}
                          >
                            刪除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {showNotes && (
              <section className="mt-4">
                <SectionHeading index={notesNo} icon={FileText} title={draft.styleSource === 'image' ? '結構描述（AI 辨識）' : '結構描述'} />
                {draft.styleSource === 'name' && (
                  <p className="mb-1.5 text-xs leading-5 text-slate-500">結構按產品名稱判斷（未看產品圖）。</p>
                )}
                <p className="flex gap-2 text-[13px] leading-6 text-slate-600">
                  <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-[#5b4dff]" />
                  <span>{draft.notes ?? (draft.styleSource === 'image' ? '已依產品圖判斷結構，可在上方改選。' : '可在上方改選類型、尺寸與結構。')}</span>
                </p>
              </section>
            )}
          </div>

          <aside className="flex min-h-[280px] flex-col rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_12px_32px_-20px_rgba(15,23,42,0.45)] lg:h-full lg:min-h-0">
            <div className="mb-3 flex items-start gap-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#efedff] text-[#5b4dff]">
                <Box className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-slate-900">即時結構預覽</h3>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">根據左側設定即時生成 3D 結構預覽，供確認參考。</p>
              </div>
            </div>
            <StudioPreview model={preview} />
            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-500">
              <MousePointer2 className="h-3.5 w-3.5" />
              拖曳旋轉，右鍵或 Shift 拖曳平移
            </p>
          </aside>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3.5">
        <p className="flex min-w-0 items-start gap-2 text-xs leading-5 text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>
            {draft.target === 'su'
              ? '生成的 SU 模型可在「下載模型」中取得，並支援後續 3D 編輯。'
              : '生成的 GLB 與 FBX 可在「下載模型」中取得。'}
          </span>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-lg border-slate-200 bg-white px-4 text-slate-700 shadow-none hover:bg-slate-50"
            disabled={generating}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            className="h-10 rounded-lg bg-[#5b4dff] px-4 text-white shadow-none hover:bg-[#4a3cf0] focus-visible:ring-[#5b4dff]/40"
            disabled={generating || partsBusy || hasDimensionConflicts || (kind === 'custom' && draft.parts.length === 0)}
            onClick={onGenerate}
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            確認生成 {outputName}
          </Button>
        </div>
      </footer>
    </div>
  );
}
