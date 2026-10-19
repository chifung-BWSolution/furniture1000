import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { invokeEdgeFunctionDirect } from '@/lib/invokeEdgeFunction';
import { buildFurnitureGlb } from '@/lib/furnitureGlb';
import {
  FURNITURE_KINDS,
  buildParametric,
  type FurnitureKind,
  type ParametricModel,
} from '@/lib/furnitureParametric';

interface SavedModel {
  id: string;
  kind: FurnitureKind;
  estimated: boolean;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  created_at: string;
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

function drawPreview(canvas: HTMLCanvasElement, model: ParametricModel) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f4f4f5';
  ctx.fillRect(0, 0, width, height);
  const project = (x: number, y: number, z: number) => ({
    x: width / 2 + (x + y * 0.45) * 0.18,
    y: height * 0.78 - (z + y * 0.25) * 0.18,
  });
  const parts = [...model.components].sort((a, b) => a.position_mm[1] - b.position_mm[1]);
  for (const part of parts) {
    const [w, d, h] = part.size_mm;
    const [x, y, z] = part.position_mm;
    const corners = [
      project(x - w / 2, y - d / 2, z - h / 2),
      project(x + w / 2, y - d / 2, z - h / 2),
      project(x + w / 2, y + d / 2, z - h / 2),
      project(x + w / 2, y + d / 2, z + h / 2),
      project(x - w / 2, y + d / 2, z + h / 2),
      project(x - w / 2, y - d / 2, z + h / 2),
    ];
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(120, 113, 108, 0.35)';
    ctx.strokeStyle = '#44403c';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
}

export function FurnitureModelView({ focus }: { focus: 'su' | '3d' }) {
  const [kind, setKind] = useState<FurnitureKind>('desk');
  const [width, setWidth] = useState('');
  const [depth, setDepth] = useState('');
  const [height, setHeight] = useState('');
  const [model, setModel] = useState<ParametricModel | null>(null);
  const [reading, setReading] = useState(false);
  const [saved, setSaved] = useState<SavedModel[]>([]);
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
  }, [model]);

  useEffect(() => {
    if (model && canvasRef.current) drawPreview(canvasRef.current, model);
  }, [model]);

  const generate = (next?: { kind?: FurnitureKind; width?: number | null; depth?: number | null; height?: number | null }) => {
    const built = buildParametric({
      kind: next?.kind ?? kind,
      width_mm: next?.width === undefined ? num(width) : next.width,
      depth_mm: next?.depth === undefined ? num(depth) : next.depth,
      height_mm: next?.height === undefined ? num(height) : next.height,
    });
    setModel(built);
  };

  const readImage = async (file: File) => {
    setReading(true);
    try {
      const image = await fileToJpeg(file);
      let result = await invokeEdgeFunctionDirect<{
        supported?: boolean;
        kind?: FurnitureKind;
        width_mm?: number | null;
        depth_mm?: number | null;
        height_mm?: number | null;
        reason?: string;
        error?: string;
      }>('supabase-functions-generate-furniture-model', { image_base64: image, mime_type: 'image/jpeg' });
      if (result.status === 404) {
        result = await invokeEdgeFunctionDirect('generate-furniture-model', { image_base64: image, mime_type: 'image/jpeg' });
      }
      if (result.error || !result.data) throw new Error(result.error?.message ?? '無法辨認圖片');
      if (result.data.supported === false || !result.data.kind || result.data.kind === ('unsupported' as FurnitureKind)) {
        toast.error(result.data.reason || '首版只做辦公桌、會議桌、書架和儲物櫃');
        return;
      }
      setKind(result.data.kind);
      const typedW = num(width);
      const typedD = num(depth);
      const typedH = num(height);
      if (typedW == null && result.data.width_mm) setWidth(String(Math.round(result.data.width_mm)));
      if (typedD == null && result.data.depth_mm) setDepth(String(Math.round(result.data.depth_mm)));
      if (typedH == null && result.data.height_mm) setHeight(String(Math.round(result.data.height_mm)));
      generate({
        kind: result.data.kind,
        width: typedW ?? result.data.width_mm,
        depth: typedD ?? result.data.depth_mm,
        height: typedH ?? result.data.height_mm,
      });
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

  const save = async () => {
    if (!model) return;
    const { error } = await supabase.rpc('fds_save_furniture_model', {
      p_kind: model.kind,
      p_parametric: model,
      p_estimated: model.estimated_axes.length > 0,
      p_product_id: null,
    });
    if (error) {
      toast.error('儲存失敗', { description: error.message });
      return;
    }
    toast.success('已儲存參數');
    setModel({ ...model });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-lg font-semibold">{focus === 'su' ? 'SU 模型' : '3D 模型'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          首版只做辦公桌、會議桌、書架和儲物櫃。沙發、辦公椅和曲面家具不會生成。
          {focus === 'su' ? ' SketchUp 檔尚未產生，因為還沒在 SketchUp 裡開啟驗證。' : ' 預覽和下載的是 GLB。'}
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
          ['寬 mm', width, setWidth],
          ['深 mm', depth, setDepth],
          ['高 mm', height, setHeight],
        ] as const).map(([label, value, setValue]) => (
          <div key={label} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input value={value} inputMode="decimal" placeholder="留空＝估算" className="h-8 w-28" onChange={(event) => setValue(event.target.value)} />
          </div>
        ))}
        <Button size="sm" onClick={() => generate()}>生成參數</Button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void readImage(file);
        }} />
        <Button size="sm" variant="outline" disabled={reading} onClick={() => fileRef.current?.click()}>
          {reading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          從圖片估算
        </Button>
      </div>

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
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={download}>下載 GLB</Button>
              <Button size="sm" variant="outline" onClick={() => void save()}>儲存參數</Button>
            </div>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="text-xs text-muted-foreground">
          最近參數：{saved.map((row) => `${FURNITURE_KINDS.find((item) => item.id === row.kind)?.label ?? row.kind} ${row.width_mm}×${row.depth_mm}×${row.height_mm}`).join('、')}
        </div>
      )}
    </div>
  );
}
