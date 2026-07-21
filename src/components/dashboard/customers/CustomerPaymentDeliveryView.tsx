import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  CreditCard, Truck, ShoppingBag, Trash2, Loader2, Lock, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchActiveShopifyProducts } from '@/lib/solutionsApi';
import type { SearchProduct } from '@/types/solutions';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';

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

function fmtMoney(n: number) {
  return `HK$ ${Math.round(n).toLocaleString()}`;
}

export function CustomerPaymentDeliveryView() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [catalog, setCatalog] = useState<SearchProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<CheckoutForm>(DEFAULT_FORM);
  const [step, setStep] = useState<'cart' | 'shipping' | 'pay'>('cart');

  useEffect(() => {
    fetchActiveShopifyProducts(24)
      .then((rows) => {
        setCatalog(rows);
      })
      .finally(() => setLoading(false));
  }, []);

  const updateCart = (next: CartItem[]) => {
    setCart(next);
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, c) => sum + c.salePrice * c.qty, 0),
    [cart],
  );
  const shippingFee =
    cart.length === 0 ? 0 : form.shipping === 'express' ? 380 : subtotal >= 12000 ? 0 : 280;
  const total = subtotal + shippingFee;

  const updateForm = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const addFromCatalog = (p: SearchProduct) => {
    const hit = cart.find((c) => c.id === p.id);
    if (hit) {
      updateCart(cart.map((c) => (c.id === p.id ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      updateCart([
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
    toast.error('尚未能進行付款', {
      description: 'Supabase 暫無真實訂單／付款紀錄，未有支付閘道時不會模擬付款成功。',
    });
  };

  return (
    <PortalPageShell
      title="付款 + 送貨"
      badge="Shopify A類"
      subtitle="唯讀載入 Supabase shopify_products 中目前 active 的 A類產品、圖片及現時售價；此頁不儲存購物車或結帳資料。"
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
                    購物車是空的 — 可從下方目前已上 Shopify 的 A類產品加入
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
                              updateCart(
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
                              updateCart(
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
                          onClick={() => updateCart(cart.filter((x) => x.id !== c.id))}
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
                <h2 className="mb-3 font-display text-sm font-bold">
                  Shopify A類產品（目前 active）
                </h2>
                {!loading && catalog.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    Supabase 暫無目前 active 的 Shopify A類產品
                  </p>
                ) : (
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
                        <span className="mb-1 inline-flex rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          A類 · Shopify
                        </span>
                        <p className="line-clamp-2 text-xs font-medium">{p.title}</p>
                        <p className="mt-1 font-mono-data text-xs font-bold text-primary">
                          {fmtMoney(p.salePrice)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                )}
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
                    ['card', '信用卡／Debit'],
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
                  Supabase 暫無此訂單的轉帳收款資料。
                </div>
              )}
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> 尚未串接真實支付閘道，不會建立付款紀錄
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
                disabled
                onClick={() => void payNow()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <Lock className="h-4 w-4" />
                尚未接通付款
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </PortalPageShell>
  );
}
