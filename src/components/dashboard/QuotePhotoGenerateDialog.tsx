import { useState } from 'react';
import { Check, LoaderCircle, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal } from '@/components/ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  QUOTE_PHOTO_GENERATE_MAX_REFERENCES,
  QUOTE_PHOTO_GENERATE_MODELS,
  QUOTE_PHOTO_LIBRARY_LIMIT,
  QUOTE_PHOTO_PROMPT_MAX,
  generateQuoteReferenceImage,
  quotePhotoErrorText,
  type QuotePhotoAsset,
  type QuotePhotoGenerateModel,
} from '@/lib/quotePhotoLibrary';
import {
  AI_REFERENCE_LABEL,
  PHOTO_RATIOS,
  PHOTO_RATIO_LABELS,
  type PhotoRatio,
} from '@/lib/quotePhotoLayouts';

/**
 * 「AI 生成參考圖」對話框（照 QMS 的同名功能，多了模型切換）。
 *
 * 用 Grok 4.7 或 Gemini 3.8 按描述生成一張室內示意圖，可帶最多 5 張現有圖片
 * 作參考；生成結果直接寫入圖片庫（isGenerated = true），再由呼叫方放進素材區。
 * 排版編輯器與報價設定 › 圖片庫共用同一個對話框。
 */

/** 共用結尾，令所有預設場景維持同一種視覺風格。 */
const GENERATE_STYLE =
  '寫實室內設計效果圖，淺色物料，暖白燈光，乾淨構圖，無人、無文字、無商標，鏡頭平視';
const GENERATE_PROMPT_PRESETS: Array<{ label: string; prompt: string }> = [
  { label: '辦公室接待處', prompt: `現代辦公室接待處，淺木色接待櫃、淺灰沙發、白牆。${GENERATE_STYLE}` },
  { label: '開放式辦公室', prompt: `開放式辦公室，淺色工作桌、低隔屏、白牆。${GENERATE_STYLE}` },
  { label: '會議室', prompt: `小型會議室，長桌、淺色座椅、白牆。${GENERATE_STYLE}` },
  { label: '診所接待處', prompt: `診所接待處，淺木色櫃檯、等候座椅、白牆。${GENERATE_STYLE}` },
  { label: '零售店舖', prompt: `零售店舖，淺色展示架、整潔走道、白牆。${GENERATE_STYLE}` },
  { label: '餐廳', prompt: `餐廳用餐區，淺木桌椅、柔和燈光、白牆。${GENERATE_STYLE}` },
  { label: '走廊', prompt: `室內走廊，淺色地台、白牆、盡頭有窗。${GENERATE_STYLE}` },
  { label: '洗手間', prompt: `洗手間，淺色潔具、鏡櫃、白牆。${GENERATE_STYLE}` },
];

export type GenerateChoice = { id: string; title: string; previewUrl: string };

