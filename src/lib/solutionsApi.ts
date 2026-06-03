// ============================================================================
// Data access layer for 傢俬方案 / 客戶專區 pages.
// Wraps Supabase queries and maps snake_case rows → camelCase domain types.
// Returns real data only — no mock fallback. Empty tables yield empty results
// and pages render their empty states.
// ============================================================================
import { supabase } from './supabase';
import type {
  DesignProject, ProjectZone, ZoneProduct, ProjectInvitation,
  ClientCompany, ProductDiscussion, SearchProduct,
} from '@/types/solutions';

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
// Fetchers (real data only — empty array / null when no rows)
// ---------------------------------------------------------------------------
export async function fetchProjects(): Promise<DesignProject[]> {
  try {
    const { data, error } = await supabase
      .from('design_projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapProject);
  } catch {
    return [];
  }
}

export async function fetchZones(projectId: string): Promise<ProjectZone[]> {
  try {
    const { data, error } = await supabase
      .from('project_zones')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true });
    if (error || !data) return [];
    return data.map(mapZone);
  } catch {
    return [];
  }
}

export async function fetchZoneProducts(projectId: string): Promise<ZoneProduct[]> {
  try {
    const { data, error } = await supabase
      .from('zone_products')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true });
    if (error || !data) return [];
    return data.map(mapZoneProduct);
  } catch {
    return [];
  }
}

export async function fetchInvitations(projectId: string): Promise<ProjectInvitation[]> {
  try {
    const { data, error } = await supabase
      .from('project_invitations')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapInvitation);
  } catch {
    return [];
  }
}

export async function fetchCompany(): Promise<ClientCompany | null> {
  try {
    const { data, error } = await supabase
      .from('client_companies')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapCompany(data);
  } catch {
    return null;
  }
}

export async function fetchDiscussions(projectId: string): Promise<ProductDiscussion[]> {
  try {
    const { data, error } = await supabase
      .from('product_discussions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map(mapDiscussion);
  } catch {
    return [];
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
    if (error || !data) return [];
    return data.map(mapSearchProduct);
  } catch {
    return [];
  }
}

// ===========================================================================
// WRITE operations
// Each returns { ok, error, data? }. They never throw — callers do optimistic
// UI updates and surface ok/error via toast.
// ===========================================================================
export interface WriteResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Create a new design project. */
export async function createProject(input: {
  name: string;
  clientName?: string;
  clientCompany?: string;
  floorPlanUrl?: string | null;
  floorPlanType?: string | null;
}): Promise<WriteResult<DesignProject>> {
  try {
    const { data, error } = await supabase
      .from('design_projects')
      .insert({
        name: input.name,
        client_name: input.clientName ?? null,
        client_company: input.clientCompany ?? null,
        floor_plan_url: input.floorPlanUrl ?? null,
        floor_plan_type: input.floorPlanType ?? null,
        status: 'draft',
        active_scheme: 'A',
        progress: 0,
        created_by: 'CF',
      })
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: mapProject(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '建立失敗' };
  }
}

/** Update project-level fields (e.g. save a version snapshot, change active scheme/progress). */
export async function saveProject(
  projectId: string,
  patch: { activeScheme?: string; progress?: number; status?: string; name?: string },
): Promise<WriteResult> {
  try {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.activeScheme !== undefined) row.active_scheme = patch.activeScheme;
    if (patch.progress !== undefined) row.progress = patch.progress;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.name !== undefined) row.name = patch.name;
    const { error } = await supabase.from('design_projects').update(row).eq('id', projectId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '儲存失敗' };
  }
}

/** Update a single zone_product's confirmation status. */
export async function updateZoneProductStatus(
  zoneProductId: string,
  status: string,
): Promise<WriteResult> {
  try {
    const { error } = await supabase.from('zone_products').update({ status }).eq('id', zoneProductId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '更新失敗' };
  }
}

/** Bulk-update zone_product statuses. */
export async function bulkUpdateZoneProductStatus(
  ids: string[],
  status: string,
): Promise<WriteResult> {
  try {
    const { error } = await supabase.from('zone_products').update({ status }).in('id', ids);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '更新失敗' };
  }
}

/** Generate a short share token without Date/Math (deterministic-ish, fine for demo). */
function makeShareToken() {
  return 'tok_' + Math.abs(hashStr(JSON.stringify(globalThis.performance?.now?.() ?? '') + Math.random())).toString(36).slice(0, 8);
}
function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

/** Create an invitation (link or email). */
export async function createInvitation(input: {
  projectId: string;
  channel: 'link' | 'email';
  email?: string | null;
}): Promise<WriteResult<ProjectInvitation>> {
  try {
    const { data, error } = await supabase
      .from('project_invitations')
      .insert({
        project_id: input.projectId,
        channel: input.channel,
        email: input.email ?? null,
        share_token: makeShareToken(),
        status: 'sent',
      })
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: mapInvitation(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '建立邀請失敗' };
  }
}

