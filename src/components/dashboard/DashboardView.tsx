import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashboardViewProps {
  onNavigateToAI: () => void;
  onNavigateToCopywriting?: () => void;
}

interface DashboardStats {
  uploadedThisMonth: number;
  tierA: number;
  tierB: number;
  tierC: number;
  copywritingPending: number;
  catalogCount: number;
  projectsThisMonth: number;
  invitesThisMonth: number;
  quotesThisMonth: number;
}

function deriveTier(price: number): 'A' | 'B' | 'C' {
  if (price >= 4000) return 'A';
  if (price >= 1500) return 'B';
  return 'C';
}

function thisMonthRange(): { gte: string; lt: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { gte: start.toISOString(), lt: end.toISOString() };
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  const { gte, lt } = thisMonthRange();
  const [
    { data: allProducts },
    { data: monthProducts },
    { data: copywritingRows },
    { data: catalogRows },
    { data: projects },
    { data: invites },
    { data: quotes },
  ] = await Promise.all([
    supabase.from('products').select('id, sale_price, price'),
    supabase.from('products').select('id').gte('created_at', gte).lt('created_at', lt),
    supabase.from('products').select('id').eq('in_shopify_queue', true).eq('info_done', false),
    supabase.from('products').select('id').eq('in_catalog', true),
    supabase.from('design_projects').select('id').gte('created_at', gte).lt('created_at', lt),
    supabase.from('project_invitations').select('id').gte('created_at', gte).lt('created_at', lt),
    supabase.from('bwf_quote').select('id').gte('created_at', gte).lt('created_at', lt),
  ]);

  let tierA = 0, tierB = 0, tierC = 0;
  for (const p of (allProducts ?? [])) {
    const price = Number(p.sale_price ?? p.price ?? 0);
    const tier = deriveTier(price);
    if (tier === 'A') tierA++;
    else if (tier === 'B') tierB++;
    else tierC++;
  }

  return {
    uploadedThisMonth: (monthProducts ?? []).length,
    tierA,
    tierB,
    tierC,
    copywritingPending: (copywritingRows ?? []).length,
    catalogCount: (catalogRows ?? []).length,
    projectsThisMonth: (projects ?? []).length,
    invitesThisMonth: (invites ?? []).length,
    quotesThisMonth: (quotes ?? []).length,
  };
}

interface StatTileProps {
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
  onClick?: () => void;
  delay?: number;
  wide?: boolean;
}

