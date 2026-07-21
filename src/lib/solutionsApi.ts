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
import { withInsertAuditFields, withUpdateAuditFields } from '@/lib/pmsAudit';

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
function mapProject(r: any): DesignProject {
  const meta =
    r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta)
      ? (r.meta as DesignProject['meta'])
      : {};
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
    creatorStaffId: r.creator_staff_id ?? null,
    editorStaffId: r.editor_staff_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    meta,
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

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseShopifyProductType(value: unknown): {
  level1: string;
  level2: string;
} {
  const parts = String(value || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { level1: parts[0], level2: parts[parts.length - 1] };
  }
  return { level1: parts[0] || '其他', level2: '' };
}

function numOrNullDim(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapSearchProduct(r: any, descLimit = 80): SearchProduct {
  const sale = Number(r.sale_price ?? r.price ?? 0);
  const img =
    (typeof r.image_url === 'string' && r.image_url) ||
    (Array.isArray(r.images) && r.images[0]?.src) ||
    '';
  const rawDesc = r.description ?? r.body_html ?? '';
  const description = (typeof rawDesc === 'string' && rawDesc.includes('<')
    ? stripHtml(rawDesc)
    : String(rawDesc ?? '')).slice(0, descLimit);
  const level1 = String(r.level1_category ?? '').trim();
  const level2 = String(r.level2_category ?? '').trim();
  return {
    id: r.id,
    title: r.title ?? '',
    description,
    imageUrl: img,
    salePrice: sale,
    category: level2 || level1 || r.category || r.collection || r.product_type || '其他',
    level1Category: level1 || undefined,
    level2Category: level2 || undefined,
    color: r.color ?? '—',
    material: (r.material && String(r.material).trim()) || '—',
    dimensionLMm: numOrNullDim(r.dimension_l_mm),
    dimensionWMm: numOrNullDim(r.dimension_w_mm),
    dimensionHMm: numOrNullDim(r.dimension_h_mm),
    shopifyProductId: r.shopify_product_id
      ? String(r.shopify_product_id)
      : null,
    tier: deriveTier(sale),
    inStock: (r.delivery_term_name ?? '').includes('現貨') || (r.total_lead_time ?? 99) <= 7,
    deliveryDays: r.total_lead_time ?? r.shipping_days ?? 14,
  };
}

const PORTAL_PRODUCT_SELECT =
  'id,title,description,price,sale_price,image_url,collection,category,color,material,level1_category,level2_category,dimension_l_mm,dimension_w_mm,dimension_h_mm,total_lead_time,shipping_days,delivery_term_name,shopify_product_id';

/** 依分區內已分配產品的確認狀態計算專案進度 0–100。 */
export function computeProjectProgress(products: ZoneProduct[]): number {
  const inZone = products.filter((p) => p.zoneId);
  if (inZone.length === 0) return 0;
  const confirmed = inZone.filter((p) => p.status === 'confirmed').length;
  return Math.round((confirmed / inZone.length) * 100);
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
      .select(PORTAL_PRODUCT_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => mapSearchProduct(r));
  } catch {
    return [];
  }
}

