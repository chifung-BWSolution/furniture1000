import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal } from '@/components/ui/modal';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateZoneScenePrompt, withReferenceImagePrompts, type ZoneSceneFurniture, type ZoneSceneInput } from '@/lib/quoteFloorPlan';
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
 * 用 Grok 4.7 或 Gemini 3.8 按描述生成一張室內示意圖，可帶最多 5 張產品圖
 * 作參考（AI 會把產品放進描述的場景）；生成結果直接寫入圖片庫
 * （isGenerated = true），再由呼叫方放進素材區。排版編輯器與報價設定 › 圖片庫共用同一個對話框。
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

export type GenerateChoice = { id: string; title: string; previewUrl: string; /** 傳給模型的參考圖 URL（產品圖絕對 URL）。 */ referenceUrl: string };

export type QuotePhotoZone = ZoneSceneInput & { id: string };

export function QuotePhotoGenerateDialog({
  open,
  onClose,
  choices,
  zones = [],
  libraryCount,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  /** 可以做參考圖的產品圖（報價明細帶來的圖）。 */
  choices: GenerateChoice[];
  /** 平面圖識別出的分區。沒有分區時改顯示常用描述。 */
  zones?: QuotePhotoZone[];
  /** 圖片庫現有張數，用來擋上限。 */
  libraryCount: number;
  onGenerated: (asset: QuotePhotoAsset) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<PhotoRatio>('4:3');
  const [model, setModel] = useState<QuotePhotoGenerateModel>(QUOTE_PHOTO_GENERATE_MODELS[0].id);
  const [refs, setRefs] = useState<string[]>([]);
  /** 已選參考圖的說明，鍵是 choice id，順序跟 refs 一致時寫進提示詞。 */
  const [refNotes, setRefNotes] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [promptProgress, setPromptProgress] = useState(0);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);

  useEffect(() => {
    if (!prompting) {
      setPromptProgress(0);
      return;
    }
    setPromptProgress((value) => (value > 0 ? value : 8));
    const timer = window.setInterval(() => {
      setPromptProgress((value) => {
        if (value >= 92) return value;
        const step = value < 50 ? 4 : 1.2;
        return Math.min(92, Math.round((value + step) * 10) / 10);
      });
    }, 280);
    return () => window.clearInterval(timer);
  }, [prompting]);

  if (!open) return null;

  const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();

  function captionsFor(ids: string[]): ZoneSceneFurniture[] {
    return ids.map((id) => ({
      name: refNotes[id] || choices.find((entry) => entry.id === id)?.title || '這件傢俬',
      role: '',
    }));
  }

  function toggleRef(id: string) {
    if (refs.includes(id)) {
      const next = refs.filter((item) => item !== id);
      setRefs(next);
      setPrompt((current) => withReferenceImagePrompts(current, captionsFor(next), QUOTE_PHOTO_PROMPT_MAX));
      return;
    }
    if (refs.length >= QUOTE_PHOTO_GENERATE_MAX_REFERENCES) {
      toast.error(quotePhotoErrorText(new Error('quote_photo_generate_reference_limit')));
      return;
    }
    const next = [...refs, id];
    setRefs(next);
    setPrompt((current) => withReferenceImagePrompts(current, captionsFor(next), QUOTE_PHOTO_PROMPT_MAX));
  }

  function referenceIdsForZone(zone: QuotePhotoZone): { ids: string[]; furniture: QuotePhotoZone['furniture'] } {
    const ids: string[] = [];
    const furniture: QuotePhotoZone['furniture'] = [];
    for (const item of zone.furniture) {
      const url = item.imageUrl?.trim();
      if (!url) continue;
      const choice = choices.find((entry) => entry.referenceUrl === url || entry.previewUrl === url);
      if (!choice || ids.includes(choice.id)) continue;
      if (ids.length >= QUOTE_PHOTO_GENERATE_MAX_REFERENCES) break;
      ids.push(choice.id);
      furniture.push(item);
    }
    return { ids, furniture };
  }

  async function writeZonePrompt(zone: QuotePhotoZone) {
    const { ids, furniture } = referenceIdsForZone(zone);
    const pictured = new Set(zone.furniture.map((item) => item.imageUrl?.trim()).filter(Boolean));
    if (pictured.size > QUOTE_PHOTO_GENERATE_MAX_REFERENCES) {
      toast.message(`這個分區有 ${pictured.size} 張產品圖，參考圖最多選 ${QUOTE_PHOTO_GENERATE_MAX_REFERENCES} 張。`);
    }
    const notes: Record<string, string> = {};
    ids.forEach((id, index) => {
      const item = furniture[index];
      if (!item) return;
      const name = item.name.trim();
      const role = item.role.trim();
      notes[id] = name && role && role !== name ? `${name}（${role}）` : (name || role);
    });
    setRefNotes(notes);
    setRefs(ids);
    setActiveZoneId(zone.id);
    setPrompting(true);
    try {
      const text = await generateZoneScenePrompt(zone, furniture);
      setPrompt(text.slice(0, QUOTE_PHOTO_PROMPT_MAX));
      setPromptProgress(100);
    } finally {
      setPrompting(false);
    }
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
    setGenerating(true);
    try {
      const referenceUrls = refs.flatMap((id) => {
        const choice = choices.find((entry) => entry.id === id);
        return choice?.referenceUrl ? [choice.referenceUrl] : [];
      });
      const promptToSend = withReferenceImagePrompts(cleanPrompt, captionsFor(refs), QUOTE_PHOTO_PROMPT_MAX);
      setPrompt(promptToSend);
      const asset = await generateQuoteReferenceImage({
        model,
        prompt: promptToSend,
        aspectRatio: ratio,
        referenceUrls,
      });
      onGenerated(asset);
      setPrompt('');
      setRefs([]);
      onClose();
      toast.success('已生成參考圖，並加入圖片庫。');
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
        if (!next && !generating && !prompting) onClose();
      }}
      icon={<Wand2 className="h-6 w-6" />}
      title="AI 生成參考圖"
      description={`${AI_REFERENCE_LABEL}，不會當成現場實拍。`}
      size="3xl"
      footer={
        <>
          <Button type="button" variant="outline" disabled={generating || prompting} onClick={onClose}>
            取消
          </Button>
          <Button type="button" disabled={generating || prompting || !cleanPrompt} onClick={() => void generate()}>
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
                disabled={generating || prompting}
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
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">{zones.length > 0 ? '分區' : '常用描述'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {zones.length > 0 ? zones.map((zone) => {
              const selected = activeZoneId === zone.id;
              const detail = [zone.spaceType, ...zone.furniture.map((item) => item.role || item.name)].filter(Boolean).join('、');
              return (
                <button
                  key={zone.id}
                  type="button"
                  disabled={generating || prompting}
                  aria-pressed={selected}
                  title={detail || zone.name}
                  onClick={() => void writeZonePrompt(zone)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground/80 hover:border-primary/60 hover:text-primary'
                  }`}
                >
                  {zone.name}
                </button>
              );
            }) : GENERATE_PROMPT_PRESETS.map((preset) => {
              const selected = cleanPrompt === preset.prompt;
              return (
                <button
                  key={preset.label}
                  type="button"
                  disabled={generating || prompting}
                  aria-pressed={selected}
                  title={preset.prompt}
                  onClick={() => {
                    setActiveZoneId(null);
                    setPrompt(preset.prompt);
                  }}
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
          <div className="relative mt-1">
            <textarea
              value={prompt}
              maxLength={QUOTE_PHOTO_PROMPT_MAX}
              rows={4}
              disabled={generating || prompting}
              onChange={(event) => {
                setActiveZoneId(null);
                setPrompt(event.target.value);
              }}
              placeholder="例如：現代診所接待處，淺木色櫃檯，暖白燈光"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground disabled:opacity-60"
            />
            {prompting ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-900/40 px-4" role="status" aria-live="polite">
                <div className="w-full max-w-xs space-y-1.5 rounded-xl bg-white px-4 py-3 shadow-lg">
                  <div className="flex items-center justify-between gap-3 text-xs text-foreground">
                    <span>正在寫描述…</span>
                    <span className="font-mono-data tabular-nums">{Math.round(promptProgress)}%</span>
                  </div>
                  <Progress value={promptProgress} />
                </div>
              </div>
            ) : null}
          </div>
          <span className="mt-1 block text-right text-xs font-normal text-muted-foreground">
            {prompt.length} / {QUOTE_PHOTO_PROMPT_MAX}
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div>
            <p className="text-sm font-semibold text-foreground">
              參考圖片（產品圖，可選，最多 {QUOTE_PHOTO_GENERATE_MAX_REFERENCES} 張）
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">點選產品圖，AI 會把這些產品放進描述的場景。圖片上的數字與描述裡的參考圖編號相同，並按這個順序上傳。</p>
            {choices.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">未有產品圖。報價明細加入有圖片的產品後，就可以在這裡選用。</p>
            ) : (
              <div className="mt-2 max-h-44 overflow-y-auto overscroll-contain pr-1">
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {choices.map((choice) => {
                    const selected = refs.includes(choice.id);
                    return (
                      <li key={choice.id}>
                        <button
                          type="button"
                          disabled={generating || prompting}
                          aria-pressed={selected}
                          title={choice.title}
                          aria-label={`${selected ? '取消選取' : '選取'}產品圖「${choice.title}」`}
                          onClick={() => toggleRef(choice.id)}
                          className={`relative block w-full overflow-hidden rounded-lg border ${
                            selected ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <LoadingImage src={choice.previewUrl} alt="" className="aspect-[4/3] w-full" />
                          {selected ? (
                            <span className="absolute left-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                              {refs.indexOf(choice.id) + 1}
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
            <Select value={ratio} disabled={generating || prompting} onValueChange={(value) => setRatio(value as PhotoRatio)}>
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
