import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Printer,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  loadClientQuoteItems,
  type BwfQuoteItemInput,
} from '@/lib/bwfQuoteItems';
import { compareQuoteVersion, displayQuoteVersion } from '@/lib/quoteVersions';
import { quoteStatusBadgeClass } from '@/lib/listTableUtils';
import { quoteItemLineSubtotal } from '@/lib/quoteItemTotals';
import {
  fetchPmsPitchings,
  pitchingDisplayTitle,
  type PmsPitchingListItem,
} from '@/lib/pmsPitchings';
import { PortalPageShell } from '@/components/dashboard/customers/PortalPageShell';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import { usePlatformRole } from '@/hooks/use-platform-role';
import { BW_COMPANY } from '@/content/bwCorporate';
import {
  fetchProjects,
  fetchActiveMainProductInfo,
  fetchZones,
  fetchZoneProducts,
} from '@/lib/solutionsApi';
import type { DesignProject } from '@/types/solutions';

type QuoteRecord = {
  id: string;
  quote_id: string;
  version: string;
  status: string;
  total_amount: number;
  created_at: string;
  modified_date?: string | null;
  bwf_pitching_id?: string | null;
  project_data: {
    formData?: {
      clientName?: string;
      clientContactName?: string;
    };
    clientInfo?: { name?: string; contactName?: string };
    [key: string]: unknown;
  };
  pitching?: PmsPitchingListItem | null;
};

type ItemReview = 'accepted' | 'change' | 'rejected';
type QuoteDecision = 'pending' | 'approved' | 'rejected';
type QuoteItemGroup = { title: string; items: BwfQuoteItemInput[] };

const LIST_SELECT =
  'id, quote_id, version, status, total_amount, created_at, modified_date, project_data, bwf_pitching_id';

