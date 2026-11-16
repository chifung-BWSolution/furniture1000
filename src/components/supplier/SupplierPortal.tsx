import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  Images,
  Info,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ShieldCheck,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { LoadingImage } from '@/components/ui/loading-image';
import { Modal, ModalButton } from '@/components/ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  loadSupplierLogins,
  loadSupplierReviewDocuments,
  type SupplierDocumentRow,
  type SupplierLogin,
} from '@/lib/supplierLogins';
import { uploadSupplierDocument } from '@/lib/supplierDocuments';
import { loadSupplierCompany, type SupplierCompany, type SupplierCompliance } from '@/lib/supplierPortal';
import { CustomerCompanyInfoView } from '@/components/dashboard/customers/CustomerCompanyInfoView';

const BASE = '/fds/supplier';

type Section =
  | 'home'
  | 'products'
  | 'catalogs'
  | 'compliance'
  | 'company'
  | 'logins'
  | 'about';

const NAV: Array<{ section: Section; label: string; en: string; icon: LucideIcon }> = [
  { section: 'home', label: '首頁', en: 'Home', icon: LayoutDashboard },
  { section: 'products', label: '我的產品', en: 'Products', icon: Package },
  { section: 'catalogs', label: '圖冊管理', en: 'Catalogues', icon: Images },
  { section: 'compliance', label: '合規證照', en: 'Compliance', icon: ShieldCheck },
  { section: 'company', label: '公司資料', en: 'Company Info', icon: Building2 },
  { section: 'logins', label: '登入紀錄', en: 'Login Records', icon: KeyRound },
  { section: 'about', label: '關於 BW', en: 'About BW', icon: Info },
];

const TITLES: Record<Section, { title: string; description: string }> = {
  home: { title: '首頁', description: '你的廠家專區。上載與產品都要經傢俬組審核才會公開。' },
  products: { title: '我的產品', description: '只顯示自己廠已入庫的產品與自己廠的成本；不含售價、毛利或其他廠資料。' },
  catalogs: { title: '圖冊管理', description: '上載圖冊、報價單與證書，並查看審核狀態與退回原因。' },
  compliance: { title: '合規證照', description: 'PMS 供應商主檔的合規文件，以及你上載的證書。' },
  company: { title: '公司資料', description: '廠家資料即時讀取 PMS factories；這裡不直接修改主檔。' },
  logins: { title: '登入紀錄', description: '帳號的登入與邀請紀錄。' },
  about: { title: '關於 BW', description: '與客戶專區一致的公司資料。' },
};

