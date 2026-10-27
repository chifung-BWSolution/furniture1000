import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Images,
  ImagePlus,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { LoadingImage } from '@/components/ui/loading-image';
import { ImageLightbox } from '@/components/ui/image-lightbox';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { QuotePhotoGenerateDialog } from '@/components/dashboard/QuotePhotoGenerateDialog';
import {
  QUOTE_PHOTO_ACCEPT,
  QUOTE_PHOTO_LIBRARY_LIMIT,
  QUOTE_PHOTO_PLACEMENT_LABELS,
  canManageQuotePhotos,
  deleteQuotePhotoAsset,
  listQuotePhotoAssets,
  quotePhotoErrorText,
  renameQuotePhotoAsset,
  reorderQuotePhotoAssets,
  updateQuotePhotoPlacement,
  uploadQuotePhotoAsset,
  type QuotePhotoAsset,
  type QuotePhotoPlacement,
} from '@/lib/quotePhotoLibrary';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 報價設定 › 圖片庫。
 *
 * 全公司共用一組可插入報價單的圖片。上載、排序、刪除限 admin / uploader / pm；
 * 其他同事看得到，編輯報價時可以直接選用。
 */
export function QuotePhotoLibraryView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<QuotePhotoAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<QuotePhotoAsset | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<QuotePhotoAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<'all' | QuotePhotoPlacement>('all');
  const [generateOpen, setGenerateOpen] = useState(false);

  const reload = useCallback(async () => {
    const result = await listQuotePhotoAssets();
    setAssets(result.assets);
    setMissingTable(result.missingTable);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    void canManageQuotePhotos().then(setCanManage);
  }, [reload]);

  /** 封面／封底各自按圖片庫次序排，用來顯示「第幾頁」與「倒數第幾頁」。 */
  const pageLabels = useMemo(() => {
    const labels = new Map<string, string>();
    const covers = assets.filter((asset) => asset.placement === 'cover');
    const backs = assets.filter((asset) => asset.placement === 'back');
    covers.forEach((asset, index) => labels.set(asset.id, `第 ${index + 1} 頁`));
    backs.forEach((asset, index) => labels.set(asset.id, `倒數第 ${backs.length - index} 頁`));
    return labels;
  }, [assets]);

  /** 內頁圖啟用時的徽章後綴：顯示插在正文第幾頁之後。 */
  const contentBadge = (asset: QuotePhotoAsset): string => `・正文第 ${asset.pageNumber} 頁後`;

  const counts = useMemo(
    () => ({
      all: assets.length,
      content: assets.filter((asset) => asset.placement === 'content').length,
      cover: assets.filter((asset) => asset.placement === 'cover').length,
      back: assets.filter((asset) => asset.placement === 'back').length,
    }),
    [assets],
  );

  const visibleAssets = useMemo(
    () => (filter === 'all' ? assets : assets.filter((asset) => asset.placement === filter)),
    [assets, filter],
  );

  /** 燈箱只滑動目前篩選得到的圖，序號跟列表一致。 */
  const urls = useMemo(() => visibleAssets.map((asset) => asset.url), [visibleAssets]);

  async function setPlacement(asset: QuotePhotoAsset, placement: QuotePhotoPlacement) {
    if (asset.placement === placement) return;
    setBusyId(asset.id);
    // 切換位置時保留原本的啟用狀態：內頁／封面／封底都有各自的「插入 PDF」開關。
    setAssets((prev) => prev.map((row) => (row.id === asset.id ? { ...row, placement } : row)));
    try {
      await updateQuotePhotoPlacement(asset.id, { placement });
      toast.success(
        placement === 'content'
          ? '已改為內頁圖片，可在報價排版選用或設為獨立整頁'
          : `已設為${QUOTE_PHOTO_PLACEMENT_LABELS[placement]}，每次出 PDF 自動插入`,
      );
    } catch (placementError) {
      toast.error(quotePhotoErrorText(placementError));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(asset: QuotePhotoAsset, isActive: boolean) {
    setBusyId(asset.id);
    setAssets((prev) => prev.map((row) => (row.id === asset.id ? { ...row, isActive } : row)));
    try {
      await updateQuotePhotoPlacement(asset.id, { isActive });
    } catch (activeError) {
      toast.error(quotePhotoErrorText(activeError));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  /** 內頁獨立整頁的插入頁數（插在正文第 N 頁之後）；離開輸入框才寫入。 */
  function commitPageNumber(asset: QuotePhotoAsset, raw: string) {
    const next = Math.max(1, Math.floor(Number(raw) || 1));
    if (next === asset.pageNumber) return;
    setAssets((prev) =>
      prev.map((row) => (row.id === asset.id ? { ...row, pageNumber: next } : row)),
    );
    void updateQuotePhotoPlacement(asset.id, { pageNumber: next }).catch((pageError) => {
      toast.error(quotePhotoErrorText(pageError));
      void reload();
    });
  }

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setUploading(true);
    let added = 0;
    let stoppedByLimit = false;
    try {
      let count = assets.length;
      for (const file of files) {
        if (count >= QUOTE_PHOTO_LIBRARY_LIMIT) {
          stoppedByLimit = true;
          break;
        }
        try {
          const asset = await uploadQuotePhotoAsset(file);
          setAssets((prev) => [...prev, asset]);
          count += 1;
          added += 1;
        } catch (uploadError) {
          toast.error(`${file.name}：${quotePhotoErrorText(uploadError)}`);
        }
      }
      if (added > 0) toast.success(`已加入 ${added} 張圖片`);
      if (stoppedByLimit) {
        toast.error(`圖片庫最多 ${QUOTE_PHOTO_LIBRARY_LIMIT} 張圖片`);
      }
      await reload();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function move(asset: QuotePhotoAsset, direction: -1 | 1) {
    // 在「目前看得到的清單」內對調，這樣篩到封面／封底時上移下移就是調第幾頁。
    const list = filter === 'all' ? assets : visibleAssets;
    const index = list.findIndex((row) => row.id === asset.id);
    const swap = list[index + direction];
    if (index < 0 || !swap) return;
    const next = [...assets];
    const currentIndex = next.findIndex((row) => row.id === asset.id);
    const swapIndex = next.findIndex((row) => row.id === swap.id);
    if (currentIndex < 0 || swapIndex < 0) return;
    next[currentIndex] = swap;
    next[swapIndex] = asset;
    setAssets(next);
    setBusyId(asset.id);
    try {
      await reorderQuotePhotoAssets(next.map((row) => row.id));
    } catch (moveError) {
      toast.error(quotePhotoErrorText(moveError));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function submitRename() {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === renaming.title) {
      setRenaming(null);
      return;
    }
    setBusyId(renaming.id);
    try {
      await renameQuotePhotoAsset(renaming.id, next);
      setAssets((prev) => prev.map((row) => (row.id === renaming.id ? { ...row, title: next } : row)));
      toast.success('已更新圖片名稱');
      setRenaming(null);
    } catch (renameError) {
      toast.error(quotePhotoErrorText(renameError));
    } finally {
      setBusyId(null);
    }
  }

  async function submitDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteQuotePhotoAsset(deleteTarget.id);
      setAssets((prev) => prev.filter((row) => row.id !== deleteTarget.id));
      toast.success('已從圖片庫移除');
      setDeleteTarget(null);
    } catch (deleteError) {
      toast.error(quotePhotoErrorText(deleteError));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <h1 className="fds-page-title">
            <Images className="h-5 w-5 text-primary" />
            圖片庫
          </h1>
          <p className="fds-page-description">
            全公司共用一組可插入報價單的圖片；可以直接上載，也可以在報價編輯器的排版頁用 AI（Grok 4.7 或 Gemini 3.8）按描述生成參考圖。內容內頁的圖在報價編輯器排版，印在總價之後、訂單確認及交付細節之前；開啟「插入 PDF（獨立整頁）」並指定頁數後，每次產生 PDF 會自動插在正文第幾頁之後；標為封面／封底的圖，每次產生 PDF 會自動插入第 1 頁起／最後一頁。
            {canManage ? '上載、排序、插入位置及刪除限管理員。' : '你目前是唯讀，改動請找管理員。'}
          </p>
        </section>

        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}
        {missingTable && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            資料表 quote_photo_assets 尚未部署。套用 migration 之後就可以上載圖片。
          </section>
        )}

        <section className="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-foreground">報價單圖片</p>
              <p className="mt-1 text-sm text-muted-foreground">
                共 {assets.length} / {QUOTE_PHOTO_LIBRARY_LIMIT} 張 · 封面 {counts.cover} 張、封底 {counts.back} 張 ·
                JPG、PNG 或 WebP，每張最多 15 MB
              </p>
            </div>
            {canManage ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  accept={QUOTE_PHOTO_ACCEPT}
                  multiple
                  className="sr-only"
                  aria-label="上載圖片"
                  onChange={(event) => void onFiles(event.target.files)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={missingTable || assets.length >= QUOTE_PHOTO_LIBRARY_LIMIT}
                    onClick={() => setGenerateOpen(true)}
                  >
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    AI 生成
                  </Button>
                  <Button
                    type="button"
                    disabled={uploading || missingTable || assets.length >= QUOTE_PHOTO_LIBRARY_LIMIT}
                    onClick={() => inputRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus className="mr-1.5 h-4 w-4" />
                    )}
                    上載圖片
                  </Button>
                </div>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', `全部 ${counts.all}`],
                ['content', `內容內頁 ${counts.content}`],
                ['cover', `封面 ${counts.cover}`],
                ['back', `封底 ${counts.back}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition',
                  filter === value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:border-primary/40',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="px-1 py-6 text-sm text-muted-foreground">讀取圖片庫…</p>
          ) : assets.length === 0 ? (
            <EmptyState
              title="尚未上載圖片"
              description={
                canManage
                  ? '按「上載圖片」加入 JPG、PNG 或 WebP，之後在報價編輯器按「添加圖片」選用。'
                  : '目前沒有可以插入報價單的圖片。'
              }
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visibleAssets.map((asset, index) => (
                <li
                  key={asset.id}
                  className={cn(
                    'flex flex-col overflow-hidden rounded-xl border bg-background',
                    asset.placement === 'cover'
                      ? 'border-primary/50'
                      : asset.placement === 'back'
                        ? 'border-amber-400/60'
                        : asset.placement === 'content' && asset.isActive
                          ? 'border-sky-400/60'
                          : 'border-border/80',
                    !asset.isActive ? 'opacity-60' : '',
                  )}
                >
                  <button
                    type="button"
                    className="relative block w-full cursor-zoom-in"
                    onClick={() => setPreview(index)}
                    aria-label={`預覽 ${asset.title}`}
                  >
                    <LoadingImage
                      src={asset.url}
                      alt={asset.title}
                      className="aspect-[4/3] w-full bg-muted"
                    />
                    <span className="absolute left-2 top-2 rounded-full bg-slate-950/70 px-2 py-0.5 font-mono-data text-[10px] text-white">
                      {index + 1}
                    </span>
                    {asset.placement !== 'content' || asset.isActive ? (
                      <span
                        className={cn(
                          'absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white',
                          asset.placement === 'cover'
                            ? 'bg-primary'
                            : asset.placement === 'back'
                              ? 'bg-amber-600'
                              : 'bg-sky-600',
                        )}
                      >
                        {asset.placement === 'content' ? '內頁' : QUOTE_PHOTO_PLACEMENT_LABELS[asset.placement]}
                        {asset.isActive
                          ? asset.placement === 'content'
                            ? contentBadge(asset)
                            : `・${pageLabels.get(asset.id) ?? ''}`
                          : '・停用'}
                      </span>
                    ) : null}
                  </button>
                  <div className="flex flex-1 flex-col gap-2 p-2.5">
                    <p className="line-clamp-2 min-h-[2.5em] text-xs font-semibold leading-snug text-foreground">
                      {asset.title}
                    </p>
                    <p className="flex items-center gap-1 font-mono-data text-[10px] text-muted-foreground">
                      {formatBytes(asset.sizeBytes)}
                      {asset.isGenerated ? (
                        <span
                          className="rounded bg-muted px-1 py-0.5 font-sans text-[10px] font-semibold text-foreground/70"
                          title="AI 生成示意圖，僅供設計參考"
                        >
                          AI 參考圖
                        </span>
                      ) : null}
                    </p>

                    {canManage ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1">
                          {(['content', 'cover', 'back'] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={asset.placement === value}
                              disabled={busyId !== null}
                              title={`插入位置：${QUOTE_PHOTO_PLACEMENT_LABELS[value]}`}
                              onClick={() => void setPlacement(asset, value)}
                              className={cn(
                                'flex-1 rounded-md border px-1 py-1 text-[10px] font-semibold transition disabled:opacity-50',
                                asset.placement === value
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border text-muted-foreground hover:border-primary/40',
                              )}
                            >
                              {value === 'content' ? '內頁' : QUOTE_PHOTO_PLACEMENT_LABELS[value]}
                            </button>
                          ))}
                        </div>
                        {asset.placement === 'content' && asset.isActive ? (
                          <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                            插在正文第
                            <input
                              type="number"
                              min={1}
                              step={1}
                              defaultValue={asset.pageNumber}
                              key={`${asset.id}-${asset.pageNumber}`}
                              disabled={busyId !== null}
                              aria-label={`${asset.title} 插入頁數`}
                              onBlur={(event) => commitPageNumber(asset, event.target.value)}
                              className="h-7 w-12 rounded-md border border-border bg-background px-1 text-center font-mono-data text-[11px] text-foreground"
                            />
                            頁後
                          </label>
                        ) : null}
                        <label className="flex items-center justify-between text-[10px] text-muted-foreground">
                          {asset.placement === 'content' ? '插入 PDF（獨立整頁）' : '插入 PDF'}
                          <Switch
                            checked={asset.isActive}
                            aria-label={`${asset.title} 插入 PDF`}
                            disabled={busyId !== null}
                            onCheckedChange={(next) => void toggleActive(asset, next)}
                          />
                        </label>
                      </div>
                    ) : null}

                    {canManage ? (
                      <div className="mt-auto flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`上移 ${asset.title}`}
                          title={
                            filter === 'cover' || filter === 'back'
                              ? `上移（${QUOTE_PHOTO_PLACEMENT_LABELS[filter]}次序＝第幾頁）`
                              : '上移'
                          }
                          disabled={index === 0 || busyId !== null}
                          onClick={() => void move(asset, -1)}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`下移 ${asset.title}`}
                          title={
                            filter === 'cover' || filter === 'back'
                              ? `下移（${QUOTE_PHOTO_PLACEMENT_LABELS[filter]}次序＝第幾頁）`
                              : '下移'
                          }
                          disabled={index === visibleAssets.length - 1 || busyId !== null}
                          onClick={() => void move(asset, 1)}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`改名 ${asset.title}`}
                          title="改名"
                          disabled={busyId !== null}
                          onClick={() => {
                            setRenaming(asset);
                            setRenameValue(asset.title);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="ml-auto h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`刪除 ${asset.title}`}
                          title="刪除"
                          disabled={busyId !== null}
                          onClick={() => setDeleteTarget(asset)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ImageLightbox
        open={preview !== null}
        onClose={() => setPreview(null)}
        images={urls}
        startIndex={preview ?? 0}
        title="圖片庫"
        thumbWidth={96}
      />

      {generateOpen ? (
        <QuotePhotoGenerateDialog
          open
          onClose={() => setGenerateOpen(false)}
          /* 參考圖片只限產品圖；圖片庫頁沒有產品圖，只能按描述生成。 */
          choices={[]}
          libraryCount={assets.length}
          onGenerated={(asset) =>
            setAssets((current) => (current.some((row) => row.id === asset.id) ? current : [...current, asset]))
          }
        />
      ) : null}

      <Modal
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        size="md"
        icon={<Pencil className="h-6 w-6" />}
        title="圖片名稱"
        description="名稱會顯示在圖片庫與報價編輯器的已選圖片清單。"
        footer={
          <>
            <ModalButton onClick={() => void submitRename()} disabled={busyId !== null}>
              {busyId !== null ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              儲存
            </ModalButton>
            <ModalButton variant="secondary" onClick={() => setRenaming(null)}>
              取消
            </ModalButton>
          </>
        }
      >
        <input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          maxLength={120}
          autoFocus
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
          placeholder="例如：三座位梳化"
        />
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        size="md"
        icon={<AlertCircle className="h-6 w-6 text-destructive" />}
        title="確認刪除圖片"
        description={
          <>
            從圖片庫移除「{deleteTarget?.title}」。
            <span className="mt-2 block text-xs text-muted-foreground">
              已插入這張圖的報價單草稿仍會保留，但下次編輯時要重新選圖；已發出的報價版本與已分享連結不受影響。
            </span>
          </>
        }
        footer={
          <>
            <ModalButton variant="destructive" onClick={() => void submitDelete()} disabled={deleting}>
              {deleting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
              刪除
            </ModalButton>
            <ModalButton variant="secondary" onClick={() => setDeleteTarget(null)}>
              取消
            </ModalButton>
          </>
        }
      />
    </div>
  );
}
