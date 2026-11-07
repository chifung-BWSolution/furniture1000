import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  History,
  Layers,
  LayoutGrid,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Package,
  PenLine,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { originalImageUrl, productThumbUrl } from '@/lib/imageThumb';
import { LoadingImage } from '@/components/ui/loading-image';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  loadClientQuoteItems,
  replaceQuoteItems,
  stripItemsFromProjectData,
  type BwfQuoteItemInput,
} from '@/lib/bwfQuoteItems';
import { hydrateProductIdsForQuoteItems } from '@/lib/quoteItemProductLink';
import { compareQuoteVersion, displayQuoteVersion } from '@/lib/quoteVersions';
import { quoteStatusBadgeClass } from '@/lib/listTableUtils';
import {
  loadPitchingsForQuoteRows,
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
  fetchProjectById,
  fetchZones,
  fetchZoneProducts,
  fetchZonesForProjects,
  fetchZoneProductsForProjects,
  fetchProductsDisplayMeta,
  applyZoneProductClientReview,
  updateZoneProductNotes,
  updateZoneProductQuantity,
  mergeProjectMeta,
  saveProject,
} from '@/lib/solutionsApi';
import { withInsertAuditFields, withUpdateAuditFields } from '@/lib/pmsAudit';
import { formatProductDimensionsMm } from '@/lib/productDimensions';
import {
  productGalleryExtras,
  productGalleryLightboxUrls,
} from '@/lib/productGallery';
import {
  ProductExtraImageThumbs,
  ProductImageGalleryLightbox,
} from '@/components/dashboard/ProductImageGallery';
import {
  readStoredPortalToken,
  readStoredQuoteShareTarget,
  readStoredQuoteShareToken,
  storeQuoteShareTarget,
  storeQuoteShareToken,
  withCustomerPortalQuery,
} from '@/lib/customerPortalRoutes';
import { resolveQuoteShareToken } from '@/lib/bwfQuoteShareLinks';
import {
  customerQuoteError,
  confirmSharedCustomerQuote,
  fetchSharedCustomerQuote,
  fetchSharedQuoteRequests,
  listCustomerQuotes,
  loadCustomerSafeItems,
  submitCustomerQuoteRequest,
  type CustomerSharedQuoteRequestRow,
} from '@/lib/customerQuoteAccess';
import { QuoteRelatedFurniture } from '@/components/dashboard/customers/QuoteRelatedFurniture';
import type { QuoteRelatedFurnitureHandle } from '@/components/dashboard/customers/QuoteRelatedFurniture';
import {
  customerRequestStatusLabel,
  customerRequestTypeLabel,
} from '@/lib/customerQuoteRequests';
import { recordQuoteShareView } from '@/lib/quoteEmailFollowUp';
import {
  buildCustomerQuotePdfData,
  fetchCustomerQuotePdfPayload,
} from '@/lib/customerQuotePdf';
import type { QuotationPDFData } from '@/types/quotation-pdf';
import { publishDesignProjectStickyChrome } from '@/lib/designProjectStickyChrome';
import { unsavedGuard } from '@/lib/unsavedGuard';
import {
  FloorPlanThumb,
  FloorPlanViewerModal,
  floorPlanPreviewOf,
} from '@/components/dashboard/solutions/FloorPlanViewerModal';
import type {
  DesignProject,
  DesignProjectMeta,
  FurnitureSchemeGroup,
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

type QuoteClientInfo = {
  name?: string;
  contactName?: string;
  phone?: string;
  email?: string;
};

type QuoteTermsContent = {
  transport?: string;
  extraFees?: string;
  warranty?: string;
  other?: string;
  payment?: string;
  fullHtml?: string;
};

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
      clientPhone?: string;
      clientEmail?: string;
    };
    clientInfo?: QuoteClientInfo;
    deliveryDetails?: string;
    deliveryDetailsEn?: string;
    termsContent?: QuoteTermsContent;
    termsContentEn?: QuoteTermsContent;
    [key: string]: unknown;
  };
  pitching?: PmsPitchingListItem | null;
};

/** Real bwf_quote rows (快速報價 / QR share) — not synthetic design-project cards. */
function isBwfQuoteRecord(quote: QuoteRecord | null | undefined): boolean {
  if (!quote?.id) return false;
  return (
    !quote.id.startsWith('design-project:') &&
    !quote.id.startsWith('confirmed-project:')
  );
}

/** Linked design project id for synthetic cards or invite/shell quotes. */
function designProjectIdOf(quote: QuoteRecord | null | undefined): string {
  if (!quote?.id) return '';
  if (quote.id.startsWith('design-project:')) {
    return quote.id.replace('design-project:', '');
  }
  if (quote.id.startsWith('confirmed-project:')) {
    return quote.id.replace('confirmed-project:', '');
  }
  const fromData = (
    quote.project_data as { designProjectId?: string } | null | undefined
  )?.designProjectId;
  return String(fromData || '').trim();
}

/**
 * BWA = 傢俬方案「設計專案」(incl. 邀請客戶 shell quotes with designProjectId / DP-).
 * BWF = 傢俬報價「報價單一覽」正式報價單.
 */
function isBwaPortalQuote(quote: QuoteRecord | null | undefined): boolean {
  if (!quote?.id) return false;
  if (designProjectIdOf(quote)) return true;
  if (/^DP-/i.test(String(quote.quote_id || '').trim())) return true;
  return String(quote.status || '').trim() === '客戶方案';
}

function portalClientInfoOf(quote: QuoteRecord): {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
} {
  const info = quote.project_data?.clientInfo;
  const form = quote.project_data?.formData;
  return {
    companyName: (info?.name || form?.clientName || '').trim(),
    contactName: (info?.contactName || form?.clientContactName || '').trim(),
    phone: (info?.phone || form?.clientPhone || '').trim(),
    email: (info?.email || form?.clientEmail || '').trim(),
  };
}

function portalDeliveryDetailsOf(quote: QuoteRecord): string {
  const raw = quote.project_data?.deliveryDetails;
  return typeof raw === 'string' ? raw.trim() : '';
}

type QuoteTermsSection = {
  key: string;
  title: string;
  text: string;
};

/** Split 報價條款 into the four portal accordion sections. */
function portalTermsSectionsOf(quote: QuoteRecord): QuoteTermsSection[] {
  const terms = quote.project_data?.termsContent;
  const parts: QuoteTermsSection[] = [
    {
      key: 'payment',
      title: '訂單及付款',
      text: [terms?.payment]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join('\n'),
    },
    {
      key: 'delivery',
      title: '交付及安裝',
      text: [quote.project_data?.deliveryDetails, terms?.transport]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join('\n'),
    },
    {
      key: 'warranty',
      title: '保養及維修',
      text: [terms?.warranty, terms?.extraFees]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join('\n'),
    },
    {
      key: 'other',
      title: '其他條款',
      text: [terms?.other]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join('\n'),
    },
  ];
  if (parts.some((part) => part.text)) return parts;
  const html = portalTermsHtmlOf(quote);
  if (!html) return parts;
  return [
    {
      key: 'full',
      title: '條款及細則',
      text: html
        .replace(/<[^>]+>/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim(),
    },
  ];
}

function portalTermsHtmlOf(quote: QuoteRecord): string {
  const terms = quote.project_data?.termsContent;
  const html = typeof terms?.fullHtml === 'string' ? terms.fullHtml.trim() : '';
  if (html) return html;
  if (!terms) return '';
  const parts = [
    terms.payment,
    terms.transport,
    terms.extraFees,
    terms.warranty,
    terms.other,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br/>')}</p>`).join('');
}

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
  /** Planned piece count from 設計專案 傢俬劃分; null when unknown. */
  plannedQuantity: number | null;
  items: BwfQuoteItemInput[];
};
type QuoteRoomGroup = {
  id: string;
  /** project_zones.id when the section title was built from a design project. */
  zoneId: string | null;
  code: string;
  name: string;
  sections: QuoteRoomSection[];
};
type QuoteZoneTypeGroup = {
  key: string;
  label: string;
  rooms: QuoteRoomGroup[];
};

/** Match 設計專案 product image size (single-product row / print). */
const PORTAL_PRODUCT_IMAGE_PX = 300;

/** Sticky / headers: keep level-2 only from「一級 > 二級」division labels. */
function divisionLevel2Label(label: string): string {
  const raw = String(label || '').trim();
  if (!raw) return '';
  const parts = raw.split(/\s*>\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1] || raw;
  return raw;
}

type QuoteSchemeSlot = {
  key: string;
  items: BwfQuoteItemInput[];
};

function normalizePortalSchemeGroups(
  value: unknown,
): Record<string, FurnitureSchemeGroup[]> {
  if (!value || typeof value !== 'object') return {};
  const next: Record<string, FurnitureSchemeGroup[]> = {};
  for (const [zoneId, rows] of Object.entries(value as Record<string, unknown>)) {
    if (!zoneId || !Array.isArray(rows)) continue;
    next[zoneId] = rows
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const item = row as Record<string, unknown>;
        const id = String(item.id || '').trim();
        const productIds = Array.isArray(item.productIds)
          ? [
              ...new Set(
                item.productIds
                  .map((pid) => String(pid || '').trim())
                  .filter(Boolean),
              ),
            ]
          : [];
        if (!id || productIds.length === 0) return null;
        return { id, productIds } satisfies FurnitureSchemeGroup;
      })
      .filter((row): row is FurnitureSchemeGroup => Boolean(row));
  }
  return next;
}

/** If any scheme-group member is assigned, treat the whole group as assigned. */
function expandIdsWithSchemeGroups(
  assignedIds: Iterable<string>,
  groups: FurnitureSchemeGroup[],
): Set<string> {
  const next = new Set(
    [...assignedIds].map((id) => String(id || '').trim()).filter(Boolean),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (!group.productIds.some((id) => next.has(id))) continue;
      for (const id of group.productIds) {
        if (next.has(id)) continue;
        next.add(id);
        changed = true;
      }
    }
  }
  return next;
}

function buildQuoteSchemeSlots(
  items: BwfQuoteItemInput[],
  groups: FurnitureSchemeGroup[],
): QuoteSchemeSlot[] {
  const itemById = new Map(
    items
      .filter((item) => item.id)
      .map((item) => [String(item.id), item] as const),
  );
  const used = new Set<string>();
  const slots: QuoteSchemeSlot[] = [];

  for (const item of items) {
    const id = String(item.id || '');
    if (!id || used.has(id)) continue;
    const group = groups.find((row) => row.productIds.includes(id));
    if (group) {
      const grouped = group.productIds
        .map((pid) => itemById.get(pid))
        .filter((row): row is BwfQuoteItemInput => Boolean(row));
      if (grouped.length === 0) continue;
      grouped.forEach((row) => {
        if (row.id) used.add(String(row.id));
      });
      slots.push({ key: group.id, items: grouped });
      continue;
    }
    used.add(id);
    slots.push({ key: id, items: [item] });
  }
  return slots;
}

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
      .trim() || '其他分區'
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

function zoneIdFromSectionTitleItem(
  item: BwfQuoteItemInput,
): string | null {
  const id = String(item.id || '').trim();
  if (!id.startsWith('zone-')) return null;
  const zoneId = id.slice('zone-'.length).trim();
  return zoneId || null;
}