export function QuotePhotoGenerateDialog({
  open,
  onClose,
  choices,
  libraryCount,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  /** 可以做參考圖的圖片（素材區／圖片庫）。 */
  choices: GenerateChoice[];
  /** 圖片庫現有張數，用來擋上限。 */
  libraryCount: number;
  onGenerated: (asset: QuotePhotoAsset) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<PhotoRatio>('4:3');
  const [model, setModel] = useState<QuotePhotoGenerateModel>(QUOTE_PHOTO_GENERATE_MODELS[0].id);
  const [refs, setRefs] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);

  if (!open) return null;

  const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();

  function toggleRef(id: string) {
    setRefs((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= QUOTE_PHOTO_GENERATE_MAX_REFERENCES) {
        toast.error(quotePhotoErrorText(new Error('quote_photo_generate_reference_limit')));
        return current;
      }
      return [...current, id];
    });
  }

  async function generate() {
    if (!cleanPrompt) {
      toast.error(quotePhotoErrorText(new Error('quote_photo_generate_invalid')));
      return;
    }
    if (libraryCount >= QUOTE_PHOTO_LIBRARY_LIMIT) {
      toast.error(quotePhotoErrorText(new Error('quote_photo_library_limit')));
      return;
    }
    const label = QUOTE_PHOTO_GENERATE_MODELS.find((entry) => entry.id === model)?.label ?? 'AI';
    setGenerating(true);
    try {
      const asset = await generateQuoteReferenceImage({
        model,
        prompt: cleanPrompt,
        aspectRatio: ratio,
        referenceAssetIds: refs,
      });
      onGenerated(asset);
      setPrompt('');
      setRefs([]);
      onClose();
      toast.success(`已用 ${label} 生成參考圖，並加入圖片庫。`);
    } catch (error) {
      toast.error(quotePhotoErrorText(error));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !generating) onClose();
      }}
      icon={<Wand2 className="h-6 w-6" />}
      title="AI 生成參考圖"
      description={`按描述生成一張室內示意圖，可選最多 ${QUOTE_PHOTO_GENERATE_MAX_REFERENCES} 張現有圖片作參考。${AI_REFERENCE_LABEL}，不會當成現場實拍。`}
      size="3xl"
      footer={
        <>
          <Button type="button" variant="outline" disabled={generating} onClick={onClose}>
            取消
          </Button>
          <Button type="button" disabled={generating || !cleanPrompt} onClick={() => void generate()}>
            {generating ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            {generating ? '生成中…' : '生成'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">模型</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {QUOTE_PHOTO_GENERATE_MODELS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                disabled={generating}
                aria-pressed={model === entry.id}
                onClick={() => setModel(entry.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                  model === entry.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground/80 hover:border-primary/40'
                }`}
              >
                {entry.label}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{entry.provider}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Grok 4.7 偏寫實效果圖；Gemini 3.8 走 Google 的 Gemini 3 影像模型（Nano Banana Pro），成品較接近實拍。生成失敗可以切換另一個再試。
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">常用描述</p>
          <p className="mt-0.5 text-xs text-muted-foreground">同一套淺色、暖白、無人效果圖。點一下填入，仍可再改。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {GENERATE_PROMPT_PRESETS.map((preset) => {
              const selected = cleanPrompt === preset.prompt;
              return (
                <button
                  key={preset.label}
                  type="button"
                  disabled={generating}
                  aria-pressed={selected}
                  title={preset.prompt}
                  onClick={() => setPrompt(preset.prompt)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground/80 hover:border-primary/60 hover:text-primary'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block text-sm font-semibold text-foreground">
          描述
          <textarea
            value={prompt}
            maxLength={QUOTE_PHOTO_PROMPT_MAX}
            rows={4}
            disabled={generating}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：現代診所接待處，淺木色櫃檯，暖白燈光"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground"
          />
          <span className="mt-1 block text-right text-xs font-normal text-muted-foreground">
            {prompt.length} / {QUOTE_PHOTO_PROMPT_MAX}
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div>
            <p className="text-sm font-semibold text-foreground">
              參考圖片（可選，最多 {QUOTE_PHOTO_GENERATE_MAX_REFERENCES} 張）
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">點圖片加入。沒有選時只按描述生成。</p>
            {choices.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">尚未有圖片。可先上載，再選為參考。</p>
            ) : (
              <div className="mt-2 max-h-44 overflow-y-auto overscroll-contain pr-1">
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {choices.map((choice) => {
                    const selected = refs.includes(choice.id);
                    return (
                      <li key={choice.id}>
                        <button
                          type="button"
                          disabled={generating}
                          aria-pressed={selected}
                          title={choice.title}
                          aria-label={`${selected ? '取消選取' : '選取'}參考圖「${choice.title}」`}
                          onClick={() => toggleRef(choice.id)}
                          className={`relative block w-full overflow-hidden rounded-lg border ${
                            selected ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <LoadingImage src={choice.previewUrl} alt="" className="aspect-[4/3] w-full" />
                          {selected ? (
                            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">比例</p>
            <Select value={ratio} disabled={generating} onValueChange={(value) => setRatio(value as PhotoRatio)}>
              <SelectTrigger className="mt-1" aria-label="生成比例">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHOTO_RATIOS.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry} {PHOTO_RATIO_LABELS[entry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