async function prioritizeActiveShopifyProducts(
  products: SearchProduct[],
): Promise<SearchProduct[]> {
  if (products.length === 0) return products;
  type ActiveShopifyMeta = {
    shopifyProductId: string | null;
    title: string;
    imageUrl: string;
    salePrice: number;
    productType: string;
  };
  const toMeta = (row: Record<string, unknown>): ActiveShopifyMeta => ({
    shopifyProductId: row.shopify_product_id
      ? String(row.shopify_product_id)
      : null,
    title: String(row.title || '').trim(),
    imageUrl: String(row.image_url || '').trim(),
    salePrice: Number(row.price || 0),
    productType: String(row.product_type || '').trim(),
  });
  const activeBySourceId = new Map<string, ActiveShopifyMeta>();
  const activeByShopifyId = new Map<string, ActiveShopifyMeta>();
  const ids = products.map((product) => product.id);
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const { data, error } = await supabase
      .from('shopify_products')
      .select(
        'source_product_id,shopify_product_id,title,image_url,price,product_type',
      )
      .in('source_product_id', chunk)
      .eq('status', 'active')
      .is('configurable', null);
    if (error) continue;
    for (const row of data ?? []) {
      const sourceId = String(row.source_product_id || '').trim();
      if (!sourceId) continue;
      const meta = toMeta(row);
      activeBySourceId.set(sourceId, meta);
      if (row.shopify_product_id) {
        activeByShopifyId.set(String(row.shopify_product_id), meta);
      }
    }
  }
  const fallbackIds = [
    ...new Set(
      products
        .filter((product) => !activeBySourceId.has(product.id))
        .map((product) => product.shopifyProductId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  for (let i = 0; i < fallbackIds.length; i += 150) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('shopify_product_id,title,image_url,price,product_type')
      .in('shopify_product_id', fallbackIds.slice(i, i + 150))
      .eq('status', 'active')
      .is('configurable', null);
    if (error) continue;
    for (const row of data ?? []) {
      if (row.shopify_product_id) {
        activeByShopifyId.set(String(row.shopify_product_id), toMeta(row));
      }
    }
  }
  return products
    .map((product) => {
      const activeMeta =
        activeBySourceId.get(product.id) ||
        (product.shopifyProductId
          ? activeByShopifyId.get(product.shopifyProductId)
          : undefined);
      return {
        ...product,
        title: activeMeta?.title || product.title,
        imageUrl: activeMeta?.imageUrl || product.imageUrl,
        salePrice:
          activeMeta && activeMeta.salePrice > 0
            ? activeMeta.salePrice
            : product.salePrice,
        category: product.category || activeMeta?.productType || '其他',
        isOnShopify: Boolean(activeMeta),
        shopifyProductId:
          activeMeta?.shopifyProductId ?? product.shopifyProductId ?? null,
      };
    })
    .sort(
      (a, b) => Number(Boolean(b.isOnShopify)) - Number(Boolean(a.isOnShopify)),
    );
}

/**
 * 客戶專區產品搜尋：唯讀載入產品目錄（in_catalog）＋分類／材質／尺寸欄位。
 * 不上傳、不修改 schema。優先 in_catalog；若為空則回退一般產品列表。
 */
export async function fetchPortalBrowseProducts(limit = 600): Promise<SearchProduct[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(PORTAL_PRODUCT_SELECT)
      .eq('in_catalog', true)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error && data && data.length > 0) {
      const catalog = await prioritizeActiveShopifyProducts(
        data.map((r) => mapSearchProduct(r)),
      );
      const active = await fetchActiveShopifyProducts(limit);
      const knownShopifyIds = new Set(
        catalog.map((product) => product.shopifyProductId).filter(Boolean),
      );
      return [
        ...catalog,
        ...active.filter(
          (product) =>
            !product.shopifyProductId ||
            !knownShopifyIds.has(product.shopifyProductId),
        ),
      ].sort(
        (a, b) =>
          Number(Boolean(b.isOnShopify)) - Number(Boolean(a.isOnShopify)),
      );
    }
    return prioritizeActiveShopifyProducts(
      await fetchSearchProducts(Math.min(limit, 400)),
    );
  } catch {
    return prioritizeActiveShopifyProducts(
      await fetchSearchProducts(Math.min(limit, 400)),
    );
  }
}

