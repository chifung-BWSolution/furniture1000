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
  createdAt: string;
  updatedAt: string;
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
  color: string;
  material: string;
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