function divisionPlannedQuantity(
  item: BwfQuoteItemInput,
): number | null {
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return Math.floor(qty);
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
      plannedQuantity: null,
      items: [],
    };
    currentRoom.sections.push(currentSection);
  };

  const ensureRoom = (title: string, zoneId: string | null = null) => {
    const parsed = parseZoneSectionTitle(title);
    // Group by the quotation's zone type (AREA / ROOM / FOYER); fall back to
    // the room name when the section title has no type code.
    const key = parsed.code ? parsed.prefix : parsed.label;
    let groupIndex = indexByKey.get(key);
    if (groupIndex == null) {
      groupIndex = groups.length;
      indexByKey.set(key, groupIndex);
      groups.push({
        key,
        label: key,
        rooms: [],
      });
    }
    const group = groups[groupIndex];
    currentRoom = {
      id: `${key}:${parsed.name}:${group.rooms.length}`,
      zoneId,
      code: parsed.code,
      name: parsed.name || parsed.label,
      sections: [],
    };
    currentSection = null;
    group.rooms.push(currentRoom);
  };

  for (const item of items) {
    if (item.isSectionTitle) {
      ensureRoom(
        item.name?.trim() || '其他區域',
        zoneIdFromSectionTitleItem(item),
      );
      continue;
    }
    if (item.isDivisionTitle) {
      if (!currentRoom) ensureRoom('報價產品');
      currentSection = {
        id: item.id || `${currentRoom!.id}:div:${currentRoom!.sections.length}`,
        label: item.name?.trim() || '傢俬劃分',
        plannedQuantity: divisionPlannedQuantity(item),
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

function roomProductCount(
  room: QuoteRoomGroup,
  schemeGroups: FurnitureSchemeGroup[] = [],
): number {
  return room.sections.reduce(
    (sum, section) => sum + sectionDisplayCount(section, schemeGroups),
    0,
  );
}

function roomPlannedFurnitureCount(room: QuoteRoomGroup): number {
  return room.sections.reduce(
    (sum, section) => sum + (section.plannedQuantity || 0),
    0,
  );
}

function sectionDisplayCount(
  section: QuoteRoomSection,
  schemeGroups: FurnitureSchemeGroup[] = [],
): number {
  if (section.plannedQuantity != null && section.plannedQuantity > 0) {
    return section.plannedQuantity;
  }
  // Unselected portal qty may be 0 — still count each product slot as ≥1 for「總共N件」.
  return buildQuoteSchemeSlots(section.items, schemeGroups).reduce(
    (sum, slot) => {
      const qty = Number(slot.items[0]?.quantity);
      return sum + (Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1);
    },
    0,
  );
}

/** Read-only sqft for 報價方案 — hide when missing / zero. */
function zoneSqftForDisplay(
  zoneAreasSqft: Record<string, number> | undefined,
  zoneId: string | null | undefined,
): number | null {
  if (!zoneId || !zoneAreasSqft) return null;
  const num = Number(zoneAreasSqft[zoneId]);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function formatZoneSqftLabel(sqft: number): string {
  const rounded = Math.round(sqft * 100) / 100;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded);
  return `${text} 平方尺 sqft`;
}

function zoneGroupDomId(label: string): string {
  return `quote-zone-group-${encodeURIComponent(label.trim() || 'zone')}`;
}

/**
 * Client selection state（由「接受」驅動）.
 * Unselected / 要求修改 / 不接受 lines are excluded from totals & quota.
 */
function isQuoteItemSelected(
  item: BwfQuoteItemInput,
  itemSelected: Record<string, boolean>,
): boolean {
  const id = String(item.id || '').trim();
  if (!id) return false;
  if (Object.prototype.hasOwnProperty.call(itemSelected, id)) {
    return Boolean(itemSelected[id]);
  }
  return false;
}

/** Selected piece count across a whole furniture-division section. */
function sectionSelectedQuantity(
  section: QuoteRoomSection,
  itemSelected: Record<string, boolean>,
): number {
  return section.items.reduce((sum, item) => {
    if (!isQuoteItemSelected(item, itemSelected)) return sum;
    return sum + Math.max(0, Math.floor(Number(item.quantity) || 0));
  }, 0);
}

/** Portal line total — ignores catalog `isOptional` (selection handled separately). */
function clientQuoteLineTotal(item: BwfQuoteItemInput): number {
  if (item.isSectionTitle || item.isDivisionTitle || item.isCustomTerm) return 0;
  return (Number(item.unitPrice) || 0) * Math.max(0, Math.floor(Number(item.quantity) || 0));
}

function readClientQuoteScheme(
  meta: DesignProjectMeta | null | undefined,
): DesignProjectMeta['clientQuoteScheme'] | null {
  const scheme = meta?.clientQuoteScheme;
  if (!scheme || typeof scheme !== 'object') return null;
  return scheme;
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

/** Selected piece count within one scheme slot (only「選擇」items). */
function schemeSlotSelectedQuantity(
  slot: QuoteSchemeSlot,
  itemSelected: Record<string, boolean>,
): number {
  return slot.items.reduce((sum, item) => {
    if (!isQuoteItemSelected(item, itemSelected)) return sum;
    return sum + Math.max(0, Math.floor(Number(item.quantity) || 0));
  }, 0);
}

const PORTAL_UNSAVED_LEAVE_MESSAGE =
  '您有尚未儲存／提交的報價方案修改。離開、重新整理或關閉頁面前請先按「儲存」或頁底「提交」，否則資料可能遺失。';

/** Vertical product card for 報價方案 3-column grid (matches 設計專案 scheme cards). */
function QuotePortalProductCard({
  item,
  schemeIndex,
  schemeCount,
  productOrdinal,
  partitionSpy,
  review,
  messages,
  selected,
  draftNote,
  saving,
  currentUserName,
  quotaFilled,
  maxQuantity,
  onSetQuantity,
  onSetDraftNote,
  onSendMessage,
  onDeleteMessage,
  onSetReview,
  onPreviewImage,
}: {
  item: BwfQuoteItemInput;
  schemeIndex: number;
  schemeCount: number;
  /** 1-based product slot index when division has 2+ products; omit for single-product. */
  productOrdinal?: number;
  /** Scroll-spy markers for sticky「區域 | 劃分 : 總共N 件產品 (產品X)」line. */
  partitionSpy?: {
    zoneLabel: string;
    zoneTitle: string;
    divisionLabel: string;
    count: number;
    picked: number;
  } | null;
  review: ItemReview | undefined;
  messages: ItemMessage[];
  selected: boolean;
  draftNote: string;
  saving: boolean;
  currentUserName: string;
  /** Unselected scheme card when division qty is already met. */
  quotaFilled?: boolean;
  /** Max qty allowed for this card (respects remaining division need). */
  maxQuantity?: number | null;
  onSetQuantity: (quantity: number) => void;
  onSetDraftNote: (value: string) => void;
  onSendMessage: () => void;
  onDeleteMessage: (messageId: string) => void;
  onSetReview: (review: ItemReview | null) => void;
  onPreviewImage: (urls: string[], title: string, startIndex?: number) => void;
}) {
  const dimsLabel = formatProductDimensionsMm(
    item.dimensionLMm,
    item.dimensionWMm,
    item.dimensionHMm,
  );
  const notesLabel = portalNotesDisplay(item.notes);
  const lineTotal = clientQuoteLineTotal(item);
  // Portal default: 0 until accepted; selected cards use at least the stored qty.
  const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
  const multiScheme = schemeCount > 1;
  const dimmed = Boolean(quotaFilled && !selected);
  const qtyCeiling =
    typeof maxQuantity === 'number' && Number.isFinite(maxQuantity)
      ? Math.max(0, Math.floor(maxQuantity))
      : 9999;
  const title = quoteItemDisplayName(item);
  // Keep full extras list so +N overflow can be counted (UI shows 3).
  const galleryExtras = productGalleryExtras(item.image, item.galleryUrls, 99);
  const galleryLightboxUrls = productGalleryLightboxUrls(
    item.image,
    item.galleryUrls,
  ).map(fullSizeImageUrl);
  const openGalleryAt = (startIndex = 0) => {
    if (galleryLightboxUrls.length === 0) return;
    onPreviewImage(galleryLightboxUrls, title, startIndex);
  };
  const openGalleryAtExtra = (extraIndex: number) => {
    const url = galleryExtras[extraIndex];
    if (!url) return;
    const startIndex = galleryLightboxUrls.findIndex((src) => src === url);
    openGalleryAt(startIndex >= 0 ? startIndex : Math.min(extraIndex + 1, galleryLightboxUrls.length - 1));
  };
  const stopCardSelect = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };
  /** Blank-area click = toggle「接受」(replaces former「選擇」). */
  const toggleAcceptSelect = () => {
    if (dimmed) return;
    if (selected || review === 'accepted') {
      onSetReview(null);
      return;
    }
    onSetReview('accepted');
  };

  const reviewActions = (
    <div
      className={cn(
        'mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-3',
        // Single-scheme: actions bottom-right (legacy 1-col row). Multi: centered under card.
        multiScheme ? 'justify-center' : 'justify-end',
      )}
    >
      {(
        [
          {
            value: 'accepted' as const,
            label: '接受',
            Icon: Check,
            iconClass: 'text-emerald-600',
            activeClass:
              'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
            // 「接受」也可取消已選；額滿變灰的未選卡不可再接受
            disabled: saving || (dimmed && !selected),
          },
          {
            value: 'change' as const,
            label: '要求修改',
            Icon: PenLine,
            iconClass: 'text-amber-600',
            activeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
            disabled: saving || dimmed,
          },
          {
            value: 'rejected' as const,
            label: '不接受',
            Icon: X,
            iconClass: 'text-rose-600',
            activeClass: 'border-rose-500/40 bg-rose-500/10 text-rose-700',
            disabled: saving || dimmed,
          },
        ] as const
      ).map(({ value, label, Icon, iconClass, activeClass, disabled }) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={(event) => {
            stopCardSelect(event);
            if (review === value || (value === 'accepted' && selected)) {
              // Toggle off accept/select, or clear the same review again
              onSetReview(null);
              return;
            }
            onSetReview(value);
          }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[15px] font-semibold disabled:opacity-50',
            value === 'accepted' && selected
              ? activeClass
              : review === value
                ? activeClass
                : 'border-border bg-background/90 text-foreground/80',
          )}
        >
          <Icon
            className={cn(
              'h-4.5 w-4.5 h-[1.125rem] w-[1.125rem]',
              iconClass,
            )}
          />
          {label}
        </button>
      ))}
    </div>
  );

  const quantityBlock = (
    <div
      className={cn(
        'flex flex-col items-start gap-1',
        (!selected || dimmed) && 'text-muted-foreground',
      )}
    >
      <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap font-mono-data text-sm">
        <span
          className={cn(
            selected && !dimmed ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {fmtMoney(Number(item.unitPrice || 0))}
        </span>
        <span>×</span>
        <div
          className="inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border bg-background"
          onClick={stopCardSelect}
        >
          <button
            type="button"
            onClick={(event) => {
              stopCardSelect(event);
              onSetQuantity(qty - 1);
            }}
            disabled={dimmed || qty <= 0}
            className="flex h-7 w-7 items-center justify-center text-[14px] text-muted-foreground hover:bg-muted disabled:opacity-35"
            aria-label="數量減一"
          >
            −
          </button>
          <input
            type="number"
            min={0}
            max={qtyCeiling}
            value={qty}
            disabled={dimmed}
            onClick={stopCardSelect}
            onChange={(event) => onSetQuantity(Number(event.target.value))}
            className="h-7 w-10 border-x border-border bg-background text-center font-mono-data text-[13px] font-semibold text-foreground outline-none disabled:opacity-50"
            aria-label={`${title}數量`}
          />
          <button
            type="button"
            onClick={(event) => {
              stopCardSelect(event);
              onSetQuantity(qty + 1);
            }}
            disabled={dimmed || qty >= qtyCeiling}
            className="flex h-7 w-7 items-center justify-center text-[14px] text-muted-foreground hover:bg-muted disabled:opacity-35"
            aria-label="數量加一"
          >
            +
          </button>
        </div>
        {item.unit ? (
          <span className="text-muted-foreground">{item.unit}</span>
        ) : null}
      </div>
      <p
        className={cn(
          'font-mono-data text-lg font-bold',
          (!selected || dimmed) && 'text-muted-foreground',
        )}
      >
        {selected ? fmtMoney(lineTotal) : '未選'}
      </p>
    </div>
  );

  const messagesBlock =
    messages.length > 0 ? (
      <div className="space-y-2" onClick={stopCardSelect}>
        {messages.map((message) => (
          <div
            key={message.id}
            className="rounded-xl border border-border bg-muted/20 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {message.authorName || currentUserName}
              </span>
              {message.authorRole ? (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                    ROLE_META[message.authorRole].className,
                  )}
                >
                  {ROLE_META[message.authorRole].label}
                </span>
              ) : null}
              <span className="font-mono-data">
                {fmtUtc8DateTime(message.createdAt)}{' '}
                <span className="text-[10px]">(UTC+8)</span>
              </span>
            </div>
            <div className="mt-1 flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
                {message.text}
              </p>
              <button
                type="button"
                onClick={() => onDeleteMessage(message.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-500/30 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                刪除
              </button>
            </div>
          </div>
        ))}
      </div>
    ) : null;

  const draftNoteBlock =
    review === 'change' || review === 'rejected' ? (
      <div onClick={stopCardSelect}>
        <textarea
          value={draftNote}
          onClick={stopCardSelect}
          onChange={(event) => onSetDraftNote(event.target.value)}
          rows={2}
          placeholder="請說明需要修改或不接受的原因…"
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={(event) => {
              stopCardSelect(event);
              onSendMessage();
            }}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            確定
          </button>
        </div>
      </div>
    ) : null;

  const productImageButton = (opts?: {
    className?: string;
    fixedPx?: number;
  }) => (
    <div
      className={cn('flex shrink-0 flex-col gap-1.5', opts?.className)}
      style={
        opts?.fixedPx
          ? {
              width: opts.fixedPx,
              maxWidth: '100%',
            }
          : undefined
      }
      onClick={stopCardSelect}
    >
      <div
        className="relative overflow-hidden rounded-xl bg-muted"
        style={
          opts?.fixedPx
            ? {
                width: opts.fixedPx,
                height: opts.fixedPx,
                maxWidth: '100%',
              }
            : undefined
        }
      >
        {item.image ? (
          <button
            type="button"
            onClick={(event) => {
              stopCardSelect(event);
              openGalleryAt(0);
            }}
            className={cn(
              'group relative h-full w-full cursor-zoom-in overflow-hidden rounded-xl ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              !opts?.fixedPx && 'aspect-square',
            )}
            title={
              galleryLightboxUrls.length > 1
                ? '點擊放大圖片（可左右瀏覽其他圖片）'
                : '點擊放大圖片'
            }
            aria-label={`${title}圖片預覽`}
          >
            <LoadingImage
              src={productThumbUrl(item.image)}
              alt={title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
              <ZoomIn className="h-6 w-6" />
            </span>
          </button>
        ) : null}
      </div>
      <ProductExtraImageThumbs
        urls={galleryExtras}
        maxVisible={3}
        interactive
        onSelect={openGalleryAtExtra}
      />
    </div>
  );

  return (
    <article
      role="button"
      tabIndex={dimmed ? -1 : 0}
      aria-pressed={selected}
      onClick={toggleAcceptSelect}
      onKeyDown={(event) => {
        if (dimmed) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleAcceptSelect();
        }
      }}
      title={
        dimmed
          ? '已選數量已達此傢俬劃分所需，無法再選其他方案'
          : selected
            ? '點擊空白處取消接受／選擇'
            : '點擊空白處或「接受」以選擇此產品'
      }
      data-partition-division={partitionSpy?.divisionLabel || undefined}
      data-partition-count={
        partitionSpy != null ? String(partitionSpy.count) : undefined
      }
      data-partition-picked={
        partitionSpy != null ? String(partitionSpy.picked) : undefined
      }
      data-partition-zone={partitionSpy?.zoneLabel || undefined}
      data-partition-zone-title={partitionSpy?.zoneTitle || undefined}
      data-partition-product={
        // Always emit when in a division so scroll-spy can clear「產品N」for single-product slots.
        partitionSpy
          ? productOrdinal != null && productOrdinal > 0
            ? String(productOrdinal)
            : ''
          : undefined
      }
      className={cn(
        // Solid color-mix (not alpha) so selected tint matches former hover over white,
        // and never picks up the grid's bg-border through transparency.
        'min-w-0 outline-none focus:outline-none focus-visible:outline-none',
        dimmed && 'cursor-not-allowed bg-muted/40 opacity-55',
        !dimmed && 'cursor-pointer',
        !dimmed &&
          selected &&
          'bg-[color-mix(in_srgb,hsl(var(--primary))_5%,hsl(var(--card)))]',
        !dimmed && !selected && 'bg-card',
        // Multi-scheme: vertical 3-col card. Single: legacy horizontal 1-col row.
        multiScheme
          ? 'flex h-full flex-col gap-3 p-4'
          : 'border-b border-border/70 p-5 last:border-b-0',
      )}
    >
      {multiScheme ? (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            {schemeIndex === 0 &&
            productOrdinal != null &&
            productOrdinal > 0 ? (
              <span
                className={cn(
                  'inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-[12px] font-bold tracking-wide',
                  dimmed
                    ? 'border-border bg-muted text-muted-foreground'
                    : 'border-sky-500/40 bg-sky-500/15 text-sky-800 dark:text-sky-200',
                )}
                title={`第 ${productOrdinal} 款產品`}
              >
                產品 {productOrdinal}
              </span>
            ) : null}
            <span
              className={cn(
                'inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-[12px] font-semibold',
                dimmed
                  ? 'border-border bg-muted text-muted-foreground'
                  : 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
              )}
            >
              方案 {schemeIndex + 1}/{schemeCount}
            </span>
          </div>

          {/* Square image + reserved thumb row; badge stays above. */}
          {productImageButton({
            className: 'mx-auto w-[88%] max-w-[280px]',
          })}

          <h5 className="min-w-0 text-[14px] font-bold leading-snug">
            {title}
            {item.isOptional ? (
              <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                （可選）
              </span>
            ) : null}
          </h5>

          <p className="font-mono-data text-sm text-muted-foreground">
            <span className="mr-1.5 font-medium">尺寸</span>
            {dimsLabel || '—'}
          </p>

          {quantityBlock}

          <p className="whitespace-pre-wrap font-mono-data text-sm text-muted-foreground">
            <span className="mr-1.5 font-medium">備註</span>
            {notesLabel || '—'}
          </p>

          {messagesBlock}
          {draftNoteBlock}
          {reviewActions}
        </>
      ) : (
        // Legacy single-scheme row: image left, details right; 「選擇」已由「接受」取代.
        <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
          {productImageButton({ fixedPx: PORTAL_PRODUCT_IMAGE_PX })}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {productOrdinal != null && productOrdinal > 0 ? (
              <span
                className={cn(
                  'inline-flex h-8 w-fit shrink-0 items-center rounded-md border px-2.5 text-[12px] font-bold tracking-wide',
                  dimmed
                    ? 'border-border bg-muted text-muted-foreground'
                    : 'border-sky-500/40 bg-sky-500/15 text-sky-800 dark:text-sky-200',
                )}
                title={`第 ${productOrdinal} 款產品`}
              >
                產品 {productOrdinal}
              </span>
            ) : null}
            <h5 className="min-w-0 text-base font-bold leading-snug">
              {title}
              {item.isOptional ? (
                <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                  （可選）
                </span>
              ) : null}
            </h5>

            <p className="font-mono-data text-sm text-muted-foreground">
              <span className="mr-1.5 font-medium">尺寸</span>
              {dimsLabel || '—'}
            </p>

            {quantityBlock}

            <p className="whitespace-pre-wrap font-mono-data text-sm text-muted-foreground">
              <span className="mr-1.5 font-medium">備註</span>
              {notesLabel || '—'}
            </p>

            {messagesBlock}
            {draftNoteBlock}
            {reviewActions}
          </div>
        </div>
      )}
    </article>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Lightbox should show the largest available source, never a stored thumbnail. */
function fullSizeImageUrl(url: string | null | undefined): string {
  const src = originalImageUrl(String(url || '').trim());
  if (!src) return src;
  try {
    const parsed = new URL(src);
    if (parsed.hostname.endsWith('cdn.shopify.com')) {
      parsed.searchParams.delete('width');
      parsed.searchParams.delete('height');
      return parsed.toString();
    }
    if (parsed.hostname.endsWith('images.unsplash.com')) {
      parsed.searchParams.set('w', '1600');
      parsed.searchParams.delete('h');
      parsed.searchParams.set('q', '85');
      return parsed.toString();
    }
  } catch {
    // Relative / data URLs: return as-is.
  }
  return src;
}

/** Compact 報價明細 row used by the redesigned /customer quote detail. */
function QuotePortalDetailRow({
  item,
  selected,
  review,
  schemeLabel,
  saving,
  dimmed,
  maxQuantity,
  draftNote,
  messageCount,
  onSetQuantity,
  onSetReview,
  onSetDraftNote,
  onSendMessage,
  onReplace,
  onPreviewImage,
}: {
  item: BwfQuoteItemInput;
  selected: boolean;
  review: ItemReview | undefined;
  schemeLabel?: string;
  saving: boolean;
  dimmed: boolean;
  maxQuantity?: number | null;
  draftNote: string;
  messageCount: number;
  onSetQuantity: (quantity: number) => void;
  onSetReview: (review: ItemReview | null) => void;
  onSetDraftNote: (value: string) => void;
  onSendMessage: () => void;
  onReplace: () => void;
  onPreviewImage: (urls: string[], title: string, startIndex?: number) => void;
}) {
  const title = quoteItemDisplayName(item);
  const dimsLabel = formatProductDimensionsMm(
    item.dimensionLMm,
    item.dimensionWMm,
    item.dimensionHMm,
  );
  const notesLabel = portalNotesDisplay(item.notes);
  const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
  const qtyCeiling =
    typeof maxQuantity === 'number' && Number.isFinite(maxQuantity)
      ? Math.max(0, Math.floor(maxQuantity))
      : 9999;
  const status: 'accepted' | 'change' | 'rejected' | 'pending' =
    selected || review === 'accepted'
      ? 'accepted'
      : review === 'change'
        ? 'change'
        : review === 'rejected'
          ? 'rejected'
          : 'pending';
  const statusClass: Record<typeof status, string> = {
    accepted: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700',
    change: 'border-amber-500/25 bg-amber-500/10 text-amber-700',
    rejected: 'border-rose-500/25 bg-rose-500/10 text-rose-700',
    pending: 'border-amber-500/25 bg-amber-500/10 text-amber-700',
  };
  const statusLabel: Record<typeof status, string> = {
    accepted: '已接受',
    change: '待處理',
    rejected: '不接受',
    pending: '待處理',
  };
  const galleryLightboxUrls = productGalleryLightboxUrls(
    item.image,
    item.galleryUrls,
  ).map(fullSizeImageUrl);

  return (
    <div
      className={cn(
        'bg-card transition-colors',
        selected && 'bg-primary/[0.035]',
        dimmed && 'opacity-55',
      )}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap sm:gap-4 sm:px-5">
      <Checkbox
        checked={selected}
        disabled={saving || (dimmed && !selected)}
        onCheckedChange={(checked) =>
          onSetReview(checked ? 'accepted' : null)
        }
        aria-label={`${selected ? '取消接受' : '接受'} ${title}`}
        className="shrink-0"
      />

      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted sm:h-[72px] sm:w-[72px]">
        {item.image ? (
          galleryLightboxUrls.length > 0 ? (
            <button
              type="button"
              onClick={() => onPreviewImage(galleryLightboxUrls, title, 0)}
              className="group relative h-full w-full cursor-zoom-in"
              title="點擊放大圖片"
              aria-label={`${title}圖片預覽`}
            >
              <LoadingImage
                src={productThumbUrl(item.image)}
                alt={title}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                <ZoomIn className="h-4 w-4" />
              </span>
            </button>
          ) : (
            <LoadingImage
              src={productThumbUrl(item.image)}
              alt={title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package className="h-5 w-5 text-muted-foreground/50" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 basis-[180px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <h5 className="min-w-0 truncate text-[14.5px] font-semibold leading-snug text-foreground">
            {title}
          </h5>
          {item.isOptional ? (
            <span className="text-[11px] font-normal text-muted-foreground">
              （可選）
            </span>
          ) : null}
          {schemeLabel ? (
            <span className="rounded border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
              {schemeLabel}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 font-mono-data text-[12px] text-muted-foreground">
          {dimsLabel ? `尺寸 ${dimsLabel}` : '尺寸 —'}
        </p>
        {notesLabel ? (
          <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground/80">
            備註：{notesLabel}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 whitespace-nowrap text-right sm:text-left">
        <p
          className={cn(
            'font-mono-data text-[14px] font-semibold',
            selected ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {fmtMoney(Number(item.unitPrice) || 0)}
          {item.unit ? (
            <span className="ml-1 font-mono-data text-[10.5px] font-normal text-muted-foreground">
              / {item.unit}
            </span>
          ) : null}
        </p>
      </div>

      <div className="inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border bg-background">
        <button
          type="button"
          onClick={() => onSetQuantity(qty - 1)}
          disabled={saving || dimmed || qty <= 0}
          className="flex h-7 w-7 items-center justify-center text-[14px] text-muted-foreground hover:bg-muted disabled:opacity-35"
          aria-label="數量減一"
        >
          −
        </button>
        <input
          type="number"
          min={0}
          max={qtyCeiling}
          value={qty}
          disabled={saving || dimmed}
          onChange={(event) => onSetQuantity(Number(event.target.value))}
          className="h-7 w-9 border-x border-border bg-background text-center font-mono-data text-[12.5px] font-semibold text-foreground outline-none disabled:opacity-50"
          aria-label={`${title}數量`}
        />
        <button
          type="button"
          onClick={() => onSetQuantity(qty + 1)}
          disabled={saving || dimmed || qty >= qtyCeiling}
          className="flex h-7 w-7 items-center justify-center text-[14px] text-muted-foreground hover:bg-muted disabled:opacity-35"
          aria-label="數量加一"
        >
          +
        </button>
      </div>

      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium',
          statusClass[status],
        )}
      >
        {status === 'accepted' ? <Check className="h-3 w-3" /> : null}
        {statusLabel[status]}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onReplace}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          更換款式
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={`${title}更多操作`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[300] w-40">
            <DropdownMenuItem
              disabled={saving || dimmed}
              onClick={() => onSetReview('accepted')}
            >
              <Check className="mr-2 h-3.5 w-3.5 text-emerald-600" />
              接受
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={saving || dimmed}
              onClick={() => onSetReview('change')}
            >
              <PenLine className="mr-2 h-3.5 w-3.5 text-amber-600" />
              要求修改
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={saving || dimmed}
              onClick={() => onSetReview('rejected')}
            >
              <X className="mr-2 h-3.5 w-3.5 text-rose-600" />
              不接受
            </DropdownMenuItem>
            {review || selected ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={saving}
                  onClick={() => onSetReview(null)}
                >
                  清除回覆
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>

      {review === 'change' || review === 'rejected' ? (
        <div className="border-t border-border/60 bg-muted/[0.12] px-4 pb-3 pt-2.5 sm:pl-[7.25rem]">
          <textarea
            value={draftNote}
            onChange={(event) => onSetDraftNote(event.target.value)}
            rows={2}
            placeholder="請說明需要修改或不接受的原因…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12.5px]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {messageCount > 0
                ? `已留 ${messageCount} 則意見，負責同事會看到。`
                : '意見會同步給負責同事。'}
            </span>
            <button
              type="button"
              onClick={onSendMessage}
              disabled={saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              確定
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const REVIEW_LABEL: Record<ItemReview, string> = {
  accepted: '接受',
  change: '要求修改',
  rejected: '不接受',
};

const LazyQuotationPDFPreviewModal = lazy(() =>
  import('@/components/dashboard/QuotationPDFPreview').then((mod) => ({
    default: mod.QuotationPDFPreviewModal,
  })),
);

export function CustomerQuoteSchemesView() {
  const { user } = useAuth();
  const staffName = usePmsStaffName(user?.id);
  const currentUserName = (staffName || user?.email || '用戶').trim() || '用戶';
  const { projects: clientProjects } = useClientZoneContext();
  const { role: platformRole, profileRole, loading: roleLoading } = usePlatformRole();
  const costStaff = profileRole === 'admin' || profileRole === 'uploader';
  const [searchParams] = useSearchParams();
  const quoteShareFromUrl = searchParams.get('quote_share');
  const hasPortalToken = Boolean(readStoredPortalToken());
  const hasQuoteShareToken = Boolean(
    quoteShareFromUrl?.trim() || readStoredQuoteShareToken()?.trim(),
  );
  const staffAccount =
    !roleLoading && (platformRole === 'staff' || platformRole === 'admin');
  // A quote-share link must not pin a logged-in staff/admin account to one quote.
  const quoteShareGuest = hasQuoteShareToken && !staffAccount;
  const clientOnly =
    platformRole === 'client' || hasPortalToken || quoteShareGuest;

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
  /** Quote opened via its QR Code or share link. */
  const [sharedQuoteTarget, setSharedQuoteTarget] = useState<{
    quoteUuid: string;
    quoteId: string;
  } | null>(null);
  const sharedQuoteOpenedRef = useRef(false);
  /** Logged-in only: 全部 = design+quote list; BWA = 設計專案; BWF = 報價單一覽. */
  const [sourceFilter, setSourceFilter] = useState<'all' | 'bwa' | 'bwf'>('all');
  const showSourceFilter = Boolean(user) && !quoteShareGuest;
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
  /** Per-item「選擇」— default on for required, off for 可選; all toggleable. */
  const [itemSelected, setItemSelected] = useState<Record<string, boolean>>({});
  const [savingScheme, setSavingScheme] = useState(false);
  const pageScrollRef = useRef<HTMLDivElement | null>(null);
  const partitionStickySentinelRef = useRef<HTMLDivElement | null>(null);
  const [partitionHeaderPinned, setPartitionHeaderPinned] = useState(false);
  const [activeZoneLabel, setActiveZoneLabel] = useState<string | null>(null);
  const [activeContextLine, setActiveContextLine] = useState<string | null>(
    null,
  );
  const [activeSelectionLine, setActiveSelectionLine] = useState<string | null>(
    null,
  );
  const [activeSelectionComplete, setActiveSelectionComplete] = useState(false);
  /** After chip click, keep highlight locked briefly so scroll-spy doesn't fight it. */
  const zoneJumpLockRef = useRef<{ label: string; until: number } | null>(null);
  /** Baseline after load / successful 儲存／提交 — used for unsaved leave warning. */
  const savedSchemeSnapshotRef = useRef<string>('');
  /** design_projects.meta.furnitureSchemeGroups keyed by zone id. */
  const [schemeGroupsByZone, setSchemeGroupsByZone] = useState<
    Record<string, FurnitureSchemeGroup[]>
  >({});
  const [lightbox, setLightbox] = useState<{
    urls: string[];
    title: string;
    startIndex: number;
  } | null>(null);
  const [floorPlanViewerOpen, setFloorPlanViewerOpen] = useState(false);
  /** 客戶尚未提交的加選／換款（在「相關家具」內編輯）。 */
  const [hasPendingChangeDraft, setHasPendingChangeDraft] = useState(false);
  /** 這張報價的客戶提交紀錄（回執與待處理狀態）。 */
  const [quoteRequests, setQuoteRequests] = useState<CustomerSharedQuoteRequestRow[]>([]);
  const [confirmationReceipt, setConfirmationReceipt] = useState<{
    status: 'confirmed' | 'rejected';
    version: string;
    confirmedAt: string | null;
    note: string;
  } | null>(null);
  const [requestsLoading, setRequestsLoading] = useState(false);
  /** 分享連結無效／已撤銷：不可讀取明細，也不可提交。 */
  const [shareLinkInvalid, setShareLinkInvalid] = useState(false);
  /** 客戶版報價 PDF 預覽：資料由 get_quote_pdf_payload() 一次取回。 */
  const [pdfPreviewData, setPdfPreviewData] = useState<QuotationPDFData | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  /** Redesigned quote detail tabs. */
  const [detailTab, setDetailTab] = useState<
    'items' | 'explore' | 'changes' | 'terms'
  >('items');
  const [expandedRooms, setExpandedRooms] = useState<Record<string, boolean>>({});
  const relatedFurnitureRef = useRef<QuoteRelatedFurnitureHandle>(null);
  const [draftChangeCount, setDraftChangeCount] = useState(0);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState<Record<string, boolean>>({});
  const autoOpenedDetailRef = useRef(false);

  const quoteShareToken = readStoredQuoteShareToken();

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
    // Quote-share sessions load only the shared row (see resolve effect below).
    if (quoteShareGuest) return;
    if (user && roleLoading) return;
    setLoading(true);
    try {
      if (!costStaff) {
        const rows = await listCustomerQuotes();
        setQuotes(rows);
        setActiveId((current) => current || rows[0]?.id || '');
        return;
      }
      const { data, error } = await supabase
        .from('bwf_quote')
        .select(LIST_SELECT)
        .neq('status', '回收桶')
        .order('created_at', { ascending: false })
        .limit(120);
      if (error) throw error;
      const rows = (data as QuoteRecord[]) || [];
      const enriched = await loadPitchingsForQuoteRows(rows);
      setQuotes(enriched);
      setActiveId((current) => current || enriched[0]?.id || '');
    } catch (error) {
      toast.error('無法載入客戶報價', {
        description: error instanceof Error
          ? error.message
          : customerQuoteError(error as { code?: string; message?: string }),
      });
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  }, [costStaff, quoteShareGuest, roleLoading, user]);

  // Load exactly one quotation for quote_share links (guest or logged-in preview).
  useEffect(() => {
    let cancelled = false;
    const token =
      quoteShareFromUrl?.trim() || readStoredQuoteShareToken()?.trim() || '';
    if (!token || staffAccount) {
      if (!quoteShareGuest) setSharedQuoteTarget(null);
      return;
    }
    storeQuoteShareToken(token);
    setLoading(true);
    setShareLinkInvalid(false);
    setPortalProjects([]);
    setPortalProjectData({});
    setPortalTotals({});
    setSyntheticQuotes([]);

    void (async () => {
      try {
        let sharedQuote: Awaited<ReturnType<typeof fetchSharedCustomerQuote>> | undefined;
        let useLegacyShare = false;
        try {
          sharedQuote = await fetchSharedCustomerQuote(token);
        } catch (error) {
          const code = (error as { code?: string })?.code;
          const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || '');
          if (code === 'PGRST202' || message.includes('get_shared_quote')) {
            useLegacyShare = true;
          } else {
            throw error;
          }
        }
        if (!useLegacyShare) {
          if (cancelled) return;
          if (!sharedQuote?.quote.id) {
            toast.error('分享連結無效或已撤銷', {
              description:
                '請向報價負責同事索取有效的分享連結。若剛從編輯頁開啟，請用無痕視窗或另一瀏覽器開啟連結。',
            });
            setShareLinkInvalid(true);
            setSharedQuoteTarget(null);
            setQuotes([]);
            setShowDetail(false);
            setLoading(false);
            return;
          }
          const resolved = {
            quoteUuid: sharedQuote.quote.id,
            quoteId: sharedQuote.quote.quote_id,
          };
          storeQuoteShareTarget(resolved);
          setSharedQuoteTarget(resolved);
          const enriched = sharedQuote.quote as QuoteRecord;
          const projectData =
            enriched.project_data &&
            typeof enriched.project_data === 'object' &&
            !Array.isArray(enriched.project_data)
              ? (enriched.project_data as Record<string, unknown>)
              : null;
          const designProjectId = String(projectData?.designProjectId || '').trim();
          if (designProjectId) {
            const linked = await fetchProjectById(designProjectId);
            if (!cancelled && linked) {
              const [zones, products] = await Promise.all([
                fetchZones(linked.id),
                fetchZoneProducts(linked.id),
              ]);
              const inZone = products.filter((product) => Boolean(product.zoneId));
              const total = inZone.reduce(
                (sum, product) =>
                  sum +
                  (Number(product.salePrice) || 0) *
                    Math.max(1, Math.floor(Number(product.quantity) || 1)),
                0,
              );
              setPortalProjects([linked]);
              setPortalProjectData({
                [linked.id]: { zones, products },
              });
              setPortalTotals({ [linked.id]: total });
            }
          }
          if (cancelled) return;
          setQuotes([enriched]);
          setActiveId(enriched.id);
          setShowDetail(true);
          sharedQuoteOpenedRef.current = true;
          return;
        }

        const resolved = await resolveQuoteShareToken(token);
        if (cancelled) return;
        if (!resolved?.quoteUuid) {
          toast.error('分享連結無效或已撤銷', {
            description:
              '請向報價負責同事索取有效的分享連結。若剛從編輯頁開啟，請用無痕視窗或另一瀏覽器開啟連結。',
          });
          setShareLinkInvalid(true);
          setSharedQuoteTarget(null);
          setQuotes([]);
          setShowDetail(false);
          setLoading(false);
          return;
        }
        storeQuoteShareTarget(resolved);
        setSharedQuoteTarget(resolved);

        const { data, error } = await supabase
          .from('bwf_quote')
          .select(LIST_SELECT)
          .eq('id', resolved.quoteUuid)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          toast.error('無法載入分享報價單', {
            description: error?.message || '找不到對應報價',
          });
          setQuotes([]);
          setShowDetail(false);
          setLoading(false);
          return;
        }

        // Don't block share view on PMS pitching enrichment failures.
        let enriched: QuoteRecord = {
          ...(data as QuoteRecord),
          pitching: null,
        };
        try {
          const rows = await loadPitchingsForQuoteRows([data as QuoteRecord]);
          if (rows[0]) enriched = rows[0];
        } catch (err) {
          console.warn('[quote_share] pitching enrich skipped', err);
        }
        if (cancelled) return;

        // If this share is backed by a 設計專案, hydrate portal project data so
        // 報價方案 detail can render live zone/furniture divisions.
        const projectData =
          enriched.project_data &&
          typeof enriched.project_data === 'object' &&
          !Array.isArray(enriched.project_data)
            ? (enriched.project_data as Record<string, unknown>)
            : null;
        const designProjectId = String(
          projectData?.designProjectId || '',
        ).trim();
        if (designProjectId) {
          const linked = await fetchProjectById(designProjectId);
          if (!cancelled && linked) {
            const [zones, products] = await Promise.all([
              fetchZones(linked.id),
              fetchZoneProducts(linked.id),
            ]);
            const inZone = products.filter((product) => Boolean(product.zoneId));
            const total = inZone.reduce(
              (sum, product) =>
                sum +
                (Number(product.salePrice) || 0) *
                  Math.max(1, Math.floor(Number(product.quantity) || 1)),
              0,
            );
            setPortalProjects([linked]);
            setPortalProjectData({
              [linked.id]: { zones, products },
            });
            setPortalTotals({ [linked.id]: total });
          }
        }

        setQuotes([enriched]);
        setActiveId(enriched.id);
        setShowDetail(true);
        sharedQuoteOpenedRef.current = true;
      } catch (err) {
        if (cancelled) return;
        toast.error('無法載入分享報價單', {
          description: err instanceof Error ? err.message : '請稍後再試',
        });
        setQuotes([]);
        setShowDetail(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quoteShareFromUrl, quoteShareGuest, staffAccount]);

  // Restore share target from storage after refresh when URL param was dropped.
  useEffect(() => {
    if (sharedQuoteTarget || !quoteShareGuest) return;
    const stored = readStoredQuoteShareTarget();
    if (stored) setSharedQuoteTarget(stored);
  }, [quoteShareGuest, sharedQuoteTarget]);

  useEffect(() => {
    if (quoteShareGuest) return;
    void fetchQuotes();
    // Quote-share guests only need the shared bwf_quote — skip design-project cards.
    void fetchProjects().then(async (rows) => {
      const projectIds = rows.map((project) => project.id);
      const [zonesByProject, productsByProjectMap] = await Promise.all([
        fetchZonesForProjects(projectIds),
        fetchZoneProductsForProjects(projectIds),
      ]);
      const loaded = rows.map((project) => {
        const zones = zonesByProject[project.id] ?? [];
        const products = productsByProjectMap[project.id] ?? [];
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
      });
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
  }, [fetchQuotes, quoteShareGuest]);

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
    const linkedShellProjectIds = new Set(
      quotes
        .map((quote) => designProjectIdOf(quote))
        .filter((id): id is string => Boolean(id)),
    );
    setSyntheticQuotes(
      portalProjects
        .filter((project) => {
          // Prefer real bwf_quote shell from「邀請客戶」/ client save.
          if (linkedShellProjectIds.has(project.id)) return false;
          const quoteId = projectQuoteId(project);
          if (quoteId && allowedQuoteIds.has(quoteId)) return false;
          const dpFallback = `DP-${project.id.slice(0, 8)}`;
          if (
            quotes.some(
              (quote) =>
                String(quote.quote_id || '').trim().toUpperCase() ===
                dpFallback.toUpperCase(),
            )
          ) {
            return false;
          }
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
            designProjectId: project.id,
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
    if (user && roleLoading) return;
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
        : costStaff
          ? await loadClientQuoteItems(activeId)
          : await loadCustomerSafeItems(activeId);
      const designProjectIdFromQuote = String(
        (
          activeQuote?.project_data as
            | { designProjectId?: string }
            | null
            | undefined
        )?.designProjectId || '',
      ).trim();
      const linkedProject = syntheticProjectId
        ? portalProjects.find((project) => project.id === syntheticProjectId)
        : designProjectIdFromQuote
          ? portalProjects.find(
              (project) => project.id === designProjectIdFromQuote,
            ) || null
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
          schemeGroups: {} as Record<string, FurnitureSchemeGroup[]>,
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
          galleryUrls: meta?.galleryUrls || [],
          productId: product.productId?.trim() || null,
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
      const schemeGroups = normalizePortalSchemeGroups(
        linkedProject.meta?.furnitureSchemeGroups,
      );

      const grouped: BwfQuoteItemInput[] = [];
      for (const zone of zones) {
        const products = selectedProducts.filter(
          (product) => product.zoneId === zone.id,
        );
        const zoneSchemeGroups = schemeGroups[zone.id] || [];
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
            const divisionProductIds = expandIdsWithSchemeGroups(
              (division.productIds || []).map((id) => String(id).trim()),
              zoneSchemeGroups,
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
              // Carry planned 傢俬劃分 qty for portal section headers.
              quantity: Math.max(0, Math.floor(Number(division.quantity) || 0)),
              image: '',
            });
            // Keep scheme-group member order (方案 1, 2, 3…) when present.
            const orderedDivisionProducts = (() => {
              const byId = new Map(
                divisionProducts.map((product) => [product.id, product]),
              );
              const ordered: ZoneProduct[] = [];
              const seen = new Set<string>();
              for (const group of zoneSchemeGroups) {
                if (!group.productIds.some((id) => byId.has(id))) continue;
                for (const pid of group.productIds) {
                  const row = byId.get(pid);
                  if (!row || seen.has(pid)) continue;
                  ordered.push(row);
                  seen.add(pid);
                }
              }
              for (const product of divisionProducts) {
                if (seen.has(product.id)) continue;
                ordered.push(product);
              }
              return ordered;
            })();
            for (const product of orderedDivisionProducts) {
              grouped.push(mapPortalProduct(product));
            }
          }
          const unassigned = products.filter(
            (product) => !assignedIds.has(product.id),
          );
          if (unassigned.length > 0) {
            const unassignedSlots = buildQuoteSchemeSlots(
              unassigned.map(mapPortalProduct),
              zoneSchemeGroups,
            );
            grouped.push({
              id: `division-${zone.id}-unassigned`,
              name: '未劃分',
              isDivisionTitle: true,
              quantity: unassignedSlots.reduce(
                (sum, slot) =>
                  sum + Math.max(1, Number(slot.items[0]?.quantity) || 1),
                0,
              ),
              image: '',
            });
            for (const slot of unassignedSlots) {
              for (const productItem of slot.items) {
                grouped.push(productItem);
              }
            }
          }
        } else {
          const slots = buildQuoteSchemeSlots(
            products.map(mapPortalProduct),
            zoneSchemeGroups,
          );
          for (const slot of slots) {
            for (const productItem of slot.items) {
              grouped.push(productItem);
            }
          }
        }
      }
      return {
        rows: grouped.length > 0 ? grouped : quoteItems,
        zoneProducts: selectedProducts,
        linkedProjectId: linkedProject.id,
        zones,
        schemeGroups,
      };
    };

    loadItems()
      .then(({ rows, zoneProducts, linkedProjectId, zones, schemeGroups }) => {
        if (cancelled) return;
        setSchemeGroupsByZone(schemeGroups || {});
        if (linkedProjectId) {
          setPortalProjectData((current) => ({
            ...current,
            [linkedProjectId]: { zones, products: zoneProducts },
          }));
        }
        const savedScheme = linkedProjectId
          ? readClientQuoteScheme(
              portalProjects.find((project) => project.id === linkedProjectId)
                ?.meta,
            )
          : null;
        const savedSelections = savedScheme?.selections || {};
        const savedQuantities = savedScheme?.quantities || {};
        // Hydrate Accept / 要求修改 / 不接受 + persisted client opinions.
        const nextReviews: Record<string, ItemReview> = {};
        const nextMessages: Record<string, ItemMessage[]> = {};
        const nextSelected: Record<string, boolean> = {};
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
        const hydrateSelection = (productId: string) => {
          if (Object.prototype.hasOwnProperty.call(savedSelections, productId)) {
            nextSelected[productId] = Boolean(savedSelections[productId]);
            return;
          }
          // 「接受」= 已選擇；其餘預設未選（已選擇 : 0/N件）
          nextSelected[productId] = nextReviews[productId] === 'accepted';
        };
        for (const product of zoneProducts) {
          hydrateFromNotes(product.id, product.status, product.notes);
          hydrateSelection(product.id);
        }
        for (const row of rows) {
          if (!row.id || row.isSectionTitle || row.isDivisionTitle) continue;
          hydrateFromNotes(row.id, row.zoneStatus, row.notes);
          hydrateSelection(row.id);
        }
        const hydratedRows = rows.map((row) => {
          if (!row.id || row.isSectionTitle || row.isDivisionTitle) return row;
          const savedQty = savedQuantities[row.id];
          const quotedQty = Math.max(
            0,
            Math.floor(Number(row.quantity) || 0),
          );
          // 0 is only meaningful when the client explicitly accepted 0;
          // otherwise show the quantity from the quotation itself.
          if (
            typeof savedQty === 'number' &&
            Number.isFinite(savedQty) &&
            (savedQty > 0 || nextSelected[row.id])
          ) {
            return {
              ...row,
              quantity: Math.max(0, Math.floor(savedQty)),
            };
          }
          // 「接受」只影響是否計入總額，數量一律跟隨報價單。
          return { ...row, quantity: quotedQty };
        });
        setItems(hydratedRows);
        setItemReviews(nextReviews);
        setItemMessages(nextMessages);
        setItemSelected(nextSelected);
        setItemsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setSchemeGroupsByZone({});
          setItemsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, costStaff, portalProjects, quotes, roleLoading, showDetail, syntheticQuotes, user]);

  const allQuoteRows = useMemo(
    () => [...quotes, ...syntheticQuotes],
    [quotes, syntheticQuotes],
  );
  const versionsByQuote = useMemo(
    () => groupVersions(allQuoteRows),
    [allQuoteRows],
  );
  const availableQuotes = useMemo(() => {
    // Quote-share sessions only ever load the shared row — show it without
    // allow-list / invite filtering (those hide non-demo quotations).
    if (quoteShareGuest) {
      const target =
        sharedQuoteTarget || readStoredQuoteShareTarget();
      const rows = [...versionsByQuote.values()].map((versions) => versions[0]);
      const matched = target
        ? rows.filter(
            (quote) =>
              quote.id === target.quoteUuid ||
              quote.quote_id === target.quoteId,
          )
        : rows;
      return matched.length > 0 ? matched : rows;
    }

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
    let visible = [...versionsByQuote.values()]
      .map((versions) => versions[0])
      .filter((quote) => {
        const designId = designProjectIdOf(quote);
        const isBwa = isBwaPortalQuote(quote);
        const allowedByPolicy = isBwa
          ? // Design / invite shells: show when project is in portal set, or name allow-list.
            (designId ? designProjectIds.has(designId) : false) ||
            isAllowedPortalQuote({
              quoteId: quote.quote_id,
              displayName: quoteDisplayName(quote),
              clientName: clientNameOf(quote),
            })
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
    if (showSourceFilter && sourceFilter !== 'all') {
      visible = visible.filter((quote) => {
        const isBwa = isBwaPortalQuote(quote);
        return sourceFilter === 'bwa' ? isBwa : !isBwa;
      });
    }
    return [...visible].sort((a, b) => {
      const aDesign = isBwaPortalQuote(a) ? 1 : 0;
      const bDesign = isBwaPortalQuote(b) ? 1 : 0;
      if (aDesign !== bDesign) return bDesign - aDesign;
      return (
        new Date(b.modified_date || b.created_at).getTime() -
        new Date(a.modified_date || a.created_at).getTime()
      );
    });
  }, [
    clientOnly,
    clientProjects,
    quoteShareGuest,
    portalProjects,
    sharedQuoteTarget,
    showSourceFilter,
    sourceFilter,
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

  // Deep-open shared quote detail in 報價方案 current format.
  useEffect(() => {
    if (!sharedQuoteTarget || sharedQuoteOpenedRef.current || loading) return;
    const match =
      allQuoteRows.find((quote) => quote.id === sharedQuoteTarget.quoteUuid) ||
      allQuoteRows.find(
        (quote) => quote.quote_id === sharedQuoteTarget.quoteId,
      ) ||
      availableQuotes.find(
        (quote) =>
          quote.id === sharedQuoteTarget.quoteUuid ||
          quote.quote_id === sharedQuoteTarget.quoteId,
      );
    if (!match) return;
    sharedQuoteOpenedRef.current = true;
    setActiveId(match.id);
    setShowDetail(true);
  }, [allQuoteRows, availableQuotes, loading, sharedQuoteTarget]);

  const active =
    allQuoteRows.find((quote) => quote.id === activeId) || null;
  const activeVersions = active
    ? versionsByQuote.get(active.quote_id) || [active]
    : [];
  const isBwfDetail = isBwfQuoteRecord(active);
  const bwfClientInfo = useMemo(
    () => (active && isBwfDetail ? portalClientInfoOf(active) : null),
    [active, isBwfDetail],
  );
  const bwfDeliveryDetails = useMemo(
    () => (active && isBwfDetail ? portalDeliveryDetailsOf(active) : ''),
    [active, isBwfDetail],
  );
  const bwfTermsHtml = useMemo(
    () => (active && isBwfDetail ? portalTermsHtmlOf(active) : ''),
    [active, isBwfDetail],
  );
  const zoneTypeGroups = useMemo(
    () => groupQuoteItemsByZoneType(items),
    [items],
  );
  const visibleZoneTypeGroups = useMemo(
    () =>
      zoneTypeGroups.filter((group) =>
        group.rooms.some(
          (room) =>
            roomProductCount(room, schemeGroupsByZone[room.zoneId || ''] || []) >
            0,
        ),
      ),
    [zoneTypeGroups, schemeGroupsByZone],
  );
  const groupProductCount = useCallback(
    (group: QuoteZoneTypeGroup) =>
      group.rooms.reduce(
        (roomSum, room) =>
          roomSum +
          roomProductCount(room, schemeGroupsByZone[room.zoneId || ''] || []),
        0,
      ),
    [schemeGroupsByZone],
  );
  const totalDisplayProductCount = useMemo(
    () =>
      visibleZoneTypeGroups.reduce(
        (sum, group) => sum + groupProductCount(group),
        0,
      ),
    [visibleZoneTypeGroups, groupProductCount],
  );
  // /customer lands on the quote detail (as in the portal design) once quotes load.
  useEffect(() => {
    if (autoOpenedDetailRef.current) return;
    if (loading || shareLinkInvalid || availableQuotes.length === 0) return;
    autoOpenedDetailRef.current = true;
    setActiveId((current) => current || availableQuotes[0].id);
    setShowDetail(true);
  }, [availableQuotes, loading, shareLinkInvalid]);

  // Accordion: expand all rooms by default.
  const zoneTypeGroupSignature = visibleZoneTypeGroups
    .map((group) => group.rooms.map((room) => room.id).join(','))
    .join('|');
  useEffect(() => {
    setExpandedRooms((current) => {
      if (Object.keys(current).length > 0) return current;
      const allRooms = visibleZoneTypeGroups.flatMap((group) => group.rooms);
      if (allRooms.length === 0) return current;
      return Object.fromEntries(allRooms.map((room) => [room.id, true]));
    });
  }, [zoneTypeGroupSignature, visibleZoneTypeGroups]);
  const billableItems = items.filter(
    (item) =>
      !item.isSectionTitle &&
      !item.isDivisionTitle &&
      !item.isCustomTerm &&
      isQuoteItemSelected(item, itemSelected),
  );
  const itemSubtotal = billableItems.reduce(
    (sum, item) => sum + clientQuoteLineTotal(item),
    0,
  );
  const selectedPieceCount = billableItems.reduce(
    (sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity) || 0)),
    0,
  );
  const structuralItems = items.filter(
    (item) =>
      !item.isSectionTitle && !item.isDivisionTitle && !item.isCustomTerm,
  );
  const pendingRequestCount = quoteRequests.filter(
    (request) => request.status === 'submitted',
  ).length;
  const pendingChangeCount = Math.max(pendingRequestCount, draftChangeCount);
  const termsSections = useMemo(
    () => (active ? portalTermsSectionsOf(active) : []),
    [active],
  );
  const quoteStatusTone = /確認|approved|confirmed/i.test(
    String(active?.status || ''),
  )
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
    : 'border-amber-500/25 bg-amber-500/10 text-amber-700';
  const openReplaceForItem = useCallback((itemId: string | undefined) => {
    if (!itemId) return;
    relatedFurnitureRef.current?.openReplaceFor(itemId);
  }, []);

  /** 原報價項目（可被更換款式）；不含分區標題與自訂條款。 */
  const originalItemOptions = useMemo(
    () =>
      items
        .filter(
          (item) =>
            Boolean(item.id) &&
            !item.isSectionTitle &&
            !item.isDivisionTitle &&
            !item.isCustomTerm,
        )
        .map((item) => ({
          id: item.id!,
          name: quoteItemDisplayName(item),
          unit: item.unit,
          unitPrice: Number(item.unitPrice) || 0,
          quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
          category: item.category?.trim() || '',
        })),
    [items],
  );

  // Quote lines store one image; hydrate the full product gallery so the
  // lightbox can show every photo (including the original full-size main image).
  const itemGalleryProductIds = useMemo(() => {
    const ids = items
      .filter(
        (item) =>
          !item.isSectionTitle &&
          !item.isDivisionTitle &&
          !item.isCustomTerm,
      )
      .map((item) => String(item.productId || '').trim())
      .filter(Boolean);
    return [...new Set(ids)].sort();
  }, [items]);
  const itemGalleryProductIdSignature = itemGalleryProductIds.join('|');
  useEffect(() => {
    if (!showDetail || itemGalleryProductIds.length === 0) return;
    let cancelled = false;
    void fetchProductsDisplayMeta(itemGalleryProductIds)
      .then((meta) => {
        if (cancelled) return;
        setItems((current) =>
          current.map((item) => {
            if (
              item.isSectionTitle ||
              item.isDivisionTitle ||
              item.isCustomTerm
            ) {
              return item;
            }
            const productId = String(item.productId || '').trim();
            const gallery = productId
              ? meta[productId]?.galleryUrls || []
              : [];
            if (gallery.length === 0) return item;
            const merged = [
              ...new Set([...(item.galleryUrls || []), ...gallery]),
            ];
            if (merged.length === (item.galleryUrls || []).length) {
              return item;
            }
            return { ...item, galleryUrls: merged };
          }),
        );
      })
      .catch(() => {
        // Gallery enrichment is optional; keep the quote image.
      });
    return () => {
      cancelled = true;
    };
  }, [itemGalleryProductIdSignature, showDetail]);
  const loadQuoteRequests = useCallback(async () => {
    const quoteUuid = active?.id && /^[0-9a-f-]{36}$/i.test(active.id) ? active.id : '';
    if (!quoteUuid) {
      setQuoteRequests([]);
      return;
    }
    setRequestsLoading(true);
    try {
      const rows = await fetchSharedQuoteRequests(
        readStoredQuoteShareToken(),
        quoteUuid,
      );
      setQuoteRequests(rows);
    } catch (error) {
      console.warn('[quote_requests]', error);
      setQuoteRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  }, [active?.id]);

  const itemKey = (item: BwfQuoteItemInput, index: number) =>
    item.id || `${quoteItemDisplayName(item)}-${index}`;

  const scrollToZoneGroup = useCallback((label: string) => {
    const root = pageScrollRef.current;
    const target = document.getElementById(zoneGroupDomId(label));
    if (!root || !target) return;
    // Optimistic chip highlight + brief spy lock for snappy UX.
    setActiveZoneLabel(label);
    zoneJumpLockRef.current = { label, until: Date.now() + 900 };
    const rootRect = root.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    // Instant jump inside the page scroller (TopBar sticky sits outside this root).
    const nextTop = root.scrollTop + (targetRect.top - rootRect.top) - 8;
    root.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (!showDetail || itemsLoading) {
      setPartitionHeaderPinned(false);
      return;
    }
    const node = partitionStickySentinelRef.current;
    const root = pageScrollRef.current;
    if (!node || !root || typeof IntersectionObserver === 'undefined') {
      setPartitionHeaderPinned(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const nextPinned =
          !entry.isIntersecting &&
          entry.boundingClientRect.top < root.getBoundingClientRect().top;
        setPartitionHeaderPinned((current) =>
          current === nextPinned ? current : nextPinned,
        );
      },
      { root, threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [showDetail, itemsLoading, zoneTypeGroups.length, activeId]);

  // Scroll-spy: highlight current zone chip + sticky division context line.
  useEffect(() => {
    const root = pageScrollRef.current;
    if (!root || !showDetail || itemsLoading || zoneTypeGroups.length === 0) {
      return;
    }

    const updateSpy = () => {
      const rootRect = root.getBoundingClientRect();
      // Keep a modest anchor so the zone near the top of the scroller wins.
      const anchorY = rootRect.top + (partitionHeaderPinned ? 96 : 24);

      let nextZone = zoneTypeGroups[0]?.label || null;
      for (const group of zoneTypeGroups) {
        const el = document.getElementById(zoneGroupDomId(group.label));
        if (!el) continue;
        if (el.getBoundingClientRect().top <= anchorY + 8) {
          nextZone = group.label;
        }
      }

      let nextDivisionLabel: string | null = null;
      let nextDivisionCount = 0;
      let nextDivisionPicked = 0;
      let nextDivisionZone: string | null = null;
      let nextZoneTitle: string | null = null;
      let nextProductOrdinal: number | null = null;
      const markers = root.querySelectorAll<HTMLElement>(
        '[data-partition-division]',
      );
      markers.forEach((el) => {
        if (el.getBoundingClientRect().top <= anchorY + 8) {
          nextDivisionLabel = el.dataset.partitionDivision || null;
          nextDivisionCount = Number(el.dataset.partitionCount || 0) || 0;
          nextDivisionPicked = Number(el.dataset.partitionPicked || 0) || 0;
          nextDivisionZone = el.dataset.partitionZone || null;
          nextZoneTitle =
            el.dataset.partitionZoneTitle ||
            el.dataset.partitionZone ||
            null;
          // Division headers set data-partition-product="" to clear; cards set "1"/"2"/…
          if (Object.prototype.hasOwnProperty.call(el.dataset, 'partitionProduct')) {
            const n = Number(el.dataset.partitionProduct || 0);
            nextProductOrdinal = Number.isFinite(n) && n > 0 ? n : null;
          }
        }
      });

      const jumpLock = zoneJumpLockRef.current;
      if (jumpLock && Date.now() < jumpLock.until) {
        nextZone = jumpLock.label;
      } else {
        zoneJumpLockRef.current = null;
        if (nextDivisionZone) nextZone = nextDivisionZone;
      }

      const contextLine = (() => {
        const areaTitle = nextZoneTitle || nextZone;
        if (!areaTitle) return null;
        // Sticky line shows level-2 only (strip「一級 > 二級」prefix).
        const divisionL2 = nextDivisionLabel
          ? divisionLevel2Label(nextDivisionLabel)
          : '';
        // Multi-product divisions:「| 產品2」before the count.
        const productPart =
          nextProductOrdinal != null ? ` | 產品${nextProductOrdinal}` : '';
        if (divisionL2 && divisionL2 !== areaTitle) {
          return `${areaTitle} | ${divisionL2}${productPart} : 總共${nextDivisionCount} 件產品`;
        }
        if (divisionL2) {
          return `${areaTitle}${productPart} : 總共${nextDivisionCount} 件產品`;
        }
        const group = zoneTypeGroups.find((g) => g.label === nextZone);
        const count = group
          ? group.rooms.reduce(
              (sum, room) =>
                sum +
                roomProductCount(
                  room,
                  schemeGroupsByZone[room.zoneId || ''] || [],
                ),
              0,
            )
          : 0;
        return `${areaTitle}${productPart} : 總共${count} 件產品`;
      })();

      const selectionLine =
        nextDivisionLabel != null
          ? `已選擇 : ${nextDivisionPicked}/${nextDivisionCount}件`
          : null;
      const selectionComplete =
        nextDivisionCount > 0 && nextDivisionPicked >= nextDivisionCount;

      setActiveZoneLabel((current) =>
        current === nextZone ? current : nextZone,
      );
      setActiveContextLine((current) =>
        current === contextLine ? current : contextLine,
      );
      setActiveSelectionLine((current) =>
        current === selectionLine ? current : selectionLine,
      );
      setActiveSelectionComplete((current) =>
        current === selectionComplete ? current : selectionComplete,
      );
    };

    updateSpy();
    root.addEventListener('scroll', updateSpy, { passive: true });
    window.addEventListener('resize', updateSpy);
    return () => {
      root.removeEventListener('scroll', updateSpy);
      window.removeEventListener('resize', updateSpy);
    };
  }, [
    itemSelected,
    items,
    itemsLoading,
    partitionHeaderPinned,
    schemeGroupsByZone,
    showDetail,
    zoneTypeGroups,
  ]);

  useEffect(
    () => () => {
      publishDesignProjectStickyChrome(null);
      unsavedGuard.clear();
      unsavedGuard.setLeaveHandler(null);
    },
    [],
  );

  const syncItemReview = async (
    item: BwfQuoteItemInput,
    review: ItemReview | null,
    feedbackText?: string,
  ): Promise<boolean> => {
    const key = item.id || '';
    const reviewKey = key || itemKey(item, 0);
    setItemReviews((current) => {
      const next = { ...current };
      if (review == null) delete next[reviewKey];
      else next[reviewKey] = review;
      return next;
    });
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
    if (review == null) {
      toast.success('已取消選擇');
    }
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
                  <b>${isQuoteItemSelected(item, itemSelected) ? fmtMoney(clientQuoteLineTotal(item)) : '未選'}</b>
                </div>`;
                  })
                  .join('');
                const divisionHeader = section.label
                  ? `<h4 class="division">${escapeHtml(section.label)} : ${sectionDisplayCount(section)}</h4>`
                  : '';
                return `${divisionHeader}${itemsHtml}`;
              })
              .join('');
            const roomSqft = zoneSqftForDisplay(
              activeZoneAreasSqft,
              room.zoneId,
            );
            const plannedCount = roomPlannedFurnitureCount(room);
            const roomCount = roomProductCount(room);
            const displayRoomTitle =
              group.rooms.length === 1 ? group.label : roomTitle;
            const roomMeta =
              plannedCount > 0
                ? `× 總數 ${plannedCount}件傢俬`
                : roomCount > 0
                  ? `${roomCount} 件傢俬`
                  : '';
            const sqftHtml = roomSqft
              ? `<p class="meta center">${escapeHtml(formatZoneSqftLabel(roomSqft))}</p>`
              : '';
            return `<div class="room"><h3 class="center">${escapeHtml(displayRoomTitle)}${roomMeta ? ` <span class="meta">${escapeHtml(roomMeta)}</span>` : ''}</h3>${sqftHtml}${
              sectionsHtml || '<p class="meta">此區域暫未選擇產品</p>'
            }</div>`;
          })
          .join('');
        const groupHeader =
          group.rooms.length === 1
            ? ''
            : `<h2>${escapeHtml(group.label)}</h2>
            <p class="meta">${group.rooms.length} 個${escapeHtml(group.label)}</p>`;
        return `
          <section>
            ${groupHeader}
            ${roomsHtml}
          </section>`;
      })
      .join('');
    const decisionLabel =
      quoteDecision === 'approved'
        ? '確認現有報價'
        : quoteDecision === 'rejected'
          ? '不接受這個版本'
          : '尚未決定';
    return `<!doctype html>
      <html lang="zh-HK"><head><meta charset="utf-8">
      <title>${escapeHtml(active.quote_id)} ${escapeHtml(displayQuoteVersion(active.version))}</title>
      <style>
        body{font-family:"Noto Sans HK","Noto Sans TC",sans-serif;color:#16182a;max-width:1080px;margin:0 auto;padding:40px}
        header{border-bottom:2px solid #6366f1;padding-bottom:22px;margin-bottom:26px}
        h1{margin:0 0 8px;font-size:28px} h2{font-size:19px;margin-top:28px} h3{font-size:18px;margin:18px 0 8px}
        h3.center,h4.division,.center{text-align:center}
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

  const openPdfPreview = async () => {
    if (!active || pdfLoading) return;
    if (!isBwfQuoteRecord(active)) {
      toast.error('此項目尚未有正式報價 PDF', {
        description: '設計專案方案未連結正式報價單，暫未能產生 PDF。',
      });
      return;
    }
    setPdfLoading(true);
    try {
      const payload = await fetchCustomerQuotePdfPayload({
        quoteUuid: active.id,
        token: quoteShareGuest
          ? quoteShareFromUrl?.trim() || quoteShareToken
          : null,
      });
      if (!payload?.quote?.id) throw new Error('找不到這份報價');
      if (payload.quote.id !== active.id) {
        throw new Error('報價資料不相符，請重新整理後再試');
      }
      const data = buildCustomerQuotePdfData(payload);
      if (!data) throw new Error('報價資料不完整');
      setPdfPreviewData(data);
    } catch (error) {
      toast.error('未能開啟 PDF 預覽', {
        description: customerQuoteError(
          error as { code?: string; message?: string },
        ),
      });
    } finally {
      setPdfLoading(false);
    }
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
    const designProjectId = String(
      (
        active.project_data as
          | { designProjectId?: string }
          | null
          | undefined
      )?.designProjectId || '',
    ).trim();
    if (designProjectId) {
      const byId = portalProjects.find(
        (project) => project.id === designProjectId,
      );
      if (byId) return byId;
    }
    return (
      portalProjects.find(
        (project) => projectQuoteId(project) === active.quote_id,
      ) || null
    );
  }, [active, activeId, portalProjects]);

  const linkedFloorPlanProject = useMemo(
    () => resolveLinkedProject(),
    [resolveLinkedProject],
  );
  const floorPlanPreviewUrl = linkedFloorPlanProject
    ? floorPlanPreviewOf(linkedFloorPlanProject)
    : null;
  const hasFloorPlan = Boolean(linkedFloorPlanProject?.floorPlanUrl);

  const openFloorPlanViewer = useCallback(() => {
    if (!linkedFloorPlanProject?.floorPlanUrl) {
      toast.error('尚未上傳平面圖');
      return;
    }
    setFloorPlanViewerOpen(true);
  }, [linkedFloorPlanProject?.floorPlanUrl]);

  const activeZoneAreasSqft = useMemo(() => {
    const linked = resolveLinkedProject();
    const raw = linked?.meta?.zoneAreasSqft;
    if (!raw || typeof raw !== 'object') return {} as Record<string, number>;
    const next: Record<string, number> = {};
    for (const [zoneId, value] of Object.entries(raw)) {
      const num = Number(value);
      if (!zoneId || !Number.isFinite(num) || num <= 0) continue;
      next[zoneId] = num;
    }
    return next;
  }, [resolveLinkedProject]);

  const setItemQuantity = useCallback((itemId: string, rawQuantity: number) => {
    const nextQuantity = Math.max(
      0,
      Math.min(9999, Math.floor(Number(rawQuantity) || 0)),
    );
    setItems((current) =>
      current.map((row) =>
        row.id === itemId ? { ...row, quantity: nextQuantity } : row,
      ),
    );
  }, []);

  const buildSchemeSnapshot = useCallback(
    (
      nextSelected: Record<string, boolean> = itemSelected,
      nextItems: BwfQuoteItemInput[] = items,
      decision: QuoteDecision = quoteDecision,
      note: string = quoteNote,
    ) => {
      const quantities: Record<string, number> = {};
      const selections: Record<string, boolean> = {};
      for (const item of nextItems) {
        if (
          !item.id ||
          item.isSectionTitle ||
          item.isDivisionTitle ||
          item.isCustomTerm
        ) {
          continue;
        }
        selections[item.id] = Boolean(nextSelected[item.id]);
        quantities[item.id] = Math.max(
          0,
          Math.floor(Number(item.quantity) || 0),
        );
      }
      return JSON.stringify({
        selections,
        quantities,
        quoteDecision: decision,
        quoteNote: note.trim(),
      });
    },
    [itemSelected, items, quoteDecision, quoteNote],
  );

  const markSchemeSaved = useCallback(() => {
    savedSchemeSnapshotRef.current = buildSchemeSnapshot();
    unsavedGuard.clear();
  }, [buildSchemeSnapshot]);

  // Baseline snapshot after items hydrate (includes current quote decision/note).
  useEffect(() => {
    if (!showDetail || itemsLoading) return;
    savedSchemeSnapshotRef.current = buildSchemeSnapshot();
    unsavedGuard.clear();
    // Only re-baseline when the loaded quote changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [showDetail, itemsLoading, activeId]);

  // Warn when leaving / refreshing / closing with unsaved scheme edits.
  useEffect(() => {
    if (!showDetail || itemsLoading) {
      if (!showDetail) unsavedGuard.clear();
      return;
    }
    if (!savedSchemeSnapshotRef.current) return;
    const hasDraftNotes = Object.values(itemDraftNotes).some(
      (note) => note.trim().length > 0,
    );
    const current = buildSchemeSnapshot();
    const dirty =
      current !== savedSchemeSnapshotRef.current || hasDraftNotes;
    unsavedGuard.set(dirty, PORTAL_UNSAVED_LEAVE_MESSAGE);
  }, [
    buildSchemeSnapshot,
    itemDraftNotes,
    itemSelected,
    items,
    itemsLoading,
    quoteDecision,
    quoteNote,
    showDetail,
  ]);

  useEffect(() => {
    if (!showDetail) return;
    unsavedGuard.setLeaveHandler(() => {
      unsavedGuard.clear();
    });
    return () => unsavedGuard.setLeaveHandler(null);
  }, [showDetail]);

  /**
   * FDS-15：客戶真的用瀏覽器打開授權頁（JS 已執行、報價已載入）才算有效查看，
   * 並只停這張報價的自動跟進。GET 請求、圖片載入與已知掃描器都不會走到這裡。
   */
  const shareViewRecordedRef = useRef(false);
  useEffect(() => {
    if (!showDetail || itemsLoading) return;
    if (shareViewRecordedRef.current) return;
    // 只有客戶（或未登入的分享連結訪客）才算查看；同事預覽自己的連結不會停信。
    if (profileRole && profileRole !== 'client') return;
    const shareToken = readStoredQuoteShareToken();
    if (!shareToken) return;
    shareViewRecordedRef.current = true;
    void recordQuoteShareView(shareToken);
  }, [showDetail, itemsLoading, activeId, profileRole]);

  // 切換報價版本時載入客戶提交紀錄，並還原這一版的確認回執。
  useEffect(() => {
    if (!showDetail || !active) {
      setQuoteRequests([]);
      setConfirmationReceipt(null);
      return;
    }
    const raw = (
      active.project_data as
        | { customerConfirmation?: Record<string, unknown> }
        | null
        | undefined
    )?.customerConfirmation;
    const status =
      raw?.status === 'rejected'
        ? 'rejected'
        : raw?.status === 'confirmed'
          ? 'confirmed'
          : null;
    setConfirmationReceipt(
      status
        ? {
            status,
            version: String(raw?.version || active.version || '').trim(),
            confirmedAt: raw?.confirmedAt ? String(raw.confirmedAt) : null,
            note: String(raw?.note || ''),
          }
        : null,
    );
    void loadQuoteRequests();
  }, [active, loadQuoteRequests, showDetail]);

  useEffect(() => {
    if (!showDetail) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (!unsavedGuard.isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [showDetail]);

  const saveQuoteScheme = useCallback(async () => {
    if (!active) return;
    setSavingScheme(true);
    try {
      const productItems = items.filter(
        (item) =>
          Boolean(item.id) &&
          !item.isSectionTitle &&
          !item.isDivisionTitle &&
          !item.isCustomTerm,
      );
      const selections: Record<string, boolean> = {};
      const quantities: Record<string, number> = {};
      for (const item of productItems) {
        const id = item.id!;
        selections[id] = isQuoteItemSelected(item, itemSelected);
        quantities[id] = Math.max(0, Math.floor(Number(item.quantity) || 0));
      }
      const totalAmount = productItems.reduce((sum, item) => {
        const id = item.id!;
        if (!selections[id]) return sum;
        return sum + (Number(item.unitPrice) || 0) * quantities[id];
      }, 0);

      const linkedProject = resolveLinkedProject();
      const savedScheme = readClientQuoteScheme(linkedProject?.meta);
      const isSynthetic =
        activeId.startsWith('design-project:') ||
        activeId.startsWith('confirmed-project:');

      for (const item of productItems) {
        if (!isZoneProductId(item.id)) continue;
        // zone_products keeps min 1 for staff tools; portal 0 stays in clientQuoteScheme only.
        const persistQty = Math.max(1, quantities[item.id!] || 0);
        if (!selections[item.id!] && quantities[item.id!] <= 0) continue;
        const result = await updateZoneProductQuantity(item.id!, persistQty);
        if (!result.ok) {
          toast.error('儲存數量失敗', { description: result.error });
          return;
        }
      }

      let quoteUuid = '';
      if (!isSynthetic && /^[0-9a-f-]{36}$/i.test(activeId)) {
        quoteUuid = activeId;
      } else if (savedScheme?.quoteUuid) {
        quoteUuid = savedScheme.quoteUuid;
      }

      if (quoteUuid && !costStaff) {
        // FDS-14: the customer's submission becomes a request record. The official
        // quote keeps its own unit prices, quantities and total until the PM confirms.
        await submitCustomerQuoteRequest({
          token: readStoredQuoteShareToken(),
          quoteId: quoteUuid,
          quoteVersion: active.version,
          note: quoteNote.trim(),
          requestType: 'scheme',
          lines: productItems.map((item) => ({
            id: item.id!,
            quantity: quantities[item.id!] || 0,
            selected: Boolean(selections[item.id!]),
            note: (itemDraftNotes[item.id!] || '').trim() || undefined,
          })),
        });
      } else if (quoteUuid) {
        const { data: existingQuote, error: existingError } = await supabase
          .from('bwf_quote')
          .select('id, project_data')
          .eq('id', quoteUuid)
          .maybeSingle();
        if (existingError) throw existingError;
        if (!existingQuote) {
          quoteUuid = '';
        } else {
          const prevProjectData =
            existingQuote.project_data &&
            typeof existingQuote.project_data === 'object' &&
            !Array.isArray(existingQuote.project_data)
              ? (existingQuote.project_data as Record<string, unknown>)
              : {};
          const updatePayload = await withUpdateAuditFields({
            // total_amount is the single source of truth for quote total.
            total_amount: totalAmount,
            project_data: stripItemsFromProjectData({
              ...prevProjectData,
              clientQuoteScheme: {
                savedAt: new Date().toISOString(),
                selections,
                quantities,
              },
              ...(linkedProject?.id
                ? { designProjectId: linkedProject.id }
                : {}),
            }),
          });
          const { error: updateError } = await supabase
            .from('bwf_quote')
            .update(updatePayload)
            .eq('id', quoteUuid);
          if (updateError) throw updateError;
          await replaceQuoteItems(
            quoteUuid,
            await hydrateProductIdsForQuoteItems(
              productItems.map((item) => ({
                ...item,
                quantity: quantities[item.id!],
              })),
            ),
          );
        }
      }

      if (!quoteUuid && !costStaff) {
        toast.error('客戶頁不能新建報價單', {
          description: '請由傢俬部建立報價後，再用分享連結儲存選擇和數量。',
        });
        return;
      }

      if (!quoteUuid) {
        const insertPayload = await withInsertAuditFields({
          quote_id: active.quote_id,
          version: active.version || 'v1',
          status: '客戶方案',
          // total_amount is the single source of truth for quote total.
          total_amount: totalAmount,
          submitter: currentUserName,
          project_data: stripItemsFromProjectData({
            formData: active.project_data?.formData || {
              clientName: active.quote_id,
            },
            clientQuoteScheme: {
              savedAt: new Date().toISOString(),
              selections,
              quantities,
            },
            ...(linkedProject?.id
              ? { designProjectId: linkedProject.id }
              : {}),
          }),
        });
        const { data: inserted, error: insertError } = await supabase
          .from('bwf_quote')
          .insert(insertPayload)
          .select('id')
          .single();
        if (insertError) throw insertError;
        if (!inserted?.id) throw new Error('報價文件已建立但缺少 id');
        quoteUuid = inserted.id;
        await replaceQuoteItems(
          quoteUuid,
          await hydrateProductIdsForQuoteItems(
            productItems.map((item) => ({
              ...item,
              quantity: quantities[item.id!],
            })),
          ),
        );
      }

      if (linkedProject) {
        const saved = await mergeProjectMeta(linkedProject.id, {
          clientQuoteScheme: {
            savedAt: new Date().toISOString(),
            quoteUuid,
            quoteId: active.quote_id,
            selections,
            quantities,
          },
        });
        if (!saved.ok || !saved.data) {
          toast.error('儲存方案失敗', { description: saved.error });
          return;
        }
        const nextMeta = saved.data;
        setPortalProjects((current) =>
          current.map((row) =>
            row.id === linkedProject.id ? { ...row, meta: nextMeta } : row,
          ),
        );
        setPortalProjectData((current) => {
          const entry = current[linkedProject.id];
          if (!entry) return current;
          return {
            ...current,
            [linkedProject.id]: {
              ...entry,
              products: entry.products.map((product) =>
                quantities[product.id]
                  ? { ...product, quantity: quantities[product.id] }
                  : product,
              ),
            },
          };
        });
        setPortalTotals((current) => ({
          ...current,
          [linkedProject.id]: totalAmount,
        }));
      }

      setItemSelected(selections);
      savedSchemeSnapshotRef.current = JSON.stringify({
        selections,
        quantities,
        quoteDecision,
        quoteNote: quoteNote.trim(),
      });
      unsavedGuard.clear();
      await fetchQuotes();
      toast.success(costStaff ? '已儲存報價方案' : '已提交選擇及數量', {
        description: costStaff
          ? (linkedProject
            ? '選擇、數量已寫入設計專案與報價文件'
            : '選擇、數量已寫入報價文件')
          : '已記錄你的選品、數量與需求。負責同事確認後會再與你安排正式報價，正式價格不會因這次提交而改變。',
      });
    } catch (error) {
      toast.error('儲存失敗', {
        description: error instanceof Error
          ? error.message
          : customerQuoteError(error as { code?: string; message?: string }),
      });
    } finally {
      setSavingScheme(false);
    }
  }, [
    active,
    activeId,
    currentUserName,
    fetchQuotes,
    itemSelected,
    items,
    quoteDecision,
    quoteNote,
    itemDraftNotes,
    costStaff,
    resolveLinkedProject,
  ]);

  useEffect(() => {
    if (!showDetail || !active) {
      publishDesignProjectStickyChrome(null);
      return;
    }
    publishDesignProjectStickyChrome({
      active: partitionHeaderPinned,
      mode: 'quote',
      zoneGroups: zoneTypeGroups.map((group) => ({
        key: group.key,
        label: group.label,
        count: group.rooms.reduce(
          (sum, room) =>
            sum +
            roomProductCount(
              room,
              schemeGroupsByZone[room.zoneId || ''] || [],
            ),
          0,
        ),
      })),
      activeZoneLabel: activeZoneLabel || zoneTypeGroups[0]?.label || null,
      activeContextLine: partitionHeaderPinned ? activeContextLine : null,
      activeSelectionLine: partitionHeaderPinned ? activeSelectionLine : null,
      activeSelectionComplete: partitionHeaderPinned
        ? activeSelectionComplete
        : false,
      saving: savingScheme,
      hasFloorPlan,
      onSave: () => {
        void saveQuoteScheme();
      },
      onViewFloorPlan: () => openFloorPlanViewer(),
      onJump: (label) => scrollToZoneGroup(label),
    });
  }, [
    active,
    activeContextLine,
    activeSelectionComplete,
    activeSelectionLine,
    activeZoneLabel,
    hasFloorPlan,
    openFloorPlanViewer,
    partitionHeaderPinned,
    saveQuoteScheme,
    savingScheme,
    schemeGroupsByZone,
    scrollToZoneGroup,
    showDetail,
    zoneTypeGroups,
  ]);

  useEffect(() => {
    if (!showDetail) setFloorPlanViewerOpen(false);
  }, [showDetail, activeId]);

  const submitResponse = async () => {
    if (!active) return;
    const note = quoteNote.trim();
    if (quoteDecision === 'pending') {
      toast.error('請先選擇「確認現有報價」或「不接受這個版本」');
      return;
    }
    if (hasPendingChangeDraft) {
      toast.error('請先提交或移除未提交的加選／換款', {
        description:
          '「確認現有報價」只會確認目前顯示的版本，不會包含「相關家具」內未提交的變更。',
      });
      return;
    }

    const linkedProject = resolveLinkedProject();
    const decision: 'confirmed' | 'rejected' =
      quoteDecision === 'approved' ? 'confirmed' : 'rejected';
    const version = (active.version || 'v1').trim() || 'v1';
    setSubmittingQuote(true);
    try {
      // 先記錄客戶對這個版本的決定（沒有設計專案也能完成）。
      // 若這個環境尚未套用新的提交函式，仍讓有設計專案的報價沿用原本流程。
      let recordedByRequest = true;
      try {
        await confirmSharedCustomerQuote({
          token: readStoredQuoteShareToken(),
          quoteId: active.id,
          quoteVersion: version,
          note,
          decision,
        });
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const message = String((error as { message?: string })?.message || '');
        const missingRpc =
          code === 'PGRST202' ||
          message.includes('submit_customer_quote_request') ||
          message.includes('Could not find the function');
        if (!missingRpc || !linkedProject) throw error;
        recordedByRequest = false;
      }

      // 有設計專案時，沿用原有 clientQuoteReply 契約同步給 PM 介面。
      if (linkedProject) {
        const clientQuoteReply = {
          decision:
            decision === 'confirmed'
              ? ('approved' as const)
              : ('rejected' as const),
          note,
          submittedAt: new Date().toISOString(),
          quoteId: active.quote_id,
          version: active.version,
        };
        const savedMeta = await mergeProjectMeta(linkedProject.id, {
          clientQuoteReply,
        });
        if (savedMeta.ok && savedMeta.data) {
          const nextMeta = savedMeta.data;
          if (decision === 'confirmed') {
            await saveProject(linkedProject.id, {
              status: 'confirmed',
              progress: 100,
            });
          }
          setPortalProjects((current) =>
            current.map((row) =>
              row.id === linkedProject.id
                ? {
                    ...row,
                    meta: nextMeta,
                    status:
                      decision === 'confirmed' ? 'confirmed' : row.status,
                    progress:
                      decision === 'confirmed' ? 100 : row.progress,
                  }
                : row,
            ),
          );
        } else {
          console.warn('[clientQuoteReply]', savedMeta.error);
        }
      }

      setConfirmationReceipt({
        status: decision,
        version,
        confirmedAt: new Date().toISOString(),
        note,
      });
      savedSchemeSnapshotRef.current = buildSchemeSnapshot(
        undefined,
        undefined,
        quoteDecision,
        quoteNote,
      );
      unsavedGuard.clear();
      if (recordedByRequest) void loadQuoteRequests();
      if (decision === 'confirmed') {
        toast.success('已確認這個報價版本', {
          description: `${active.quote_id} · ${displayQuoteVersion(version)} 的確認已提交，負責同事會收到通知。`,
        });
      } else {
        toast.success('已提交不接受這個版本', {
          description: '負責同事會看到你的回覆，正式報價維持不變。',
        });
      }
    } catch (error) {
      toast.error('提交失敗', {
        description: customerQuoteError(
          error as { code?: string; message?: string } | null,
        ),
      });
    } finally {
      setSubmittingQuote(false);
    }
  };

  const applyItemReview = (
    item: BwfQuoteItemInput,
    context: {
      targetQty: number | null;
      slotCount: number;
      selectedQty: number;
      sectionLabel: string;
    },
    nextReview: ItemReview | null,
  ) => {
    if (!item.id) return;
    const itemQty = Math.max(0, Math.floor(Number(item.quantity) || 0));
    if (nextReview === 'accepted') {
      if (
        context.targetQty != null &&
        context.slotCount > 1 &&
        !isQuoteItemSelected(item, itemSelected)
      ) {
        const remaining = context.targetQty - context.selectedQty;
        if (remaining <= 0) {
          toast.message('已達此傢俬劃分所需數量', {
            description: `「${context.sectionLabel}」需要 ${context.targetQty} 件，請先調整已選方案的數量。`,
          });
          return;
        }
        setItemQuantity(
          item.id,
          Math.max(1, Math.min(itemQty > 0 ? itemQty : 1, remaining)),
        );
      } else if (itemQty <= 0) {
        setItemQuantity(item.id, 1);
      }
      setItemSelected((current) => ({ ...current, [item.id!]: true }));
    } else {
      // 不接受／要求修改不應改動報價單數量；只取消計入總額。
      setItemSelected((current) => ({ ...current, [item.id!]: false }));
    }
    void syncItemReview(item, nextReview).then((ok) => {
      if (ok && nextReview === 'accepted') {
        toast.success('已同步為「已確定」');
      }
    });
  };

  const detailFooter = active ? (
    <div className="flex flex-wrap items-center justify-between gap-3">

                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <p className="text-[12.5px] text-muted-foreground">
                    已選擇{' '}
                    <span className="font-mono-data font-bold text-foreground">
                      {selectedPieceCount}
                    </span>{' '}
                    件產品
                  </p>
                  <p className="text-[12.5px] text-muted-foreground">
                    合計{' '}
                    <span className="font-mono-data text-[16px] font-bold text-primary">
                      {fmtMoney(itemSubtotal)}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (draftChangeCount > 0) {
                        relatedFurnitureRef.current?.focusDraft();
                        setDetailTab('explore');
                        window.setTimeout(() => {
                          relatedFurnitureRef.current?.focusDraft();
                        }, 40);
                      } else {
                        setDetailTab('explore');
                      }
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-[12.5px] font-semibold text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    <PenLine className="h-4 w-4" />
                    提交變更請求
                    {pendingChangeCount > 0
                      ? `（${pendingChangeCount} 項）`
                      : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('terms')}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    確認報價（{fmtMoney(active.total_amount)}）
                  </button>
                </div>

    </div>
  ) : null;


  return (
    <>
      <PortalPageShell
        scrollRef={pageScrollRef}
        title={showDetail && active ? quoteDisplayName(active) : '報價方案'}
        footer={
          showDetail && active && detailTab === 'items'
            ? detailFooter
            : undefined
        }
        badge="Client Portal"
        titleExtra={
          !showDetail && showSourceFilter ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'all', label: '全部' },
                  { key: 'bwa', label: 'BWA' },
                  { key: 'bwf', label: 'BWF' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setSourceFilter(opt.key)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors',
                    sourceFilter === opt.key
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null
        }
        subtitle="查看自己的報價、切換版本、按房間批核產品，並回覆整張報價。"
        maxWidthClass="max-w-none"
        header={
          showDetail && active ? (
            <div className="space-y-4">
              <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
                <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start">
                  <button
                    type="button"
                    disabled={!hasFloorPlan}
                    onClick={openFloorPlanViewer}
                    className="relative h-24 w-28 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/40 transition hover:border-primary/40 disabled:cursor-default disabled:opacity-70"
                    title={hasFloorPlan ? '點擊查看平面圖' : '尚未上傳平面圖'}
                    aria-label={hasFloorPlan ? '查看平面圖縮圖' : '尚未上傳平面圖'}
                  >
                    {structuralItems.find((item) => item.image)?.image ? (
                      <LoadingImage
                        src={productThumbUrl(
                          structuralItems.find((item) => item.image)!.image!,
                        )}
                        alt={quoteDisplayName(active)}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <FloorPlanThumb
                        url={linkedFloorPlanProject?.floorPlanUrl ?? null}
                        type={linkedFloorPlanProject?.floorPlanType ?? null}
                        previewUrl={floorPlanPreviewUrl}
                        fileName={
                          typeof linkedFloorPlanProject?.meta?.floorPlanFileName ===
                          'string'
                            ? linkedFloorPlanProject.meta.floorPlanFileName
                            : undefined
                        }
                      />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight sm:text-[26px]">
                        {quoteDisplayName(active)}
                      </h1>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2.5 py-1 text-[11.5px] font-semibold',
                          quoteStatusTone,
                        )}
                      >
                        {active.status || '待審核'}
                      </span>
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono-data text-[11.5px] text-muted-foreground">
                      <span>{active.quote_id}</span>
                      <span className="text-border">·</span>
                      <span>版本 {displayQuoteVersion(active.version)}</span>
                      <span className="text-border">·</span>
                      <span>
                        更新日期{' '}
                        {fmtDate(active.modified_date || active.created_at)}
                      </span>
                    </p>
                    <p className="mt-2 text-[13px] text-muted-foreground">
                      {clientNameOf(active)}
                      {activeVersions.length > 1
                        ? ` · 共 ${activeVersions.length} 個版本`
                        : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => setShowDetail(false)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                      title="返回所有報價"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      所有報價
                    </button>
                    <button
                      type="button"
                      onClick={() => void openPdfPreview()}
                      disabled={pdfLoading}
                      title="預覽或下載報價單 PDF"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60"
                    >
                      {pdfLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      PDF 預覽
                    </button>
                    <Link
                      to={withCustomerPortalQuery('/customer/contact', {
                        quoteShareToken: quoteShareToken,
                      })}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      聯絡我們
                    </Link>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 border-t border-border/70 bg-muted/[0.18] px-4 py-3 sm:px-5 lg:grid-cols-4">
                  {[
                    {
                      icon: Package,
                      label: '報價產品',
                      value: `${totalDisplayProductCount} 件`,
                      tone: 'text-sky-600 bg-sky-500/10',
                    },
                    {
                      icon: LayoutGrid,
                      label: '分區',
                      value: `${visibleZoneTypeGroups.length} 個`,
                      tone: 'text-violet-600 bg-violet-500/10',
                    },
                    {
                      icon: ReceiptText,
                      label: '原報價總額',
                      value: fmtMoney(active.total_amount),
                      tone: 'text-indigo-600 bg-indigo-500/10',
                    },
                    {
                      icon: Bell,
                      label: '待處理變更',
                      value: `${pendingChangeCount} 項`,
                      tone: 'text-rose-500 bg-rose-500/10',
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2.5"
                    >
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          stat.tone,
                        )}
                      >
                        <stat.icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-mono-data text-[14px] font-bold leading-tight text-foreground">
                          {stat.value}
                        </p>
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                          {stat.label}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex flex-wrap items-center gap-1 border-b border-border/70">
                {(
                  [
                    {
                      key: 'items' as const,
                      label: '報價明細',
                      icon: FileText,
                      count: totalDisplayProductCount,
                    },
                    {
                      key: 'explore' as const,
                      label: '探索家具',
                      icon: ShoppingBag,
                    },
                    {
                      key: 'changes' as const,
                      label: '變更記錄',
                      icon: History,
                      count: quoteRequests.length || null,
                    },
                    {
                      key: 'terms' as const,
                      label: '條款及付款',
                      icon: CreditCard,
                    },
                  ] as const
                ).map((tab) => {
                  const activeTab = detailTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setDetailTab(tab.key)}
                      className={cn(
                        'relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-medium transition-colors sm:px-4',
                        activeTab
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <tab.icon className="h-4 w-4" />
                      {tab.label}
                      {'count' in tab && tab.count ? (
                        <span
                          className={cn(
                            'font-mono-data text-[10.5px]',
                            activeTab ? 'text-primary/70' : 'text-muted-foreground',
                          )}
                        >
                          ({tab.count})
                        </span>
                      ) : null}
                      {activeTab ? (
                        <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : undefined
        }
      >
        {!showDetail ? (
          <section>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold">您的報價</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {showSourceFilter
                    ? sourceFilter === 'bwa'
                      ? '顯示傢俬方案「設計專案」的訂單'
                      : sourceFilter === 'bwf'
                        ? '顯示傢俬報價「報價單一覽」的報價單'
                        : '顯示設計專案與報價單一覽的全部項目'
                    : '一般只會顯示目前客戶的 1–2 張有效報價。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void fetchQuotes()}
                className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-border px-3 py-2 text-sm sm:self-auto"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                重新整理
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : shareLinkInvalid ? (
              <EmptyState
                title="分享連結無效或已撤銷"
                description="這個連結已不能讀取報價明細，也不能提交變更。請向報價負責同事索取新的二維碼或連結。"
              />
            ) : availableQuotes.length === 0 ? (
              <EmptyState
                title="目前沒有屬於您的報價"
                description="PM 完成報價後，報價方案會顯示在這裡。"
              />
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
                {availableQuotes.map((quote) => {
                  const selected = active?.quote_id === quote.quote_id;
                  const versions = versionsByQuote.get(quote.quote_id) || [quote];
                  const linkedDesignProject =
                    isBwaPortalQuote(quote) ||
                    portalProjects.some(
                      (project) =>
                        project.id === designProjectIdOf(quote) ||
                        projectQuoteId(project) === quote.quote_id,
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
                        'min-h-[44px] rounded-2xl border bg-card p-4 text-left shadow-sm transition-all sm:p-5',
                        selected
                          ? 'border-primary/50 ring-2 ring-primary/10'
                          : 'border-border hover:border-primary/30',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="max-w-[70%] break-all rounded-lg bg-primary/10 px-2.5 py-1 font-mono-data text-xs font-bold text-primary">
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
          <section className="space-y-4 pb-2">
            <div className={detailTab === 'items' ? 'space-y-3' : 'hidden'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base font-bold">
                  分區清單與傢俬配置
                </h2>
                <div className="flex items-center gap-3">
                  <span className="font-mono-data text-[11.5px] text-muted-foreground">
                    {visibleZoneTypeGroups.length} 個分區 ·{' '}
                    {totalDisplayProductCount} 件產品
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRooms(
                        Object.fromEntries(
                          visibleZoneTypeGroups.flatMap((group) =>
                            group.rooms.map((room) => [room.id, true]),
                          ),
                        ),
                      )
                    }
                    className="text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    全部展開
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedRooms({})}
                    className="text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    全部收合
                  </button>
                </div>
              </div>

              {!itemsLoading && visibleZoneTypeGroups.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-card px-3 py-2.5 sm:px-4">
                  <span className="mr-1 text-[12px] font-semibold text-muted-foreground">
                    分區數量
                  </span>
                  {visibleZoneTypeGroups.map((group) => {
                    const isActive =
                      (activeZoneLabel || visibleZoneTypeGroups[0]?.label) ===
                      group.label;
                    return (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => scrollToZoneGroup(group.label)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[12px] transition-colors',
                          isActive
                            ? 'border-primary/50 bg-primary/15 text-primary shadow-sm'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
                        )}
                        title={`跳至「${group.label}」· 產品總數 ${groupProductCount(group)}`}
                        aria-current={isActive ? 'true' : undefined}
                      >
                        <span
                          className={cn(
                            'font-semibold',
                            isActive ? 'text-primary' : 'text-foreground',
                          )}
                        >
                          {group.label}
                        </span>
                        <span
                          className={
                            isActive
                              ? 'text-primary/80'
                              : 'text-muted-foreground'
                          }
                        >
                          ：{groupProductCount(group)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {itemsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : visibleZoneTypeGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">
                  此版本暫無產品明細
                </div>
              ) : (
                <div className="space-y-2.5">
                  {visibleZoneTypeGroups.map((group) => {
                    const visibleRooms = group.rooms.filter(
                      (room) =>
                        roomProductCount(
                          room,
                          schemeGroupsByZone[room.zoneId || ''] || [],
                        ) > 0,
                    );
                    const groupCount = group.rooms.reduce(
                      (sum, room) =>
                        sum +
                        roomProductCount(
                          room,
                          schemeGroupsByZone[room.zoneId || ''] || [],
                        ),
                      0,
                    );
                    const groupSubtotal = group.rooms.reduce(
                      (sum, room) =>
                        sum +
                        room.sections.reduce(
                          (sectionSum, section) =>
                            sectionSum +
                            section.items.reduce((itemSum, item) => {
                              if (!isQuoteItemSelected(item, itemSelected)) {
                                return itemSum;
                              }
                              return itemSum + clientQuoteLineTotal(item);
                            }, 0),
                          0,
                        ),
                      0,
                    );
                    const groupExpanded = visibleRooms.some(
                      (room) => expandedRooms[room.id],
                    );
                    return (
                      <section
                        key={group.key}
                        id={zoneGroupDomId(group.label)}
                        className="scroll-mt-2 overflow-hidden rounded-xl border border-border/80 bg-card"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedRooms((current) => {
                              const next = { ...current };
                              group.rooms.forEach((room) => {
                                next[room.id] = !groupExpanded;
                              });
                              return next;
                            })
                          }
                          className="flex w-full flex-wrap items-center gap-2.5 bg-muted/[0.22] px-4 py-3 text-left transition-colors hover:bg-muted/[0.32] sm:px-5"
                          aria-expanded={groupExpanded}
                        >
                          <ChevronRight
                            className={cn(
                              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                              groupExpanded && 'rotate-90',
                            )}
                          />
                          <span className="font-display text-[13.5px] font-bold uppercase tracking-wide text-foreground">
                            {group.label}
                          </span>
                          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono-data text-[10.5px] font-medium text-muted-foreground">
                            （{groupCount} 件產品）
                          </span>
                          <span className="ml-auto font-mono-data text-[12px] font-semibold text-muted-foreground">
                            小計：
                            <span className="ml-1 text-foreground">
                              {fmtMoney(groupSubtotal)}
                            </span>
                          </span>
                        </button>

                        {groupExpanded ? (
                          <div className="divide-y divide-border/70">
                            {visibleRooms.map((room) => {
                              const roomSchemeGroups =
                                schemeGroupsByZone[room.zoneId || ''] || [];
                              const roomCount = roomProductCount(
                                room,
                                roomSchemeGroups,
                              );
                              const roomSubtotal = room.sections.reduce(
                                (sum, section) =>
                                  sum +
                                  section.items.reduce((sectionSum, item) => {
                                    if (
                                      !isQuoteItemSelected(item, itemSelected)
                                    ) {
                                      return sectionSum;
                                    }
                                    return (
                                      sectionSum + clientQuoteLineTotal(item)
                                    );
                                  }, 0),
                                0,
                              );
                              return (
                                <div key={room.id}>
                                  {visibleRooms.length > 1 ? (
                                    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/[0.12] px-4 py-2 sm:px-5">
                                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        {room.name}
                                      </span>
                                      <span className="font-mono-data text-[10.5px] text-muted-foreground">
                                        {roomCount} 件
                                      </span>
                                      <span className="ml-auto font-mono-data text-[11px] text-muted-foreground">
                                        小計 {fmtMoney(roomSubtotal)}
                                      </span>
                                    </div>
                                  ) : null}
                                  {room.sections.map((section) => {
                                    const sectionSlots = buildQuoteSchemeSlots(
                                      section.items,
                                      roomSchemeGroups,
                                    );
                                    const sectionCount = sectionDisplayCount(
                                      section,
                                      roomSchemeGroups,
                                    );
                                    const sectionPickedQty =
                                      sectionSelectedQuantity(
                                        section,
                                        itemSelected,
                                      );
                                    return (
                                      <div key={section.id}>
                                        {section.label ? (
                                          <div className="flex flex-wrap items-center gap-2 border-y border-border/50 bg-muted/[0.18] px-4 py-2 sm:px-5">
                                            <Layers className="h-3 w-3 text-muted-foreground" />
                                            <span className="font-display text-[12px] font-semibold text-foreground/80">
                                              {section.label}
                                            </span>
                                            <span className="font-mono-data text-[10.5px] text-muted-foreground">
                                              : 總共{sectionCount} 件產品
                                            </span>
                                            <span
                                              className={cn(
                                                'ml-auto font-mono-data text-[10.5px] font-medium',
                                                sectionPickedQty >=
                                                  sectionCount &&
                                                  sectionCount > 0
                                                  ? 'text-emerald-700'
                                                  : 'text-muted-foreground',
                                              )}
                                            >
                                              已選擇 {sectionPickedQty}/
                                              {sectionCount} 件
                                            </span>
                                          </div>
                                        ) : null}
                                        {sectionSlots.length > 0 ? (
                                          <div className="divide-y divide-border/70">
                                            {sectionSlots.map(
                                              (slot, slotIndex) => {
                                                const targetQty =
                                                  section.plannedQuantity !=
                                                    null &&
                                                  section.plannedQuantity > 0
                                                    ? section.plannedQuantity
                                                    : null;
                                                const selectedQty =
                                                  schemeSlotSelectedQuantity(
                                                    slot,
                                                    itemSelected,
                                                  );
                                                const quotaMet =
                                                  targetQty != null &&
                                                  slot.items.length > 1 &&
                                                  selectedQty >= targetQty;
                                                const multiScheme =
                                                  slot.items.length > 1;
                                                const productOrdinal =
                                                  sectionSlots.length > 1
                                                    ? slotIndex + 1
                                                    : undefined;
                                                return (
                                                  <div key={slot.key}>
                                                    {multiScheme ? (
                                                      <div className="flex flex-wrap items-center gap-2 px-4 pt-2.5 pb-1 sm:px-5">
                                                        {productOrdinal ? (
                                                          <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
                                                            產品 {productOrdinal}
                                                          </span>
                                                        ) : null}
                                                        <span className="rounded border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                                          方案 {slot.items.length}{' '}
                                                          選 1
                                                        </span>
                                                        <span className="font-mono-data text-[10.5px] text-muted-foreground">
                                                          已選 {selectedQty}/
                                                          {targetQty ?? '-'} 件
                                                        </span>
                                                      </div>
                                                    ) : null}
                                                    {slot.items.map(
                                                      (item, index) => {
                                                        const key = itemKey(
                                                          item,
                                                          index,
                                                        );
                                                        const selected =
                                                          isQuoteItemSelected(
                                                            item,
                                                            itemSelected,
                                                          );
                                                        const itemQty = Math.max(
                                                          0,
                                                          Math.floor(
                                                            Number(
                                                              item.quantity,
                                                            ) || 0,
                                                          ),
                                                        );
                                                        const othersSelectedQty =
                                                          selected
                                                            ? selectedQty -
                                                              itemQty
                                                            : selectedQty;
                                                        const maxQuantity =
                                                          targetQty != null &&
                                                          slot.items.length > 1
                                                            ? Math.max(
                                                                0,
                                                                targetQty -
                                                                  Math.max(
                                                                    0,
                                                                    othersSelectedQty,
                                                                  ),
                                                              )
                                                            : null;
                                                        const rowKey = `${slot.key}:${key}`;
                                                        return (
                                                          <div
                                                            key={rowKey}
                                                            className="min-w-0"
                                                          >
                                                            <QuotePortalDetailRow
                                                              item={item}
                                                              selected={selected}
                                                              review={
                                                                itemReviews[key]
                                                              }
                                                              schemeLabel={
                                                                slot.items
                                                                  .length > 1
                                                                  ? `方案 ${index + 1}/${slot.items.length}`
                                                                  : undefined
                                                              }
                                                              saving={
                                                                savingReviewKey ===
                                                                key
                                                              }
                                                              dimmed={Boolean(
                                                                quotaMet &&
                                                                  !selected,
                                                              )}
                                                              maxQuantity={
                                                                maxQuantity
                                                              }
                                                              draftNote={
                                                                itemDraftNotes[
                                                                  key
                                                                ] || ''
                                                              }
                                                              messageCount={
                                                                (
                                                                  itemMessages[
                                                                    key
                                                                  ] || []
                                                                ).length
                                                              }
                                                              onSetDraftNote={(
                                                                value,
                                                              ) =>
                                                                setItemDraftNotes(
                                                                  (current) => ({
                                                                    ...current,
                                                                    [key]: value,
                                                                  }),
                                                                )
                                                              }
                                                              onSendMessage={() =>
                                                                void sendItemMessage(
                                                                  item,
                                                                  index,
                                                                )
                                                              }
                                                              onSetQuantity={(
                                                                quantity,
                                                              ) => {
                                                                if (!item.id)
                                                                  return;
                                                                const next =
                                                                  Math.max(
                                                                    0,
                                                                    Math.floor(
                                                                      Number(
                                                                        quantity,
                                                                      ) || 0,
                                                                    ),
                                                                  );
                                                                const capped =
                                                                  maxQuantity !=
                                                                  null
                                                                    ? Math.min(
                                                                        next,
                                                                        maxQuantity,
                                                                      )
                                                                    : next;
                                                                setItemQuantity(
                                                                  item.id,
                                                                  capped,
                                                                );
                                                                // 改數量不會自動接受；接受仍由勾選／狀態控制。
                                                                if (
                                                                  capped <= 0 &&
                                                                  selected
                                                                ) {
                                                                  setItemSelected(
                                                                    (current) => ({
                                                                      ...current,
                                                                      [item.id!]: false,
                                                                    }),
                                                                  );
                                                                }
                                                              }}
                                                              onSetReview={(
                                                                nextReview,
                                                              ) => {
                                                                applyItemReview(
                                                                  item,
                                                                  {
                                                                    targetQty,
                                                                    slotCount:
                                                                      slot.items
                                                                        .length,
                                                                    selectedQty,
                                                                    sectionLabel:
                                                                      section.label ||
                                                                      '此劃分',
                                                                  },
                                                                  nextReview,
                                                                );
                                                              }}
                                                              onReplace={() =>
                                                                openReplaceForItem(
                                                                  item.id,
                                                                )
                                                              }
                                                              onPreviewImage={(
                                                                urls,
                                                                previewTitle,
                                                                startIndex = 0,
                                                              ) =>
                                                                setLightbox({
                                                                  urls,
                                                                  title: previewTitle,
                                                                  startIndex,
                                                                })
                                                              }
                                                            />
                                                          </div>
                                                        );
                                                      },
                                                    )}
                                                  </div>
                                                );
                                              },
                                            )}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              )}

            </div>

            <div className={detailTab === 'explore' ? 'space-y-3' : 'hidden'}>
              <QuoteRelatedFurniture
                ref={relatedFurnitureRef}
                key={`${active.id}:${active.version}`}
                token={quoteShareToken}
                quoteUuid={active.id}
                quoteVersion={(active.version || 'v1').trim() || 'v1'}
                projectData={
                  (active.project_data as Record<string, unknown> | null) ??
                  null
                }
                engineeringType={
                  linkedFloorPlanProject?.meta?.projectType ?? null
                }
                originalItems={originalItemOptions}
                onDraftChange={setHasPendingChangeDraft}
                onDraftCountChange={setDraftChangeCount}
                onSubmitted={() => {
                  void loadQuoteRequests();
                }}
              />
            </div>

            <div className={detailTab === 'changes' ? 'space-y-3' : 'hidden'}>
              <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-bold">變更記錄</h2>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
                      您在本報價方案中的所有操作記錄。
                    </p>
                  </div>
                  {requestsLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : null}
                </div>

                {quoteRequests.length === 0 && !confirmationReceipt ? (
                  <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center">
                    <History className="mx-auto h-6 w-6 text-muted-foreground/60" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      暫無變更記錄。提交加選、換款或報價回覆後會顯示在這裡。
                    </p>
                  </div>
                ) : (
                  <ol className="relative mt-5 space-y-4 before:absolute before:left-[5px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
                    {confirmationReceipt ? (
                      <li className="relative pl-6">
                        <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono-data text-[11.5px] text-muted-foreground">
                            {fmtUtc8DateTime(
                              confirmationReceipt.confirmedAt ||
                                new Date().toISOString(),
                            )}
                          </span>
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                              confirmationReceipt.status === 'confirmed'
                                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
                                : 'border-rose-500/25 bg-rose-500/10 text-rose-700',
                            )}
                          >
                            {confirmationReceipt.status === 'confirmed'
                              ? '已確認報價'
                              : '不接受報價'}
                          </span>
                        </div>
                        <p className="mt-1 text-[13px] font-medium">
                          {confirmationReceipt.status === 'confirmed'
                            ? '已確認這個報價版本'
                            : '已提交不接受這個版本'}
                        </p>
                        {confirmationReceipt.note ? (
                          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-muted-foreground">
                            {confirmationReceipt.note}
                          </p>
                        ) : null}
                      </li>
                    ) : null}
                    {quoteRequests.map((request) => (
                      <li key={request.id} className="relative pl-6">
                        <span
                          className={cn(
                            'absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card',
                            request.status === 'converted'
                              ? 'bg-emerald-500'
                              : request.status === 'declined'
                                ? 'bg-rose-500'
                                : 'bg-amber-500',
                          )}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono-data text-[11.5px] text-muted-foreground">
                            {fmtUtc8DateTime(request.submitted_at)}
                          </span>
                          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10.5px] font-medium">
                            {customerRequestTypeLabel(request.request_type)}
                          </span>
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                              request.status === 'converted'
                                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
                                : request.status === 'declined'
                                  ? 'border-rose-500/25 bg-rose-500/10 text-rose-700'
                                  : 'border-amber-500/25 bg-amber-500/10 text-amber-700',
                            )}
                          >
                            {customerRequestStatusLabel(request.status)}
                          </span>
                        </div>
                        {request.lines.length > 0 ? (
                          <ul className="mt-1.5 space-y-1 text-[12.5px] text-foreground/85">
                            {request.lines
                              .filter(
                                (line) =>
                                  line.selected !== false &&
                                  Number(line.quantity) > 0,
                              )
                              .slice(0, 8)
                              .map((line, index) => (
                                <li key={`${request.id}-${index}`}>
                                  {line.kind === 'replacement'
                                    ? `${line.originalName || '原項目'} → ${line.name || '替代品'}`
                                    : line.name || '家具'}{' '}
                                  × {line.quantity}
                                </li>
                              ))}
                          </ul>
                        ) : null}
                        {request.note ? (
                          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-muted-foreground">
                            {request.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            <div className={detailTab === 'terms' ? 'space-y-3' : 'hidden'}>
              <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
                <h2 className="font-display text-lg font-bold">條款及付款</h2>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  請確認以下條款，並選擇是否確認目前報價版本。
                </p>

                <div className="mt-4 space-y-2">
                  {(termsSections.length > 0
                    ? termsSections
                    : [
                        {
                          key: 'empty',
                          title: '訂單及付款',
                          text: '',
                        },
                      ]
                  ).map((section, index) => {
                    const open = termsOpen[section.key] ?? index === 0;
                    return (
                      <section
                        key={section.key}
                        className="overflow-hidden rounded-xl border border-border/80"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setTermsOpen((current) => ({
                              ...current,
                              [section.key]: !open,
                            }))
                          }
                          className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                          aria-expanded={open}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono-data text-[10.5px] font-bold text-primary">
                            {index + 1}
                          </span>
                          <span className="text-[13px] font-semibold">
                            {section.title}
                          </span>
                          <ChevronDown
                            className={cn(
                              'ml-auto h-4 w-4 text-muted-foreground transition-transform',
                              open && 'rotate-180',
                            )}
                          />
                        </button>
                        {open ? (
                          <div className="border-t border-border/70 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                            {section.text ? (
                              <p className="whitespace-pre-wrap">{section.text}</p>
                            ) : (
                              <p>—</p>
                            )}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>

                {isBwfDetail ? (
                  <div className="mt-4 grid gap-2 rounded-xl bg-muted/30 px-4 py-3 text-[12px] sm:grid-cols-2">
                    <p>
                      <span className="text-muted-foreground">公司名稱：</span>
                      <span className="font-medium">
                        {bwfClientInfo?.companyName || '—'}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">聯絡人：</span>
                      <span className="font-medium">
                        {bwfClientInfo?.contactName || '—'}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">電話：</span>
                      <span className="font-mono-data font-medium">
                        {bwfClientInfo?.phone || '—'}
                      </span>
                    </p>
                    <p className="truncate">
                      <span className="text-muted-foreground">電郵：</span>
                      <span className="font-mono-data font-medium">
                        {bwfClientInfo?.email || '—'}
                      </span>
                    </p>
                  </div>
                ) : null}

                <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/80 px-3.5 py-3">
                  <Checkbox
                    checked={termsAgreed}
                    onCheckedChange={(checked) =>
                      setTermsAgreed(Boolean(checked))
                    }
                    className="mt-0.5"
                  />
                  <span className="text-[12.5px] text-muted-foreground">
                    我已閱讀並同意以上條款及細則
                  </span>
                </label>

                {hasPendingChangeDraft ? (
                  <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-900">
                    您仍有未提交的加選／換款。請先到「探索家具」提交變更；「確認報價」只會確認目前顯示的版本。
                  </p>
                ) : null}

                {confirmationReceipt ? (
                  <div
                    className={cn(
                      'mt-3 rounded-lg border p-3 text-[12.5px]',
                      confirmationReceipt.status === 'confirmed'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-900',
                    )}
                  >
                    <p className="font-semibold">
                      {confirmationReceipt.status === 'confirmed'
                        ? '已確認這個報價版本'
                        : '已提交不接受這個版本'}
                    </p>
                    <p className="mt-0.5 font-mono-data text-[11px]">
                      {active.quote_id} ·{' '}
                      {displayQuoteVersion(
                        confirmationReceipt.version || active.version,
                      )}
                      {confirmationReceipt.confirmedAt
                        ? ` · ${fmtUtc8DateTime(confirmationReceipt.confirmedAt)}`
                        : ''}
                    </p>
                  </div>
                ) : null}

                <textarea
                  value={quoteNote}
                  onChange={(event) => setQuoteNote(event.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="整體意見、交期或其他補充…"
                  className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[12.5px]"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setQuoteDecision('approved')}
                    className={cn(
                      'inline-flex h-10 items-center gap-1.5 rounded-lg border px-3.5 text-[12.5px] font-semibold transition-colors',
                      quoteDecision === 'approved'
                        ? 'border-emerald-500/40 bg-emerald-600 text-white'
                        : 'border-border bg-background text-foreground/80',
                    )}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    確認現有報價
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuoteDecision('rejected')}
                    className={cn(
                      'inline-flex h-10 items-center gap-1.5 rounded-lg border px-3.5 text-[12.5px] font-semibold transition-colors',
                      quoteDecision === 'rejected'
                        ? 'border-rose-500/40 bg-rose-600 text-white'
                        : 'border-border bg-background text-foreground/80',
                    )}
                  >
                    <Ban className="h-4 w-4" />
                    不接受這個版本
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitResponse()}
                    disabled={
                      submittingQuote ||
                      quoteDecision === 'pending' ||
                      !termsAgreed
                    }
                    className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12.5px] font-semibold text-primary-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submittingQuote ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {quoteDecision === 'rejected'
                      ? '提交不接受'
                      : '確認並提交'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </PortalPageShell>
      {lightbox ? (
        <ProductImageGalleryLightbox
          urls={lightbox.urls}
          title={lightbox.title}
          startIndex={lightbox.startIndex}
          onClose={() => setLightbox(null)}
        />
      ) : null}
      <FloorPlanViewerModal
        open={floorPlanViewerOpen}
        title={
          linkedFloorPlanProject?.name ||
          (active ? quoteDisplayName(active) : '平面圖')
        }
        url={linkedFloorPlanProject?.floorPlanUrl ?? null}
        type={linkedFloorPlanProject?.floorPlanType ?? null}
        previewUrl={floorPlanPreviewUrl}
        onClose={() => setFloorPlanViewerOpen(false)}
      />
      {pdfPreviewData ? (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          }
        >
          <LazyQuotationPDFPreviewModal
            open
            onClose={() => setPdfPreviewData(null)}
            data={pdfPreviewData}
            showCnyToggle={false}
          />
        </Suspense>
      ) : null}
    </>
  );
}