function StatTile({ label, value, sub, accent = 'text-foreground', onClick, delay = 0, wide }: StatTileProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      onClick={onClick}
      className={cn(
        'flex flex-col justify-between rounded-xl border border-border bg-card p-5 gap-3',
        onClick && 'cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors',
        wide && 'col-span-2'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p style={{ fontSize: 13 }} className="font-medium text-foreground leading-snug">{label}</p>
          {sub && <p style={{ fontSize: 12 }} className="mt-0.5 text-muted-foreground">{sub}</p>}
        </div>
        {onClick && <ArrowRight style={{ fontSize: 14 }} className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      <p style={{ fontSize: 32 }} className={cn('font-bold font-mono-data tabular-nums leading-none', accent)}>
        {value}
      </p>
    </motion.div>
  );
}

interface TierTileProps {
  tier: string;
  range: string;
  count: number;
  pct: number;
  accent: string;
  delay?: number;
}

function TierTile({ tier, range, count, pct, accent, delay = 0 }: TierTileProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 gap-3"
    >
      <div>
        <p style={{ fontSize: 16 }} className={cn('font-bold', accent)}>{tier} 類</p>
        <p style={{ fontSize: 12 }} className="mt-0.5 text-muted-foreground">{range}</p>
      </div>
      <div className="flex items-end justify-between">
        <p style={{ fontSize: 32 }} className="font-bold font-mono-data tabular-nums leading-none text-foreground">
          {count}
        </p>
        <p style={{ fontSize: 18 }} className={cn('font-semibold font-mono-data', accent)}>
          {pct}%
        </p>
      </div>
    </motion.div>
  );
}

export function DashboardView({ onNavigateToAI, onNavigateToCopywriting }: DashboardViewProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tierTotal = (stats?.tierA ?? 0) + (stats?.tierB ?? 0) + (stats?.tierC ?? 0);
  const tierAPercent = tierTotal > 0 ? Math.round(((stats?.tierA ?? 0) / tierTotal) * 100) : 0;
  const tierBPercent = tierTotal > 0 ? Math.round(((stats?.tierB ?? 0) / tierTotal) * 100) : 0;
  const tierCPercent = tierTotal > 0 ? Math.round(((stats?.tierC ?? 0) / tierTotal) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-8 max-w-3xl">

        {/* 產品概覽 */}
        <div>
          <p style={{ fontSize: 12 }} className="mb-3 font-semibold uppercase tracking-widest text-muted-foreground">
            產品概覽
          </p>
          <div className="grid grid-cols-3 gap-3">
            <StatTile
              label="本月上載產品"
              value={stats?.uploadedThisMonth ?? 0}
              delay={0}
            />
            <StatTile
              label="待填寫產品文案"
              sub="已加入佇列，文案未填"
              value={stats?.copywritingPending ?? 0}
              accent="text-amber-500"
              onClick={onNavigateToCopywriting}
              delay={0.05}
            />
            <StatTile
              label="產品目錄"
              sub="已加入目錄的產品"
              value={stats?.catalogCount ?? 0}
              accent="text-emerald-600"
              delay={0.1}
            />
          </div>
        </div>

        {/* A/B/C 類別分布 */}
        <div>
          <p style={{ fontSize: 12 }} className="mb-3 font-semibold uppercase tracking-widest text-muted-foreground">
            A / B / C 類別分布
          </p>
          <div className="grid grid-cols-3 gap-3">
            <TierTile
              tier="A"
              range="≥ $4,000"
              count={stats?.tierA ?? 0}
              pct={tierAPercent}
              accent="text-primary"
              delay={0.12}
            />
            <TierTile
              tier="B"
              range="$1,500 – $3,999"
              count={stats?.tierB ?? 0}
              pct={tierBPercent}
              accent="text-amber-500"
              delay={0.17}
            />
            <TierTile
              tier="C"
              range="< $1,500"
              count={stats?.tierC ?? 0}
              pct={tierCPercent}
              accent="text-muted-foreground"
              delay={0.22}
            />
          </div>
        </div>

        {/* 本月業務 */}
        <div>
          <p style={{ fontSize: 12 }} className="mb-3 font-semibold uppercase tracking-widest text-muted-foreground">
            本月業務
          </p>
          <div className="grid grid-cols-3 gap-3">
            <StatTile
              label="專案成立"
              value={stats?.projectsThisMonth ?? 0}
              accent="text-violet-600"
              delay={0.24}
            />
            <StatTile
              label="客戶邀請"
              value={stats?.invitesThisMonth ?? 0}
              accent="text-sky-600"
              delay={0.29}
            />
            <StatTile
              label="報價單"
              value={stats?.quotesThisMonth ?? 0}
              accent="text-rose-500"
              delay={0.34}
            />
          </div>
        </div>

        {/* 快捷操作 */}
        <div>
          <p style={{ fontSize: 12 }} className="mb-3 font-semibold uppercase tracking-widest text-muted-foreground">
            快捷操作
          </p>
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="處理新產品"
              sub="上傳目錄及圖片進行 AI 分析"
              value=""
              onClick={onNavigateToAI}
              delay={0.36}
            />
            <StatTile
              label="填寫產品文案"
              sub={`${stats?.copywritingPending ?? 0} 件待填寫`}
              value=""
              onClick={onNavigateToCopywriting}
              delay={0.4}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
