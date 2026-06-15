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
    supabase.from('products').select('id').eq('in_shopify_queue', true).eq('copy_done', false),
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12 }} className="mb-3 font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

interface NumCardProps {
  label: string;
  value: number;
  sub?: string;
  valueColor?: string;
  onClick?: () => void;
  delay?: number;
}

function NumCard({ label, value, sub, valueColor = 'text-foreground', onClick, delay = 0 }: NumCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.28 }}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-card px-5 py-4',
        onClick && 'cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors'
      )}
    >
      <div className="flex items-center justify-between">
        <p style={{ fontSize: 13 }} className="font-medium text-foreground">{label}</p>
        {onClick && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      {sub && <p style={{ fontSize: 12 }} className="text-muted-foreground -mt-1">{sub}</p>}
      <p style={{ fontSize: 28 }} className={cn('font-bold font-mono-data tabular-nums leading-none', valueColor)}>
        {value}
      </p>
    </motion.div>
  );
}

interface TierCardProps {
  tier: 'A' | 'B' | 'C';
  range: string;
  count: number;
  pct: number;
  delay?: number;
}

const TIER_COLORS: Record<string, string> = {
  A: 'text-primary',
  B: 'text-amber-500',
  C: 'text-muted-foreground',
};

function TierCard({ tier, range, count, pct, delay = 0 }: TierCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.28 }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4"
    >
      <div>
        <p style={{ fontSize: 14 }} className={cn('font-bold', TIER_COLORS[tier])}>{tier} 類</p>
        <p style={{ fontSize: 12 }} className="text-muted-foreground">{range}</p>
      </div>
      <div className="flex items-end justify-between">
        <p style={{ fontSize: 28 }} className="font-bold font-mono-data tabular-nums leading-none text-foreground">
          {count}
        </p>
        <p style={{ fontSize: 16 }} className={cn('font-semibold font-mono-data', TIER_COLORS[tier])}>
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
      <div className="p-6 space-y-7">

        {/* 第一行：產品概覽 3 格 + A/B/C 3 格 = 同一行 6 欄 */}
        <div>
          <SectionLabel>產品概覽 · A / B / C 類別分布</SectionLabel>
          <div className="grid grid-cols-6 gap-3">
            <NumCard
              label="本月上載產品"
              value={stats?.uploadedThisMonth ?? 0}
              delay={0}
            />
            <NumCard
              label="待填寫產品文案"
              sub="已加入佇列，文案未填"
              value={stats?.copywritingPending ?? 0}
              valueColor="text-amber-500"
              onClick={onNavigateToCopywriting}
              delay={0.04}
            />
            <NumCard
              label="產品目錄"
              sub="已加入目錄的產品"
              value={stats?.catalogCount ?? 0}
              valueColor="text-emerald-600"
              delay={0.08}
            />
            <TierCard tier="A" range="≥ $4,000"         count={stats?.tierA ?? 0} pct={tierAPercent} delay={0.12} />
            <TierCard tier="B" range="$1,500 – $3,999"  count={stats?.tierB ?? 0} pct={tierBPercent} delay={0.16} />
            <TierCard tier="C" range="< $1,500"          count={stats?.tierC ?? 0} pct={tierCPercent} delay={0.20} />
          </div>
        </div>

        {/* 第二行：本月業務 3 格 + 快捷操作 2 格（佔剩餘空間） */}
        <div>
          <SectionLabel>本月業務 · 快捷操作</SectionLabel>
          <div className="grid grid-cols-6 gap-3">
            <NumCard label="專案成立" value={stats?.projectsThisMonth ?? 0} valueColor="text-violet-600" delay={0.24} />
            <NumCard label="客戶邀請" value={stats?.invitesThisMonth ?? 0}  valueColor="text-sky-600"    delay={0.28} />
            <NumCard label="報價單"   value={stats?.quotesThisMonth ?? 0}   valueColor="text-rose-500"  delay={0.32} />

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.36, duration: 0.28 }}
              onClick={onNavigateToAI}
              className="col-span-1 flex flex-col justify-between gap-2 rounded-xl border border-border bg-card px-5 py-4 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <p style={{ fontSize: 13 }} className="font-medium text-foreground">處理新產品</p>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p style={{ fontSize: 12 }} className="text-muted-foreground">上傳目錄及圖片進行 AI 分析</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.40, duration: 0.28 }}
              onClick={onNavigateToCopywriting}
              className="col-span-2 flex flex-col justify-between gap-2 rounded-xl border border-border bg-card px-5 py-4 cursor-pointer hover:border-amber-500/40 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <p style={{ fontSize: 13 }} className="font-medium text-foreground">填寫產品文案</p>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p style={{ fontSize: 12 }} className="text-muted-foreground">
                {stats?.copywritingPending ?? 0} 件待填寫
              </p>
            </motion.div>
          </div>
        </div>

      </div>
    </div>
  );
}
