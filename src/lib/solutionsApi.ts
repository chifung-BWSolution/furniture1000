// ============================================================================
// Data access layer for 傢俬方案 / 客戶專區 pages.
// Wraps Supabase queries, maps snake_case rows → camelCase domain types,
// and falls back to mock data when a table is empty or the query fails so
// pages never render blank.
// ============================================================================
import { supabase } from './supabase';
import type {
  DesignProject, ProjectZone, ZoneProduct, ProjectInvitation,
  ClientCompany, ProductDiscussion, SearchProduct,
} from '@/types/solutions';
import {
  MOCK_PROJECTS, MOCK_ZONES, MOCK_ZONE_PRODUCTS,
  MOCK_INVITATIONS, MOCK_CLIENT_COMPANY, MOCK_DISCUSSIONS, MOCK_SEARCH_PRODUCTS,
} from '@/constants/solutions-mock';

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
function mapProject(r: any): DesignProject {
  return {
    id: r.id,
    name: r.name,
    clientName: r.client_name ?? null,
    clientCompany: r.client_company ?? null,
    floorPlanUrl: r.floor_plan_url ?? null,
    floorPlanType: r.floor_plan_type ?? null,
    status: r.status ?? 'draft',
    activeScheme: (r.active_scheme ?? 'A') as DesignProject['activeScheme'],
    progress: r.progress ?? 0,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapZone(r: any): ProjectZone {
  return {
    id: r.id,
    projectId: r.project_id,
    code: r.code ?? null,
    name: r.name,
    bounds: typeof r.bounds === 'string' ? JSON.parse(r.bounds) : (r.bounds ?? { x: 0, y: 0, w: 0, h: 0 }),
    aiSuggested: !!r.ai_suggested,
    sortOrder: r.sort_order ?? 0,
  };
}

function mapZoneProduct(r: any): ZoneProduct {
  return {
    id: r.id,
    projectId: r.project_id,
    zoneId: r.zone_id ?? null,
    productId: r.product_id ?? null,
    productTitle: r.product_title ?? '',
    productImageUrl: r.product_image_url ?? '',
    salePrice: Number(r.sale_price ?? 0),
    scheme: (r.scheme ?? 'A') as ZoneProduct['scheme'],
    status: (r.status ?? 'pending') as ZoneProduct['status'],
    quantity: r.quantity ?? 1,
    sortOrder: r.sort_order ?? 0,
  };
}

function mapInvitation(r: any): ProjectInvitation {
  return {
    id: r.id,
    projectId: r.project_id,
    channel: (r.channel ?? 'link') as ProjectInvitation['channel'],
    email: r.email ?? null,
    shareToken: r.share_token,
    status: (r.status ?? 'sent') as ProjectInvitation['status'],
    viewedAt: r.viewed_at ?? null,
    createdAt: r.created_at,
  };
}

function mapCompany(r: any): ClientCompany {
  return {
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person ?? null,
    contactEmail: r.contact_email ?? null,
    contactPhone: r.contact_phone ?? null,
    address: r.address ?? null,
    pendingChanges: r.pending_changes ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDiscussion(r: any): ProductDiscussion {
  return {
    id: r.id,
    projectId: r.project_id,
    zoneProductId: r.zone_product_id ?? null,
    author: r.author,
    authorRole: (r.author_role ?? 'client') as ProductDiscussion['authorRole'],
    body: r.body,
    mentions: r.mentions ?? [],
    createdAt: r.created_at,
  };
}

/** A/B/C tier is not stored on products; derive a stable tier from price bands. */
function deriveTier(price: number): SearchProduct['tier'] {
  if (price >= 4000) return 'A';
  if (price >= 1500) return 'B';
  return 'C';
}

function mapSearchProduct(r: any): SearchProduct {
  const sale = Number(r.sale_price ?? r.price ?? 0);
  const img = (Array.isArray(r.images) && r.images[0]?.src) || r.image_url || '';
  return {
    id: r.id,
    title: r.title ?? '',
    description: (r.description ?? '').slice(0, 80),
    imageUrl: img,
    salePrice: sale,
    category: r.category ?? r.collection ?? '其他',
    color: r.color ?? '—',
    material: r.material ?? '—',
    tier: deriveTier(sale),
    inStock: (r.delivery_term_name ?? '').includes('現貨') || (r.total_lead_time ?? 99) <= 7,
    deliveryDays: r.total_lead_time ?? r.shipping_days ?? 14,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Fetchers (each returns mock fallback on empty/error)
// ---------------------------------------------------------------------------
export async function fetchProjects(): Promise<DesignProject[]> {
  try {
    const { data, error } = await supabase
      .from('design_projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error || !data || data.length === 0) return MOCK_PROJECTS;
    return data.map(mapProject);
  } catch {
    return MOCK_PROJECTS;
  }
}

export async function fetchZones(projectId: string): Promise<ProjectZone[]> {
  try {
    const { data, error } = await supabase
      .from('project_zones')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true });
    if (error || !data || data.length === 0) return MOCK_ZONES.filter((z) => z.projectId === projectId);
    return data.map(mapZone);
  } catch {
    return MOCK_ZONES.filter((z) => z.projectId === projectId);
  }
}

export async function fetchZoneProducts(projectId: string): Promise<ZoneProduct[]> {
  try {
    const { data, error } = await supabase
      .from('zone_products')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true });
    if (error || !data || data.length === 0) return MOCK_ZONE_PRODUCTS.filter((p) => p.projectId === projectId);
    return data.map(mapZoneProduct);
  } catch {
    return MOCK_ZONE_PRODUCTS.filter((p) => p.projectId === projectId);
  }
}

export async function fetchInvitations(projectId: string): Promise<ProjectInvitation[]> {
  try {
    const { data, error } = await supabase
      .from('project_invitations')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error || !data || data.length === 0) return MOCK_INVITATIONS.filter((i) => i.projectId === projectId);
    return data.map(mapInvitation);
  } catch {
    return MOCK_INVITATIONS.filter((i) => i.projectId === projectId);
  }
}

export async function fetchCompany(): Promise<ClientCompany> {
  try {
    const { data, error } = await supabase
      .from('client_companies')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error || !data) return MOCK_CLIENT_COMPANY;
    return mapCompany(data);
  } catch {
    return MOCK_CLIENT_COMPANY;
  }
}

export async function fetchDiscussions(projectId: string): Promise<ProductDiscussion[]> {
  try {
    const { data, error } = await supabase
      .from('product_discussions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (error || !data || data.length === 0) return MOCK_DISCUSSIONS.filter((d) => d.projectId === projectId);
    return data.map(mapDiscussion);
  } catch {
    return MOCK_DISCUSSIONS.filter((d) => d.projectId === projectId);
  }
}

/**
 * Product search against the REAL existing `products` table (1400+ rows).
 * @param limit cap rows for performance.
 */
export async function fetchSearchProducts(limit = 60): Promise<SearchProduct[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id,title,description,price,sale_price,image_url,images,collection,category,color,total_lead_time,shipping_days,delivery_term_name')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data || data.length === 0) return MOCK_SEARCH_PRODUCTS;
    return data.map(mapSearchProduct);
  } catch {
    return MOCK_SEARCH_PRODUCTS;
  }
}
