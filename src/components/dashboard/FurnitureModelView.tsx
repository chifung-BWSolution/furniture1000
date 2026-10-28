import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { invokeEdgeFunctionDirect } from '@/lib/invokeEdgeFunction';
import { buildFurnitureGlb } from '@/lib/furnitureGlb';
import { downloadModel, fetchSkpStatus, requestSkp, type SkpStatus } from '@/lib/productModels';
import { useSkpRequirements } from '@/components/dashboard/SkpRequirementsDialog';
import { FurnitureProductScopeDialog, type ProductCountDetection, type ProductScopeChoice } from '@/components/dashboard/FurnitureProductScopeDialog';
import { hasStructureEvidence, selectFurnitureGeometry, validateFurnitureStructure, type StructureEvidence } from '@/lib/furnitureStructure';
import {
  DEFAULT_TABLE_STYLE,
  FURNITURE_KINDS,
  buildParametric,
  faceNormal,
  partFaces,
  sanitizeCustomParts,
  resolveStyle,
  fitCustomParts,
  customPartsSize,
  type CustomPartSpec,
  type FurnitureKind,
  type ParametricModel,
  type SizeAxis,
  type TableStyle,
  type Vec3,
} from '@/lib/furnitureParametric';

interface SavedModel {
  id: string;
  kind: FurnitureKind;
  estimated: boolean;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  created_at: string;
  skp: SkpStatus;
}

const SKP_POLL_MS = 5000;

const SKP_READY_NOTICE = 'SKP 已生成，可以下載';

function notifySkpReady(skp: SkpStatus, seen: { current: string | null }) {
  if (skp.status !== 'ready' || seen.current === skp.storage_path) return;
  seen.current = skp.storage_path;
  toast.success(SKP_READY_NOTICE);
}

function skpStatusText(skp: SkpStatus): string {
  switch (skp.status) {
    case 'ready':
      return SKP_READY_NOTICE;
    case 'queued':
      return skp.attempts > 0 ? `排隊重試中（第 ${skp.attempts} 次失敗：${skp.error ?? '未知錯誤'}）` : 'SKP 排隊中，等 Windows SKP Worker 處理';
    case 'running':
      return 'SKP 生成中…';
    case 'failed':
      return `SKP 生成失敗：${skp.error ?? '未知錯誤'}`;
    case 'cancelled':
      return 'SKP 任務已取消';
    default:
      return '';
  }
}

