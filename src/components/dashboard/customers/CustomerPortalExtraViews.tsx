import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Upload, Send, CreditCard, PackageCheck, PenLine, Film, Briefcase,
  Phone, Landmark, UserPlus, CheckCircle2, Clock, MapPin, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';
import { readPortalContentDraft } from '@/components/dashboard/solutions/SolutionPortalContentView';
import { fetchSearchProducts } from '@/lib/solutionsApi';
import type { SearchProduct } from '@/types/solutions';

const CUSTOM_STORAGE = 'fds-portal-custom-requests';
const ORG_STORAGE = 'fds-portal-org-accounts';

export function CustomerCustomFurnitureView() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [req, setReq] = useState({ title: '', description: '', qty: '1', budget: '' });
  const [list, setList] = useState<Array<typeof req & { id: string; at: string; image?: string }>>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_STORAGE);
      if (raw) setList(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const submit = () => {
    if (!req.title.trim() || !req.description.trim()) {
      toast.error('請填寫標題與要求說明');
      return;
    }
    const row = {
      ...req,
      id: `cf-${Date.now()}`,
      at: new Date().toISOString(),
      image: imagePreview || undefined,
    };
    const next = [row, ...list].slice(0, 20);
    setList(next);
    localStorage.setItem(CUSTOM_STORAGE, JSON.stringify(next));
    toast.success('已送出訂製查詢', { description: '前端暫存（未寫入資料庫）' });
    setReq({ title: '', description: '', qty: '1', budget: '' });
    setImagePreview(null);
  };

  return (
    <PortalPageShell
      title="傢俬訂製"
      badge="Client Portal"
      subtitle="上載參考圖片並寫出要求，我們會跟進報價。此頁僅前端暫存，不寫入 Supabase。"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">需求標題</span>
            <input
              value={req.title}
              onChange={(e) => setReq((r) => ({ ...r, title: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="例如：訂製接待櫃連品牌燈箱"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">詳細要求</span>
            <textarea
              value={req.description}
              onChange={(e) => setReq((r) => ({ ...r, description: e.target.value }))}
              rows={5}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="尺寸、材質、顏色、交期、安裝環境…"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">數量</span>
              <input
                value={req.qty}
                onChange={(e) => setReq((r) => ({ ...r, qty: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">預算（選填）</span>
              <input
                value={req.budget}
                onChange={(e) => setReq((r) => ({ ...r, budget: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="HK$"
              />
            </label>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">參考圖片</span>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 hover:border-primary/40">
              {imagePreview ? (
                <img src={imagePreview} alt="" className="max-h-40 rounded-lg object-contain" />
              ) : (
                <>
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">上載 JPG / PNG</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => setImagePreview(String(reader.result || ''));
                  reader.readAsDataURL(f);
                }}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={submit}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Send className="h-4 w-4" /> 送出查詢
          </button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-display text-sm font-bold">已送出查詢</h2>
          <div className="mt-3 space-y-2">
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚未有訂製查詢</p>
            ) : (
              list.map((item) => (
                <div key={item.id} className="rounded-xl border border-border/80 px-3 py-2.5">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </PortalPageShell>
  );
}

export { CustomerPaymentDeliveryView } from '@/components/dashboard/customers/CustomerPaymentDeliveryView';

export function CustomerOrderStatusView() {
  const [signed, setSigned] = useState(false);
  const [paymentNote, setPaymentNote] = useState('');
  const [installDate, setInstallDate] = useState('');

  const steps = [
    { id: 1, label: '確認訂單', done: true },
    { id: 2, label: '網上簽署', done: signed },
    { id: 3, label: '上載付款資料', done: Boolean(paymentNote.trim()) },
    { id: 4, label: '出廠／到港', done: false },
    { id: 5, label: '安裝時間', done: Boolean(installDate) },
  ];

  return (
    <PortalPageShell
      title="訂單狀況"
      badge="Client Portal"
      subtitle="確認訂單、電子簽署、上載付款資料，並協調出廠／到港與安裝時間。"
    >
      <div className="flex flex-wrap gap-2">
        {steps.map((s) => (
          <div
            key={s.id}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs',
              s.done
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-border text-muted-foreground',
            )}
          >
            {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
            {s.label}
          </div>
        ))}
      </div>

      <div className="mt-2 grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <PenLine className="h-4 w-4 text-primary" /> 網上簽署
          </h2>
          <p className="text-xs text-muted-foreground">確認接受報價條款與交付安排（示意）。</p>
          <button
            type="button"
            onClick={() => {
              setSigned(true);
              toast.success('已完成網上簽署（前端示意）');
            }}
            className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"
          >
            {signed ? '已簽署' : '簽署確認'}
          </button>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <CreditCard className="h-4 w-4 text-primary" /> 付款資料
          </h2>
          <textarea
            value={paymentNote}
            onChange={(e) => setPaymentNote(e.target.value)}
            rows={4}
            placeholder="轉帳日期、金額、參考編號…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <PackageCheck className="h-4 w-4 text-primary" /> 安裝時間
          </h2>
          <input
            type="date"
            value={installDate}
            onChange={(e) => setInstallDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3" /> 送貨地址以報價條款為準
          </p>
        </section>
      </div>
    </PortalPageShell>
  );
}

export function CustomerCaseStudiesView() {
  const content = readPortalContentDraft();
  const [products, setProducts] = useState<SearchProduct[]>([]);

  useEffect(() => {
    fetchSearchProducts(8).then(setProducts).catch(() => setProducts([]));
  }, []);

  const logos = useMemo(
    () =>
      (content.clients || '')
        .split(/[·,，、]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 12),
    [content.clients],
  );

  return (
    <PortalPageShell
      title="成功案例"
      badge="Client Portal"
      subtitle="客戶分類 Logo 牆 + 影片頻道，並以真實產品圖豐富視覺（唯讀展示）。"
    >
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-display text-sm font-bold">客戶 Logo 牆</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {logos.map((name) => (
            <span
              key={name}
              className="rounded-full border border-border bg-muted/40 px-3 py-1.5 font-body text-xs"
            >
              {name}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-bold">
          <Film className="h-4 w-4 text-primary" /> YouTube 頻道
        </h2>
        <a
          href={content.youtubeUrl || '#'}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {content.youtubeUrl || '尚未設定'} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </section>

      <section>
        <h2 className="mb-3 font-display text-sm font-bold">精選產品視覺</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {products.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="aspect-square bg-muted/30">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.title} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <p className="truncate px-2 py-2 text-xs">{p.title}</p>
            </div>
          ))}
        </div>
      </section>
    </PortalPageShell>
  );
}

export function CustomerServicesView() {
  const services = [
    { title: '傢俬訂購', desc: '現貨／訂製傢俬選品、報價、送貨安裝一站式。' },
    { title: '辦公室設計工程', desc: '平面規劃、分區方案、效果圖與施工配合。' },
    { title: '社區／機構工程', desc: '學校、醫院、社福空間傢俬與工程協調。' },
    { title: 'Client Portal 協作', desc: '專屬連結查看報價、提出修改、共同確認。' },
  ];
  return (
    <PortalPageShell title="服務一覽" badge="Client Portal" subtitle="我們提供的核心服務範疇。">
      <div className="grid gap-3 md:grid-cols-2">
        {services.map((s) => (
          <div key={s.title} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold">
              <Briefcase className="h-4 w-4 text-primary" /> {s.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
          </div>
        ))}
      </div>
    </PortalPageShell>
  );
}

export function CustomerContactView() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  return (
    <PortalPageShell title="聯絡我們" badge="Client Portal" subtitle="留下訊息，PM／設計師會盡快回覆。">
      <section className="mx-auto max-w-xl space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">姓名</span>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">電郵</span>
          <input
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">訊息</span>
          <textarea
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            toast.success('已送出訊息（前端示意）');
            setForm({ name: '', email: '', message: '' });
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <Phone className="h-4 w-4" /> 送出
        </button>
      </section>
    </PortalPageShell>
  );
}

type OrgUser = { id: string; email: string; role: 'super_admin' | 'approver' | 'viewer' };

export function CustomerOrgAccountView() {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgUser['role']>('viewer');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORG_STORAGE);
      if (raw) setUsers(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: OrgUser[]) => {
    setUsers(next);
    localStorage.setItem(ORG_STORAGE, JSON.stringify(next));
  };

  return (
    <PortalPageShell
      title="建立機構採購帳號"
      badge="Client Portal"
      subtitle="多用戶電郵認證示意：Client Super Admin 可瀏覽及批核所有成員報價單。"
    >
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1">
            <span className="mb-1 block text-xs text-muted-foreground">成員電郵</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted-foreground">角色</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrgUser['role'])}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="super_admin">Client Super Admin</option>
              <option value="approver">Approver 批核</option>
              <option value="viewer">Viewer 唯讀</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              if (!email.trim() || !email.includes('@')) {
                toast.error('請輸入有效電郵');
                return;
              }
              persist([
                { id: `u-${Date.now()}`, email: email.trim(), role },
                ...users,
              ]);
              setEmail('');
              toast.success('已新增成員（前端暫存）');
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            <UserPlus className="h-4 w-4" /> 邀請
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚未建立成員</p>
          ) : (
            users.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-primary" />
                  <span className="text-sm">{u.email}</span>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                  {u.role}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </PortalPageShell>
  );
}
