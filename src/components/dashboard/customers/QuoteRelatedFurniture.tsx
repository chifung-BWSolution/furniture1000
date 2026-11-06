import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightLeft,
  Check,
  Loader2,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { productThumbUrl } from '@/lib/imageThumb';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal, ModalButton } from '@/components/ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchActiveShopifyProducts } from '@/lib/solutionsApi';
import type { SearchProduct } from '@/types/solutions';
import {
  QUOTE_SCENARIOS,
  categoryOptionsFromProducts,
  productScenarioMatches,
  rankProductsForScenarios,
  resolveQuoteScenarios,
  type QuoteScenarioCode,
} from '@/lib/quoteScenarios';
import {
  customerQuoteError,
  submitCustomerQuoteChanges,
  type CustomerQuoteRequestLine,
} from '@/lib/customerQuoteAccess';
import { withCustomerPortalQuery } from '@/lib/customerPortalRoutes';

/**
 * 報價頁「相關家具」「查看其他 A 類家具」「加選」「更換款式」。
 *
 * - 一律讀客戶目錄（Shopify 已上架、有售價）的公開資料，不讀內部圖冊或成本。
 * - 提交只建立這張報價的待處理請求；正式報價明細與總額在 PM 處理前不變。
 */

export interface QuoteOriginalItem {
  id: string;
  name: string;
  unit?: string;
  unitPrice: number;
  quantity: number;
}

type AdditionDraft = { productId: string; quantity: number };
type ReplacementDraft = {
  originalItemId: string;
  productId: string;
  quantity: number;
};

const RELATED_LIMIT = 12;
const BROWSE_LIMIT = 24;

function fmtMoney(value: number) {
  return `$${Math.round(Number(value) || 0).toLocaleString()}`;
}

/**
 * 客戶目錄多數商品圖是 Shopify CDN 原圖（可達 1MB+）。
 * 目錄頁只要 small thumb：Shopify 支援 `?width=`，Storage 用固定縮圖。
 */
function catalogThumbUrl(url: string | null | undefined, width = 400): string {
  const src = (url || '').trim();
  if (!src) return src;
  if (src.includes('cdn.shopify.com')) {
    try {
      const parsed = new URL(src);
      parsed.searchParams.set('width', String(width));
      return parsed.toString();
    } catch {
      return src;
    }
  }
  return productThumbUrl(src, 640);
}

function categoryLabel(product: SearchProduct) {
  const parts = [product.level1Category, product.level2Category].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : product.category || '';
}

