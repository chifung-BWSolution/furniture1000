import { useState, type ReactNode } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingImage } from '@/components/ui/loading-image';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { generateQuoteReferenceImage, quotePhotoErrorText } from '@/lib/quotePhotoLibrary';
import type { SearchProduct } from '@/lib/productSearch';
import {
  draftFor,
  draftFromProductFacts,
  type PresentationProductDraft,
  type PresentationZoneDraft,
} from '@/lib/presentationOutlineModel';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function PresentationOutlineStep({
  title,
  client,
  companyIntro,
  qualifications,
  services,
  includeFloor,
  zones,
  products,
  productZone,
  drafts,
  disabled,
  onTitle,
  onClient,
  onCompanyIntro,
  onQualifications,
  onServices,
  onZoneName,
  onDraft,
  onZone,
}: {
  title: string;
  client: string;
  companyIntro: string;
  qualifications: string;
  services: string;
  includeFloor: boolean;
  zones: PresentationZoneDraft[];
  products: SearchProduct[];
  productZone: Record<string, string>;
  drafts: Record<string, PresentationProductDraft>;
  disabled: boolean;
  onTitle: (value: string) => void;
  onClient: (value: string) => void;
  onCompanyIntro: (value: string) => void;
  onQualifications: (value: string) => void;
  onServices: (value: string) => void;
  onZoneName: (id: string, name: string) => void;
  onDraft: (productId: string, patch: Partial<PresentationProductDraft>) => void;
  onZone: (productId: string, zoneId: string) => void;
}) {
  const [samplingId, setSamplingId] = useState<string | null>(null);

  async function generateSample(product: SearchProduct) {
    const draft = draftFor(product, drafts);
    const reference = draft.imageUrl.trim();
    if (!reference) {
      toast.error('這件產品沒有可參考的圖片');
      return;
    }
    setSamplingId(product.id);
    try {
      const asset = await generateQuoteReferenceImage({
        model: 'gemini',
        aspectRatio: '4:3',
        referenceUrls: [reference],
        prompt: `Keep the exact product in the reference photo. Do not change its shape, material, color, or proportions. Place that same product in a simple office scene. The result is a presentation sample, not a new product design. ${draft.displayName} ${draft.model}`.trim(),
      });
      onDraft(product.id, { sampleImageUrl: asset.url, noBackground: true });
      toast.success('已生成示例圖', { description: '僅供參考，不會改寫產品原圖。' });
    } catch (error) {
      toast.error('示例圖生成失敗', { description: quotePhotoErrorText(error) });
    } finally {
      setSamplingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border p-4">
        <p className="text-sm font-semibold">封面</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="項目名稱">
            <Input value={title} disabled={disabled} onChange={(event) => onTitle(event.target.value)} />
          </Field>
          <Field label="客戶">
            <Input value={client} disabled={disabled} onChange={(event) => onClient(event.target.value)} />
          </Field>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <p className="text-sm font-semibold">公司介紹</p>
        <Textarea className="min-h-24" value={companyIntro} disabled={disabled} onChange={(event) => onCompanyIntro(event.target.value)} />
      </section>

      {includeFloor ? (
        <section className="space-y-2 rounded-xl border p-4">
          <p className="text-sm font-semibold">項目平面圖</p>
          <p className="text-xs text-muted-foreground">{zones.map((zone) => zone.name).filter(Boolean).join('、') || '已包含整體平面圖。'}</p>
        </section>
      ) : null}

      {zones.map((zone) => (
        <section key={zone.id} className="space-y-3 rounded-xl border p-4">
          <Field label="分區">
            <Input value={zone.name} disabled={disabled} onChange={(event) => onZoneName(zone.id, event.target.value)} />
          </Field>
          {products.filter((product) => productZone[product.id] === zone.id).map((product) => {
            const draft = draftFor(product, drafts);
            const shown = draft.sampleImageUrl || draft.imageUrl;
            return (
              <div key={product.id} className="space-y-3 rounded-lg bg-muted/30 p-3">
                <div className="flex gap-3">
                  {shown ? <LoadingImage src={shown} alt="" className="h-20 w-20 shrink-0 rounded-md" /> : null}
                  <div className="min-w-0 flex-1 space-y-2">
                    <Field label="展示名稱">
                      <Input value={draft.displayName} disabled={disabled} onChange={(event) => onDraft(product.id, { displayName: event.target.value })} />
                    </Field>
                    <Field label="型號">
                      <Input value={draft.model} disabled={disabled} onChange={(event) => onDraft(product.id, { model: event.target.value })} />
                    </Field>
                  </div>
                </div>
                <Field label="描述">
                  <Textarea className="min-h-20" value={draft.description} disabled={disabled} onChange={(event) => onDraft(product.id, { description: event.target.value })} />
                </Field>
                <Field label="賣點">
                  <Textarea className="min-h-16" value={draft.sellingPoints} disabled={disabled} onChange={(event) => onDraft(product.id, { sellingPoints: event.target.value })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="市場價">
                    <Input value={draft.marketPrice} disabled={disabled} onChange={(event) => onDraft(product.id, { marketPrice: event.target.value })} />
                  </Field>
                  <Field label="項目優惠價">
                    <Input value={draft.projectPrice} disabled={disabled} onChange={(event) => onDraft(product.id, { projectPrice: event.target.value })} />
                  </Field>
                </div>
                <Field label="所屬分區">
                  <Select value={productZone[product.id] || ''} onValueChange={(value) => onZone(product.id, value)} disabled={disabled}>
                    <SelectTrigger><SelectValue placeholder="選擇分區" /></SelectTrigger>
                    <SelectContent>
                      {zones.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name || '未命名分區'}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="bg-background" disabled={disabled} onClick={() => {
                    const facts = draftFromProductFacts(product);
                    onDraft(product.id, facts);
                  }}>
                    依產品資料產生初稿
                  </Button>
                  <Button type="button" variant="outline" className="bg-background" disabled={disabled || samplingId === product.id} onClick={() => void generateSample(product)}>
                    {samplingId === product.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {draft.noBackground ? '生成示例圖' : '這張圖沒有背景，生成示例圖'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="bg-background"
                    aria-pressed={draft.noBackground}
                    disabled={disabled}
                    onClick={() => onDraft(product.id, { noBackground: !draft.noBackground })}
                  >
                    {draft.noBackground ? '已標記沒有背景' : '標記為沒有背景'}
                  </Button>
                </div>
                {draft.sampleImageUrl ? <p className="text-xs text-muted-foreground">示例圖僅供參考，不會寫回產品原圖。</p> : null}
              </div>
            );
          })}
        </section>
      ))}

      {products.some((product) => !zones.some((zone) => zone.id === productZone[product.id])) ? (
        <p className="text-sm text-destructive">還有產品未分到分區。請在上方選擇所屬分區，或回到上一步調整。</p>
      ) : null}

      {qualifications.trim() || services.trim() ? (
        <section className="space-y-3 rounded-xl border p-4">
          {qualifications.trim() ? (
            <Field label="公司資質">
              <Textarea className="min-h-20" value={qualifications} disabled={disabled} onChange={(event) => onQualifications(event.target.value)} />
            </Field>
          ) : null}
          {services.trim() ? (
            <Field label="服務介紹">
              <Textarea className="min-h-20" value={services} disabled={disabled} onChange={(event) => onServices(event.target.value)} />
            </Field>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