/** 客戶付款頁：直接唯讀 Shopify active mirror，使用現時圖片與售價。 */
export async function fetchActiveShopifyProducts(
  limit = 60,
): Promise<SearchProduct[]> {
  try {
    const { data, error } = await supabase
      .from('shopify_products')
      .select(
        'source_product_id,shopify_product_id,title,body_html,image_url,price,product_type,sku,status,published_at',
      )
      .eq('status', 'active')
      .is('configurable', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error || !data) return [];
    const sourceIds = [
      ...new Set(
        data
          .map((row) => String(row.source_product_id || '').trim())
          .filter(Boolean),
      ),
    ];
    const sourceById = new Map<string, SearchProduct>();
    for (let i = 0; i < sourceIds.length; i += 150) {
      const { data: sourceRows } = await supabase
        .from('products')
        .select(PORTAL_PRODUCT_SELECT)
        .in('id', sourceIds.slice(i, i + 150));
      for (const row of sourceRows ?? []) {
        sourceById.set(String(row.id), mapSearchProduct(row));
      }
    }
    return data
      .map((row) => {
        const sourceId = String(row.source_product_id || '').trim();
        const source = sourceById.get(sourceId);
        const shopify = mapSearchProduct({
          ...row,
          id: sourceId || row.shopify_product_id,
          category: row.product_type,
        });
        const categories = parseShopifyProductType(row.product_type);
        return {
          ...source,
          ...shopify,
          material: source?.material || '—',
          color: source?.color || '—',
          dimensionLMm: source?.dimensionLMm ?? null,
          dimensionWMm: source?.dimensionWMm ?? null,
          dimensionHMm: source?.dimensionHMm ?? null,
          category: categories.level2 || categories.level1,
          level1Category: categories.level1,
          level2Category: categories.level2 || undefined,
          isOnShopify: true,
          shopifyProductId: row.shopify_product_id
            ? String(row.shopify_product_id)
            : null,
          sku: row.sku ? String(row.sku).trim() : undefined,
        };
      })
      .filter((product) => product.salePrice > 0);
  } catch {
    return [];
  }
}

