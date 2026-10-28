import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { Input } from '@/components/ui/input';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal, ModalButton } from '@/components/ui/modal';
import { StudioPreview } from '@/components/dashboard/StructureConfirmDialog';
import { buildParametric, type ParametricModel } from '@/lib/furnitureParametric';
import { validateFurnitureStructure } from '@/lib/furnitureStructure';
import { QUALITY_LABEL, fetchFurnitureModelDetail, reviewFurnitureModel, type FurnitureModelDetail } from '@/lib/furnitureModelVersions';
import { STATUS_LABEL, acceptanceBlockers, withStatuses } from '@/lib/modelEvidence';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Program checks on the saved geometry: structure rules, and the same input must rebuild the same mesh. */
function programChecks(model: ParametricModel): string[] {
  const errors: string[] = [];
  try {
    errors.push(...validateFurnitureStructure(model, model.structure_evidence, model.custom_parts ?? []));
  } catch (err) {
    errors.push(errorText(err));
  }
  try {
    const rebuilt = buildParametric({
      kind: model.kind,
      width_mm: model.width_mm,
      depth_mm: model.depth_mm,
      height_mm: model.height_mm,
      estimated_axes: model.estimated_axes,
      style: model.style,
      parts: model.custom_parts,
    });
    if (JSON.stringify(rebuilt.components) !== JSON.stringify(model.components)) {
      errors.push(`以目前引擎（${rebuilt.engine_version}）重建的幾何與儲存版本（${model.engine_version ?? '未知引擎'}）不一致`);
    }
  } catch (err) {
    errors.push(`無法重建：${errorText(err)}`);
  }
  return errors;
}

/** FR-06：程式檢查與人工外形核對分開；正式驗收要證據、檢查、核對三者都通過。 */
export function FurnitureModelReviewDialog({ modelId, photos, onClose, onReviewed, style }: {
  modelId: string | null;
  photos: string[];
  onClose: () => void;
  onReviewed: () => void;
  style?: CSSProperties;
}) {
  const [detail, setDetail] = useState<FurnitureModelDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appearanceOk, setAppearanceOk] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    setDetail(null);
    setLoadError(null);
    setAppearanceOk(false);
    setNote('');
    if (!modelId) return;
    let cancelled = false;
    fetchFurnitureModelDetail(modelId)
      .then((row) => { if (!cancelled) setDetail(row); })
      .catch((err) => { if (!cancelled) setLoadError(errorText(err)); });
    return () => { cancelled = true; };
  }, [modelId]);

  const model = detail?.parametric ?? null;
  const evidence = model?.evidence ? withStatuses(model.evidence) : undefined;
  const checks = useMemo(() => (model ? programChecks(model) : []), [model]);
  const evidenceBlockers = useMemo(() => acceptanceBlockers(evidence), [evidence]);
  const closed = detail?.quality_status === 'accepted' || detail?.quality_status === 'rejected';
  const canAccept = Boolean(detail && !closed && detail.quality_status === 'pending_review' && checks.length === 0 && evidenceBlockers.length === 0 && appearanceOk);

  const submit = async (decision: 'accepted' | 'rejected') => {
    if (!detail?.params_hash) return;
    setBusy(true);
    try {
      const status = await reviewFurnitureModel(detail.id, decision, note, {
        errors: checks,
        appearance_ok: appearanceOk,
        params_hash: detail.params_hash,
        compared_images: photos.length,
      });
      toast.success(`已記錄：${QUALITY_LABEL[status]}`);
      onReviewed();
    } catch (err) {
      toast.error('驗收失敗', { description: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={modelId != null}
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      size="4xl"
      icon={<ClipboardCheck className="h-6 w-6" />}
      title="模型驗收"
      description={detail ? `版本 ${detail.id.slice(0, 8)} · ${QUALITY_LABEL[detail.quality_status]} · 引擎 ${detail.engine_version ?? '未知'}` : '讀取版本…'}
      style={style}
      bodyClassName="space-y-4"
      footer={
        <>
          <ModalButton variant="secondary" disabled={busy} onClick={onClose}>關閉</ModalButton>
          <ModalButton variant="secondary" disabled={busy || closed || !detail || !note.trim()} title={!note.trim() ? '驗收不通過要寫原因' : undefined} onClick={() => void submit('rejected')}>
            驗收不通過
          </ModalButton>
          <ModalButton disabled={busy || !canAccept} onClick={() => void submit('accepted')}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            驗收通過
          </ModalButton>
        </>
      }
    >
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {!detail && !loadError && <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-1 h-4 w-4 animate-spin" />讀取版本…</p>}
      {detail && model && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex h-[340px] flex-col rounded-xl border border-border p-2">
              <StudioPreview model={model} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">原始產品圖（透視照片只作外形比較，不作量度）</p>
              <div className="grid grid-cols-3 gap-2">
                {photos.slice(0, 6).map((src, index) => (
                  <button key={src} type="button" className="overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={`放大產品圖 ${index + 1}`} onClick={() => setLightbox(index)}>
                    <LoadingImage src={src} alt={`產品圖 ${index + 1}`} className="aspect-square w-full" imgClassName="object-contain" />
                  </button>
                ))}
              </div>
              {photos.length === 0 && <p className="text-xs text-muted-foreground">沒有可比較的產品圖。</p>}
            </div>
          </div>

          <section className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border p-3">
              <h3 className="text-sm font-semibold">程式檢查</h3>
              {checks.length === 0
                ? <p className="mt-1 text-sm text-emerald-700">零件數、接合、對稱、落地、總尺寸及重建一致性均通過。</p>
                : <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-600">{checks.map((line) => <li key={line}>{line}</li>)}</ul>}
              <p className="mt-2 text-xs text-muted-foreground">程式通過不能證明模型與實物一致，仍需人工外形核對。</p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <h3 className="text-sm font-semibold">尺寸依據</h3>
              {evidence ? (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {evidence.dimensions.filter((d) => d.critical).map((d) => (
                    <li key={d.key} className={d.status === 'confirmed' ? 'text-foreground' : 'text-amber-700'}>{d.label}：{STATUS_LABEL[d.status]}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-amber-700">此版本沒有尺寸證據（舊版本），只能維持未驗收或驗收不通過。</p>
              )}
              {evidenceBlockers.length > 0 && evidence && <p className="mt-2 text-xs text-amber-700">尚有 {evidenceBlockers.length} 項未有依據，不能驗收通過；請以此版本修改並補資料。</p>}
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-border p-3">
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox checked={appearanceOk} disabled={closed} onCheckedChange={(value) => setAppearanceOk(value === true)} className="mt-0.5" />
              <span>已對照原始產品圖，從正面、側面、頂面及透視核對外形、零件數量與接合位置。</span>
            </label>
            <Input value={note} disabled={closed} placeholder="核對備註（驗收不通過必填）" aria-label="核對備註" onChange={(event) => setNote(event.target.value)} />
            {closed && <p className="text-xs text-muted-foreground">此版本已{QUALITY_LABEL[detail.quality_status]}{detail.review?.note ? `：${detail.review.note}` : ''}。修改會建立新版本並重新驗收。</p>}
          </section>
          <ImageLightbox open={lightbox != null} onClose={() => setLightbox(null)} images={photos.slice(0, 6)} startIndex={lightbox ?? 0} title="原始產品圖" thumbWidth={320} />
        </>
      )}
    </Modal>
  );
}
