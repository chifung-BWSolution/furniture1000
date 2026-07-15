import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import {
  Loader2,
  ArrowRight,
  Package,
  Factory,
  FolderTree,
  Search,
  BookOpen,
  LayoutDashboard,
  ClipboardList,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ViewType } from '@/types/product';

interface DashboardViewProps {
  onNavigate: (view: ViewType) => void;
}

interface HomeDashboardMetrics {
  totalProducts: number;
  activeFactories: number;
  catalogProducts: number;
  categoryCount: number;
  publishedProducts: number;
  pendingQuotes: number;
}

async function countTable(
  table: string,
  filters?: Record<string, string | boolean>,
): Promise<number> {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      q = q.eq(key, value);
    }
  }
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function fetchHomeDashboardMetrics(): Promise<HomeDashboardMetrics> {
  const [
    totalProducts,
    catalogProducts,
    categoryCount,
    publishedProducts,
    pendingQuotes,
    factoriesRes,
  ] = await Promise.all([
    countTable('products'),
    countTable('products', { in_catalog: true }),
    countTable('product_category'),
    countTable('shopify_products', { status: 'active' }),
    countTable('bwf_quote', { status: '待審核' }),
    supabase.functions.invoke('supabase-functions-fetch-manufacturer-directory'),
  ]);

  const activeFactories = Array.isArray(factoriesRes.data?.factories)
    ? factoriesRes.data.factories.length
    : 0;

  return {
    totalProducts,
    activeFactories,
    catalogProducts,
    categoryCount,
    publishedProducts,
    pendingQuotes,
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  sub?: string;
  icon: React.ReactNode;
  valueColor?: string;
  delay?: number;
}

function MetricCard({ label, value, sub, icon, valueColor = 'text-foreground', delay = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.28 }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          {icon}
        </div>
      </div>
      {sub && <p className="-mt-1 text-xs text-muted-foreground">{sub}</p>}
      <p className={cn('font-mono-data text-3xl font-bold tabular-nums leading-none', valueColor)}>
        {value.toLocaleString()}
      </p>
    </motion.div>
  );
}

interface QuickLinkProps {
  label: string;
  description: string;
  badge?: number;
  icon: React.ReactNode;
  onClick: () => void;
  delay?: number;
}

function QuickLink({ label, description, badge, icon, onClick, delay = 0 }: QuickLinkProps) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.28 }}
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card px-5 py-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <p className="text-sm font-medium text-foreground">{label}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono-data text-xs font-semibold text-primary">
              {badge}
            </span>
          )}
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </motion.button>
  );
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const [metrics, setMetrics] = useState<HomeDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchHomeDashboardMetrics()
      .then((data) => { if (!cancelled) setMetrics(data); })
      .catch((error) => {
        if (!cancelled) console.warn('[DashboardView] Failed to load metrics:', error);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const m = metrics ?? {
    totalProducts: 0,
    activeFactories: 0,
    catalogProducts: 0,
    categoryCount: 0,
    publishedProducts: 0,
    pendingQuotes: 0,
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="space-y-8 p-6">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground">儀表板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            平台關鍵指標與常用功能捷徑
          </p>
        </div>

        <div>
          <SectionLabel>關鍵指標</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label="總產品數量"
              sub="Products · Bod Number"
              value={m.totalProducts}
              icon={<Package className="h-4 w-4" />}
              delay={0}
            />
            <MetricCard
              label="活躍廠家數量"
              sub="Manufacturer Directory"
              value={m.activeFactories}
              valueColor="text-sky-600"
              icon={<Factory className="h-4 w-4" />}
              delay={0.05}
            />
            <MetricCard
              label="產品目錄"
              sub={`Catalog · ${m.categoryCount.toLocaleString()} 個分類`}
              value={m.catalogProducts}
              valueColor="text-emerald-600"
              icon={<FolderTree className="h-4 w-4" />}
              delay={0.1}
            />
          </div>
        </div>

        <div>
          <SectionLabel>快速鏈接</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <QuickLink
              label="產品搜尋"
              description="在設計專案中搜尋產品與規格"
              icon={<Search className="h-4 w-4" />}
              onClick={() => onNavigate('product-search')}
              delay={0.12}
            />
            <QuickLink
              label="廠家目錄"
              description="查看廠家資料與聯絡方式"
              icon={<BookOpen className="h-4 w-4" />}
              onClick={() => onNavigate('manufacturer-catalog')}
              delay={0.16}
            />
            <QuickLink
              label="我的設計專案"
              description="管理進行中的設計方案"
              icon={<LayoutDashboard className="h-4 w-4" />}
              onClick={() => onNavigate('design-projects')}
              delay={0.2}
            />
            <QuickLink
              label="待確認報價"
              description="查看待審核的報價單"
              badge={m.pendingQuotes}
              icon={<ClipboardList className="h-4 w-4" />}
              onClick={() => onNavigate('quotation-list')}
              delay={0.24}
            />
            <QuickLink
              label="已發佈產品狀態"
              description={`Shopify 已發佈 ${m.publishedProducts.toLocaleString()} 件`}
              badge={m.publishedProducts}
              icon={<Globe className="h-4 w-4" />}
              onClick={() => onNavigate('published-products')}
              delay={0.28}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
