import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PhotoConfirmButton, QuotePhotoLayoutEditor } from '@/components/dashboard/QuotePhotoLayoutEditor';
import type { QuotePhotoZone } from '@/components/dashboard/QuotePhotoGenerateDialog';
import { PhotoLayoutBlock } from '@/components/dashboard/QuotePhotoLayoutView';
import {
  listQuotePhotoAssets,
  quotePhotoRefUrl,
  type QuotePhotoAsset,
  type QuotePhotoAssetRef,
} from '@/lib/quotePhotoLibrary';
import {
  MAX_LAYOUT_GROUPS,
  MAX_LAYOUT_PHOTOS,
  countPlacements,
  groupGeometry,
  photoTemplateText,
  type PhotoLayoutGroup,
} from '@/lib/quotePhotoLayouts';
import type { QuoteLocale } from '@/lib/quotationLocale';
import { photoPagesCopy } from '@/lib/quoteSurfaceCopy';

/**
 * 報價單圖片（排版版）：排在總價之後、訂單確認及交付細節之前。
 *
 * 每個佈局完整放在同一頁，放不下移到下一頁；編輯在整頁的排版側欄做
 * （照 QMS 的 QuotePhotoPages）。圖片本身只記 assetId，快照存 project_data。
 */
export function QuotePhotoPages({
  layouts,
  assets,
  productPhotos = [],
  photoZones = [],
  canManage,
  disabled = false,
  locale = 'zh',
  onChange,
}: {
  layouts: PhotoLayoutGroup[];
  /** project_data 內的圖片庫快照，圖片庫改動後印刷仍然準。 */
  assets: QuotePhotoAssetRef[];
  /** 報價明細帶過來的產品圖，開排版時預設就放進素材區。 */
  productPhotos?: { id: string; title: string; url: string }[];
  photoZones?: QuotePhotoZone[];
  canManage: boolean;
  disabled?: boolean;
  locale?: QuoteLocale;
  onChange: (layouts: PhotoLayoutGroup[], usedAssets: QuotePhotoAssetRef[]) => void;
}) {
  const copy = photoPagesCopy(locale);
  const [library, setLibrary] = useState<QuotePhotoAsset[]>([]);
  const [editor, setEditor] = useState<{ groupId: string | null } | null>(null);
  const editable = !disabled;

  useEffect(() => {
    let cancelled = false;
    void listQuotePhotoAssets().then((result) => {
      if (!cancelled) setLibrary(result.assets);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 現行圖片庫優先，抓不到（已刪）就退回 project_data 快照；產品圖直接吃 URL。 */
  const sources = useMemo(() => {
    const map = new Map<string, { title: string; previewUrl: string }>();
    for (const photo of productPhotos) {
      if (photo.url) map.set(photo.id, { title: photo.title, previewUrl: photo.url });
    }
    for (const asset of assets) {
      const url = quotePhotoRefUrl(asset);
      if (url) map.set(asset.id, { title: asset.title, previewUrl: url });
    }
    for (const asset of library) map.set(asset.id, { title: asset.title, previewUrl: asset.url });
    return map;
  }, [assets, library, productPhotos]);
  const photoFor = (assetId: string) => sources.get(assetId);

  const total = countPlacements(layouts);
  const canAdd = layouts.length < MAX_LAYOUT_GROUPS && total < MAX_LAYOUT_PHOTOS;

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (!layouts[index] || !layouts[target]) return;
    const next = [...layouts];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next, assets);
  }

  function snapshot(groups: PhotoLayoutGroup[], usedAssets: QuotePhotoAsset[]): QuotePhotoAssetRef[] {
    const ids = new Set<string>();
    for (const group of groups) for (const placement of group.placements) ids.add(placement.assetId);
    const refs: QuotePhotoAssetRef[] = [];
    for (const asset of usedAssets) {
      if (!ids.has(asset.id)) continue;
      refs.push({
        id: asset.id,
        title: asset.title,
        objectPath: asset.objectPath,
        ...(asset.isGenerated ? { isGenerated: true } : {}),
      });
    }
    for (const photo of productPhotos) {
      if (ids.has(photo.id) && !refs.some((ref) => ref.id === photo.id)) {
        refs.push({ id: photo.id, title: photo.title, url: photo.url });
      }
    }
    for (const asset of assets) {
      if (ids.has(asset.id) && !refs.some((ref) => ref.id === asset.id)) refs.push(asset);
    }
    return refs;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy.hint}
          </p>
        </div>
        {editable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditor({ groupId: layouts[0]?.id ?? null })}
          >
            <Pencil className="mr-1.5 h-4 w-4" />
            {copy.arrange}
          </Button>
        ) : null}
      </div>

      {layouts.length > 0 ? (
        <ol className="mt-4 space-y-5">
          {layouts.map((group, index) => (
            <li key={group.id} className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {copy.layout(index + 1)}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {photoTemplateText(group.templateId, locale).name} · {copy.photoCount(group.placements.length)}
                  </span>
                </p>
                {editable ? (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={copy.editLayout(index + 1)}
                      title={copy.edit}
                      onClick={() => setEditor({ groupId: group.id })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={copy.moveUpLabel(index + 1)}
                      title={copy.moveUp}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={copy.moveDownLabel(index + 1)}
                      title={copy.moveDown}
                      disabled={index === layouts.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <PhotoConfirmButton
                      className="text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      ariaLabel={copy.deleteLabel(index + 1)}
                      title={copy.delete}
                      confirmLabel={copy.deleteConfirm}
                      description={copy.deleteDescription(index + 1, photoTemplateText(group.templateId, locale).name, group.placements.length)}
                      onConfirm={() => onChange(layouts.filter((entry) => entry.id !== group.id), assets)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </PhotoConfirmButton>
                  </div>
                ) : null}
              </div>
              <div className="max-w-3xl rounded-lg border border-border bg-card p-2">
                <PhotoLayoutBlock
                  geometry={groupGeometry(group)}
                  placements={group.placements}
                  photoFor={photoFor}
                  renderSlot={(_slot, placement, content) =>
                    content ??
                    (placement ? null : <div className="absolute inset-0 border border-dashed border-border" aria-hidden />)
                  }
                />
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {editable ? (
        layouts.length === 0 ? (
          <button
            type="button"
            onClick={() => setEditor({ groupId: null })}
            className="mt-4 flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border py-8 text-sm text-muted-foreground transition hover:border-primary/60 hover:text-primary"
          >
            <ImagePlus className="h-5 w-5" aria-hidden />
            {copy.empty}
          </button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            disabled={!canAdd}
            title={canAdd ? undefined : copy.max(MAX_LAYOUT_GROUPS, MAX_LAYOUT_PHOTOS)}
            onClick={() => setEditor({ groupId: null })}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {copy.add}
          </Button>
        )
      ) : null}

      {editor ? (
        <QuotePhotoLayoutEditor
          layouts={layouts}
          groupId={editor.groupId}
          assets={library}
          productPhotos={productPhotos}
          photoZones={photoZones}
          photos={assets.map((asset) => ({
            assetId: asset.id,
            title: asset.title,
            objectPath: quotePhotoRefUrl(asset),
          }))}
          canManage={canManage}
          locale={locale}
          onUploaded={(asset) => setLibrary((current) => (current.some((row) => row.id === asset.id) ? current : [...current, asset]))}
          onSave={(groups, usedAssets) => {
            onChange(groups, snapshot(groups, usedAssets));
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
