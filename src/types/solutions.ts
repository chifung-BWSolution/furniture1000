// ============================================================================
// 傢俬方案 (Furniture Scheme) + 客戶專區 (Client Zone) — shared domain types
// Mirrors the Supabase schema in migrations/20250147_create_design_projects_schema.sql
// ============================================================================

export type ProjectStatus = 'draft' | 'in_progress' | 'confirmed' | 'archived';
export type SchemeLabel = 'A' | 'B';
/** 產品分配狀態：已確定 / 待討論 / 未確定 */
export type ZoneProductStatus = 'confirmed' | 'discussing' | 'pending';
/** A/B/C 產品分級 */
export type ProductTier = 'A' | 'B' | 'C';
export type InvitationStatus = 'sent' | 'viewed' | 'revoked';
export type DiscussionRole = 'pm' | 'designer' | 'client';

export interface ZoneBounds {
  x: number; // 0-100 (%)
  y: number;
  w: number;
  h: number;
}

export interface ProjectZone {
  id: string;
  projectId: string;
  code: string | null;
  name: string;
  bounds: ZoneBounds;
  aiSuggested: boolean;
  sortOrder: number;
}

export interface ZoneProduct {
  id: string;
  projectId: string;
  zoneId: string | null;
  productId: string | null;
  productTitle: string;
  productImageUrl: string;
  salePrice: number;
  scheme: SchemeLabel;
  status: ZoneProductStatus;
  quantity: number;
  sortOrder: number;
  /** Staff remark / note entered on 設計專案. */
  notes: string;
  /**
   * Project-local dimensions (mm). Null = fall back to catalog for display
   * until staff edits; edits never write back to products table.
   */
  dimensionLMm?: number | null;
  dimensionWMm?: number | null;
  dimensionHMm?: number | null;
  /**
   * Optional / 可選 line — still shown on 設計專案, but excluded from
   * zone 小計 and project 總計. Persisted via design_projects.meta.
   */
  isOptional?: boolean;
}

/** Custom room rows created via「新增房間」, stored in design_projects.meta. */
export interface CustomRoomType {
  key: string;
  label: string;
  codePrefix: string;
}

/** One furniture line saved into design_projects.meta.furnitureSnapshot. */
export interface FurnitureSnapshotItem {
  id: string;
  zoneId: string | null;
  zoneCode: string | null;
  zoneName: string | null;
  productId: string | null;
  productTitle: string;
  /** Storage / public HTTP URL only — never base64. */
  productImageUrl: string;
  salePrice: number;
  quantity: number;
  /** salePrice × quantity (0 when isOptional). */
  subtotal: number;
  notes: string;
  status: ZoneProductStatus;
  scheme: SchemeLabel;
  sortOrder: number;
  dimensionLMm?: number | null;
  dimensionWMm?: number | null;
  dimensionHMm?: number | null;
  /** Optional line — excluded from snapshot grandTotal. */
  isOptional?: boolean;
}

/** Full furniture inventory snapshot under design_projects.meta. */
export interface FurnitureSnapshot {
  savedAt: string;
  activeScheme: SchemeLabel;
  zoneCount: number;
  productCount: number;
  grandTotal: number;
  products: FurnitureSnapshotItem[];
}

/** Stored in design_projects.meta (no schema change). */
export interface DesignProjectMeta {
  projectType?: 'office' | 'school' | 'clinic' | 'hotel' | 'other';
  existingPartition?:
    | 'full_demolish'
    | 'partial_demolish'
    | 'keep_all'
    | 'raise_to_ceiling'
    | 'none';
  roomCounts?: Record<string, number>;
  /** User-defined rooms beyond the engineering-type templates. */
  customRooms?: CustomRoomType[];
  /** Display/sync order of room type keys (templates + custom). */
  roomOrder?: string[];
  /**
   * Renamed labels for template room keys (custom rooms store label on
   * customRooms directly). Applied when rendering and syncing zones.
   */
  roomLabelOverrides?: Record<string, string>;
  /**
   * Per-工程類型 room drafts. Switching type shows that type's template
   * (qty 0) or restores a previous draft/save for that type.
   */
  roomsByType?: Partial<
    Record<
      'office' | 'school' | 'clinic' | 'hotel' | 'other',
      {
        roomOrder: string[];
        roomCounts: Record<string, number>;
        customRooms: CustomRoomType[];
      }
    >
  >;
  floorPlanFileName?: string;
  /** JPEG preview for PDF floor plans (Storage HTTP URL). */
  floorPlanPreviewUrl?: string;
  /** Latest furniture inventory from 設計專案「儲存». */
  furnitureSnapshot?: FurnitureSnapshot;
  /**
   * Whole-quote reply from 客戶專區 > 報價方案「提交」。
   * Only decision=approved confirms the design project.
   */
  clientQuoteReply?: {
    decision: 'approved' | 'rejected' | 'comment';
    note: string;
    submittedAt: string;
    quoteId?: string;
    version?: string;
  };
  /**
   * Client portal「報價方案」draft — selections / quantities from「儲存」。
   * Also links the created/updated `bwf_quote` document when present.
   */
  clientQuoteScheme?: {
    savedAt: string;
    quoteUuid?: string;
    quoteId?: string;
    /** zone_products / item id → selected (計入小計). */
    selections: Record<string, boolean>;
    /** zone_products / item id → quantity. */
    quantities: Record<string, number>;
  };
  /** Per project_zones.id → area in square feet. */
  zoneAreasSqft?: Record<string, number>;
  /**
   * Per project_zones.id → planned furniture category partitions
   * (一級分類 / 二級分類 + quantity), with assigned zone_product ids.
   */
  furnitureDivisions?: Record<string, ZoneFurnitureDivision[]>;
  /** zone_products.id marked 可選 — excluded from furniture totals. */
  optionalZoneProductIds?: string[];
  [key: string]: unknown;
}