function fmtMoney(value: number) {
  return `HK$ ${Math.round(value || 0).toLocaleString()}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-HK');
}

function clientNameOf(quote: QuoteRecord) {
  return (
    quote.project_data?.formData?.clientName?.trim() ||
    quote.project_data?.clientInfo?.name?.trim() ||
    quote.project_data?.formData?.clientContactName?.trim() ||
    '—'
  );
}

function quoteDisplayName(quote: QuoteRecord) {
  if (quote.pitching) return pitchingDisplayTitle(quote.pitching);
  return (
    quote.project_data?.formData?.clientName?.trim() ||
    quote.quote_id?.trim() ||
    '未命名專案'
  );
}

function projectQuoteId(project: DesignProject): string {
  return String(
    project.meta?.quoteId || project.meta?.pitchingCode || '',
  ).trim();
}

function groupVersions(rows: QuoteRecord[]) {
  const map = new Map<string, QuoteRecord[]>();
  for (const row of rows) {
    const versions = map.get(row.quote_id) || [];
    versions.push(row);
    map.set(row.quote_id, versions);
  }
  for (const versions of map.values()) {
    versions.sort((a, b) => -compareQuoteVersion(a.version, b.version));
  }
  return map;
}

function groupQuoteItems(items: BwfQuoteItemInput[]): QuoteItemGroup[] {
  const groups: QuoteItemGroup[] = [];
  let current: QuoteItemGroup | null = null;
  for (const item of items) {
    if (item.isSectionTitle) {
      if (current) groups.push(current);
      current = { title: item.name?.trim() || '其他區域', items: [] };
      continue;
    }
    if (item.isCustomTerm) continue;
    if (!current) current = { title: '報價產品', items: [] };
    current.items.push(item);
  }
  if (current) groups.push(current);
  return groups;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const REVIEW_LABEL: Record<ItemReview, string> = {
  accepted: '接受',
  change: '要求修改',
  rejected: '不接受',
};

export function CustomerQuoteSchemesView() {
  const { projects: clientProjects } = useClientZoneContext();
  const { role: platformRole } = usePlatformRole();
  const hasPortalToken =
    typeof window !== 'undefined' &&
    Boolean(localStorage.getItem('fds-client-portal-token'));
  const clientOnly = platformRole === 'client' || hasPortalToken;

  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [confirmedProjects, setConfirmedProjects] = useState<DesignProject[]>([]);
  const [confirmedTotals, setConfirmedTotals] = useState<Record<string, number>>(
    {},
  );
  const [syntheticQuotes, setSyntheticQuotes] = useState<QuoteRecord[]>([]);
  const [activeId, setActiveId] = useState('');
  const [items, setItems] = useState<BwfQuoteItemInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [itemReviews, setItemReviews] = useState<Record<string, ItemReview>>({});
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [quoteDecision, setQuoteDecision] = useState<QuoteDecision>('pending');
  const [quoteNote, setQuoteNote] = useState('');

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bwf_quote')
        .select(LIST_SELECT)
        .order('created_at', { ascending: false })
        .limit(120);
      if (error) throw error;
      const rows = (data as QuoteRecord[]) || [];
      const pitchingIds = [
        ...new Set(
          rows
            .map((quote) => quote.bwf_pitching_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const pitchings = pitchingIds.length
        ? await fetchPmsPitchings({ ids: pitchingIds, limit: pitchingIds.length })
        : [];
      const pitchingById = new Map(pitchings.map((pitching) => [pitching.id, pitching]));
      const enriched = rows.map((quote) => ({
        ...quote,
        pitching: quote.bwf_pitching_id
          ? pitchingById.get(quote.bwf_pitching_id) || null
          : null,
      }));
      setQuotes(enriched);
      setActiveId((current) => current || enriched[0]?.id || '');
    } catch (error) {
      toast.error('無法載入客戶報價', {
        description: error instanceof Error ? error.message : '請稍後再試',
      });
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchQuotes();
    void fetchProjects().then(async (rows) => {
      const confirmed = rows.filter((project) => project.status === 'confirmed');
      setConfirmedProjects(confirmed);
      const totals = await Promise.all(
        confirmed.map(async (project) => {
          const products = await fetchZoneProducts(project.id);
          const total = products
            .filter((product) => product.zoneId)
            .reduce(
              (sum, product) =>
                sum + product.salePrice * product.quantity,
              0,
            );
          return [project.id, total] as const;
        }),
      );
      setConfirmedTotals(Object.fromEntries(totals));
    });
  }, [fetchQuotes]);

  useEffect(() => {
    const actualQuoteIds = new Set(quotes.map((quote) => quote.quote_id));
    setSyntheticQuotes(
      confirmedProjects
        .filter((project) => {
          const quoteId = projectQuoteId(project);
          return quoteId && !actualQuoteIds.has(quoteId);
        })
        .map((project) => ({
          id: `confirmed-project:${project.id}`,
          quote_id: projectQuoteId(project),
          version: 'v1',
          status: '已確認',
          total_amount: confirmedTotals[project.id] || 0,
          created_at: project.createdAt,
          modified_date: project.updatedAt,
          project_data: {
            formData: {
              clientName: project.clientCompany || project.name,
              clientContactName: project.clientName || undefined,
            },
          },
          pitching: null,
        })),
    );
  }, [confirmedProjects, confirmedTotals, quotes]);

  useEffect(() => {
    if (!activeId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setItemsLoading(true);
    const loadItems = async () => {
      const activeQuote = [...quotes, ...syntheticQuotes].find(
        (quote) => quote.id === activeId,
      );
      const syntheticProjectId = activeId.startsWith('confirmed-project:')
        ? activeId.replace('confirmed-project:', '')
        : '';
      const quoteItems = syntheticProjectId
        ? []
        : await loadClientQuoteItems(activeId);
      const quoteInfo = await fetchActiveMainProductInfo(
        quoteItems
          .filter((item) => !item.isSectionTitle && item.id)
          .map((item) => item.id as string),
      );
      const safeQuoteItems = quoteItems.map((item) => ({
          ...item,
          sku: item.id ? quoteInfo[item.id]?.sku : undefined,
      }));
      const linkedProject = syntheticProjectId
        ? confirmedProjects.find((project) => project.id === syntheticProjectId)
        : activeQuote
          ? confirmedProjects.find(
            (project) => projectQuoteId(project) === activeQuote.quote_id,
          )
          : null;
      if (!linkedProject) return safeQuoteItems;

      const [zones, zoneProducts] = await Promise.all([
        fetchZones(linkedProject.id),
        fetchZoneProducts(linkedProject.id),
      ]);
      const selectedProducts = zoneProducts.filter((product) => product.zoneId);
      const mainInfo = await fetchActiveMainProductInfo(
        selectedProducts
          .map((product) => product.productId)
          .filter((id): id is string => Boolean(id)),
      );
      const grouped: BwfQuoteItemInput[] = [];
      for (const zone of zones) {
        const products = selectedProducts.filter(
          (product) => product.zoneId === zone.id,
        );
        grouped.push({
          id: `zone-${zone.id}`,
          name: `${zone.code ? `${zone.code} · ` : ''}${zone.name}`,
          isSectionTitle: true,
          image: '',
        });
        for (const product of products) {
          grouped.push({
            id: product.id,
            name: product.productTitle,
            image: product.productImageUrl,
            unitPrice: product.salePrice,
            quantity: product.quantity,
            unit: '件',
            sku: product.productId
              ? mainInfo[product.productId]?.sku
              : undefined,
          });
        }
      }
      return grouped.length > 0 ? grouped : safeQuoteItems;
    };

    loadItems()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, confirmedProjects, quotes, syntheticQuotes]);

  const allQuoteRows = useMemo(
    () => [...quotes, ...syntheticQuotes],
    [quotes, syntheticQuotes],
  );
  const versionsByQuote = useMemo(
    () => groupVersions(allQuoteRows),
    [allQuoteRows],
  );
  const availableQuotes = useMemo(() => {
    const allowedTerms = new Set(
      clientProjects
        .flatMap((project) => [project.name, project.clientName, project.clientCompany])
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
    );
    const visible = [...versionsByQuote.values()]
      .map((versions) => versions[0])
      .filter((quote) => {
        if (!clientOnly) return true;
        if (allowedTerms.size === 0) return false;
        const values = [quoteDisplayName(quote), clientNameOf(quote)]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        return values.some((value) =>
          [...allowedTerms].some(
            (term) => value.includes(term) || term.includes(value),
          ),
        );
      });
    const clientProjectIds = new Set(clientProjects.map((project) => project.id));
    const confirmedQuoteIds = new Set(
      confirmedProjects
        .filter(
          (project) => !clientOnly || clientProjectIds.has(project.id),
        )
        .map(projectQuoteId)
        .filter(Boolean),
    );
    return [...visible].sort((a, b) => {
      const aConfirmed = confirmedQuoteIds.has(a.quote_id) ? 1 : 0;
      const bConfirmed = confirmedQuoteIds.has(b.quote_id) ? 1 : 0;
      if (aConfirmed !== bConfirmed) return bConfirmed - aConfirmed;
      return (
        new Date(b.modified_date || b.created_at).getTime() -
        new Date(a.modified_date || a.created_at).getTime()
      );
    });
  }, [
    clientOnly,
    clientProjects,
    confirmedProjects,
    versionsByQuote,
  ]);

  useEffect(() => {
    if (availableQuotes.length === 0) return;
    const activeVisible = allQuoteRows.some(
      (quote) =>
        quote.id === activeId &&
        availableQuotes.some((latest) => latest.quote_id === quote.quote_id),
    );
    if (!activeVisible) setActiveId(availableQuotes[0].id);
  }, [activeId, allQuoteRows, availableQuotes]);

  const active =
    allQuoteRows.find((quote) => quote.id === activeId) || null;
  const activeVersions = active
    ? versionsByQuote.get(active.quote_id) || [active]
    : [];
  const itemGroups = useMemo(() => groupQuoteItems(items), [items]);
  const pricedItems = items.filter(
    (item) => !item.isSectionTitle && !item.isCustomTerm && !item.isOptional,
  );
  const itemSubtotal = pricedItems.reduce(
    (sum, item) => sum + quoteItemLineSubtotal(item),
    0,
  );

  const itemKey = (item: BwfQuoteItemInput, index: number) =>
    item.id || `${item.name || 'item'}-${index}`;

  const buildExportHtml = () => {
    if (!active) return '';
    const groupsHtml = itemGroups
      .map(
        (group) => `
          <section>
            <h2>${escapeHtml(group.title)}</h2>
            ${group.items
              .map((item, index) => {
                const key = itemKey(item, index);
                const review = itemReviews[key]
                  ? REVIEW_LABEL[itemReviews[key]]
                  : '尚未決定';
                return `<div class="item">
                  ${
                    item.image
                      ? `<img src="${escapeHtml(item.image)}" alt="">`
                      : ''
                  }
                  <div class="grow">
                    <div class="name-row"><strong>${escapeHtml(item.name || '—')}</strong><small>SKU ${escapeHtml(item.sku || '—')}</small></div>
                    <p>${escapeHtml(item.material || '')} ${escapeHtml(item.color || '')}</p>
                    <p>${fmtMoney(Number(item.unitPrice || 0))} × ${escapeHtml(item.quantity || 1)} ${escapeHtml(item.unit || '')}</p>
                    <p class="review">客戶決定：${escapeHtml(review)} ${escapeHtml(itemNotes[key] || '')}</p>
                  </div>
                  <b>${item.isOptional ? '可選' : fmtMoney(quoteItemLineSubtotal(item))}</b>
                </div>`;
              })
              .join('')}
          </section>`,
      )
      .join('');
    const decisionLabel =
      quoteDecision === 'approved'
        ? '確認整張報價'
        : quoteDecision === 'rejected'
          ? '拒絕整張報價'
          : '尚未決定';
    return `<!doctype html>
      <html lang="zh-HK"><head><meta charset="utf-8">
      <title>${escapeHtml(active.quote_id)} ${escapeHtml(displayQuoteVersion(active.version))}</title>
      <style>
        body{font-family:"Noto Sans HK","Noto Sans TC",sans-serif;color:#16182a;max-width:960px;margin:0 auto;padding:40px}
        header{border-bottom:2px solid #6366f1;padding-bottom:22px;margin-bottom:26px}
        h1{margin:0 0 8px;font-size:28px} h2{font-size:19px;margin-top:28px}
        .meta{color:#62677a}.item{display:flex;gap:16px;align-items:center;border:1px solid #e4e5ef;border-radius:12px;padding:14px;margin:10px 0}
        .item img{width:72px;height:72px;object-fit:cover;border-radius:8px}.grow{flex:1}.item p{margin:4px 0;color:#62677a}
        .name-row{display:flex;justify-content:space-between;gap:16px}.name-row small{font-size:10px;color:#8a8d99;font-family:monospace}
        .review{color:#4338ca!important}.decision{margin-top:30px;padding:18px;background:#f2f2ff;border-radius:12px}
        @media print{body{padding:0}.item{break-inside:avoid}}
      </style></head><body>
      <header><p>BW Furniture · Client Portal</p>
        <h1>${escapeHtml(quoteDisplayName(active))}</h1>
        <p class="meta">${escapeHtml(active.quote_id)} · ${escapeHtml(displayQuoteVersion(active.version))} · ${fmtDate(active.modified_date || active.created_at)}</p>
        <h2>${fmtMoney(active.total_amount || itemSubtotal)}</h2>
      </header>
      ${groupsHtml}
      <div class="decision"><strong>整張報價決定：${decisionLabel}</strong><p>${escapeHtml(quoteNote)}</p></div>
      </body></html>`;
  };

  const openHtmlQuote = () => {
    const popup = window.open('', '_blank');
    if (!popup) {
      toast.error('瀏覽器已阻擋新視窗');
      return;
    }
    popup.opener = null;
    popup.document.open();
    popup.document.write(buildExportHtml());
    popup.document.close();
  };

  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) {
      toast.error('瀏覽器已阻擋列印視窗');
      return;
    }
    popup.opener = null;
    popup.document.open();
    popup.document.write(buildExportHtml());
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 300);
  };

  const submitResponse = () => {
    if (!active || quoteDecision === 'pending') {
      toast.error('請先選擇確認或拒絕整張報價');
      return;
    }
    const lines = pricedItems.map((item, index) => {
      const key = itemKey(item, index);
      return `${item.name || '產品'}：${
        itemReviews[key] ? REVIEW_LABEL[itemReviews[key]] : '尚未決定'
      }${itemNotes[key] ? `（${itemNotes[key]}）` : ''}`;
    });
    const body = encodeURIComponent(
      `報價：${active.quote_id} ${displayQuoteVersion(active.version)}\n整張決定：${
        quoteDecision === 'approved' ? '確認' : '拒絕'
      }\n\n${lines.join('\n')}\n\n備註：${quoteNote || '沒有'}`,
    );
    window.location.href = `mailto:${BW_COMPANY.email}?subject=${encodeURIComponent(
      `客戶報價回覆 ${active.quote_id}`,
    )}&body=${body}`;
  };

  return (
    <PortalPageShell
      title={showDetail && active ? quoteDisplayName(active) : '報價方案'}
      badge="Client Portal"
      subtitle="查看自己的 HTML 報價、切換版本、按工程分區批核產品，並回覆整張報價。"
      maxWidthClass="max-w-6xl"
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs text-primary">
          <Shield className="h-4 w-4" />
          只顯示售價，成本已隱藏
        </span>
      }
    >
      {!showDetail ? (
      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">您的報價</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              一般只會顯示目前客戶的 1–2 張有效報價。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchQuotes()}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            重新整理
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : availableQuotes.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <FileText className="mx-auto h-9 w-9 text-muted-foreground/40" />
            <p className="mt-3 font-semibold">目前沒有屬於您的報價</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {availableQuotes.map((quote) => {
              const selected = active?.quote_id === quote.quote_id;
              const versions = versionsByQuote.get(quote.quote_id) || [quote];
              const linkedConfirmedProject = confirmedProjects.some(
                (project) => projectQuoteId(project) === quote.quote_id,
              );
              return (
                <button
                  key={quote.quote_id}
                  type="button"
                  onClick={() => {
                    setActiveId(quote.id);
                    setShowDetail(true);
                    setItems([]);
                    setItemsLoading(true);
                    setItemReviews({});
                    setItemNotes({});
                    setQuoteDecision('pending');
                    setQuoteNote('');
                  }}
                  className={cn(
                    'rounded-2xl border bg-card p-5 text-left shadow-sm transition-all',
                    selected
                      ? 'border-primary/50 ring-2 ring-primary/10'
                      : 'border-border hover:border-primary/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-lg bg-primary/10 px-2.5 py-1 font-mono-data text-xs font-bold text-primary">
                      {quote.quote_id}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs font-medium',
                        linkedConfirmedProject
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : quoteStatusBadgeClass(quote.status),
                      )}
                    >
                      {linkedConfirmedProject ? '已確認' : quote.status || '—'}
                    </span>
                  </div>
                  <h3 className="mt-4 line-clamp-2 font-display text-lg font-bold">
                    {quoteDisplayName(quote)}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {clientNameOf(quote)} · {versions.length} 個版本
                  </p>
                  {linkedConfirmedProject ? (
                    <p className="mt-2 inline-flex rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      已劃分工程區域
                    </p>
                  ) : null}
                  <div className="mt-4 flex items-end justify-between gap-3 border-t border-border pt-4">
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(quote.modified_date || quote.created_at)}
                    </span>
                    <strong className="font-mono-data text-lg text-primary">
                      {fmtMoney(quote.total_amount)}
                    </strong>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

      {showDetail && active ? (
        <section className="space-y-5">
          <button
            type="button"
            onClick={() => setShowDetail(false)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            返回您的報價
          </button>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono-data text-xs text-primary">
                  {active.quote_id}
                </p>
                <h2 className="mt-1 font-display text-xl font-bold">
                  {quoteDisplayName(active)}
                </h2>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  更新日期 {fmtDate(active.modified_date || active.created_at)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={activeId}
                  onChange={(event) => {
                    setActiveId(event.target.value);
                    setItemReviews({});
                    setItemNotes({});
                    setQuoteDecision('pending');
                    setQuoteNote('');
                  }}
                  className="h-10 rounded-lg border border-border bg-background px-3 text-sm font-semibold"
                >
                  {activeVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {displayQuoteVersion(version.version)} · {version.status}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={openHtmlQuote}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm"
                >
                  <ExternalLink className="h-4 w-4" />
                  HTML Quote
                </button>
                <button
                  type="button"
                  onClick={printPdf}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm"
                >
                  <Printer className="h-4 w-4" />
                  PDF
                </button>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3">
              <span className="font-semibold">報價總額</span>
              <strong className="font-mono-data text-xl text-primary">
                {fmtMoney(active.total_amount || itemSubtotal)}
              </strong>
            </div>
          </div>

          {itemsLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : itemGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">
              此版本暫無產品明細
            </div>
          ) : (
            itemGroups.map((group, groupIndex) => (
              <section
                key={`${group.title}-${groupIndex}`}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold text-primary">
                      區域 {String(groupIndex + 1).padStart(2, '0')}
                    </p>
                    <h3 className="mt-1 font-display text-lg font-bold">
                      {group.title}
                    </h3>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {group.items.length} 件產品
                  </span>
                </div>
                <div className="divide-y divide-border/70">
                  {group.items.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground">
                      此區域暫未選擇產品
                    </p>
                  ) : null}
                  {group.items.map((item, index) => {
                    const key = itemKey(item, index);
                    const review = itemReviews[key];
                    return (
                      <article key={key} className="p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-muted">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.name || ''}
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="min-w-0 truncate text-base font-bold">
                                {item.name || '—'}
                              </h4>
                              <span className="shrink-0 font-mono-data text-[10px] text-muted-foreground">
                                SKU {item.sku || '—'}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {[item.material, item.color].filter(Boolean).join(' · ') ||
                                '產品規格以報價為準'}
                            </p>
                            <p className="mt-2 font-mono-data text-sm text-primary">
                              {fmtMoney(Number(item.unitPrice || 0))} ×{' '}
                              {item.quantity || 1} {item.unit || ''}
                            </p>
                          </div>
                          <div className="sm:text-right">
                            <p className="font-mono-data text-lg font-bold">
                              {item.isOptional
                                ? '可選'
                                : fmtMoney(quoteItemLineSubtotal(item))}
                            </p>
                          </div>
                        </div>
                        {!item.isOptional ? (
                          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                            {(
                              [
                                ['accepted', '接受', Check],
                                ['change', '要求修改', MessageSquare],
                                ['rejected', '不接受', Ban],
                              ] as const
                            ).map(([value, label, Icon]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  setItemReviews((current) => ({
                                    ...current,
                                    [key]: value,
                                  }))
                                }
                                className={cn(
                                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium',
                                  review === value
                                    ? value === 'accepted'
                                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                                      : value === 'change'
                                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700'
                                        : 'border-rose-500/40 bg-rose-500/10 text-rose-700'
                                    : 'border-border text-muted-foreground',
                                )}
                              >
                                <Icon className="h-4 w-4" />
                                {label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {review === 'change' || review === 'rejected' ? (
                          <textarea
                            value={itemNotes[key] || ''}
                            onChange={(event) =>
                              setItemNotes((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            rows={2}
                            placeholder="請說明需要修改或不接受的原因…"
                            className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                          />
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
            <h2 className="font-display text-lg font-bold">整張報價決定</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              可先逐件提出意見，再確認或拒絕整張報價。
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setQuoteDecision('approved')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border px-4 py-3 font-semibold',
                  quoteDecision === 'approved'
                    ? 'border-emerald-500/40 bg-emerald-600 text-white'
                    : 'border-border bg-card',
                )}
              >
                <CheckCircle2 className="h-5 w-5" />
                確認整張報價
              </button>
              <button
                type="button"
                onClick={() => setQuoteDecision('rejected')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border px-4 py-3 font-semibold',
                  quoteDecision === 'rejected'
                    ? 'border-rose-500/40 bg-rose-600 text-white'
                    : 'border-border bg-card',
                )}
              >
                <Ban className="h-5 w-5" />
                拒絕整張報價
              </button>
            </div>
            <textarea
              value={quoteNote}
              onChange={(event) => setQuoteNote(event.target.value)}
              rows={3}
              placeholder="整體意見、交期或其他補充…"
              className="mt-4 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
            />
            <button
              type="button"
              onClick={submitResponse}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground"
            >
              <Mail className="h-5 w-5" />
              提交回覆給 BW
            </button>
          </section>
        </section>
      ) : null}
    </PortalPageShell>
  );
}
