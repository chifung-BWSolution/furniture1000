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
  MessageSquare,
  Printer,
  RefreshCw,
  Shield,
  Trash2,
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
import { useAuth } from '@/contexts/AuthProvider';
import { useClientZoneContext } from '@/hooks/use-client-zone-context';
import { usePlatformRole } from '@/hooks/use-platform-role';
import { usePmsStaffName } from '@/hooks/use-pms-staff-name';
import { ROLE_META, type UserRole } from '@/constants/analytics-mock';
import {
  fetchProjects,
  fetchZones,
  fetchZoneProducts,
  fetchProductsDisplayMeta,
  applyZoneProductClientReview,
  updateZoneProductNotes,
  saveProject,
} from '@/lib/solutionsApi';
import { formatProductDimensionsMm } from '@/lib/productDimensions';
import { readStoredPortalToken } from '@/lib/customerPortalRoutes';
import type {
  DesignProject,
  ProjectZone,
  ZoneProduct,
} from '@/types/solutions';
import {
  isAllowedPortalQuote,
  removeClientFeedbackFromNotes,
  splitStaffNotesAndFeedback,
  ZONE_STATUS_TO_REVIEW,
  type ClientItemReview,
} from '@/lib/zoneProductClientFeedback';
import { remarksPlainText } from '@/lib/remarksContent';

function isZoneProductId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (id.startsWith('zone-')) return false;
  // zone_products ids are UUIDs
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}

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

type ItemReview = ClientItemReview;
type QuoteDecision = 'pending' | 'approved' | 'rejected';

function hydrateQuoteReplyFromProject(project: DesignProject | null | undefined): {
  decision: QuoteDecision;
  note: string;
} {
  const reply = project?.meta?.clientQuoteReply;
  if (!reply || typeof reply !== 'object') {
    return { decision: 'pending', note: '' };
  }
  const decision =
    reply.decision === 'approved'
      ? 'approved'
      : reply.decision === 'rejected'
        ? 'rejected'
        : 'pending';
  return {
    decision,
    note: typeof reply.note === 'string' ? reply.note : '',
  };
}
type CommentBadgeRole = Extract<UserRole, 'pm' | 'designer'>;
type ItemMessage = {
  id: string;
  text: string;
  createdAt: string;
  authorName: string;
  authorRole?: CommentBadgeRole | null;
};

function asCommentBadgeRole(
  role: string | null | undefined,
): CommentBadgeRole | null {
  const next = String(role || '').trim().toLowerCase();
  if (next === 'pm' || next === 'designer') return next;
  return null;
}
type QuoteRoomSection = {
  id: string;
  /** Null = no division header (flat product list under the zone). */
  label: string | null;
  items: BwfQuoteItemInput[];
};
type QuoteRoomGroup = {
  id: string;
  code: string;
  name: string;
  sections: QuoteRoomSection[];
};
type QuoteZoneTypeGroup = {
  key: string;
  label: string;
  rooms: QuoteRoomGroup[];
};

/** Match 設計專案 product image size. */
const PORTAL_PRODUCT_IMAGE_PX = 300;

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

/** Display timestamps in UTC+8, 24-hour clock. */
function fmtUtc8DateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function zoneCodePrefix(code: string | null): string {
  return code?.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || '其他';
}

function zoneBaseName(name: string): string {
  return (
    name
      .trim()
      .replace(/\s+\d+$/, '')
      .replace(/[（(]\d+[）)]$/, '')
      .trim() || '其他間隔'
  );
}