/** Main active product SKU lookup; configurable child products are excluded. */
export async function fetchActiveMainProductInfo(
  targets: Array<{ key: string; productId?: string | null; title?: string | null }>,
): Promise<Record<string, { sku: string }>> {
  const cleanTargets = targets.filter((target) => target.key.trim());
  const ids = [
    ...new Set(
      cleanTargets
        .map((target) => target.productId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const result: Record<string, { sku: string }> = {};
  type ShopifyInfoRow = {
    source_product_id: unknown;
    shopify_product_id: unknown;
    title: unknown;
    sku: unknown;
  };
  const rows: ShopifyInfoRow[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('source_product_id,shopify_product_id,title,sku')
      .in('source_product_id', ids.slice(i, i + 150))
      .eq('status', 'active')
      .is('configurable', null);
    if (error) continue;
    rows.push(...((data ?? []) as ShopifyInfoRow[]));
  }
  const unresolvedIds = ids.filter(
    (id) =>
      !rows.some(
        (row) => String(row.source_product_id || '').trim() === id,
      ),
  );
  for (let i = 0; i < unresolvedIds.length; i += 150) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('source_product_id,shopify_product_id,title,sku')
      .in('shopify_product_id', unresolvedIds.slice(i, i + 150))
      .eq('status', 'active')
      .is('configurable', null);
    if (error) continue;
    rows.push(...((data ?? []) as ShopifyInfoRow[]));
  }
  const unresolvedTitles = [
    ...new Set(
      cleanTargets
        .filter((target) => {
          const id = target.productId?.trim();
          return !rows.some(
            (row) =>
              (id &&
                (String(row.source_product_id || '').trim() === id ||
                  String(row.shopify_product_id || '').trim() === id)),
          );
        })
        .map((target) => target.title?.trim())
        .filter((title): title is string => Boolean(title)),
    ),
  ];
  for (let i = 0; i < unresolvedTitles.length; i += 80) {
    const { data, error } = await supabase
      .from('shopify_products')
      .select('source_product_id,shopify_product_id,title,sku')
      .in('title', unresolvedTitles.slice(i, i + 80))
      .eq('status', 'active')
      .is('configurable', null);
    if (error) continue;
    rows.push(...((data ?? []) as ShopifyInfoRow[]));
  }
  for (const target of cleanTargets) {
    const productId = target.productId?.trim() || '';
    const title = target.title?.trim().toLowerCase() || '';
    const match = rows.find(
      (row) =>
        (productId &&
          (String(row.source_product_id || '').trim() === productId ||
            String(row.shopify_product_id || '').trim() === productId)) ||
        (title && String(row.title || '').trim().toLowerCase() === title),
    );
    if (!match) continue;
    result[target.key] = {
      sku: match.sku ? String(match.sku).trim() : '—',
    };
  }
  return result;
}

/**
 * 客戶專區：取得受邀專案（有非撤銷邀請的專案）。
 * 若提供 clientEmail，僅顯示 email 相符或純連結邀請的專案。
 */
export async function fetchInvitedProjects(
  clientEmail?: string | null,
  shareToken?: string | null,
): Promise<DesignProject[]> {
  try {
    const email = clientEmail?.trim().toLowerCase() ?? null;
    const token = shareToken?.trim() || null;
    if (!email && !token) return [];

    let invitationQuery = supabase
      .from('project_invitations')
      .select('project_id, email, channel, share_token')
      .neq('status', 'revoked');
    if (email && token) {
      invitationQuery = invitationQuery.or(
        `email.ilike.${email},share_token.eq.${token}`,
      );
    } else if (token) {
      invitationQuery = invitationQuery.eq('share_token', token);
    } else if (email) {
      invitationQuery = invitationQuery.ilike('email', email);
    }
    const { data: invs, error: invErr } = await invitationQuery;
    if (invErr || !invs?.length) return [];

    const projectIds = [...new Set(
      invs
        .filter((inv) => {
          if (token && inv.share_token === token) return true;
          if (!email || !inv.email) return false;
          return String(inv.email).trim().toLowerCase() === email;
        })
        .map((inv) => inv.project_id as string),
    )];
    if (projectIds.length === 0) return [];

    const { data, error } = await supabase
      .from('design_projects')
      .select('*')
      .in('id', projectIds)
      .order('updated_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapProject);
  } catch {
    return [];
  }
}

/**
 * 客戶公司資料：只以登入電郵配對，避免錯誤顯示其他客戶資料。
 */
export async function fetchClientCompany(clientEmail?: string | null): Promise<ClientCompany | null> {
  try {
    const email = clientEmail?.trim().toLowerCase();
    if (email) {
      const { data, error } = await supabase
        .from('client_companies')
        .select('*')
        .ilike('contact_email', email)
        .maybeSingle();
      if (!error && data) return mapCompany(data);
    }
    return null;
  } catch {
    return null;
  }
}

/** 客戶留言顯示名稱 */
export function getClientAuthorName(company: ClientCompany | null): string {
  if (company?.contactPerson) return `${company.contactPerson}（客戶）`;
  return '客戶';
}

/** 重新計算並寫入專案進度。 */
export async function recalculateAndSaveProjectProgress(projectId: string): Promise<number> {
  const products = await fetchZoneProducts(projectId);
  const progress = computeProjectProgress(products);
  await saveProject(projectId, { progress });
  return progress;
}

/**
 * 客戶產品搜尋：受邀專案內產品 ∪ A 類已發佈產品（shopify active）。
 */
export async function fetchClientSearchProducts(projectIds: string[]): Promise<SearchProduct[]> {
  const byId = new Map<string, SearchProduct>();

  try {
    if (projectIds.length > 0) {
      const { data: zps } = await supabase
        .from('zone_products')
        .select('product_id, product_title, product_image_url, sale_price, project_id')
        .in('project_id', projectIds)
        .not('zone_id', 'is', null);

      const linkedIds = [...new Set((zps ?? []).map((z) => z.product_id).filter(Boolean))] as string[];
      const detailById: Record<string, ReturnType<typeof mapSearchProduct>> = {};

      if (linkedIds.length > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select(PORTAL_PRODUCT_SELECT)
          .in('id', linkedIds);
        for (const p of prods ?? []) {
          detailById[p.id] = mapSearchProduct(p, 60);
        }
      }

      for (const zp of zps ?? []) {
        const pid = zp.product_id as string | null;
        const key = pid ?? `zone-${zp.product_title}`;
        if (byId.has(key)) continue;
        if (pid && detailById[pid]) {
          byId.set(key, { ...detailById[pid], description: detailById[pid].description.slice(0, 60) });
        } else {
          const sale = Number(zp.sale_price ?? 0);
          byId.set(key, {
            id: key,
            title: zp.product_title ?? '',
            description: '',
            imageUrl: zp.product_image_url ?? '',
            salePrice: sale,
            category: '方案產品',
            color: '—',
            material: '—',
            tier: deriveTier(sale),
            inStock: false,
            deliveryDays: 14,
          });
        }
      }
    }

    const { data: published } = await supabase
      .from('shopify_products')
      .select('source_product_id, shopify_product_id, title, body_html, image_url, images, price, status, product_type')
      .eq('status', 'active')
      .is('configurable', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(300);

    const sourceIds = [...new Set(
      (published ?? []).map((r) => r.source_product_id).filter(Boolean),
    )] as string[];
    const productMeta: Record<string, ReturnType<typeof mapSearchProduct>> = {};
    if (sourceIds.length > 0) {
      const { data: prods } = await supabase
        .from('products')
        .select(PORTAL_PRODUCT_SELECT)
        .in('id', sourceIds);
      for (const p of prods ?? []) {
        productMeta[p.id] = mapSearchProduct(p, 60);
      }
    }

    for (const row of published ?? []) {
      const price = Number(row.price ?? 0);
      if (deriveTier(price) !== 'A') continue;
      const sid = (row.source_product_id ?? row.shopify_product_id) as string;
      if (byId.has(sid)) continue;
      if (row.source_product_id && productMeta[row.source_product_id]) {
        byId.set(sid, productMeta[row.source_product_id]);
      } else {
        byId.set(sid, mapSearchProduct({
          id: sid,
          title: row.title,
          body_html: row.body_html,
          price: row.price,
          image_url: row.image_url,
          images: row.images,
          product_type: row.product_type,
        }, 60));
      }
    }
  } catch {
    /* return partial results */
  }

  return Array.from(byId.values());
}

/**
 * 客戶「確定產品」：受邀專案中，有分區產品的專案與產品清單。
 */
export async function fetchInvitedProjectsWithProducts(
  clientEmail?: string | null,
  shareToken?: string | null,
): Promise<{
  projects: DesignProject[];
  productsByProject: Record<string, ZoneProduct[]>;
}> {
  const projects = await fetchInvitedProjects(clientEmail, shareToken);
  const productsByProject: Record<string, ZoneProduct[]> = {};
  await Promise.all(projects.map(async (p) => {
    const zps = await fetchZoneProducts(p.id);
    productsByProject[p.id] = zps.filter((x) => x.zoneId);
  }));
  return { projects, productsByProject };
}

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
  meta?: DesignProject['meta'];
}): Promise<WriteResult<DesignProject>> {
  try {
    const insertPayload = await withInsertAuditFields({
      name: input.name,
      client_name: input.clientName ?? null,
      client_company: input.clientCompany ?? null,
      floor_plan_url: input.floorPlanUrl ?? null,
      floor_plan_type: input.floorPlanType ?? null,
      status: 'draft',
      active_scheme: 'A',
      progress: 0,
      meta: input.meta ?? {},
      created_by: 'CF',
    });
    const { data, error } = await supabase
      .from('design_projects')
      .insert(insertPayload)
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
  patch: {
    activeScheme?: string;
    progress?: number;
    status?: string;
    name?: string;
    meta?: DesignProject['meta'];
  },
): Promise<WriteResult> {
  try {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.activeScheme !== undefined) row.active_scheme = patch.activeScheme;
    if (patch.progress !== undefined) row.progress = patch.progress;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.meta !== undefined) row.meta = patch.meta;
    const updatePayload = await withUpdateAuditFields(row);
    const { error } = await supabase.from('design_projects').update(updatePayload).eq('id', projectId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '儲存失敗' };
  }
}

/** Add a catalog product into a zone (or design basket when zoneId is null). */
export async function createZoneProduct(input: {
  projectId: string;
  zoneId?: string | null;
  productId?: string | null;
  productTitle: string;
  productImageUrl?: string;
  salePrice?: number;
  scheme?: string;
  quantity?: number;
  status?: string;
}): Promise<WriteResult<ZoneProduct>> {
  try {
    const insertPayload = await withInsertAuditFields({
      project_id: input.projectId,
      zone_id: input.zoneId ?? null,
      product_id: input.productId ?? null,
      product_title: input.productTitle,
      product_image_url: input.productImageUrl ?? '',
      sale_price: input.salePrice ?? 0,
      scheme: input.scheme ?? 'A',
      status: input.status ?? 'pending',
      quantity: input.quantity ?? 1,
      sort_order: 0,
    });
    const { data, error } = await supabase
      .from('zone_products')
      .insert(insertPayload)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: mapZoneProduct(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '加入產品失敗' };
  }
}

/** Update a single zone_product's confirmation status. */
export async function updateZoneProductStatus(
  zoneProductId: string,
  status: string,
): Promise<WriteResult> {
  try {
    const updatePayload = await withUpdateAuditFields({ status });
    const { error } = await supabase.from('zone_products').update(updatePayload).eq('id', zoneProductId);
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
    const updatePayload = await withUpdateAuditFields({ status });
    const { error } = await supabase.from('zone_products').update(updatePayload).in('id', ids);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '更新失敗' };
  }
}