function sectionFromPath(pathname: string): Section {
  const rest = pathname.replace(/\/+$/, '').replace(BASE, '').replace(/^\//, '');
  const found = NAV.find((item) => item.section === rest);
  return found?.section ?? 'home';
}

const DOC_STATUS: Record<string, string> = {
  uploaded: '已上載',
  parsing: '解析中',
  review: '待審核',
  ready: '已入庫',
  failed: '失敗',
};

const DOC_TYPE: Record<string, string> = {
  catalog: '圖冊',
  price_list: '報價單',
  quote: '報價單',
  certificate: '證書',
};

interface MyProduct {
  id: string;
  model: string | null;
  title: string | null;
  specifications: string | null;
  image_url: string | null;
  status: string | null;
  in_stock: boolean;
  cost_price: number | null;
  currency: string | null;
  latest_quote_year: number | null;
}

/**
 * PMS `factories.display_name` is an internal sort name (e.g. "1.向氏 QXS").
 * Suppliers must see the real factory name, never the internal label or UUID.
 */
function realFactoryName(company: SupplierCompany | null, login: SupplierLogin | null): string {
  const pmsName = (company?.factory_name || '').trim();
  if (pmsName) return pmsName;
  const engName = (company?.factory_eng_name || '').trim();
  if (engName) return engName;
  const stored = (login?.factoryName || '').trim().replace(/^\s*\d+\s*[.、]\s*/, '');
  return stored || '廠家';
}

function money(value: number | null, currency: string | null) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${currency ? `${currency} ` : ''}${Number(value).toLocaleString('en-HK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function SupplierPortal() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = sectionFromPath(location.pathname);
  const [login, setLogin] = useState<SupplierLogin | null>(null);
  const [documents, setDocuments] = useState<SupplierDocumentRow[]>([]);
  const [products, setProducts] = useState<MyProduct[]>([]);
  const [company, setCompany] = useState<SupplierCompany | null>(null);
  const [compliance, setCompliance] = useState<SupplierCompliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  const loadDocs = useCallback(async () => {
    const result = await loadSupplierReviewDocuments();
    setDocuments(result.rows);
    if (result.error) setError(result.error);
  }, []);

  const loadProducts = useCallback(async (term: string) => {
    const { data, error: rpcError } = await supabase.rpc('fds_supplier_my_products', {
      p_search: term.trim() || null,
      p_limit: 500,
    });
    if (rpcError) {
      setError(rpcError.message);
      setProducts([]);
      return;
    }
    setProducts(Array.isArray(data) ? (data as MyProduct[]) : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [loginResult] = await Promise.all([loadSupplierLogins()]);
      if (cancelled) return;
      const mine = loginResult.rows.find((row) => row.active) ?? loginResult.rows[0] ?? null;
      setLogin(mine);
      const pms = await loadSupplierCompany();
      if (!cancelled) {
        setCompany(pms.company);
        setCompliance(pms.compliance);
      }
      await Promise.all([loadDocs(), loadProducts('')]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDocs, loadProducts]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [section]);

  const go = (next: Section) => {
    navigate(next === 'home' ? BASE : `${BASE}/${next}`);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.assign('/');
  };

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
  const catalogDocs = documents.filter((doc) =>
    ['catalog', 'price_list', 'quote'].includes(doc.docType),
  );
  const certificateDocs = documents.filter((doc) => doc.docType === 'certificate');
  const pendingDocs = documents.filter((doc) => ['uploaded', 'parsing', 'review'].includes(doc.status));

  const stats = [
    { label: '我的產品', value: products.length, hint: '已入庫' },
    { label: '圖冊／報價單', value: catalogDocs.length, hint: '已上載' },
    { label: '待審文件', value: pendingDocs.length, hint: '審核中' },
    { label: '合規證照', value: certificateDocs.length, hint: '已上載' },
  ];

  const nav = (
    <nav aria-label="廠家專區導航" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      <ul className="space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.section === section;
          return (
            <li key={item.section}>
              <button
                type="button"
                onClick={() => go(item.section)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  <span className={`block truncate text-xs ${active ? 'text-primary-foreground/70' : 'text-slate-500'}`}>
                    {item.en}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <div className="fixed inset-0 flex bg-muted/30 text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-slate-950 lg:flex">
        <div className="flex h-16 items-center gap-3 px-5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Package className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">FDS Partner Portal</p>
            <p className="truncate text-xs text-slate-400">廠家專區</p>
          </div>
        </div>
        {nav}
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            登出
          </button>
        </div>
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="關閉選單"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[min(280px,86vw)] flex-col bg-slate-950 shadow-2xl">
            <div className="flex h-16 items-center justify-between px-4">
              <p className="text-sm font-bold text-white">FDS Partner Portal</p>
              <button
                type="button"
                aria-label="關閉選單"
                className="rounded-lg p-2 text-slate-300 hover:bg-white/10"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {nav}
            <div className="border-t border-white/10 p-3">
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                登出
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="開啟選單"
              className="rounded-lg border border-border p-2 lg:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <p className="truncate text-sm font-semibold">{TITLES[section].title}</p>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-medium">{realFactoryName(company, login)}</p>
              <p className="truncate text-xs text-muted-foreground">{login?.email || ''}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">登出</span>
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 lg:px-8">
            <h1 className="text-xl font-bold">{TITLES[section].title}</h1>

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {loading ? <p className="text-sm text-muted-foreground">載入中…</p> : null}

            {!loading && section === 'home' ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {stats.map((stat) => (
                    <div key={stat.label} className="rounded-xl border bg-card p-4">
                      <p className="text-sm text-muted-foreground">{stat.label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.hint}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-sm font-medium">你的廠家</p>
                  <p className="mt-2 text-sm">
                    {realFactoryName(company, login)}
                    {company?.factory_code ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono-data text-xs text-muted-foreground">
                        {company.factory_code}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{login?.email || ''} · {login?.active ? '使用中' : '已停用'}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => go('catalogs')}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
                    >
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      上載文件
                    </button>
                    <button
                      type="button"
                      onClick={() => go('products')}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
                    >
                      <Package className="h-4 w-4" aria-hidden="true" />
                      查看我的產品
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-sm font-medium">最近上載</p>
                  {documents.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">還沒有上載文件。</p>
                  ) : (
                    <ul className="mt-2 divide-y">
                      {documents.slice(0, 5).map((doc) => (
                        <li key={doc.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0 truncate">{doc.title || '未命名文件'}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {DOC_STATUS[doc.status] ?? doc.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : null}

            {!loading && section === 'products' ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void loadProducts(productSearch);
                    }}
                    placeholder="搜尋型號或名稱"
                    aria-label="搜尋產品"
                    className="h-10 min-w-[220px] flex-1 rounded-lg border bg-background px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void loadProducts(productSearch)}
                    className="h-10 rounded-lg border px-4 text-sm font-medium hover:bg-muted"
                  >
                    搜尋
                  </button>
                </div>
                {products.length === 0 ? (
                  <div className="rounded-xl border bg-card px-4 py-12 text-center text-sm font-medium">
                    還沒有已入庫的產品
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border bg-card">
                    <table className="w-full min-w-[860px] text-left text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">主圖</th>
                          <th className="px-3 py-2 font-medium">型號</th>
                          <th className="px-3 py-2 font-medium">名稱／規格</th>
                          <th className="px-3 py-2 font-medium">狀態</th>
                          <th className="px-3 py-2 font-medium">最新報價年份</th>
                          <th className="px-3 py-2 font-medium">我的成本</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map((product) => (
                          <tr key={product.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2">
                              <LoadingImage
                                src={product.image_url}
                                alt={product.model || product.title || ''}
                                className="h-12 w-12 rounded-lg border bg-muted"
                              />
                            </td>
                            <td className="px-3 py-2 font-mono-data text-xs">{product.model || '—'}</td>
                            <td className="max-w-[340px] px-3 py-2">
                              <p className="truncate font-medium">{product.title || '—'}</p>
                              {product.specifications ? (
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{product.specifications}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {product.in_stock === false ? '停產' : '在售'}
                              {product.status && product.status !== 'active' ? ` · ${product.status}` : ''}
                            </td>
                            <td className="px-3 py-2 text-xs tabular-nums">{product.latest_quote_year ?? '—'}</td>
                            <td className="px-3 py-2 text-xs tabular-nums">{money(product.cost_price, product.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : null}

            {!loading && section === 'catalogs' ? (
              <CatalogManager
                login={login}
                documents={catalogDocs}
                onUploaded={async () => {
                  await loadDocs();
                  await loadProducts('');
                }}
              />
            ) : null}

            {!loading && section === 'compliance' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">PMS 合規文件</p>
                  <button
                    type="button"
                    onClick={() => go('catalogs')}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    上載證書
                  </button>
                </div>

                {compliance?.linked ? (
                  compliance.files.length === 0 ? (
                    <div className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                      PMS 沒有合規文件紀錄。
                    </div>
                  ) : (
                    compliance.files.map((file) => {
                      const expiry = file.expiry_date ? file.expiry_date.slice(0, 10) : null;
                      const expired = Boolean(expiry && expiry < today);
                      return (
                        <article key={file.id} className="rounded-xl border bg-card p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <span
                                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                                  expired ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{file.type_name || '合規文件'}</p>
                                <p className="truncate text-xs text-muted-foreground">{file.file_name || '—'}</p>
                              </div>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                                expired ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {expired ? '已過期' : '有效'}
                            </span>
                          </div>
                          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                            <div>
                              <dt className="text-muted-foreground">編號</dt>
                              <dd className="mt-0.5 font-mono-data">{file.code_number || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">簽發機構</dt>
                              <dd className="mt-0.5">{file.institution || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">到期日</dt>
                              <dd className="mt-0.5 tabular-nums">
                                {file.expiry_date ? new Date(file.expiry_date).toLocaleDateString('zh-HK') : '—'}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">來源</dt>
                              <dd className="mt-0.5">PMS</dd>
                            </div>
                          </dl>
                        </article>
                      );
                    })
                  )
                ) : null}

                <div className="space-y-2 pt-2">
                  <p className="text-sm font-medium">證照</p>
                  {certificateDocs.length === 0 ? (
                    <div className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                      還沒有上載證書。
                    </div>
                  ) : null}
                  {certificateDocs.map((doc) => {
                      const meta =
                        doc.status === 'ready'
                          ? { label: '已通過', cls: 'bg-emerald-50 text-emerald-700' }
                          : doc.status === 'failed'
                            ? { label: '退回', cls: 'bg-rose-50 text-rose-700' }
                            : { label: '待審核', cls: 'bg-amber-50 text-amber-800' };
                      return (
                        <article key={doc.id} className="rounded-xl border bg-card p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.cls}`}>
                                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{doc.title || '未命名證書'}</p>
                                <p className="text-xs text-muted-foreground">
                                  {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString('zh-HK') : '—'}
                                </p>
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${meta.cls}`}>
                              {meta.label}
                            </span>
                          </div>
                          {doc.errorMessage ? (
                            <p className="mt-2 text-xs text-destructive">{doc.errorMessage}</p>
                          ) : null}
                        </article>
                      );
                  })}
                </div>
              </div>
            ) : null}

            {!loading && section === 'company' ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{realFactoryName(company, login)}</h2>
                  {company?.factory_eng_name ? (
                    <p className="mt-1 text-sm text-muted-foreground">{company.factory_eng_name}</p>
                  ) : null}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-xl border bg-card p-5">
                    <h3 className="text-sm font-semibold">公司身份</h3>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                      <InfoRow label="廠家代碼">
                        <span className="font-mono-data text-xs">{company?.factory_code || '—'}</span>
                      </InfoRow>
                      <InfoRow label="帳號狀態">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            login?.active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {login?.active ? '使用中' : '已停用'}
                        </span>
                      </InfoRow>
                      <InfoRow label="合作起始">
                        {company?.join_date ? new Date(company.join_date).toLocaleDateString('zh-HK') : '—'}
                      </InfoRow>
                      <InfoRow label="登入電郵">{login?.email || company?.email || '—'}</InfoRow>
                    </dl>
                  </section>

                  <section className="rounded-xl border bg-card p-5">
                    <h3 className="text-sm font-semibold">聯絡資料</h3>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                      <InfoRow label="聯絡人">{company?.contact_person || '—'}</InfoRow>
                      <InfoRow label="電話">{company?.phone || '—'}</InfoRow>
                      <InfoRow label="電郵">{company?.email || '—'}</InfoRow>
                      <InfoRow label="網站">
                        {company?.website ? (
                          <a
                            href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-primary underline-offset-2 hover:underline"
                          >
                            {company.website}
                          </a>
                        ) : (
                          '—'
                        )}
                      </InfoRow>
                    </dl>
                  </section>

                  <section className="rounded-xl border bg-card p-5 lg:col-span-2">
                    <h3 className="text-sm font-semibold">其他資料</h3>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                      <InfoRow label="地區">{company?.location || '—'}</InfoRow>
                      <InfoRow label="項目數">
                        {company?.project_number == null ? '—' : String(company.project_number)}
                      </InfoRow>
                      <InfoRow label="備註">{company?.remarks || '—'}</InfoRow>
                    </dl>
                  </section>
                </div>
              </div>
            ) : null}

            {!loading && section === 'logins' ? (
              <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm font-medium">
                暫未提供登入紀錄
              </div>
            ) : null}

            {!loading && section === 'about' ? <CustomerCompanyInfoView embedded /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

function DocumentList({ documents, empty }: { documents: SupplierDocumentRow[]; empty: string }) {
  if (documents.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">{empty}</div>
    );
  }
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {documents.map((doc) => (
        <li key={doc.id} className="px-4 py-3">
          <p className="text-sm font-medium">{doc.title || '未命名文件'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {DOC_TYPE[doc.docType] ?? doc.docType} · {DOC_STATUS[doc.status] ?? doc.status}
            {doc.createdAt ? ` · ${new Date(doc.createdAt).toLocaleDateString('zh-HK')}` : ''}
          </p>
          {doc.errorMessage ? <p className="mt-1 text-xs text-destructive">{doc.errorMessage}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function CatalogManager({
  login,
  documents,
  onUploaded,
}: {
  login: SupplierLogin | null;
  documents: SupplierDocumentRow[];
  onUploaded: () => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<'catalog' | 'price_list' | 'certificate'>('catalog');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [title, setTitle] = useState('');
  const [series, setSeries] = useState('');
  const [categories, setCategories] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [open, setOpen] = useState(false);

  const upload = async () => {
    if (!login || !login.active) {
      toast.error('找不到有效的廠家帳號，請聯絡管理員。');
      return;
    }
    if (!file) {
      toast.error('請先選擇 PDF 檔。');
      return;
    }
    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || numericYear < 1990 || numericYear > 2100) {
      toast.error('請填有效年份（1990–2100）。');
      return;
    }
    const categoryList = categories
      .split(/[,，、\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (docType === 'catalog' && (!series.trim() || categoryList.length === 0)) {
      toast.error('圖冊要填系列名稱及至少一個產品類別。');
      return;
    }
    setUploading(true);
    setProgress('準備中…');
    try {
      await uploadSupplierDocument({
        file,
        factoryId: login.factoryId,
        factoryName: login.factoryName,
        docType,
        title: title.trim() || file.name,
        metadata: {
          document_year: numericYear,
          series: series.trim() || undefined,
          product_categories: categoryList.length > 0 ? categoryList : undefined,
        },
        onProgress: (p) => {
          if (p.phase === 'uploading') {
            const pct = p.totalBytes > 0 ? Math.round((p.uploadedBytes / p.totalBytes) * 100) : 0;
            setProgress(`上載中 ${pct}%`);
          } else if (p.phase === 'registering') {
            setProgress('登記文件…');
          } else if (p.phase === 'complete') {
            setProgress('完成');
          } else {
            setProgress('準備中…');
          }
        },
      });
      toast.success('已上載，會先進入傢俬組審核。');
      setFile(null);
      setTitle('');
      setSeries('');
      setCategories('');
      setProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setOpen(false);
      await onUploaded();
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : '上載失敗，請重試。');
      setProgress('');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">已上載的圖冊與報價單</p>
        <button
          type="button"
          disabled={!login || !login.active}
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          上載文件
        </button>
      </div>

      <DocumentList documents={documents} empty="還沒有圖冊或報價單。" />

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="上載文件"
        icon={<Upload className="h-5 w-5" aria-hidden="true" />}
        size="lg"
        footer={
          <>
            <ModalButton variant="secondary" disabled={uploading} onClick={() => setOpen(false)}>
              取消
            </ModalButton>
            <ModalButton disabled={uploading || !file} onClick={() => void upload()}>
              {uploading ? '上載中…' : '上載文件'}
            </ModalButton>
          </>
        }
      >
        {!login || !login.active ? (
          <p className="text-sm text-destructive">這個帳號未綁定有效廠家，暫時不能上載。</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium sm:col-span-2">
              文件（PDF）
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                disabled={uploading}
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  if (next) setTitle((current) => current || next.name.replace(/\.pdf$/i, ''));
                }}
                className="mt-2 block w-full cursor-pointer rounded-lg border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:text-primary-foreground"
              />
            </label>
            <label className="block text-sm font-medium">
              文件類型
              <Select
                value={docType}
                onValueChange={(value) => setDocType(value as 'catalog' | 'price_list' | 'certificate')}
              >
                <SelectTrigger className="mt-2" aria-label="文件類型">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="catalog">圖冊</SelectItem>
                  <SelectItem value="price_list">報價單</SelectItem>
                  <SelectItem value="certificate">證書</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block text-sm font-medium">
              年份
              <input
                type="number"
                min={1990}
                max={2100}
                value={year}
                disabled={uploading}
                onChange={(event) => setYear(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
              />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">
              標題
              <input
                value={title}
                disabled={uploading}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：2026 辦公椅圖冊"
                className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
              />
            </label>
            {docType === 'catalog' ? (
              <>
                <label className="block text-sm font-medium">
                  系列
                  <input
                    value={series}
                    disabled={uploading}
                    onChange={(event) => setSeries(event.target.value)}
                    placeholder="例如：QXS 2026"
                    className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
                  />
                </label>
                <label className="block text-sm font-medium">
                  產品類別（逗號分隔）
                  <input
                    value={categories}
                    disabled={uploading}
                    onChange={(event) => setCategories(event.target.value)}
                    placeholder="例如：椅, 桌"
                    className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
                  />
                </label>
              </>
            ) : null}
            {progress ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">{progress}</p>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