async function fileToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法讀取圖片');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('圖片壓縮失敗'))), 'image/jpeg', 0.82);
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Oblique view from the front right, scaled to fit; faces drawn back to front. */
function drawPreview(canvas: HTMLCanvasElement, model: ParametricModel) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f4f4f5';
  ctx.fillRect(0, 0, width, height);
  const raw = (x: number, y: number, z: number) => ({ x: x + y * 0.45, y: -(z + y * 0.3) });
  const faces = model.components.flatMap((part) => (part.faces_mm?.length ? part.faces_mm : partFaces(part)));
  const projected = faces.flatMap((face) => face.map(([x, y, z]) => raw(x, y, z)));
  const minX = Math.min(...projected.map((p) => p.x));
  const maxX = Math.max(...projected.map((p) => p.x));
  const minY = Math.min(...projected.map((p) => p.y));
  const maxY = Math.max(...projected.map((p) => p.y));
  const scale = Math.min((width * 0.88) / (maxX - minX || 1), (height * 0.85) / (maxY - minY || 1));
  const offX = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const offY = (height - (maxY - minY) * scale) / 2 - minY * scale;
  const depth = (face: Vec3[]) => face.reduce((sum, [, y, z]) => sum + y - z * 0.2, 0) / face.length;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#44403c';
  for (const face of [...faces].sort((a, b) => depth(b) - depth(a))) {
    const shade = 0.25 + 0.2 * Math.abs(faceNormal(face)[2]);
    ctx.beginPath();
    face.forEach(([x, y, z], index) => {
      const p = raw(x, y, z);
      const sx = offX + p.x * scale;
      const sy = offY + p.y * scale;
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fillStyle = `rgba(120, 113, 108, ${shade})`;
    ctx.fill();
    ctx.stroke();
  }
}

export function FurnitureModelView({ focus }: { focus: 'su' | '3d' }) {
  const skpRequirements = useSkpRequirements();
  const [kind, setKind] = useState<FurnitureKind>('desk');
  const [width, setWidth] = useState('');
  const [depth, setDepth] = useState('');
  const [height, setHeight] = useState('');
  /** Axes whose current value came from the AI estimate, not from a measurement. */
  const [aiEstimated, setAiEstimated] = useState<SizeAxis[]>([]);
  const [model, setModel] = useState<ParametricModel | null>(null);
  const [style, setStyle] = useState<TableStyle>(DEFAULT_TABLE_STYLE);
  const [reading, setReading] = useState(false);
  const [hasReferences, setHasReferences] = useState(false);
  const [scopeRequest, setScopeRequest] = useState<{ files: File[]; detection: ProductCountDetection } | null>(null);
  const [structure, setStructure] = useState<StructureEvidence>();
  const [referenceParts, setReferenceParts] = useState<CustomPartSpec[]>([]);
  const [saved, setSaved] = useState<SavedModel[]>([]);
  /** Row id of the current model once saved; a new generate clears it. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [skp, setSkp] = useState<SkpStatus | null>(null);
  const skpReadyNoticeRef = useRef<string | null>(null);
  const [skpBusy, setSkpBusy] = useState(false);
  const [listKey, setListKey] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const num = (raw: string) => {
    const n = Number(raw.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  useEffect(() => {
    supabase.rpc('fds_list_furniture_models').then(({ data }) => {
      if (Array.isArray(data)) setSaved(data as SavedModel[]);
    });
  }, [listKey]);

  const skpPending = skp?.status === 'queued' || skp?.status === 'running';
  useEffect(() => {
    if (!savedId || !skpPending) return;
    const timer = window.setInterval(() => {
      fetchSkpStatus(savedId)
        .then((next) => {
          setSkp(next);
          if (next.status === 'ready') notifySkpReady(next, skpReadyNoticeRef);
          if (next.status !== 'queued' && next.status !== 'running') setListKey((n) => n + 1);
        })
        .catch(() => undefined);
    }, SKP_POLL_MS);
    return () => window.clearInterval(timer);
  }, [savedId, skpPending]);

  useEffect(() => {
    if (model && canvasRef.current) drawPreview(canvasRef.current, model);
  }, [model]);

  const generate = (next?: {
    kind?: FurnitureKind;
    width?: number | null;
    depth?: number | null;
    height?: number | null;
    estimatedAxes?: SizeAxis[];
    style?: Partial<TableStyle>;
    parts?: CustomPartSpec[];
    structure?: StructureEvidence;
  }) => {
    if (!next && !hasReferences) {
      toast.error('請先選擇最少 2 張不同角度圖片完成辨認');
      return;
    }
    const rawParts = next?.parts ?? model?.custom_parts ?? [];
    const partSize = customPartsSize(rawParts);
    const w = (next?.width === undefined ? num(width) : next.width) ?? partSize?.[0];
    const d = (next?.depth === undefined ? num(depth) : next.depth) ?? partSize?.[1];
    const h = (next?.height === undefined ? num(height) : next.height) ?? partSize?.[2];
    const built = buildParametric({
      kind: next?.kind ?? kind,
      width_mm: w,
      depth_mm: d,
      height_mm: h,
      estimated_axes: next?.estimatedAxes ?? aiEstimated,
      style: next?.style ?? style,
      parts: rawParts.length && w && d && h ? fitCustomParts(rawParts, w, d, h) : rawParts,
    });
    const evidence = next?.structure ?? structure;
    if (!hasStructureEvidence(evidence)) throw new Error('缺少結構辨認資料，請重新辨認圖片');
    const errors = validateFurnitureStructure(built, evidence, next?.parts ?? referenceParts);
    if (errors.length) throw new Error(errors.join('；'));
    built.structure_evidence = evidence;
    built.structure_parts = next?.parts ?? referenceParts;
    setModel(built);
    setSavedId(null);
    setSkp(null);
  };

  const readImage = async (files: File[], choice?: ProductScopeChoice) => {
    if (files.length < 2 || files.length > 6) {
      toast.error('請選擇 2 至 6 張同款家具的不同角度圖片');
      return;
    }
    setReading(true);
    try {
      const images = await Promise.all(files.map(async file => ({ image_base64: await fileToJpeg(file), mime_type: 'image/jpeg' })));
      const body = { images, product_scope: choice?.scope, product_count: choice?.count };
      if (new Set(images.map(image => image.image_base64)).size < 2) throw new Error('最少需要 2 張不同圖片，重複圖片不計算');
      type AnalysisResponse = {
        supported?: boolean;
        kind?: FurnitureKind;
        width_mm?: number | null;
        depth_mm?: number | null;
        height_mm?: number | null;
        /** The AI only guesses: every number it returns stays an estimate. */
        estimated?: boolean;
        reason?: string;
        error?: string;
        style?: Partial<TableStyle> | null;
        parts?: unknown;
        structure?: StructureEvidence;
        requires_product_scope_confirmation?: boolean;
        detection?: ProductCountDetection;
      };
      let result: Awaited<ReturnType<typeof invokeEdgeFunctionDirect<AnalysisResponse>>> | null = null;
      let legacy: typeof result = null;
      for (const slug of ['supabase-functions-generate-furniture-model', 'generate-furniture-model'] as const) {
        const next = await invokeEdgeFunctionDirect<AnalysisResponse>(slug, body);
        if (next.status === 404) continue;
        if (next.error || !next.data) {
          result = next;
          break;
        }
        if ((next.data.requires_product_scope_confirmation && next.data.detection) || next.data.supported === false) {
          result = next;
          break;
        }
        if (hasStructureEvidence(next.data.structure)) {
          result = next;
          break;
        }
        legacy = next;
      }
      result = result ?? legacy;
      if (!result || result.error || !result.data) throw new Error(result?.error?.message ?? '無法辨認圖片');
      if (result.data.requires_product_scope_confirmation && result.data.detection) {
        setScopeRequest({ files, detection: result.data.detection });
        return;
      }
      if (result.data.supported === false || !result.data.kind || result.data.kind === ('unsupported' as FurnitureKind)) {
        toast.error(result.data.reason || '這件家具不屬於現有模板類型');
        return;
      }
      setKind(result.data.kind);
      const typedW = choice?.scope === 'arrangement' ? null : num(width);
      const typedD = choice?.scope === 'arrangement' ? null : num(depth);
      const typedH = choice?.scope === 'arrangement' ? null : num(height);
      const guessed = result.data.estimated !== false;
      const estimatedAxes: SizeAxis[] = [];
      if (typedW == null && result.data.width_mm) {
        setWidth(String(Math.round(result.data.width_mm)));
        if (guessed) estimatedAxes.push('width');
      }
      if (typedD == null && result.data.depth_mm) {
        setDepth(String(Math.round(result.data.depth_mm)));
        if (guessed) estimatedAxes.push('depth');
      }
      if (typedH == null && result.data.height_mm) {
        setHeight(String(Math.round(result.data.height_mm)));
        if (guessed) estimatedAxes.push('height');
      }
      const imageStyle = resolveStyle(result.data.kind,
        typedW ?? result.data.width_mm ?? 500,
        typedD ?? result.data.depth_mm ?? 500,
        typedH ?? result.data.height_mm ?? 850,
        result.data.style);
      const imageParts = sanitizeCustomParts(result.data.parts);
      const partSize = customPartsSize(imageParts)!;
      if (choice?.scope === 'arrangement') {
        setWidth(String(partSize[0])); setDepth(String(partSize[1])); setHeight(String(partSize[2]));
        estimatedAxes.splice(0, estimatedAxes.length, 'width', 'depth', 'height');
      }
      setAiEstimated([...estimatedAxes]);
      const selection = selectFurnitureGeometry({ kind: result.data.kind,
        width_mm: typedW ?? result.data.width_mm ?? partSize[0],
        depth_mm: typedD ?? result.data.depth_mm ?? partSize[1],
        height_mm: typedH ?? result.data.height_mm ?? partSize[2], style: imageStyle, parts: imageParts });
      setKind(selection.kind);
      setStyle({ ...DEFAULT_TABLE_STYLE, ...imageStyle });
      generate({
        kind: selection.kind,
        width: typedW ?? result.data.width_mm ?? partSize[0],
        depth: typedD ?? result.data.depth_mm ?? partSize[1],
        height: typedH ?? result.data.height_mm ?? partSize[2],
        estimatedAxes,
        style: imageStyle,
        parts: imageParts,
        structure: hasStructureEvidence(result.data.structure) ? result.data.structure : undefined,
      });
      setStructure(hasStructureEvidence(result.data.structure) ? result.data.structure : undefined);
      setReferenceParts(imageParts);
      setHasReferences(true);
    } catch (err) {
      toast.error('辨認圖片失敗', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setReading(false);
    }
  };

  const download = () => {
    if (!model) return;
    const blob = buildFurnitureGlb(model);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${model.kind}.glb`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const save = async (): Promise<string | null> => {
    if (!model) return null;
    if (savedId) return savedId;
    const { data, error } = await supabase.rpc('fds_save_furniture_model', {
      p_kind: model.kind,
      p_parametric: model,
      p_estimated: model.estimated_axes.length > 0,
      p_product_id: null,
    });
    if (error || typeof data !== 'string') {
      toast.error('儲存失敗', { description: error?.message ?? '沒有回傳編號' });
      return null;
    }
    setSavedId(data);
    setListKey((n) => n + 1);
    return data;
  };

  const generateSkp = async () => {
    setSkpBusy(true);
    try {
      if (!await skpRequirements.check()) return;
      const id = await save();
      if (!id) return;
      skpReadyNoticeRef.current = null;
      const status = await requestSkp(id);
      setSkp(status);
      notifySkpReady(status, skpReadyNoticeRef);
      setListKey((n) => n + 1);
    } catch (err) {
      toast.error('無法排 SKP 任務', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSkpBusy(false);
    }
  };

  const downloadSkp = async (status: SkpStatus | null) => {
    if (status?.status !== 'ready') return;
    try {
      await downloadModel(status.storage_path, status.file_name);
    } catch (err) {
      toast.error('下載 SKP 失敗', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-4 py-5 md:px-6">
      {skpRequirements.dialog}
      <FurnitureProductScopeDialog detection={scopeRequest?.detection ?? null} images={scopeRequest?.files ?? []}
        onCancel={() => setScopeRequest(null)} onChoose={choice => {
          if (!scopeRequest) return;
          const files = scopeRequest.files;
          setScopeRequest(null);
          void readImage(files, choice);
        }} />
      <div>
        <h2 className="text-lg font-semibold">{focus === 'su' ? 'SU 模型' : '3D 模型'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          類型按 FDS 產品類別：枱／桌、儲物、座椅（辦公椅、會議椅、梳化等）和靜音倉。
          {focus === 'su'
            ? ' 生成 SKP 會排進 Windows SKP Worker（SketchUp SDK）處理，完成後可下載。'
            : ' 預覽和下載的是 GLB；設計師畫圖用的 SKP 在 SU 模型頁。'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">類型</Label>
          <div className="flex gap-1">
            {FURNITURE_KINDS.map((item) => (
              <Button key={item.id} size="sm" variant={kind === item.id ? 'default' : 'outline'} onClick={() => setKind(item.id)}>
                {item.label}
              </Button>
            ))}
          </div>
        </div>
        {([
          ['寬 mm', 'width', width, setWidth],
          ['深 mm', 'depth', depth, setDepth],
          ['高 mm', 'height', height, setHeight],
        ] as const).map(([label, axisKey, value, setValue]) => (
          <div key={label} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input
              value={value}
              inputMode="decimal"
              placeholder="留空＝估算"
              className="h-8 w-28"
              onChange={(event) => {
                setValue(event.target.value);
                // A typed value is measured, so that axis is no longer an AI guess.
                setAiEstimated((cur) => cur.filter((a) => a !== axisKey));
              }}
            />
          </div>
        ))}
        <Button size="sm" disabled={reading || !hasReferences} onClick={() => { try { generate(); } catch (error) { toast.error('結構校驗未通過', { description: error instanceof Error ? error.message : String(error) }); } }}>生成參數</Button>
        <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void readImage(files);
        }} />
        <Button size="sm" variant="outline" disabled={reading} onClick={() => fileRef.current?.click()}>
          {reading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          從圖片估算（2–6 張不同角度）
        </Button>
      </div>

      {(kind === 'desk' || kind === 'conference') && (
        <div className="flex flex-wrap items-end gap-3">
          {([
            ['桌面', 'top', [['rect', '矩形'], ['boat', '船形（兩端收窄）']]],
            ['桌腳', 'legs', [['four', '四腳'], ['panel', '折板腳']]],
          ] as const).map(([label, key, options]) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <div className="flex gap-1">
                {options.map(([value, text]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={style[key] === value ? 'default' : 'outline'}
                    onClick={() => setStyle((cur) => ({ ...cur, [key]: value }))}
                  >
                    {text}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex h-8 items-center gap-1.5 text-sm">
            <Checkbox
              id="furniture-model-cable-tray"
              checked={style.cable_tray}
              onCheckedChange={(checked) => setStyle((cur) => ({ ...cur, cable_tray: checked === true }))}
            />
            <label htmlFor="furniture-model-cable-tray" className="cursor-pointer">
              中間走線槽
            </label>
          </div>
        </div>
      )}

      {model && (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <canvas ref={canvasRef} width={280} height={220} className="rounded-lg border border-border" />
          <div className="space-y-2 text-sm">
            <div>
              {model.label} · {model.width_mm} × {model.depth_mm} × {model.height_mm} mm
              {model.estimated_axes.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  估算尺寸（{model.estimated_axes.map((axis) => ({ width: '寬', depth: '深', height: '高' }[axis])).join('、')}）
                </span>
              )}
            </div>
            <ul className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
              {model.components.map((part) => (
                <li key={part.id}>{part.name} · {part.size_mm.join('×')} mm</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              {focus === 'su' && (
                skp?.status === 'ready' ? (
                  <Button size="sm" onClick={() => void downloadSkp(skp)}>下載 SKP</Button>
                ) : (
                  <Button size="sm" disabled={skpBusy || skpPending} onClick={() => void generateSkp()}>
                    {skpBusy || skpPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    {skp?.status === 'failed' || skp?.status === 'cancelled' ? '重新生成 SKP' : '生成 SKP'}
                  </Button>
                )
              )}
              <Button size="sm" variant="outline" onClick={download}>下載 GLB</Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!savedId}
                onClick={() => void save().then((id) => id && toast.success('已儲存參數'))}
              >
                {savedId ? '已儲存' : '儲存參數'}
              </Button>
            </div>
            {focus === 'su' && skp && skp.status !== 'none' && skp.status !== 'ready' && (
              <p className={skp.status === 'failed' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {skpStatusText(skp)}
              </p>
            )}
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>最近參數</div>
          <ul className="space-y-1">
            {saved.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {FURNITURE_KINDS.find((item) => item.id === row.kind)?.label ?? row.kind} {row.width_mm}×{row.depth_mm}×{row.height_mm}
                  {row.estimated && '（估算）'}
                </span>
                {focus === 'su' && row.skp.status === 'ready' && (
                  <button type="button" className="text-primary hover:underline" onClick={() => void downloadSkp(row.skp)}>
                    下載 SKP
                  </button>
                )}
                {focus === 'su' && row.skp.status !== 'ready' && row.skp.status !== 'none' && (
                  <span>{skpStatusText(row.skp)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

