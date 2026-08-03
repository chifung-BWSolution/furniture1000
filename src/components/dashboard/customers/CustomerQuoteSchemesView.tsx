import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Ban,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  PenLine,
  Printer,
  RefreshCw,
  Save,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  loadClientQuoteItems,
  replaceQuoteItems,
  stripItemsFromProjectData,
  type BwfQuoteItemInput,
} from '@/lib/bwfQuoteItems';
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
} from '@/lib/customerPortalRoutes';
import { resolveQuoteShareToken } from '@/lib/bwfQuoteShareLinks';
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

/** Real bwf_quote rows (快速報價 / QR share) — not BWA 設計專案 cards. */
function isBwfQuoteRecord(quote: QuoteRecord | null | undefined): boolean {
  if (!quote?.id) return false;
  return (
    !quote.id.startsWith('design-project:') &&
    !quote.id.startsWith('confirmed-project:')
  );
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
      zoneId,
      code: '',
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
  );
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
            <img
              src={item.image}
              alt={title}
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
  const [searchParams] = useSearchParams();
  const quoteShareFromUrl = searchParams.get('quote_share');
  const hasPortalToken = Boolean(readStoredPortalToken());
  const hasQuoteShareToken = Boolean(
    quoteShareFromUrl?.trim() || readStoredQuoteShareToken()?.trim(),
  );
  const clientOnly =
    platformRole === 'client' || hasPortalToken || hasQuoteShareToken;

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
  /** Quote opened via 生成QR Code 及連結 share token. */
  const [sharedQuoteTarget, setSharedQuoteTarget] = useState<{
    quoteUuid: string;
    quoteId: string;
  } | null>(null);
  const sharedQuoteOpenedRef = useRef(false);
  /** Logged-in only: 全部 = design+quote list; BWA = 設計專案; BWF = 報價單一覽. */
  const [sourceFilter, setSourceFilter] = useState<'all' | 'bwa' | 'bwf'>('all');
  const showSourceFilter = Boolean(user) && !hasQuoteShareToken;
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
    if (hasQuoteShareToken) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bwf_quote')
        .select(LIST_SELECT)
        .order('created_at', { ascending: false })
        .limit(120);
      if (error) throw error;
      const rows = (data as QuoteRecord[]) || [];
      const enriched = await loadPitchingsForQuoteRows(rows);
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
  }, [hasQuoteShareToken]);

  // Load exactly one quotation for quote_share links (guest or logged-in preview).
  useEffect(() => {
    let cancelled = false;
    const token =
      quoteShareFromUrl?.trim() || readStoredQuoteShareToken()?.trim() || '';
    if (!token) {
      if (!hasQuoteShareToken) setSharedQuoteTarget(null);
      return;
    }
    storeQuoteShareToken(token);
    setLoading(true);
    setPortalProjects([]);
    setPortalProjectData({});
    setPortalTotals({});
    setSyntheticQuotes([]);

    void (async () => {
      try {
        const resolved = await resolveQuoteShareToken(token);
        if (cancelled) return;
        if (!resolved?.quoteUuid) {
          toast.error('分享連結無效或已撤銷', {
            description:
              '請重新在報價單按「生成QR Code 及連結」。若剛從編輯頁開啟，請用無痕視窗或另一瀏覽器開啟連結。',
          });
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
  }, [quoteShareFromUrl, hasQuoteShareToken]);

  // Restore share target from storage after refresh when URL param was dropped.
  useEffect(() => {
    if (sharedQuoteTarget || !hasQuoteShareToken) return;
    const stored = readStoredQuoteShareTarget();
    if (stored) setSharedQuoteTarget(stored);
  }, [hasQuoteShareToken, sharedQuoteTarget]);

  useEffect(() => {
    if (hasQuoteShareToken) return;
    void fetchQuotes();
    // Quote-share guests only need the shared bwf_quote — skip design-project cards.
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
  }, [fetchQuotes, hasQuoteShareToken]);

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
          if (typeof savedQty === 'number' && Number.isFinite(savedQty)) {
            return {
              ...row,
              quantity: Math.max(0, Math.floor(savedQty)),
            };
          }
          // Default: selected → ≥1, unselected → 0
          if (nextSelected[row.id]) {
            return {
              ...row,
              quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)),
            };
          }
          return { ...row, quantity: 0 };
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
    // Quote-share sessions only ever load the shared row — show it without
    // allow-list / invite filtering (those hide non-demo quotations).
    if (hasQuoteShareToken) {
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
    if (showSourceFilter && sourceFilter !== 'all') {
      visible = visible.filter((quote) => {
        const isDesignCard =
          quote.id.startsWith('design-project:') ||
          quote.id.startsWith('confirmed-project:');
        return sourceFilter === 'bwa' ? isDesignCard : !isDesignCard;
      });
    }
    return [...visible].sort((a, b) => {
      const aDesign = a.id.startsWith('design-project:') ? 1 : 0;
      const bDesign = b.id.startsWith('design-project:') ? 1 : 0;
      if (aDesign !== bDesign) return bDesign - aDesign;
      return (
        new Date(b.modified_date || b.created_at).getTime() -
        new Date(a.modified_date || a.created_at).getTime()
      );
    });
  }, [
    clientOnly,
    clientProjects,
    hasQuoteShareToken,
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

      if (quoteUuid) {
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
            productItems.map((item) => ({
              ...item,
              quantity: quantities[item.id!],
            })),
          );
        }
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
          productItems.map((item) => ({
            ...item,
            quantity: quantities[item.id!],
          })),
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
      toast.success('已儲存報價方案', {
        description: linkedProject
          ? '選擇、數量已寫入設計專案與報價文件'
          : '選擇、數量已寫入報價文件',
      });
    } catch (error) {
      toast.error('儲存失敗', {
        description:
          error instanceof Error ? error.message : '請稍後再試',
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
    setSubmittingQuote(true);
    try {
      // Persist selections/qty together with the whole-quote reply.
      await saveQuoteScheme();
      const savedMeta = await mergeProjectMeta(linkedProject.id, {
        clientQuoteReply,
      });
      if (!savedMeta.ok || !savedMeta.data) {
        toast.error('提交失敗', { description: savedMeta.error });
        return;
      }
      const nextMeta = savedMeta.data;
      if (decision === 'approved') {
        const statusSaved = await saveProject(linkedProject.id, {
          status: 'confirmed',
          progress: 100,
        });
        if (!statusSaved.ok) {
          toast.error('提交失敗', { description: statusSaved.error });
          return;
        }
      }
      setPortalProjects((current) =>
        current.map((row) =>
          row.id === linkedProject.id
            ? {
                ...row,
                meta: nextMeta,
                status:
                  decision === 'approved' ? 'confirmed' : row.status,
                progress:
                  decision === 'approved' ? 100 : row.progress,
              }
            : row,
        ),
      );
      savedSchemeSnapshotRef.current = buildSchemeSnapshot();
      unsavedGuard.clear();
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
    <>
    <PortalPageShell
      scrollRef={pageScrollRef}
      title={showDetail && active ? quoteDisplayName(active) : '報價方案'}
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
      subtitle="查看自己的 HTML 報價、切換版本、按工程分區批核產品，並回覆整張報價。"
      maxWidthClass="max-w-none"
      actions={
        showDetail && active ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <button
              type="button"
              disabled={!hasFloorPlan}
              onClick={openFloorPlanViewer}
              className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm transition hover:border-primary/40 hover:shadow-md disabled:cursor-default disabled:opacity-70 sm:h-20 sm:w-28"
              title={hasFloorPlan ? '點擊查看平面圖' : '尚未上傳平面圖'}
              aria-label={hasFloorPlan ? '查看平面圖縮圖' : '尚未上傳平面圖'}
            >
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
            </button>
          </div>
        ) : null
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
        ) : availableQuotes.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <FileText className="mx-auto h-9 w-9 text-muted-foreground/40" />
            <p className="mt-3 font-semibold">目前沒有屬於您的報價</p>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
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
        <section className="space-y-5">
          <button
            type="button"
            onClick={() => setShowDetail(false)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
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

          {isBwfDetail && bwfClientInfo ? (
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="font-display text-base font-bold">客戶資訊</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    公司名稱
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {bwfClientInfo.companyName || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    客戶名稱
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {bwfClientInfo.contactName || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    電話
                  </p>
                  <p className="mt-1 font-mono-data text-sm font-semibold">
                    {bwfClientInfo.phone || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    電郵
                  </p>
                  <p className="mt-1 font-mono-data text-sm font-semibold break-all">
                    {bwfClientInfo.email || '—'}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <div ref={partitionStickySentinelRef}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold">
                  間隔清單與傢俬配置
                </h2>
                <span className="font-mono-data text-[15px] text-muted-foreground">
                  {zoneTypeGroups.length} 個間隔 ·{' '}
                  {items.filter(
                    (item) =>
                      !item.isSectionTitle &&
                      !item.isDivisionTitle &&
                      !item.isCustomTerm,
                  ).length}{' '}
                  件產品
                </span>
              </div>
              {!itemsLoading && zoneTypeGroups.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
                  <span className="mr-1 text-[15px] font-semibold text-muted-foreground">
                    間隔數量
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {zoneTypeGroups.map((group) => {
                      const productTotal = group.rooms.reduce(
                        (sum, room) =>
                          sum +
                          roomProductCount(
                            room,
                            schemeGroupsByZone[room.zoneId || ''] || [],
                          ),
                        0,
                      );
                      const isActive =
                        (activeZoneLabel || zoneTypeGroups[0]?.label) ===
                        group.label;
                      return (
                        <button
                          key={group.key}
                          type="button"
                          onClick={() => scrollToZoneGroup(group.label)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[15px] transition-colors',
                            isActive
                              ? 'border-primary/50 bg-primary/15 text-primary shadow-sm'
                              : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
                          )}
                          title={`跳至「${group.label}」· 產品總數 ${productTotal}`}
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
                            ：{productTotal}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveQuoteScheme()}
                    disabled={savingScheme}
                    className="ml-auto inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[15px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {savingScheme ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    儲存
                  </button>
                </div>
              ) : null}
            </div>
          </section>

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
                const isSingleRoomGroup = group.rooms.length === 1;
                const productCount = group.rooms.reduce(
                  (sum, room) =>
                    sum +
                    roomProductCount(
                      room,
                      schemeGroupsByZone[room.zoneId || ''] || [],
                    ),
                  0,
                );
                return (
                  <section
                    key={group.key}
                    id={zoneGroupDomId(group.label)}
                    className="scroll-mt-2 space-y-3"
                  >
                    {!isSingleRoomGroup ? (
                      <div className="rounded-xl border border-border bg-foreground/[0.06] px-4 py-3 text-center">
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                          區域類型
                        </p>
                        <h3 className="mt-0.5 font-display text-lg font-bold leading-snug md:text-xl">
                          {group.label} x {group.rooms.length} 個{group.label}
                          {productCount > 0
                            ? ` · 總共${productCount} 件產品`
                            : ''}
                        </h3>
                      </div>
                    ) : null}

                    <div className="space-y-3">
                      {group.rooms.map((room) => {
                        const roomSchemeGroups =
                          schemeGroupsByZone[room.zoneId || ''] || [];
                        const roomCount = roomProductCount(
                          room,
                          roomSchemeGroups,
                        );
                        const plannedCount = roomPlannedFurnitureCount(room);
                        const roomTitle = isSingleRoomGroup
                          ? group.label
                          : room.name;
                        const roomSqft = zoneSqftForDisplay(
                          activeZoneAreasSqft,
                          room.zoneId,
                        );
                        const roomContextCount =
                          plannedCount > 0 ? plannedCount : roomCount;
                        const roomSubtotal = room.sections.reduce(
                          (sum, section) =>
                            sum +
                            section.items.reduce((sectionSum, item) => {
                              if (!isQuoteItemSelected(item, itemSelected)) {
                                return sectionSum;
                              }
                              return sectionSum + clientQuoteLineTotal(item);
                            }, 0),
                          0,
                        );
                        const hasDivisionLabels = room.sections.some(
                          (section) => Boolean(section.label),
                        );
                        return (
                          <section
                            key={room.id}
                            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                          >
                            <div
                              className="border-b border-border bg-foreground/[0.06] px-5 py-4"
                              data-partition-zone={group.label}
                              data-partition-zone-title={roomTitle}
                              {...(!hasDivisionLabels
                                ? {
                                    'data-partition-division': roomTitle,
                                    'data-partition-count': String(
                                      roomContextCount,
                                    ),
                                    'data-partition-picked': String(
                                      room.sections.reduce(
                                        (sum, section) =>
                                          sum +
                                          sectionSelectedQuantity(
                                            section,
                                            itemSelected,
                                          ),
                                        0,
                                      ),
                                    ),
                                    'data-partition-product': '',
                                  }
                                : {})}
                            >
                              <div className="flex w-full min-w-0 flex-col items-center gap-1 text-center">
                                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                  區域
                                </p>
                                <h4 className="font-display text-lg font-bold leading-snug tracking-tight text-foreground md:text-xl">
                                  {roomTitle}{' '}
                                  {plannedCount > 0
                                    ? `× 總數 ${plannedCount}件傢俬`
                                    : roomCount > 0
                                      ? `× 總數 ${roomCount}件傢俬`
                                      : '× 暫無產品'}
                                  {roomSqft != null
                                    ? ` · ${formatZoneSqftLabel(roomSqft)}`
                                    : ''}
                                </h4>
                              </div>
                            </div>
                            <div className="divide-y divide-border/70">
                              {roomCount === 0 ? (
                                <p className="px-5 py-6 text-sm text-muted-foreground">
                                  此區域暫未選擇產品
                                </p>
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
                                      <div
                                        className="grid grid-cols-1 items-center gap-2 border-b border-border/80 bg-muted/20 px-4 py-2.5 sm:grid-cols-[1fr_auto_1fr] sm:px-5"
                                        data-partition-division={section.label}
                                        data-partition-count={String(
                                          sectionCount,
                                        )}
                                        data-partition-picked={String(
                                          sectionPickedQty,
                                        )}
                                        data-partition-zone={group.label}
                                        data-partition-zone-title={roomTitle}
                                        data-partition-product=""
                                      >
                                        <div className="hidden sm:block" />
                                        <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1">
                                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                                            <Layers className="h-3 w-3" />
                                            傢俬劃分
                                          </span>
                                          <h5 className="text-center font-display text-[15px] font-semibold leading-snug text-foreground/90 md:text-base">
                                            {section.label}
                                            <span className="ml-1.5 font-mono-data text-[13px] font-medium text-muted-foreground">
                                              : 總共{sectionCount} 件產品
                                            </span>
                                          </h5>
                                        </div>
                                        <p
                                          className={cn(
                                            'justify-self-center text-[13px] font-semibold sm:justify-self-end md:text-sm',
                                            sectionPickedQty >= sectionCount &&
                                              sectionCount > 0
                                              ? 'text-emerald-700'
                                              : 'text-muted-foreground',
                                          )}
                                        >
                                          已選擇 : {sectionPickedQty}/
                                          {sectionCount}件
                                        </p>
                                      </div>
                                    ) : null}
                                    {sectionSlots.length > 0 ? (
                                      <div className="space-y-px bg-border">
                                        {/*
                                          Each scheme slot (e.g. 7選1 / 2選1) owns its own grid.
                                          Multi-scheme → up to 3 vertical cards; single → horizontal 1-col row.
                                        */}
                                        {sectionSlots.map((slot, slotIndex) => {
                                          const targetQty =
                                            section.plannedQuantity != null &&
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
                                          // Hide「產品 N」when the division only has one product slot.
                                          const productOrdinal =
                                            sectionSlots.length > 1
                                              ? slotIndex + 1
                                              : undefined;
                                          return (
                                          <div
                                            key={slot.key}
                                            className={cn(
                                              'min-w-0',
                                              // Multi → 3-col vertical cards; single → stacked horizontal rows.
                                              multiScheme
                                                ? 'grid grid-cols-1 items-stretch gap-px bg-border md:grid-cols-2 xl:grid-cols-3'
                                                : 'flex flex-col bg-card',
                                            )}
                                          >
                                            {slot.items.map((item, index) => {
                                              const key = itemKey(item, index);
                                              const review = itemReviews[key];
                                              const messages =
                                                itemMessages[key] || [];
                                              const selected =
                                                isQuoteItemSelected(
                                                  item,
                                                  itemSelected,
                                                );
                                              const itemQty = Math.max(
                                                0,
                                                Math.floor(
                                                  Number(item.quantity) || 0,
                                                ),
                                              );
                                              const othersSelectedQty =
                                                selected
                                                  ? selectedQty - itemQty
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
                                              return (
                                                <div
                                                  key={`${slot.key}:${key}`}
                                                  className="min-w-0 bg-card"
                                                >
                                                  <QuotePortalProductCard
                                                    item={item}
                                                    schemeIndex={index}
                                                    schemeCount={
                                                      slot.items.length
                                                    }
                                                    productOrdinal={
                                                      productOrdinal
                                                    }
                                                    partitionSpy={
                                                      section.label
                                                        ? {
                                                            zoneLabel:
                                                              group.label,
                                                            zoneTitle:
                                                              roomTitle,
                                                            divisionLabel:
                                                              section.label,
                                                            count: sectionCount,
                                                            picked:
                                                              sectionPickedQty,
                                                          }
                                                        : null
                                                    }
                                                    review={review}
                                                    messages={messages}
                                                    selected={selected}
                                                    draftNote={
                                                      itemDraftNotes[key] || ''
                                                    }
                                                    saving={
                                                      savingReviewKey === key
                                                    }
                                                    currentUserName={
                                                      currentUserName
                                                    }
                                                    quotaFilled={
                                                      quotaMet && !selected
                                                    }
                                                    maxQuantity={maxQuantity}
                                                    onSetQuantity={(
                                                      quantity,
                                                    ) => {
                                                      if (!item.id) return;
                                                      const next = Math.max(
                                                        0,
                                                        Math.floor(
                                                          Number(quantity) || 0,
                                                        ),
                                                      );
                                                      const capped =
                                                        maxQuantity != null
                                                          ? Math.min(
                                                              next,
                                                              maxQuantity,
                                                            )
                                                          : next;
                                                      setItemQuantity(
                                                        item.id,
                                                        capped,
                                                      );
                                                      // Typing a positive qty implies selecting; 0 clears selection.
                                                      if (capped > 0 && !selected) {
                                                        setItemSelected(
                                                          (current) => ({
                                                            ...current,
                                                            [item.id!]: true,
                                                          }),
                                                        );
                                                      } else if (
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
                                                    onSetDraftNote={(value) =>
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
                                                    onDeleteMessage={(
                                                      messageId,
                                                    ) =>
                                                      void deleteItemMessage(
                                                        item,
                                                        messageId,
                                                      )
                                                    }
                                                    onSetReview={(
                                                      nextReview,
                                                    ) => {
                                                      if (!item.id) return;
                                                      if (
                                                        nextReview ===
                                                        'accepted'
                                                      ) {
                                                        if (
                                                          targetQty != null &&
                                                          slot.items.length >
                                                            1 &&
                                                          !selected
                                                        ) {
                                                          const remaining =
                                                            targetQty -
                                                            selectedQty;
                                                          if (remaining <= 0) {
                                                            toast.message(
                                                              '已達此傢俬劃分所需數量',
                                                              {
                                                                description: `「${section.label || '此劃分'}」需要 ${targetQty} 件，請先調整已選方案的數量。`,
                                                              },
                                                            );
                                                            return;
                                                          }
                                                          setItemQuantity(
                                                            item.id,
                                                            Math.max(
                                                              1,
                                                              Math.min(
                                                                itemQty > 0
                                                                  ? itemQty
                                                                  : 1,
                                                                remaining,
                                                              ),
                                                            ),
                                                          );
                                                        } else if (itemQty <= 0) {
                                                          // Select → default quantity 1
                                                          setItemQuantity(
                                                            item.id,
                                                            1,
                                                          );
                                                        }
                                                        setItemSelected(
                                                          (current) => ({
                                                            ...current,
                                                            [item.id!]: true,
                                                          }),
                                                        );
                                                      } else {
                                                        // 取消接受／要求修改／不接受 → 數量歸 0
                                                        setItemQuantity(
                                                          item.id,
                                                          0,
                                                        );
                                                        setItemSelected(
                                                          (current) => ({
                                                            ...current,
                                                            [item.id!]: false,
                                                          }),
                                                        );
                                                      }
                                                      void syncItemReview(
                                                        item,
                                                        nextReview,
                                                      ).then((ok) => {
                                                        if (
                                                          ok &&
                                                          nextReview ===
                                                            'accepted'
                                                        ) {
                                                          toast.success(
                                                            '已同步為「已確定」',
                                                          );
                                                        }
                                                      });
                                                    }}
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
                                            })}
                                          </div>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                              {roomCount > 0 ? (
                                <div className="flex justify-end border-t border-border bg-muted/20 px-5 py-3.5">
                                  <p className="font-mono-data text-[15px] font-semibold text-foreground">
                                    {room.name} : 小計 $
                                    {Math.round(roomSubtotal).toLocaleString()}
                                  </p>
                                </div>
                              ) : null}
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
              {fmtMoney(itemSubtotal || active.total_amount || 0)}
            </strong>
          </div>

          {isBwfDetail ? (
            <>
              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h2 className="font-display text-base font-bold">
                  訂單確認及交付細節
                </h2>
                <p className="mt-3 whitespace-pre-wrap font-body text-sm leading-relaxed text-foreground/90">
                  {bwfDeliveryDetails || '—'}
                </p>
              </section>

              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h2 className="font-display text-base font-bold">條款及付款</h2>
                {bwfTermsHtml ? (
                  <div
                    className="quotation-terms-html mt-3 max-w-none font-body text-sm leading-relaxed text-foreground/90 [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-bold [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                    dangerouslySetInnerHTML={{ __html: bwfTermsHtml }}
                  />
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">—</p>
                )}
              </section>
            </>
          ) : null}

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
    </>
  );
}
