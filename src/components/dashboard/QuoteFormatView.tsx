import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DEFAULT_QUOTE_FORMAT,
  loadQuoteFormatSettings,
  saveQuoteFormatSettings,
  type QuoteFormatSettings,
  type ZoneSubtotalPlacement,
} from '@/lib/quoteFormatSettings';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const PLACEMENT_OPTIONS: { value: ZoneSubtotalPlacement; label: string }[] = [
  { value: 'section_and_summary', label: '每分區段落結尾，並在頁尾列出總表' },
  { value: 'summary_only', label: '只在頁尾列出總表' },
  { value: 'hidden', label: '不顯示分區小計' },
];

export function QuoteFormatView() {
  const [settings, setSettings] = useState<QuoteFormatSettings>(DEFAULT_QUOTE_FORMAT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missingTable, setMissingTable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadQuoteFormatSettings().then((result) => {
      if (cancelled) return;
      setSettings(result.settings);
      setMissingTable(result.missingTable);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    const result = await saveQuoteFormatSettings(settings);
    setSaving(false);
    if (result.missingTable) {
      setMissingTable(true);
      toast.error(result.error || '格式設定還沒準備好，暫時不能儲存');
      return;
    }
    if (!result.ok) {
      toast.error(result.error || '儲存失敗');
      return;
    }
    toast.success('已更新報價單格式');
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-none space-y-4 fds-page-padding">
        <section className="fds-page-header">
          <h1 className="fds-page-title">
            <FileText className="h-5 w-5 text-primary" />
            報價單格式設定
          </h1>
          <p className="fds-page-description">
            全公司共用一組格式。QR 文案、修訂日期和分區小計會用在報價單 PDF 與客戶連結。
          </p>
        </section>

        {loading && <p className="px-2 text-sm text-muted-foreground">讀取格式設定…</p>}
        {error && (
          <section className="rounded-2xl border border-destructive/30 bg-card p-4 text-sm text-destructive shadow-sm">
            {error}
          </section>
        )}
        {missingTable && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            格式設定還沒準備好，暫時不能儲存。畫面顯示的是預設內容。請聯絡管理員。
          </section>
        )}

        {!loading && (
          <section className="space-y-5 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:p-6">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">QR Code 文案</span>
              <input
                value={settings.qrCaption}
                onChange={(event) => setSettings((prev) => ({ ...prev, qrCaption: event.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
              />
            </label>

            <div className="space-y-2">
              <p className="text-sm font-medium">日期</p>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="quote-format-show-revision-date"
                  checked={settings.showRevisionDate}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, showRevisionDate: checked === true }))
                  }
                />
                <label htmlFor="quote-format-show-revision-date" className="cursor-pointer">
                  顯示修訂日期（此版本建立日）
                </label>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="quote-format-show-latest-modified"
                  checked={settings.showLatestModifiedDate}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, showLatestModifiedDate: checked === true }))
                  }
                />
                <label htmlFor="quote-format-show-latest-modified" className="cursor-pointer">
                  顯示最新修改日期
                </label>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">分區小計</legend>
              <RadioGroup
                value={settings.zoneSubtotalPlacement}
                onValueChange={(value) =>
                  setSettings((prev) => ({ ...prev, zoneSubtotalPlacement: value as typeof prev.zoneSubtotalPlacement }))
                }
              >
                {PLACEMENT_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center gap-2 text-sm">
                    <RadioGroupItem id={`zone-subtotal-${option.value}`} value={option.value} />
                    <label htmlFor={`zone-subtotal-${option.value}`} className="cursor-pointer">
                      {option.label}
                    </label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">預覽</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div className="space-y-1 text-sm">
                  <p>日期：2026/10/21</p>
                  {settings.showRevisionDate && <p>修訂日期：2026/10/18</p>}
                  {settings.showLatestModifiedDate && <p>最新修改日期：2026/10/21</p>}
                  {settings.zoneSubtotalPlacement !== 'hidden' && (
                    <p className="pt-2 text-muted-foreground">
                      A 區小計 HK$15,000
                      {settings.zoneSubtotalPlacement === 'section_and_summary' ? '（段尾 + 頁尾總表）' : '（頁尾總表）'}
                    </p>
                  )}
                </div>
                <div className="text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-md border border-border bg-background text-[10px] text-muted-foreground">
                    QR
                  </div>
                  <p className="mt-1 max-w-[8rem] text-xs font-medium">{settings.qrCaption || DEFAULT_QUOTE_FORMAT.qrCaption}</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || missingTable}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              儲存格式
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