function parseZoneSectionTitle(title: string): {
  code: string;
  name: string;
  prefix: string;
  label: string;
} {
  const cleaned = title.trim() || '其他區域';
  const dotted = cleaned.match(/^([A-Za-z]+[0-9]*)\s*[·•‧.\-–—]\s*(.+)$/);
  if (dotted) {
    const code = dotted[1].toUpperCase();
    const name = dotted[2].trim();
    return {
      code,
      name,
      prefix: zoneCodePrefix(code),
      label: zoneBaseName(name),
    };
  }
  const spaced = cleaned.match(/^([A-Za-z]+[0-9]*)\s+(.+)$/);
  if (spaced) {
    const code = spaced[1].toUpperCase();
    const name = spaced[2].trim();
    return {
      code,
      name,
      prefix: zoneCodePrefix(code),
      label: zoneBaseName(name),
    };
  }
  return {
    code: '',
    name: cleaned,
    prefix: '其他',
    label: zoneBaseName(cleaned),
  };
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

function quoteItemDisplayName(item: BwfQuoteItemInput): string {
  const name = item.name?.trim() || '';
  if (name && !/^[-—–]+$/.test(name)) return name;
  const category = item.category?.trim() || '';
  return category || '產品';
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

function groupQuoteItemsByZoneType(
  items: BwfQuoteItemInput[],
): QuoteZoneTypeGroup[] {
  const groups: QuoteZoneTypeGroup[] = [];
  const indexByKey = new Map<string, number>();
  let currentRoom: QuoteRoomGroup | null = null;
  let currentSection: QuoteRoomSection | null = null;

  const ensureDefaultSection = () => {
    if (!currentRoom) return;
    if (currentSection) return;
    currentSection = {
      id: `${currentRoom.id}:default`,
      label: null,
      items: [],
    };
    currentRoom.sections.push(currentSection);
  };

  const ensureRoom = (title: string) => {
    const parsed = parseZoneSectionTitle(title);
    const key = parsed.label;
    let groupIndex = indexByKey.get(key);
    if (groupIndex == null) {
      groupIndex = groups.length;
      indexByKey.set(key, groupIndex);
      groups.push({
        key,
        label: parsed.label,
        rooms: [],
      });
    }
    const group = groups[groupIndex];
    currentRoom = {
      id: `${key}:${parsed.name}:${group.rooms.length}`,
      code: '',
      name: parsed.name || parsed.label,
      sections: [],
    };
    currentSection = null;
    group.rooms.push(currentRoom);
  };

  for (const item of items) {
    if (item.isSectionTitle) {
      ensureRoom(item.name?.trim() || '其他區域');
      continue;
    }
    if (item.isDivisionTitle) {
      if (!currentRoom) ensureRoom('報價產品');
      currentSection = {
        id: item.id || `${currentRoom!.id}:div:${currentRoom!.sections.length}`,
        label: item.name?.trim() || '傢俬劃分',
        items: [],
      };
      currentRoom!.sections.push(currentSection);
      continue;
    }
    if (item.isCustomTerm) continue;
    if (!currentRoom) ensureRoom('報價產品');
    ensureDefaultSection();
    currentSection?.items.push(item);
  }
  return groups;
}

function roomProductCount(room: QuoteRoomGroup): number {
  return room.sections.reduce((sum, section) => sum + section.items.length, 0);
}

function furnitureDivisionLabel(division: {
  level1: string;
  level2: string;
}): string {
  return division.level2
    ? `${division.level1} > ${division.level2}`
    : division.level1;
}

function portalNotesDisplay(notes: string | null | undefined): string {
  const { staffNotes } = splitStaffNotesAndFeedback(notes);
  return remarksPlainText(staffNotes) || staffNotes.trim();
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
  const { user } = useAuth();
  const staffName = usePmsStaffName(user?.id);
  const currentUserName = (staffName || user?.email || '用戶').trim() || '用戶';
  const { projects: clientProjects } = useClientZoneContext();
  const { role: platformRole } = usePlatformRole();
  const hasPortalToken = Boolean(readStoredPortalToken());
  const clientOnly = platformRole === 'client' || hasPortalToken;

  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [portalProjects, setPortalProjects] = useState<DesignProject[]>([]);
  const [portalTotals, setPortalTotals] = useState<Record<string, number>>({});
  const [portalProjectData, setPortalProjectData] = useState<
    Record<string, { zones: ProjectZone[]; products: ZoneProduct[] }>
  >({});
  const [syntheticQuotes, setSyntheticQuotes] = useState<QuoteRecord[]>([]);
  const [savingReviewKey, setSavingReviewKey] = useState<string | null>(null);
  const [activeId, setActiveId] = useState('');
  const [items, setItems] = useState<BwfQuoteItemInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [itemReviews, setItemReviews] = useState<Record<string, ItemReview>>({});
  const [itemDraftNotes, setItemDraftNotes] = useState<Record<string, string>>(
    {},
  );
  const [itemMessages, setItemMessages] = useState<
    Record<string, ItemMessage[]>
  >({});
  const [quoteDecision, setQuoteDecision] = useState<QuoteDecision>('pending');
  const [quoteNote, setQuoteNote] = useState('');
  const [submittingQuote, setSubmittingQuote] = useState(false);
  const [currentUserRole, setCurrentUserRole] =
    useState<CommentBadgeRole | null>(null);

  useEffect(() => {
    let cancelled = false;
    const email = user?.email?.trim().toLowerCase();
    if (!email) {
      setCurrentUserRole(null);
      return;
    }
    supabase
      .from('platform_user_profiles')
      .select('role')
      .ilike('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setCurrentUserRole(asCommentBadgeRole(data?.role));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

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
      const loaded = await Promise.all(
        rows.map(async (project) => {
          const [zones, products] = await Promise.all([
            fetchZones(project.id),
            fetchZoneProducts(project.id),
          ]);
          const assigned = products.filter((product) => product.zoneId);
          const total = assigned.reduce(
            (sum, product) => sum + product.salePrice * product.quantity,
            0,
          );
          return {
            project,
            projectId: project.id,
            zones,
            products,
            total,
            hasFurniture: assigned.length > 0,
          };
        }),
      );
      // Design-project quotes: any project that already has furniture configured.
      const withFurniture = loaded.filter((entry) => entry.hasFurniture);
      setPortalProjectData(
        Object.fromEntries(
          withFurniture.map((entry) => [
            entry.projectId,
            { zones: entry.zones, products: entry.products },
          ]),
        ),
      );
      setPortalTotals(
        Object.fromEntries(
          withFurniture.map((entry) => [entry.projectId, entry.total]),
        ),
      );
      setPortalProjects(withFurniture.map((entry) => entry.project));
    });
  }, [fetchQuotes]);

  useEffect(() => {
    const allowedQuoteIds = new Set(
      quotes
        .filter((quote) =>
          isAllowedPortalQuote({
            quoteId: quote.quote_id,
            displayName: quoteDisplayName(quote),
            clientName: clientNameOf(quote),
          }),
        )
        .map((quote) => quote.quote_id),
    );
    setSyntheticQuotes(
      portalProjects
        .filter((project) => {
          const quoteId = projectQuoteId(project);
          // Prefer real bwf_quote card when allow-listed and already present.
          if (quoteId && allowedQuoteIds.has(quoteId)) return false;
          return true;
        })
        .map((project) => ({
          id: `design-project:${project.id}`,
          quote_id: projectQuoteId(project) || `DP-${project.id.slice(0, 8)}`,
          version: 'v1',
          status:
            project.status === 'confirmed'
              ? '已確認'
              : '進行中',
          total_amount: portalTotals[project.id] || 0,
          created_at: project.createdAt,
          modified_date: project.updatedAt,
          project_data: {
            formData: {
              clientName: project.name,
              clientContactName:
                project.clientCompany || project.clientName || undefined,
            },
          },
          pitching: null,
        })),
    );
  }, [portalProjects, portalTotals, quotes]);

  useEffect(() => {
    // Re-load whenever detail is opened (even same quote), so client opinions
    // persist across close/reopen instead of staying wiped in local state.
    if (!showDetail || !activeId) {
      return;
    }
    let cancelled = false;
    setItemsLoading(true);
    const loadItems = async () => {
      const activeQuote = [...quotes, ...syntheticQuotes].find(
        (quote) => quote.id === activeId,
      );
      const syntheticProjectId = activeId.startsWith('design-project:')
        ? activeId.replace('design-project:', '')
        : activeId.startsWith('confirmed-project:')
          ? activeId.replace('confirmed-project:', '')
          : '';
      const quoteItems = syntheticProjectId
        ? []
        : await loadClientQuoteItems(activeId);
      const linkedProject = syntheticProjectId
        ? portalProjects.find((project) => project.id === syntheticProjectId)
        : activeQuote
          ? portalProjects.find(
              (project) => projectQuoteId(project) === activeQuote.quote_id,
            )
          : null;
      if (!linkedProject) {
        return {
          rows: quoteItems,
          zoneProducts: [] as ZoneProduct[],
          linkedProjectId: '',
          zones: [] as ProjectZone[],
        };
      }

      // Always fetch fresh notes/status so reopening shows saved client feedback.
      const [zones, zoneProducts] = await Promise.all([
        fetchZones(linkedProject.id),
        fetchZoneProducts(linkedProject.id),
      ]);
      const selectedProducts = zoneProducts.filter((product) => product.zoneId);
      const catalogMeta = await fetchProductsDisplayMeta(
        selectedProducts
          .map((product) => String(product.productId || '').trim())
          .filter(Boolean),
      );
      const mapPortalProduct = (product: ZoneProduct): BwfQuoteItemInput => {
        const meta = product.productId
          ? catalogMeta[product.productId]
          : undefined;
        return {
          id: product.id,
          name: product.productTitle,
          image: product.productImageUrl,
          unitPrice: product.salePrice,
          quantity: product.quantity,
          unit: '件',
          notes: product.notes || '',
          zoneStatus: product.status,
          isOptional: Boolean(product.isOptional),
          // Prefer project-local dims; fall back to catalog. Never show factory here.
          dimensionLMm:
            product.dimensionLMm ?? meta?.dimensionLMm ?? null,
          dimensionWMm:
            product.dimensionWMm ?? meta?.dimensionWMm ?? null,
          dimensionHMm:
            product.dimensionHMm ?? meta?.dimensionHMm ?? null,
        };
      };

      const furnitureDivisions =
        linkedProject.meta?.furnitureDivisions &&
        typeof linkedProject.meta.furnitureDivisions === 'object'
          ? linkedProject.meta.furnitureDivisions
          : {};

      const grouped: BwfQuoteItemInput[] = [];
      for (const zone of zones) {
        const products = selectedProducts.filter(
          (product) => product.zoneId === zone.id,
        );
        grouped.push({
          id: `zone-${zone.id}`,
          name: zone.name,
          isSectionTitle: true,
          image: '',
        });

        const divisions = Array.isArray(furnitureDivisions[zone.id])
          ? furnitureDivisions[zone.id]
          : [];
        const assignedIds = new Set<string>();

        if (divisions.length > 0) {
          for (const division of divisions) {
            const divisionProductIds = new Set(
              (division.productIds || []).map((id) => String(id).trim()),
            );
            const divisionProducts = products.filter((product) =>
              divisionProductIds.has(product.id),
            );
            for (const product of divisionProducts) {
              assignedIds.add(product.id);
            }
            grouped.push({
              id: `division-${zone.id}-${division.id}`,
              name: furnitureDivisionLabel(division),
              isDivisionTitle: true,
              image: '',
            });
            for (const product of divisionProducts) {
              grouped.push(mapPortalProduct(product));
            }
          }
          const unassigned = products.filter(
            (product) => !assignedIds.has(product.id),
          );
          if (unassigned.length > 0) {
            grouped.push({
              id: `division-${zone.id}-unassigned`,
              name: '未劃分',
              isDivisionTitle: true,
              image: '',
            });
            for (const product of unassigned) {
              grouped.push(mapPortalProduct(product));
            }
          }
        } else {
          for (const product of products) {
            grouped.push(mapPortalProduct(product));
          }
        }
      }
      return {
        rows: grouped.length > 0 ? grouped : quoteItems,
        zoneProducts: selectedProducts,
        linkedProjectId: linkedProject.id,
        zones,
      };
    };

    loadItems()
      .then(({ rows, zoneProducts, linkedProjectId, zones }) => {
        if (cancelled) return;
        if (linkedProjectId) {
          setPortalProjectData((current) => ({
            ...current,
            [linkedProjectId]: { zones, products: zoneProducts },
          }));
        }
        setItems(rows);
        // Hydrate Accept / 要求修改 / 不接受 + persisted client opinions.
        const nextReviews: Record<string, ItemReview> = {};
        const nextMessages: Record<string, ItemMessage[]> = {};
        const hydrateFromNotes = (
          productId: string,
          status: ZoneProduct['status'] | undefined,
          notes: string | undefined,
        ) => {
          const { feedback } = splitStaffNotesAndFeedback(notes);
          const mapped = status ? ZONE_STATUS_TO_REVIEW[status] : undefined;
          if (mapped) nextReviews[productId] = mapped;
          else if (feedback.length > 0) {
            nextReviews[productId] = feedback[feedback.length - 1].review;
          }
          if (feedback.length > 0) {
            nextMessages[productId] = feedback.map((row, index) => ({
              id: `${productId}-${row.at}-${index}`,
              text: row.text,
              createdAt: row.at,
              authorName: row.author || '客戶',
              authorRole: null,
            }));
          }
        };
        for (const product of zoneProducts) {
          hydrateFromNotes(product.id, product.status, product.notes);
        }
        for (const row of rows) {
          if (!row.id || row.isSectionTitle || row.isDivisionTitle) continue;
          hydrateFromNotes(row.id, row.zoneStatus, row.notes);
        }
        setItemReviews(nextReviews);
        setItemMessages(nextMessages);
        setItemsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setItemsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, portalProjects, quotes, showDetail, syntheticQuotes]);

  const allQuoteRows = useMemo(
    () => [...quotes, ...syntheticQuotes],
    [quotes, syntheticQuotes],
  );
  const versionsByQuote = useMemo(
    () => groupVersions(allQuoteRows),
    [allQuoteRows],
  );
  const availableQuotes = useMemo(() => {
    const invitedTerms = new Set(
      clientProjects
        .flatMap((project) => [
          project.name,
          project.clientName,
          project.clientCompany,
        ])
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
    );
    const designProjectIds = new Set(portalProjects.map((project) => project.id));
    const visible = [...versionsByQuote.values()]
      .map((versions) => versions[0])
      .filter((quote) => {
        const isDesignCard =
          quote.id.startsWith('design-project:') ||
          quote.id.startsWith('confirmed-project:');
        const designId = isDesignCard
          ? quote.id.replace(/^design-project:|^confirmed-project:/, '')
          : '';
        const allowedByPolicy =
          isDesignCard
            ? designProjectIds.has(designId)
            : isAllowedPortalQuote({
                quoteId: quote.quote_id,
                displayName: quoteDisplayName(quote),
                clientName: clientNameOf(quote),
              });
        if (!allowedByPolicy) return false;
        if (!clientOnly) return true;
        if (invitedTerms.size === 0) {
          // Staff/demo portal token without invites: still show allow-listed set.
          return true;
        }
        const values = [quoteDisplayName(quote), clientNameOf(quote)]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        return values.some((value) =>
          [...invitedTerms].some(
            (term) => value.includes(term) || term.includes(value),
          ),
        );
      });
    return [...visible].sort((a, b) => {
      const aDesign = a.id.startsWith('design-project:') ? 1 : 0;
      const bDesign = b.id.startsWith('design-project:') ? 1 : 0;
      if (aDesign !== bDesign) return bDesign - aDesign;
      return (
        new Date(b.modified_date || b.created_at).getTime() -
        new Date(a.modified_date || a.created_at).getTime()
      );
    });
  }, [clientOnly, clientProjects, portalProjects, versionsByQuote]);

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
  const zoneTypeGroups = useMemo(
    () => groupQuoteItemsByZoneType(items),
    [items],
  );
  const pricedItems = items.filter(
    (item) => !item.isSectionTitle && !item.isCustomTerm && !item.isOptional,
  );
  const itemSubtotal = pricedItems.reduce(
    (sum, item) => sum + quoteItemLineSubtotal(item),
    0,
  );

  const itemKey = (item: BwfQuoteItemInput, index: number) =>
    item.id || `${quoteItemDisplayName(item)}-${index}`;

  const syncItemReview = async (
    item: BwfQuoteItemInput,
    review: ItemReview,
    feedbackText?: string,
  ): Promise<boolean> => {
    const key = item.id || '';
    setItemReviews((current) => ({
      ...current,
      [key || itemKey(item, 0)]: review,
    }));
    if (!isZoneProductId(key)) {
      if (feedbackText?.trim()) {
        toast.error('此產品尚未連結設計專案，意見無法儲存');
      }
      return false;
    }

    setSavingReviewKey(key);
    const previousNotes =
      Object.values(portalProjectData)
        .flatMap((entry) => entry.products)
        .find((product) => product.id === key)?.notes ||
      item.notes ||
      '';
    const result = await applyZoneProductClientReview({
      zoneProductId: key,
      review,
      feedbackText,
      authorName: currentUserName,
      previousNotes,
    });
    setSavingReviewKey(null);
    if (!result.ok || !result.data) {
      toast.error('同步設計專案狀態失敗', { description: result.error });
      return false;
    }
    setPortalProjectData((current) => {
      const next: typeof current = { ...current };
      let found = false;
      for (const [projectId, entry] of Object.entries(current)) {
        next[projectId] = {
          ...entry,
          products: entry.products.map((product) => {
            if (product.id !== key) return product;
            found = true;
            return {
              ...product,
              status: result.data!.status,
              notes: result.data!.notes,
            };
          }),
        };
      }
      // Keep cache coherent even if product was missing from local cache.
      if (!found) {
        // no-op: DB already updated; next reopen will reload.
      }
      return next;
    });
    setItems((current) =>
      current.map((row) =>
        row.id === key
          ? {
              ...row,
              notes: result.data!.notes,
              zoneStatus: result.data!.status,
            }
          : row,
      ),
    );
    if (feedbackText?.trim()) {
      const { feedback } = splitStaffNotesAndFeedback(result.data.notes);
      setItemMessages((current) => ({
        ...current,
        [key]: feedback.map((row, index) => ({
          id: `${key}-${row.at}-${index}`,
          text: row.text,
          createdAt: row.at,
          authorName: row.author || currentUserName,
          authorRole: null,
        })),
      }));
    }
    return true;
  };

  const sendItemMessage = async (item: BwfQuoteItemInput, index: number) => {
    const key = itemKey(item, index);
    const text = (itemDraftNotes[key] || '').trim();
    if (!text) {
      toast.error('請先填寫留言內容');
      return;
    }
    const review = itemReviews[key];
    if (review !== 'change' && review !== 'rejected') {
      toast.error('請先選擇「要求修改」或「不接受」');
      return;
    }
    const ok = await syncItemReview(item, review, text);
    if (!ok) return;
    setItemDraftNotes((current) => ({ ...current, [key]: '' }));
    toast.success('已儲存意見至設計專案', {
      description: '下次打開報價方案仍會保留此留言',
    });
  };

  const deleteItemMessage = async (
    item: BwfQuoteItemInput,
    messageId: string,
  ) => {
    const key = item.id || '';
    const messages = itemMessages[key] || [];
    const feedbackIndex = messages.findIndex(
      (message) => message.id === messageId,
    );
    if (feedbackIndex < 0) return;

    const previousNotes =
      Object.values(portalProjectData)
        .flatMap((entry) => entry.products)
        .find((product) => product.id === key)?.notes ||
      item.notes ||
      '';

    setItemMessages((current) => ({
      ...current,
      [key]: (current[key] || []).filter((message) => message.id !== messageId),
    }));

    if (!isZoneProductId(key)) {
      toast.error('此產品尚未連結設計專案，無法刪除已儲存意見');
      return;
    }

    const nextNotes = removeClientFeedbackFromNotes(
      previousNotes,
      feedbackIndex,
    );
    const result = await updateZoneProductNotes(key, nextNotes);
    if (!result.ok) {
      setItemMessages((current) => ({
        ...current,
        [key]: messages,
      }));
      toast.error('刪除意見失敗', { description: result.error });
      return;
    }
    setPortalProjectData((current) => {
      const next: typeof current = { ...current };
      for (const [projectId, entry] of Object.entries(current)) {
        next[projectId] = {
          ...entry,
          products: entry.products.map((product) =>
            product.id === key ? { ...product, notes: nextNotes } : product,
          ),
        };
      }
      return next;
    });
    setItems((current) =>
      current.map((row) =>
        row.id === key ? { ...row, notes: nextNotes } : row,
      ),
    );
    toast.success('已刪除意見');
  };

  const buildExportHtml = () => {
    if (!active) return '';
    const groupsHtml = zoneTypeGroups
      .map((group) => {
        const roomsHtml = group.rooms
          .map((room) => {
            const roomTitle = room.code
              ? `${room.code} · ${room.name}`
              : room.name;
            const sectionsHtml = room.sections
              .map((section) => {
                const itemsHtml = section.items
                  .map((item, index) => {
                    const key = itemKey(item, index);
                    const review = itemReviews[key]
                      ? REVIEW_LABEL[itemReviews[key]]
                      : '尚未決定';
                    const feedbackNotes = (itemMessages[key] || [])
                      .map((message) => {
                        const roleLabel = message.authorRole
                          ? ROLE_META[message.authorRole].label
                          : '';
                        return `${message.authorName}${roleLabel ? ` [${roleLabel}]` : ''} ${fmtUtc8DateTime(message.createdAt)} ${message.text}`;
                      })
                      .join('；');
                    const dimsLabel =
                      formatProductDimensionsMm(
                        item.dimensionLMm,
                        item.dimensionWMm,
                        item.dimensionHMm,
                      ) || '—';
                    const staffNotes = portalNotesDisplay(item.notes) || '—';
                    return `<div class="item">
                  ${
                    item.image
                      ? `<img src="${escapeHtml(item.image)}" alt="">`
                      : ''
                  }
                  <div class="grow">
                    <div class="name-row"><strong>${escapeHtml(quoteItemDisplayName(item))}</strong></div>
                    <p><span class="label">尺寸</span> ${escapeHtml(dimsLabel)}</p>
                    <p><span class="label">備註</span> ${escapeHtml(staffNotes)}</p>
                    <p>${fmtMoney(Number(item.unitPrice || 0))} × ${escapeHtml(item.quantity || 1)} ${escapeHtml(item.unit || '')}</p>
                    <p class="review">客戶決定：${escapeHtml(review)}${feedbackNotes ? `（${escapeHtml(feedbackNotes)}）` : ''}</p>
                  </div>
                  <b>${item.isOptional ? '可選' : fmtMoney(quoteItemLineSubtotal(item))}</b>
                </div>`;
                  })
                  .join('');
                const divisionHeader = section.label
                  ? `<h4>${escapeHtml(section.label)} <span class="meta">${section.items.length} 件傢俬</span></h4>`
                  : '';
                return `${divisionHeader}${itemsHtml}`;
              })
              .join('');
            return `<div class="room"><h3>${escapeHtml(roomTitle)}</h3>${
              sectionsHtml || '<p class="meta">此區域暫未選擇產品</p>'
            }</div>`;
          })
          .join('');
        return `
          <section>
            <h2>${escapeHtml(group.label)}</h2>
            <p class="meta">${group.rooms.length} 個${escapeHtml(group.label)}</p>
            ${roomsHtml}
          </section>`;
      })
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
        body{font-family:"Noto Sans HK","Noto Sans TC",sans-serif;color:#16182a;max-width:1080px;margin:0 auto;padding:40px}
        header{border-bottom:2px solid #6366f1;padding-bottom:22px;margin-bottom:26px}
        h1{margin:0 0 8px;font-size:28px} h2{font-size:19px;margin-top:28px} h3{font-size:16px;margin:18px 0 8px}
        h4{font-size:13px;margin:14px 0 8px;padding:8px 10px;background:#f5f6fb;border-radius:8px}
        .meta{color:#62677a}.room{margin:12px 0 18px;padding:12px;border:1px solid #ececf5;border-radius:12px}
        .item{display:flex;gap:18px;align-items:flex-start;border:1px solid #e4e5ef;border-radius:12px;padding:14px;margin:10px 0}
        .item img{width:${PORTAL_PRODUCT_IMAGE_PX}px;height:${PORTAL_PRODUCT_IMAGE_PX}px;object-fit:cover;border-radius:10px;flex-shrink:0}
        .grow{flex:1}.item p{margin:6px 0;color:#62677a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
        .label{font-weight:600;margin-right:6px}
        .name-row{display:flex;justify-content:space-between;gap:16px}.name-row small{font-size:10px;color:#8a8d99;font-family:monospace}
        .review{color:#4338ca!important}.total{margin:24px 0;padding:14px 16px;background:#f2f2ff;border-radius:12px;display:flex;justify-content:space-between;align-items:center;font-weight:700}
        .decision{margin-top:18px;padding:18px;background:#f2f2ff;border-radius:12px}
        @media print{body{padding:0}.item{break-inside:avoid}}
      </style></head><body>
      <header><p>BW Furniture · Client Portal</p>
        <h1>${escapeHtml(quoteDisplayName(active))}</h1>
        <p class="meta">${escapeHtml(active.quote_id)} · ${escapeHtml(displayQuoteVersion(active.version))} · ${fmtDate(active.modified_date || active.created_at)}</p>
      </header>
      ${groupsHtml}
      <div class="total"><span>報價總額</span><span>${fmtMoney(active.total_amount || itemSubtotal)}</span></div>
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

  const resolveLinkedProject = useCallback((): DesignProject | null => {
    if (!activeId) return null;
    const syntheticProjectId = activeId.startsWith('design-project:')
      ? activeId.replace('design-project:', '')
      : activeId.startsWith('confirmed-project:')
        ? activeId.replace('confirmed-project:', '')
        : '';
    if (syntheticProjectId) {
      return (
        portalProjects.find((project) => project.id === syntheticProjectId) ||
        null
      );
    }
    if (!active) return null;
    return (
      portalProjects.find(
        (project) => projectQuoteId(project) === active.quote_id,
      ) || null
    );
  }, [active, activeId, portalProjects]);

  const submitResponse = async () => {
    if (!active) return;
    const note = quoteNote.trim();
    if (quoteDecision === 'pending' && !note) {
      toast.error('請選擇確認／拒絕整張報價，或輸入回覆後再提交');
      return;
    }
    const linkedProject = resolveLinkedProject();
    if (!linkedProject) {
      toast.error('找不到對應的設計專案，無法提交');
      return;
    }

    const decision =
      quoteDecision === 'approved'
        ? 'approved'
        : quoteDecision === 'rejected'
          ? 'rejected'
          : 'comment';
    const clientQuoteReply = {
      decision: decision as 'approved' | 'rejected' | 'comment',
      note,
      submittedAt: new Date().toISOString(),
      quoteId: active.quote_id,
      version: active.version,
    };
    const nextMeta = {
      ...linkedProject.meta,
      clientQuoteReply,
    };
    const patch =
      decision === 'approved'
        ? { status: 'confirmed', progress: 100, meta: nextMeta }
        : { meta: nextMeta };

    setSubmittingQuote(true);
    try {
      const saved = await saveProject(linkedProject.id, patch);
      if (!saved.ok) {
        toast.error('提交失敗', { description: saved.error });
        return;
      }
      setPortalProjects((current) =>
        current.map((row) =>
          row.id === linkedProject.id
            ? {
                ...row,
                status:
                  decision === 'approved' ? 'confirmed' : row.status,
                progress:
                  decision === 'approved' ? 100 : row.progress,
                meta: nextMeta,
              }
            : row,
        ),
      );
      if (decision === 'approved') {
        toast.success('已確認整張報價並提交', {
          description: '方案已標示為已確認，可在「已確定方案」查看',
        });
      } else if (decision === 'rejected') {
        toast.success('已提交拒絕整張報價的回覆', {
          description: '方案仍為進行中；回覆已顯示於設計專案',
        });
      } else {
        toast.success('已提交回覆', {
          description: '方案仍為進行中；回覆已顯示於設計專案',
        });
      }
    } finally {
      setSubmittingQuote(false);
    }
  };

  return (
    <PortalPageShell
      title={showDetail && active ? quoteDisplayName(active) : '報價方案'}
      badge="Client Portal"
      subtitle="查看自己的 HTML 報價、切換版本、按工程分區批核產品，並回覆整張報價。"
      maxWidthClass="max-w-none"
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
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {availableQuotes.map((quote) => {
              const selected = active?.quote_id === quote.quote_id;
              const versions = versionsByQuote.get(quote.quote_id) || [quote];
              const linkedDesignProject =
                quote.id.startsWith('design-project:') ||
                quote.id.startsWith('confirmed-project:') ||
                portalProjects.some(
                  (project) => projectQuoteId(project) === quote.quote_id,
                );
              return (
                <button
                  key={`${quote.id}:${quote.quote_id}`}
                  type="button"
                  onClick={() => {
                    setActiveId(quote.id);
                    setShowDetail(true);
                    setItemReviews({});
                    setItemDraftNotes({});
                    setItemMessages({});
                    const linked =
                      quote.id.startsWith('design-project:')
                        ? portalProjects.find(
                            (project) =>
                              project.id ===
                              quote.id.replace('design-project:', ''),
                          )
                        : quote.id.startsWith('confirmed-project:')
                          ? portalProjects.find(
                              (project) =>
                                project.id ===
                                quote.id.replace('confirmed-project:', ''),
                            )
                          : portalProjects.find(
                              (project) =>
                                projectQuoteId(project) === quote.quote_id,
                            );
                    const hydrated = hydrateQuoteReplyFromProject(linked);
                    setQuoteDecision(hydrated.decision);
                    setQuoteNote(hydrated.note);
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
                        linkedDesignProject
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : quoteStatusBadgeClass(quote.status),
                      )}
                    >
                      {linkedDesignProject
                        ? quote.status || '設計專案'
                        : quote.status || '—'}
                    </span>
                  </div>
                  <h3 className="mt-4 line-clamp-2 font-display text-lg font-bold">
                    {quoteDisplayName(quote)}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {clientNameOf(quote)} · {versions.length} 個版本
                  </p>
                  {linkedDesignProject ? (
                    <p className="mt-2 inline-flex rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      來自設計專案
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
                    const nextId = event.target.value;
                    setActiveId(nextId);
                    setItemReviews({});
                    setItemDraftNotes({});
                    setItemMessages({});
                    const nextQuote = activeVersions.find(
                      (version) => version.id === nextId,
                    );
                    const linked = nextQuote
                      ? nextId.startsWith('design-project:')
                        ? portalProjects.find(
                            (project) =>
                              project.id ===
                              nextId.replace('design-project:', ''),
                          )
                        : nextId.startsWith('confirmed-project:')
                          ? portalProjects.find(
                              (project) =>
                                project.id ===
                                nextId.replace('confirmed-project:', ''),
                            )
                          : portalProjects.find(
                              (project) =>
                                projectQuoteId(project) === nextQuote.quote_id,
                            )
                      : null;
                    const hydrated = hydrateQuoteReplyFromProject(linked);
                    setQuoteDecision(hydrated.decision);
                    setQuoteNote(hydrated.note);
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
          </div>

          {itemsLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : zoneTypeGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">
              此版本暫無產品明細
            </div>
          ) : (
            <div className="space-y-7">
              {zoneTypeGroups.map((group) => {
                const productCount = group.rooms.reduce(
                  (sum, room) => sum + roomProductCount(room),
                  0,
                );
                return (
                  <section key={group.key} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2.5">
                      <div>
                        <h3 className="font-display text-lg font-bold">
                          {group.label}
                        </h3>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {group.rooms.length} 個{group.label}
                        </p>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {productCount} 件產品
                      </span>
                    </div>

                    <div className="space-y-3">
                      {group.rooms.map((room) => {
                        const roomCount = roomProductCount(room);
                        return (
                        <section
                          key={room.id}
                          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <h4 className="font-display text-base font-bold">
                                {room.name}
                              </h4>
                              <span className="text-sm text-muted-foreground">
                                {roomCount} 件產品
                              </span>
                            </div>
                          </div>
                          <div className="divide-y divide-border/70">
                            {roomCount === 0 ? (
                              <p className="px-5 py-6 text-sm text-muted-foreground">
                                此區域暫未選擇產品
                              </p>
                            ) : null}
                            {room.sections.map((section) => (
                              <div key={section.id}>
                                {section.label ? (
                                  <div className="border-b border-border bg-muted/20 px-5 py-2.5">
                                    <h5 className="font-display text-[13px] font-bold text-foreground md:text-[14px]">
                                      {section.label}
                                      <span className="ml-1.5 text-[12px] font-semibold text-muted-foreground">
                                        {section.items.length} 件傢俬
                                      </span>
                                    </h5>
                                  </div>
                                ) : null}
                                {section.items.map((item, index) => {
                              const key = itemKey(item, index);
                              const review = itemReviews[key];
                              const messages = itemMessages[key] || [];
                              const dimsLabel = formatProductDimensionsMm(
                                item.dimensionLMm,
                                item.dimensionWMm,
                                item.dimensionHMm,
                              );
                              const notesLabel = portalNotesDisplay(item.notes);
                              return (
                                <article
                                  key={key}
                                  className="border-b border-border/70 p-5 last:border-b-0"
                                >
                                  <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
                                    <div
                                      className="shrink-0 overflow-hidden rounded-xl bg-muted"
                                      style={{
                                        width: PORTAL_PRODUCT_IMAGE_PX,
                                        height: PORTAL_PRODUCT_IMAGE_PX,
                                        maxWidth: '100%',
                                      }}
                                    >
                                      {item.image ? (
                                        <img
                                          src={item.image}
                                          alt={quoteItemDisplayName(item)}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : null}
                                    </div>
                                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <h5 className="min-w-0 flex-1 text-base font-bold leading-snug">
                                          {quoteItemDisplayName(item)}
                                        </h5>
                                        <div className="shrink-0 text-right">
                                          <p className="font-mono-data text-lg font-bold">
                                            {item.isOptional
                                              ? '可選'
                                              : fmtMoney(
                                                  quoteItemLineSubtotal(item),
                                                )}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                                        <p className="font-mono-data text-sm text-muted-foreground">
                                          <span className="mr-1.5 font-medium">
                                            尺寸
                                          </span>
                                          {dimsLabel || '—'}
                                        </p>
                                        <p className="min-w-0 flex-1 whitespace-pre-wrap font-mono-data text-sm text-muted-foreground">
                                          <span className="mr-1.5 font-medium">
                                            備註
                                          </span>
                                          {notesLabel || '—'}
                                        </p>
                                      </div>

                                      <p className="font-mono-data text-sm text-primary">
                                        {fmtMoney(Number(item.unitPrice || 0))} ×{' '}
                                        {item.quantity || 1} {item.unit || ''}
                                      </p>

                                      {!item.isOptional ? (
                                        <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-4">
                                          {(
                                            [
                                              ['accepted', '接受', Check],
                                              [
                                                'change',
                                                '要求修改',
                                                MessageSquare,
                                              ],
                                              ['rejected', '不接受', Ban],
                                            ] as const
                                          ).map(([value, label, Icon]) => (
                                            <button
                                              key={value}
                                              type="button"
                                              disabled={savingReviewKey === key}
                                              onClick={() => {
                                                void syncItemReview(item, value);
                                                if (value === 'accepted') {
                                                  toast.success(
                                                    '已同步為「已確定」',
                                                  );
                                                }
                                              }}
                                              className={cn(
                                                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60',
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
                                      {messages.length > 0 ? (
                                        <div className="space-y-2">
                                          {messages.map((message) => (
                                            <div
                                              key={message.id}
                                              className="rounded-xl border border-border bg-muted/20 px-3 py-2.5"
                                            >
                                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                                <span className="font-semibold text-foreground">
                                                  {message.authorName ||
                                                    currentUserName}
                                                </span>
                                                {message.authorRole ? (
                                                  <span
                                                    className={cn(
                                                      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                                                      ROLE_META[
                                                        message.authorRole
                                                      ].className,
                                                    )}
                                                  >
                                                    {
                                                      ROLE_META[
                                                        message.authorRole
                                                      ].label
                                                    }
                                                  </span>
                                                ) : null}
                                                <span className="font-mono-data">
                                                  {fmtUtc8DateTime(
                                                    message.createdAt,
                                                  )}{' '}
                                                  <span className="text-[10px]">
                                                    (UTC+8)
                                                  </span>
                                                </span>
                                              </div>
                                              <div className="mt-1 flex items-start justify-between gap-3">
                                                <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
                                                  {message.text}
                                                </p>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void deleteItemMessage(
                                                      item,
                                                      message.id,
                                                    )
                                                  }
                                                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-500/30 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-500/10"
                                                >
                                                  <Trash2 className="h-3.5 w-3.5" />
                                                  刪除
                                                </button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                      {review === 'change' ||
                                      review === 'rejected' ? (
                                        <div>
                                          <textarea
                                            value={itemDraftNotes[key] || ''}
                                            onChange={(event) =>
                                              setItemDraftNotes((current) => ({
                                                ...current,
                                                [key]: event.target.value,
                                              }))
                                            }
                                            rows={2}
                                            placeholder="請說明需要修改或不接受的原因…"
                                            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                                          />
                                          <div className="mt-2 flex justify-end">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                void sendItemMessage(item, index)
                                              }
                                              disabled={savingReviewKey === key}
                                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                                            >
                                              {savingReviewKey === key ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                              ) : null}
                                              確定
                                            </button>
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </article>
                              );
                                })}
                              </div>
                            ))}
                          </div>
                        </section>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3">
            <span className="font-semibold">報價總額</span>
            <strong className="font-mono-data text-xl text-primary">
              {fmtMoney(active.total_amount || itemSubtotal)}
            </strong>
          </div>

          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
            <h2 className="font-display text-lg font-bold">整張報價決定</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              選擇「確認整張報價」並按「提交」後，方案會標示為已確認；拒絕或只輸入回覆再提交，則只傳送意見，方案仍為進行中。
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
              onClick={() => void submitResponse()}
              disabled={submittingQuote}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
            >
              {submittingQuote ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
              提交
            </button>
          </section>
        </section>
      ) : null}
    </PortalPageShell>
  );
}
