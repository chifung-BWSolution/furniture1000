import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  CreditCard, Truck, ShoppingBag, Trash2, Loader2, Lock, MapPin, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchSearchProducts } from '@/lib/solutionsApi';
import type { SearchProduct } from '@/types/solutions';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';

const CART_KEY = 'fds-portal-inquiry-cart';
const CHECKOUT_KEY = 'fds-portal-checkout-draft';

type CartItem = {
  id: string;
  title: string;
  salePrice: number;
  imageUrl?: string;
  qty: number;
};

type CheckoutForm = {
  name: string;
  email: string;
  phone: string;
  address: string;
  district: string;
  note: string;
  payMethod: 'card' | 'fps' | 'transfer';
  shipping: 'standard' | 'express';
};

const DEFAULT_FORM: CheckoutForm = {
  name: '',
  email: '',
  phone: '',
  address: '',
  district: '香港島',
  note: '',
  payMethod: 'card',
  shipping: 'standard',
};

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

function fmtMoney(n: number) {
  return `HK$ ${Math.round(n).toLocaleString()}`;
}

export function CustomerPaymentDeliveryView() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [catalog, setCatalog] = useState<SearchProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<CheckoutForm>(DEFAULT_FORM);
  const [step, setStep] = useState<'cart' | 'shipping' | 'pay' | 'done'>('cart');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const existing = loadCart();
    setCart(existing);
    try {
      const raw = localStorage.getItem(CHECKOUT_KEY);
      if (raw) setForm({ ...DEFAULT_FORM, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }

    fetchSearchProducts(24)
      .then((rows) => {
        setCatalog(rows);
        // Seed demo cart from real products when empty (Shopify-like first visit)
        if (existing.length === 0 && rows.length > 0) {
          const seed = rows.slice(0, 2).map((p) => ({
            id: p.id,
            title: p.title,
            salePrice: p.salePrice,
            imageUrl: p.imageUrl,
            qty: 1,
          }));
          setCart(seed);
          saveCart(seed);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const persistCart = (next: CartItem[]) => {
    setCart(next);
    saveCart(next);
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, c) => sum + c.salePrice * c.qty, 0),
    [cart],
  );
  const shippingFee =
    cart.length === 0 ? 0 : form.shipping === 'express' ? 380 : subtotal >= 12000 ? 0 : 280;
  const total = subtotal + shippingFee;

  const updateForm = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(CHECKOUT_KEY, JSON.stringify(next));
      return next;
    });
  };

  const addFromCatalog = (p: SearchProduct) => {
    const hit = cart.find((c) => c.id === p.id);
    if (hit) {
      persistCart(cart.map((c) => (c.id === p.id ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      persistCart([
        ...cart,
        {
          id: p.id,
          title: p.title,
          salePrice: p.salePrice,
          imageUrl: p.imageUrl,
          qty: 1,
        },
      ]);
    }
    toast.success('已加入購物車', { description: p.title });
  };

  const payNow = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.address.trim()) {
      toast.error('請填寫收件人、電郵與送貨地址');
      setStep('shipping');
      return;
    }
    if (cart.length === 0) {
      toast.error('購物車是空的');
      return;
    }
    setPaying(true);
    await new Promise((r) => setTimeout(r, 900));
    setPaying(false);
    setStep('done');
    persistCart([]);
    toast.success('付款成功（前端示意）', {
      description: `${fmtMoney(total)} · 未寫入 Supabase／未串接真實金流`,
    });
  };

  if (step === 'done') {
    return (
      <PortalPageShell title="付款 + 送貨" badge="Checkout">
        <div className="mx-auto max-w-md rounded-2xl border border-emerald-500/30 bg-card p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h2 className="mt-3 font-display text-xl font-bold">感謝您的訂單</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            已收到付款指示（示意）。PM 會以電郵確認出廠與送貨時間。
          </p>
          <button
            type="button"
            onClick={() => setStep('cart')}
            className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            繼續選購
          </button>
        </div>
      </PortalPageShell>
    );
  }

  return (
    <PortalPageShell
      title="付款 + 送貨"
      badge="Shopify-style"
      subtitle="查看產品後可直接結帳付款（售價可見、成本隱藏）。金流為前端示意，不修改資料庫。"
      maxWidthClass="max-w-6xl"
    >
      {/* Steps */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['cart', '1. 購物車'],
            ['shipping', '2. 送貨資料'],
            ['pay', '3. 付款'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStep(id)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium',
              step === id
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-4">
          {step === 'cart' ? (
            <>
              <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold">
                  <ShoppingBag className="h-4 w-4 text-primary" /> 購物車
                </h2>
                {loading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : cart.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    購物車是空的 — 可從下方產品加入，或先到「產品搜尋」加入查詢車
                  </p>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {cart.map((c) => (
                      <li key={c.id} className="flex items-center gap-3 py-3">
                        <div className="h-14 w-14 overflow-hidden rounded-lg bg-muted">
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{c.title}</p>
                          <p className="font-mono-data text-xs text-primary">
                            {fmtMoney(c.salePrice)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="h-7 w-7 rounded border border-border text-xs"
                            onClick={() =>
                              persistCart(
                                cart
                                  .map((x) =>
                                    x.id === c.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x,
                                  )
                                  .filter((x) => x.qty > 0),
                              )
                            }
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-mono-data text-xs">{c.qty}</span>
                          <button
                            type="button"
                            className="h-7 w-7 rounded border border-border text-xs"
                            onClick={() =>
                              persistCart(
                                cart.map((x) =>
                                  x.id === c.id ? { ...x, qty: x.qty + 1 } : x,
                                ),
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => persistCart(cart.filter((x) => x.id !== c.id))}
                          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <h2 className="mb-3 font-display text-sm font-bold">繼續選購（真實產品目錄）</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {catalog.slice(0, 9).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addFromCatalog(p)}
                      className="overflow-hidden rounded-xl border border-border text-left transition-shadow hover:shadow-md"
                    >
                      <div className="aspect-square bg-muted">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="p-2">
                        <p className="line-clamp-2 text-xs font-medium">{p.title}</p>
                        <p className="mt-1 font-mono-data text-xs font-bold text-primary">
                          {fmtMoney(p.salePrice)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {step === 'shipping' ? (
            <section className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="flex items-center gap-2 font-display text-sm font-bold">
                <MapPin className="h-4 w-4 text-primary" /> 送貨資料
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-1">
                  <span className="mb-1 block text-xs text-muted-foreground">收件人 *</span>
                  <input
                    value={form.name}
                    onChange={(e) => updateForm('name', e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">電郵 *</span>
                  <input
                    value={form.email}
                    onChange={(e) => updateForm('email', e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">電話</span>
                  <input
                    value={form.phone}
                    onChange={(e) => updateForm('phone', e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">地區</span>
                  <select
                    value={form.district}
                    onChange={(e) => updateForm('district', e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option>香港島</option>
                    <option>九龍</option>
                    <option>新界</option>
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs text-muted-foreground">送貨地址 *</span>
                  <textarea
                    value={form.address}
                    onChange={(e) => updateForm('address', e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs text-muted-foreground">備註</span>
                  <input
                    value={form.note}
                    onChange={(e) => updateForm('note', e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder="例如：貨到致電、需預約安裝…"
                  />
                </label>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">送貨方式</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => updateForm('shipping', 'standard')}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left text-sm',
                      form.shipping === 'standard'
                        ? 'border-primary bg-primary/10'
                        : 'border-border',
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Truck className="h-4 w-4" /> 標準送貨安裝
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {subtotal >= 12000 ? '滿 HK$12,000 免費' : 'HK$ 280'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm('shipping', 'express')}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left text-sm',
                      form.shipping === 'express'
                        ? 'border-primary bg-primary/10'
                        : 'border-border',
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Truck className="h-4 w-4" /> 加急送貨
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">HK$ 380</span>
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {step === 'pay' ? (
            <section className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="flex items-center gap-2 font-display text-sm font-bold">
                <CreditCard className="h-4 w-4 text-primary" /> 付款方式
              </h2>
              <div className="grid gap-2">
                {(
                  [
                    ['card', '信用卡／Debit（示意）'],
                    ['fps', '轉數快 FPS'],
                    ['transfer', '銀行轉帳'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => updateForm('payMethod', id)}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left text-sm',
                      form.payMethod === id
                        ? 'border-primary bg-primary/10'
                        : 'border-border',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {form.payMethod === 'card' ? (
                <div className="grid gap-2 rounded-xl bg-muted/30 p-3 sm:grid-cols-2">
                  <input
                    placeholder="卡號 4242 4242 4242 4242"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
                  />
                  <input
                    placeholder="MM / YY"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="CVC"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              ) : (
                <div className="rounded-xl bg-muted/30 p-3 font-mono-data text-xs leading-relaxed">
                  Account Name: Branding Works Design Ltd
                  <br />
                  HSBC · 747-058683-001
                  <br />
                  請於轉帳備註填寫您的電郵
                </div>
              )}
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> 示意結帳頁 — 未串接真實支付閘道
              </p>
            </section>
          ) : null}
        </div>

        {/* Order summary sticky */}
        <aside className="h-fit rounded-2xl border border-border bg-card p-5 shadow-sm lg:sticky lg:top-4">
          <h2 className="font-display text-sm font-bold">訂單摘要</h2>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">商品小計</span>
              <span className="font-mono-data">{fmtMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">送貨</span>
              <span className="font-mono-data">
                {shippingFee === 0 ? '免費' : fmtMoney(shippingFee)}
              </span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <span>合計</span>
              <span className="font-mono-data text-primary">{fmtMoney(total)}</span>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {step === 'cart' ? (
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => setStep('shipping')}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                前往結帳
              </button>
            ) : null}
            {step === 'shipping' ? (
              <button
                type="button"
                onClick={() => setStep('pay')}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                繼續付款
              </button>
            ) : null}
            {step === 'pay' ? (
              <button
                type="button"
                disabled={paying}
                onClick={() => void payNow()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                立即付款 {fmtMoney(total)}
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </PortalPageShell>
  );
}