/** Update an invitation's status (resend → sent, revoke → revoked). */
export async function updateInvitationStatus(
  invitationId: string,
  status: 'sent' | 'viewed' | 'revoked',
): Promise<WriteResult> {
  try {
    const { error } = await supabase.from('project_invitations').update({ status }).eq('id', invitationId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '更新失敗' };
  }
}

/** Add a discussion message. */
export async function addDiscussion(input: {
  projectId: string;
  zoneProductId: string | null;
  author: string;
  authorRole: 'pm' | 'designer' | 'client';
  body: string;
  mentions?: string[];
}): Promise<WriteResult<ProductDiscussion>> {
  try {
    const { data, error } = await supabase
      .from('product_discussions')
      .insert({
        project_id: input.projectId,
        zone_product_id: input.zoneProductId,
        author: input.author,
        author_role: input.authorRole,
        body: input.body,
        mentions: input.mentions ?? [],
      })
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: mapDiscussion(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '送出失敗' };
  }
}

/** Submit client company contact changes for PM approval (stored in pending_changes). */
export async function submitCompanyChanges(
  companyId: string,
  changes: Record<string, string>,
): Promise<WriteResult> {
  try {
    const { error } = await supabase
      .from('client_companies')
      .update({ pending_changes: changes })
      .eq('id', companyId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '提交失敗' };
  }
}

/** Assign a zone_product to a zone (drag from basket → zone), optionally under a scheme. */
export async function assignZoneProductToZone(
  zoneProductId: string,
  zoneId: string,
  scheme?: string,
): Promise<WriteResult> {
  try {
    const patch: Record<string, unknown> = { zone_id: zoneId };
    if (scheme) patch.scheme = scheme;
    const { error } = await supabase
      .from('zone_products')
      .update(patch)
      .eq('id', zoneProductId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '分配失敗' };
  }
}

/** Move a zone_product back to the design basket (zone_id → null). */
export async function unassignZoneProduct(zoneProductId: string): Promise<WriteResult> {
  try {
    const { error } = await supabase
      .from('zone_products')
      .update({ zone_id: null })
      .eq('id', zoneProductId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '移動失敗' };
  }
}

/** Persist a project's uploaded floor plan (data URL or storage URL + type). */
export async function updateProjectFloorPlan(
  projectId: string,
  floorPlanUrl: string,
  floorPlanType: string,
): Promise<WriteResult> {
  try {
    const { error } = await supabase
      .from('design_projects')
      .update({ floor_plan_url: floorPlanUrl, floor_plan_type: floorPlanType, updated_at: new Date().toISOString() })
      .eq('id', projectId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '儲存平面圖失敗' };
  }
}

/** Create a zone under a project. Returns the inserted zone. */
export async function createZone(input: {
  projectId: string;
  name: string;
  code?: string | null;
  bounds: { x: number; y: number; w: number; h: number };
  aiSuggested?: boolean;
  sortOrder?: number;
}): Promise<WriteResult<ProjectZone>> {
  try {
    const { data, error } = await supabase
      .from('project_zones')
      .insert({
        project_id: input.projectId,
        name: input.name,
        code: input.code ?? null,
        bounds: input.bounds,
        ai_suggested: input.aiSuggested ?? false,
        sort_order: input.sortOrder ?? 0,
      })
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: mapZone(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '建立分區失敗' };
  }
}

/** Update a zone's editable fields (name, code, bounds). */
export async function updateZone(
  zoneId: string,
  patch: { name?: string; code?: string | null; bounds?: { x: number; y: number; w: number; h: number } },
): Promise<WriteResult> {
  try {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.code !== undefined) row.code = patch.code;
    if (patch.bounds !== undefined) row.bounds = patch.bounds;
    const { error } = await supabase.from('project_zones').update(row).eq('id', zoneId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '更新分區失敗' };
  }
}

/** Delete a zone. Its zone_products are moved back to the basket (zone_id → null). */
export async function deleteZone(zoneId: string): Promise<WriteResult> {
  try {
    // un-assign any products in this zone first so they aren't orphaned
    await supabase.from('zone_products').update({ zone_id: null }).eq('zone_id', zoneId);
    const { error } = await supabase.from('project_zones').delete().eq('id', zoneId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '刪除分區失敗' };
  }
}

/**
 * Find the most relevant project for the customer "確定產品" view:
 * the first project that actually has products assigned to zones.
 * Falls back to the first project, or null if none exist.
 */
export async function fetchProjectWithProducts(): Promise<{
  project: DesignProject | null;
  products: ZoneProduct[];
}> {
  const projects = await fetchProjects();
  if (projects.length === 0) return { project: null, products: [] };

  // Look for a project whose zone_products include zone-assigned items.
  for (const p of projects) {
    const zps = await fetchZoneProducts(p.id);
    const inZone = zps.filter((x) => x.zoneId);
    if (inZone.length > 0) {
      return { project: p, products: inZone };
    }
  }
  // None had assigned products — return the first project with whatever it has.
  const first = projects[0];
  const zps = await fetchZoneProducts(first.id);
  return { project: first, products: zps.filter((x) => x.zoneId) };
}