function QuantityStepper({
  value,
  min = 1,
  max = 9999,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border bg-background">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-35"
        aria-label={`${label}數量減一`}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const next = Math.floor(Number(event.target.value) || 0);
          onChange(Math.min(max, Math.max(min, next)));
        }}
        className="h-7 w-10 border-x border-border bg-background text-center font-mono-data text-[13px] font-semibold outline-none"
        aria-label={`${label}數量`}
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-35"
        aria-label={`${label}數量加一`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function QuoteRelatedFurniture({
  token,
  quoteUuid,
  quoteVersion,
  projectData,
  engineeringType,
  originalItems,
  onSubmitted,
  onDraftChange,
}: {
  token: string | null;
  quoteUuid: string;
  quoteVersion: string;
  projectData: Record<string, unknown> | null | undefined;
  /** 客戶對應設計專案的工程類型（design_projects.meta.projectType）。 */
  engineeringType?: string | null;
  originalItems: QuoteOriginalItem[];
  onSubmitted?: (requestId: string | null) => void;
  /** 讓上層的「確認報價」區域知道仍有未提交的加選／換款。 */
  onDraftChange?: (hasDraft: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<SearchProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  // 工程類型是推薦來源；客戶仍可在頁面上調整用途 chips。
  const derivedScenarios = useMemo(
    () => resolveQuoteScenarios(projectData, engineeringType),
    [projectData, engineeringType],
  );
  const [scenarios, setScenarios] = useState<QuoteScenarioCode[]>(derivedScenarios);
  const scenariosTouchedRef = useRef(false);
  useEffect(() => {
    // 專案資料可能比報價晚載入；客戶未手動調整前，跟隨工程類型更新。
    if (!scenariosTouchedRef.current) setScenarios(derivedScenarios);
  }, [derivedScenarios]);
  const [showAll, setShowAll] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [level1, setLevel1] = useState('');
  const [level2, setLevel2] = useState('');
  const [browseCount, setBrowseCount] = useState(BROWSE_LIMIT);
  const [additions, setAdditions] = useState<AdditionDraft[]>([]);
  const [replacements, setReplacements] = useState<ReplacementDraft[]>([]);
  const [replaceTarget, setReplaceTarget] = useState<QuoteOriginalItem | null>(null);
  const [replaceKeyword, setReplaceKeyword] = useState('');
  const [replaceLevel1, setReplaceLevel1] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hasDraft = additions.length > 0 || replacements.length > 0;
  useEffect(() => {
    onDraftChange?.(hasDraft);
  }, [hasDraft, onDraftChange]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void fetchActiveShopifyProducts(600)
      .then((rows) => {
        if (!cancelled) {
          setCatalog(rows.filter((row) => row.isOnShopify && row.salePrice > 0));
        }
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => categoryOptionsFromProducts(catalog), [catalog]);

  const related = useMemo(() => {
    if (scenarios.length === 0) return catalog;
    const matched = catalog.filter(
      (product) => productScenarioMatches(product, scenarios).length > 0,
    );
    // 沒有相符商品時回退正常 A 類目錄，客戶仍可瀏覽其他分類。
    return rankProductsForScenarios(matched.length > 0 ? matched : catalog, scenarios);
  }, [catalog, scenarios]);

  const browse = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const rows = catalog.filter((product) => {
      if (level1 && product.level1Category !== level1) return false;
      if (level2 && product.level2Category !== level2) return false;
      if (!q) return true;
      const hay = [
        product.title,
        product.description,
        product.material,
        product.level1Category,
        product.level2Category,
        ...(product.tags ?? []),
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
    return rankProductsForScenarios(rows, scenarios);
  }, [catalog, keyword, level1, level2, scenarios]);

  const productById = useMemo(() => {
    const map = new Map<string, SearchProduct>();
    for (const product of catalog) map.set(product.id, product);
    return map;
  }, [catalog]);

  const toggleScenario = (code: QuoteScenarioCode) => {
    scenariosTouchedRef.current = true;
    setScenarios((current) =>
      current.includes(code) ? current.filter((row) => row !== code) : [...current, code],
    );
    setBrowseCount(BROWSE_LIMIT);
  };

  const additionsById = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of additions) map.set(row.productId, row.quantity);
    return map;
  }, [additions]);

  const addProduct = useCallback(
    (product: SearchProduct, quantity = 1) => {
      const qty = Math.max(1, Math.floor(Number(quantity) || 1));
      setAdditions((current) => {
        const existing = current.find((row) => row.productId === product.id);
        if (existing) {
          return current.map((row) =>
            row.productId === product.id ? { ...row, quantity: row.quantity + qty } : row,
          );
        }
        return [...current, { productId: product.id, quantity: qty }];
      });
      toast.success('已加入加選清單', {
        description: `${product.title} × ${qty}`,
      });
    },
    [],
  );

  const changeAdditionQuantity = (productId: string, quantity: number) => {
    setAdditions((current) =>
      current.map((row) =>
        row.productId === productId
          ? { ...row, quantity: Math.max(1, Math.floor(quantity)) }
          : row,
      ),
    );
  };

  const removeAddition = (productId: string) => {
    setAdditions((current) => current.filter((row) => row.productId !== productId));
  };

  const removeReplacement = (originalItemId: string) => {
    setReplacements((current) =>
      current.filter((row) => row.originalItemId !== originalItemId),
    );
  };

  const pickReplacement = (product: SearchProduct) => {
    if (!replaceTarget) return;
    setReplacements((current) => {
      const next = current.filter((row) => row.originalItemId !== replaceTarget.id);
      next.push({
        originalItemId: replaceTarget.id,
        productId: product.id,
        quantity: Math.max(1, Math.floor(Number(replaceTarget.quantity) || 1)),
      });
      return next;
    });
    toast.success('已加入換款清單', {
      description: `${replaceTarget.name} → ${product.title}`,
    });
    setReplaceTarget(null);
    setReplaceKeyword('');
    setReplaceLevel1('');
  };

  const replacementProducts = useMemo(() => {
    const q = replaceKeyword.trim().toLowerCase();
    const rows = catalog.filter((product) => {
      if (replaceLevel1 && product.level1Category !== replaceLevel1) return false;
      if (!q) return true;
      const hay = [
        product.title,
        product.material,
        product.level1Category,
        product.level2Category,
        ...(product.tags ?? []),
      ]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
    return rankProductsForScenarios(rows, scenarios);
  }, [catalog, replaceKeyword, replaceLevel1, scenarios]);

  const draftLines: CustomerQuoteRequestLine[] = [
    ...additions.map((row) => ({
      id: row.productId,
      productId: row.productId,
      kind: 'addition' as const,
      quantity: row.quantity,
      selected: true,
    })),
    ...replacements.map((row) => ({
      id: row.productId,
      productId: row.productId,
      originalItemId: row.originalItemId,
      kind: 'replacement' as const,
      quantity: row.quantity,
      selected: true,
    })),
  ];

  const draftTotal = useMemo(
    () =>
      draftLines.reduce((sum, line) => {
        const product = productById.get(line.productId || '');
        return sum + (Number(product?.salePrice) || 0) * (Number(line.quantity) || 0);
      }, 0),
    [draftLines, productById],
  );

  const submitChanges = async () => {
    if (draftLines.length === 0) return;
    setSubmitting(true);
    try {
      const requestId = await submitCustomerQuoteChanges({
        token,
        quoteId: quoteUuid,
        quoteVersion,
        note,
        additions: additions.map((row) => ({ ...row })),
        replacements: replacements.map((row) => ({ ...row })),
      });
      toast.success('已提交變更', {
        description:
          '負責同事會看到加選與換款內容；正式報價明細與總額在你提交後仍維持不變，直到同事處理。',
      });
      setAdditions([]);
      setReplacements([]);
      setNote('');
      onSubmitted?.(requestId);
    } catch (error) {
      toast.error('提交變更沒有完成', {
        description: customerQuoteError(error as { code?: string; message?: string } | null),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const visibleRelated = showAll ? browse.slice(0, browseCount) : related.slice(0, RELATED_LIMIT);

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold">相關家具</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            按客戶項目的工程類型優先顯示；你可以加入加選清單，或由下方原報價項目挑選替代款式。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowAll((current) => !current);
            setBrowseCount(BROWSE_LIMIT);
          }}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <ShoppingBag className="h-4 w-4" />
          {showAll ? '只看相關家具' : '查看其他 A 類家具'}
        </button>
        <Link
          to={withCustomerPortalQuery('/customer/product-search', {
            quoteShareToken: token,
          })}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          產品搜尋
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          推薦用途
        </span>
        {QUOTE_SCENARIOS.map((scenario) => {
          const active = scenarios.includes(scenario.code);
          return (
            <button
              key={scenario.code}
              type="button"
              aria-pressed={active}
              onClick={() => toggleScenario(scenario.code)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              {scenario.label}
            </button>
          );
        })}
        {scenarios.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              scenariosTouchedRef.current = true;
              setScenarios([]);
            }}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            清除用途
          </button>
        ) : null}
      </div>

      {showAll ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_11rem_11rem]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setBrowseCount(BROWSE_LIMIT);
              }}
              placeholder="關鍵字（名稱、材質、分類）"
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm"
              aria-label="搜尋家具"
            />
          </label>
          <Select
            value={level1 || '__all__'}
            onValueChange={(value) => {
              setLevel1(value === '__all__' ? '' : value);
              setLevel2('');
              setBrowseCount(BROWSE_LIMIT);
            }}
          >
            <SelectTrigger className="h-10" aria-label="一級分類">
              <SelectValue placeholder="一級分類" />
            </SelectTrigger>
            <SelectContent className="z-[300]">
              <SelectItem value="__all__">全部分類</SelectItem>
              {categories.level1.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={level2 || '__all__'}
            onValueChange={(value) => {
              setLevel2(value === '__all__' ? '' : value);
              setBrowseCount(BROWSE_LIMIT);
            }}
            disabled={!level1}
          >
            <SelectTrigger className="h-10" aria-label="二級分類">
              <SelectValue placeholder="二級分類" />
            </SelectTrigger>
            <SelectContent className="z-[300]">
              <SelectItem value="__all__">全部二級分類</SelectItem>
              {(categories.level2[level1] ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {catalogLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : visibleRelated.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          暫無符合用途的家具，你仍可按「查看其他 A 類家具」瀏覽全部分類。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleRelated.map((product) => {
            const inDraft = additionsById.get(product.id) ?? 0;
            return (
              <article
                key={product.id}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="aspect-[4/3] bg-muted">
                  {product.imageUrl ? (
                    <LoadingImage
                      src={catalogThumbUrl(product.imageUrl)}
                      alt={product.title}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      無圖片
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  {categoryLabel(product) ? (
                    <p className="font-body text-[11px] text-muted-foreground">
                      {categoryLabel(product)}
                    </p>
                  ) : null}
                  <h3 className="line-clamp-2 font-display text-[15px] font-semibold">
                    {product.title}
                  </h3>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                    <p className="font-mono-data text-base font-bold text-primary">
                      {fmtMoney(product.salePrice)}
                    </p>
                    <button
                      type="button"
                      onClick={() => addProduct(product, 1)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
                    >
                      {inDraft > 0 ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {inDraft > 0 ? `已加 ${inDraft}` : '加選'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showAll && browse.length > visibleRelated.length && visibleRelated.length > 0 ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setBrowseCount((current) => current + BROWSE_LIMIT)}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            顯示更多家具
          </button>
        </div>
      ) : null}

      {originalItems.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-border/80 bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-display text-sm font-bold">更換現有款式</h3>
            <span className="text-xs text-muted-foreground">
              選擇替代商品後，負責同事會同時看到原項目與替代品。
            </span>
          </div>
          <ul className="divide-y divide-border/70">
            {originalItems.map((item) => {
              const replacement = replacements.find((row) => row.originalItemId === item.id);
              const replacementProduct = replacement
                ? productById.get(replacement.productId)
                : null;
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="font-mono-data text-xs text-muted-foreground">
                      {fmtMoney(item.unitPrice)} × {item.quantity}
                      {item.unit ? ` ${item.unit}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {replacementProduct ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        改為 {replacementProduct.title}
                        <button
                          type="button"
                          onClick={() => removeReplacement(item.id)}
                          className="ml-1 text-emerald-700/70 hover:text-emerald-800"
                          aria-label={`移除 ${item.name} 的換款`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setReplaceTarget(item);
                          setReplaceKeyword('');
                          setReplaceLevel1('');
                        }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        更換款式
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {additions.length > 0 || replacements.length > 0 ? (
        <div className="space-y-3 rounded-xl border border-sky-500/30 bg-sky-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold text-sky-900">準備提交的變更</h3>
            <span className="font-mono-data text-xs text-sky-900/80">
              參考合計 {fmtMoney(draftTotal)}（未計入正式報價）
            </span>
          </div>
          <ul className="space-y-2">
            {additions.map((row) => {
              const product = productById.get(row.productId);
              if (!product) return null;
              return (
                <li
                  key={`add-${row.productId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <span className="mr-1.5 rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        加選
                      </span>
                      {product.title}
                    </p>
                    <p className="font-mono-data text-xs text-muted-foreground">
                      {fmtMoney(product.salePrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <QuantityStepper
                      value={row.quantity}
                      onChange={(next) => changeAdditionQuantity(row.productId, next)}
                      label={product.title}
                    />
                    <button
                      type="button"
                      onClick={() => removeAddition(row.productId)}
                      className="text-muted-foreground hover:text-rose-600"
                      aria-label={`移除加選 ${product.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
            {replacements.map((row) => {
              const product = productById.get(row.productId);
              const original = originalItems.find((item) => item.id === row.originalItemId);
              if (!product) return null;
              return (
                <li
                  key={`repl-${row.originalItemId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <span className="mr-1.5 rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        換款
                      </span>
                      {original?.name || '原報價項目'} → {product.title}
                    </p>
                    <p className="font-mono-data text-xs text-muted-foreground">
                      {fmtMoney(product.salePrice)} × {row.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <QuantityStepper
                      value={row.quantity}
                      onChange={(next) =>
                        setReplacements((current) =>
                          current.map((entry) =>
                            entry.originalItemId === row.originalItemId
                              ? { ...entry, quantity: Math.max(1, Math.floor(next)) }
                              : entry,
                          ),
                        )
                      }
                      label={product.title}
                    />
                    <button
                      type="button"
                      onClick={() => removeReplacement(row.originalItemId)}
                      className="text-muted-foreground hover:text-rose-600"
                      aria-label="移除換款"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="變更備註（例如顏色、尺寸或交期考慮）"
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-sky-900/80">
              提交後只會建立待處理請求，正式報價明細與總額不會即時改變。
            </p>
            <button
              type="button"
              onClick={() => void submitChanges()}
              disabled={submitting}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              提交變更
            </button>
          </div>
        </div>
      ) : null}

      <Modal
        open={Boolean(replaceTarget)}
        onOpenChange={(open) => {
          if (!open) setReplaceTarget(null);
        }}
        size="4xl"
        icon={<ArrowRightLeft className="h-6 w-6" />}
        title="選擇替代款式"
        description={
          replaceTarget
            ? `原項目：${replaceTarget.name}（${fmtMoney(replaceTarget.unitPrice)} × ${replaceTarget.quantity}）`
            : undefined
        }
        footer={
          <ModalButton variant="secondary" onClick={() => setReplaceTarget(null)}>
            取消
          </ModalButton>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={replaceKeyword}
                onChange={(event) => setReplaceKeyword(event.target.value)}
                placeholder="搜尋替代家具"
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm"
                aria-label="搜尋替代家具"
              />
            </label>
            <Select
              value={replaceLevel1 || '__all__'}
              onValueChange={(value) => setReplaceLevel1(value === '__all__' ? '' : value)}
            >
              <SelectTrigger className="h-10" aria-label="替代家具分類">
                <SelectValue placeholder="全部分類" />
              </SelectTrigger>
              <SelectContent className="z-[300]">
                <SelectItem value="__all__">全部分類</SelectItem>
                {categories.level1.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {replacementProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              找不到符合條件的家具，請調整關鍵字或分類。
            </p>
          ) : (
            <div className="grid max-h-[55vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {replacementProducts.slice(0, 48).map((product) => (
                <article
                  key={product.id}
                  className="flex gap-3 rounded-xl border border-border bg-card p-2.5"
                >
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {product.imageUrl ? (
                      <LoadingImage
                        src={catalogThumbUrl(product.imageUrl)}
                        alt={product.title}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h4 className="line-clamp-2 text-sm font-semibold">{product.title}</h4>
                    <p className="font-mono-data text-xs text-muted-foreground">
                      {categoryLabel(product) || '—'}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <span className="font-mono-data text-sm font-bold text-primary">
                        {fmtMoney(product.salePrice)}
                      </span>
                      <button
                        type="button"
                        onClick={() => pickReplacement(product)}
                        className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                      >
                        選擇
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </section>
  );
}