/** 更新產品狀態並同步專案進度。 */
export async function updateZoneProductStatusWithProgress(
  zoneProductId: string,
  projectId: string,
  status: string,
): Promise<WriteResult> {
  const res = await updateZoneProductStatus(zoneProductId, status);
  if (res.ok) await recalculateAndSaveProjectProgress(projectId);
  return res;
}

/** 批量更新產品狀態並同步專案進度。 */
export async function bulkUpdateZoneProductStatusWithProgress(
  ids: string[],
  projectId: string,
  status: string,
): Promise<WriteResult> {
  const res = await bulkUpdateZoneProductStatus(ids, status);
  if (res.ok) await recalculateAndSaveProjectProgress(projectId);
  return res;
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
    const insertPayload = await withInsertAuditFields({
      project_id: input.projectId,
      channel: input.channel,
      email: input.email ?? null,
      share_token: makeShareToken(),
      status: 'sent',
    });
    const { data, error } = await supabase
      .from('project_invitations')
      .insert(insertPayload)
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
    const updatePayload = await withUpdateAuditFields({ status });
    const { error } = await supabase.from('project_invitations').update(updatePayload).eq('id', invitationId);
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
    const insertPayload = await withInsertAuditFields({
      project_id: input.projectId,
      zone_product_id: input.zoneProductId,
      author: input.author,
      author_role: input.authorRole,
      body: input.body,
      mentions: input.mentions ?? [],
    });
    const { data, error } = await supabase
      .from('product_discussions')
      .insert(insertPayload)
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
    const updatePayload = await withUpdateAuditFields({ pending_changes: changes });
    const { error } = await supabase
      .from('client_companies')
      .update(updatePayload)
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
    const updatePayload = await withUpdateAuditFields(patch);
    const { error } = await supabase
      .from('zone_products')
      .update(updatePayload)
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
    const updatePayload = await withUpdateAuditFields({ zone_id: null });
    const { error } = await supabase
      .from('zone_products')
      .update(updatePayload)
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
    const updatePayload = await withUpdateAuditFields({
      floor_plan_url: floorPlanUrl,
      floor_plan_type: floorPlanType,
      updated_at: new Date().toISOString(),
    });
    const { error } = await supabase
      .from('design_projects')
      .update(updatePayload)
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
    const insertPayload = await withInsertAuditFields({
      project_id: input.projectId,
      name: input.name,
      code: input.code ?? null,
      bounds: input.bounds,
      ai_suggested: input.aiSuggested ?? false,
      sort_order: input.sortOrder ?? 0,
    });
    const { data, error } = await supabase
      .from('project_zones')
      .insert(insertPayload)
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
    const updatePayload = await withUpdateAuditFields(row);
    const { error } = await supabase.from('project_zones').update(updatePayload).eq('id', zoneId);
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
    const unassignPayload = await withUpdateAuditFields({ zone_id: null });
    await supabase.from('zone_products').update(unassignPayload).eq('zone_id', zoneId);
    const { error } = await supabase.from('project_zones').delete().eq('id', zoneId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '刪除分區失敗' };
  }
}

/**
 * Find the most relevant project for the customer "確定產品" view:
 * first invited project that has zone-assigned products.
 */
export async function fetchProjectWithProducts(clientEmail?: string | null): Promise<{
  project: DesignProject | null;
  products: ZoneProduct[];
  allProjects: DesignProject[];
}> {
  const { projects, productsByProject } = await fetchInvitedProjectsWithProducts(clientEmail);
  if (projects.length === 0) return { project: null, products: [], allProjects: [] };

  for (const p of projects) {
    const inZone = productsByProject[p.id] ?? [];
    if (inZone.length > 0) {
      return { project: p, products: inZone, allProjects: projects };
    }
  }
  const first = projects[0];
  return { project: first, products: productsByProject[first.id] ?? [], allProjects: projects };
}