/** Planned furniture category bucket under a project zone. */
export interface ZoneFurnitureDivision {
  id: string;
  level1: string;
  level2: string;
  /** Planned piece count for this category partition. */
  quantity: number;
  /** zone_products.id assigned under this partition. */
  productIds?: string[];
}

export interface DesignProject {
  id: string;
  name: string;
  clientName: string | null;
  clientCompany: string | null;
  floorPlanUrl: string | null;
  floorPlanType: string | null;
  status: ProjectStatus;
  activeScheme: SchemeLabel;
  progress: number;
  createdBy: string | null;
  creatorStaffId: string | null;
  editorStaffId: string | null;
  createdAt: string;
  updatedAt: string;
  /** JSON meta: projectType / roomCounts / existingPartition */
  meta: DesignProjectMeta;
}

export interface ProjectInvitation {
  id: string;
  projectId: string;
  channel: 'link' | 'email';
  email: string | null;
  shareToken: string;
  status: InvitationStatus;
  viewedAt: string | null;
  createdAt: string;
}

export interface ClientCompany {
  id: string;
  name: string;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  pendingChanges: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDiscussion {
  id: string;
  projectId: string;
  zoneProductId: string | null;
  author: string;
  authorRole: DiscussionRole;
  body: string;
  mentions: string[];
  createdAt: string;
}

/** 產品搜尋結果（傢俬方案 / 客戶專區共用） */
export interface SearchProduct {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  salePrice: number;
  category: string;
  /** 產品目錄一級分類（products.level1_category） */
  level1Category?: string;
  /** 產品目錄二級分類（products.level2_category） */
  level2Category?: string;
  color: string;
  material: string;
  dimensionLMm?: number | null;
  dimensionWMm?: number | null;
  dimensionHMm?: number | null;
  /** products.factories_display_name */
  factoryName?: string;
  /** True only when a linked shopify_products row is currently active. */
  isOnShopify?: boolean;
  shopifyProductId?: string | null;
  sku?: string;
  tier: ProductTier;
  inStock: boolean;
  deliveryDays: number;
}

// ----------------------------------------------------------------------------
// Status display helpers — keep consistent with the rest of the dashboard
// ----------------------------------------------------------------------------
export const ZONE_PRODUCT_STATUS_META: Record<
  ZoneProductStatus,
  { label: string; className: string }
> = {
  confirmed: { label: '已確定', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  discussing: { label: '待討論', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  pending: { label: '未確定', className: 'bg-muted text-muted-foreground border-border' },
};

/** 客戶專區確認狀態文案 */
export const CLIENT_ZONE_STATUS_META: Record<
  ZoneProductStatus,
  { label: string; className: string }
> = {
  confirmed: { label: '已確認', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  discussing: { label: '待討論', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  pending: { label: '待確認', className: 'bg-sky-500/15 text-sky-600 border-sky-500/30' },
};

export const TIER_META: Record<ProductTier, { label: string; className: string }> = {
  A: { label: 'A 類', className: 'bg-primary/15 text-primary border-primary/30' },
  B: { label: 'B 類', className: 'bg-sky-500/15 text-sky-600 border-sky-500/30' },
  C: { label: 'C 類', className: 'bg-slate-500/15 text-slate-600 border-slate-500/30' },
};

export const INVITATION_STATUS_META: Record<
  InvitationStatus,
  { label: string; className: string }
> = {
  sent: { label: '未查看', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  viewed: { label: '已查看', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  revoked: { label: '已撤銷', className: 'bg-rose-500/15 text-rose-600 border-rose-500/30' },
};
