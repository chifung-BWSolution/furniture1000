import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import {
  Package,
  BookOpen,
  Library,
  FolderKanban,
  FileText,
  TrendingUp,
  Sparkles,
  ArrowRight,
  Loader2,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigateToAI: () => void;
  onNavigateToCopywriting?: () => void;
}

interface DashboardStats {
  // 本月上載產品數
  uploadedThisMonth: number;
  // A/B/C 分類分布
  tierA: number;
  tierB: number;
  tierC: number;
  // 待填寫產品文案（in_shopify_queue = true AND info_done = false）
  copywritingPending: number;
  // 產品目錄（in_catalog = true）
  catalogCount: number;
  // 每月專案成立數（本月）
  projectsThisMonth: number;
  // 客戶邀請數（本月）
  invitesThisMonth: number;
  // 報價單數（本月）
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
  return {
    gte: start.toISOString(),
    lt: end.toISOString(),
  };
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

  const products = allProducts ?? [];

  let tierA = 0, tierB = 0, tierC = 0;
  for (const p of products) {
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

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  bg: string;
  delay?: number;
}

function StatCard({ label, value, icon: Icon, color, bg, delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="rounded-xl border border-border bg-card p-5 transition-all hover:shadow-lg hover:shadow-primary/5"
    >
      <div className="flex items-center justify-between">
        <span className="font-body text-xs text-muted-foreground">{label}</span>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', bg)}>
          <Icon className={cn('h-4 w-4', color)} />
        </div>
      </div>
      <p className="mt-2 font-mono-data text-3xl font-bold tracking-tight">{value}</p>
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

  const tierTotal = stats ? stats.tierA + stats.tierB + stats.tierC : 0;
  const tierAPercent = tierTotal > 0 ? Math.round((stats!.tierA / tierTotal) * 100) : 0;
  const tierBPercent = tierTotal > 0 ? Math.round((stats!.tierB / tierTotal) * 100) : 0;
  const tierCPercent = tierTotal > 0 ? Math.round((stats!.tierC / tierTotal) * 100) : 0;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-8 p-6">

        {/* 本月上載 + 待填寫文案 + 產品目錄 */}
        <div>
          <h3 className="mb-4 font-display text-sm font-bold text-muted-foreground uppercase tracking-wide">產品概覽</h3>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              label="本月上載產品"
              value={stats?.uploadedThisMonth ?? 0}
              icon={Package}
              color="text-primary"
              bg="bg-primary/10"
              delay={0}
            />
            <StatCard
              label="待填寫產品文案"
              value={stats?.copywritingPending ?? 0}
              icon={BookOpen}
              color="text-amber-500"
              bg="bg-amber-500/10"
              delay={0.06}
            />
            <StatCard
              label="產品目錄"
              value={stats?.catalogCount ?? 0}
              icon={Library}
              color="text-emerald-500"
              bg="bg-emerald-500/10"
              delay={0.12}
            />
          </div>
        </div>

        {/* A/B/C 分類分布 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.4 }}
          className="rounded-xl border border-border bg-card p-6"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-sm font-bold">A / B / C 類別分布</h3>
            <span className="font-mono-data text-xs text-muted-foreground">{tierTotal} 件</span>
          </div>
          {/* Stacked bar */}
          <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {tierAPercent > 0 && (
              <div className="h-full bg-primary transition-all duration-700" style={{ width: `${tierAPercent}%` }} />
            )}
            {tierBPercent > 0 && (
              <div className="h-full bg-amber-400 transition-all duration-700" style={{ width: `${tierBPercent}%` }} />
            )}
            {tierCPercent > 0 && (
              <div className="h-full bg-muted-foreground/30 transition-all duration-700" style={{ width: `${tierCPercent}%` }} />
            )}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'A 類', count: stats?.tierA ?? 0, pct: tierAPercent, dot: 'bg-primary' },
              { label: 'B 類', count: stats?.tierB ?? 0, pct: tierBPercent, dot: 'bg-amber-400' },
              { label: 'C 類', count: stats?.tierC ?? 0, pct: tierCPercent, dot: 'bg-muted-foreground/30' },
            ].map((t) => (
              <div key={t.label} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', t.dot)} />
                  <span className="font-body text-xs text-muted-foreground">{t.label}</span>
                </div>
                <p className="font-mono-data text-2xl font-bold">{t.count}</p>
                <p className="font-mono-data text-xs text-muted-foreground">{t.pct}%</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 文案填寫進度 */}
        {(() => {
          const total = (stats?.copywritingPending ?? 0) + (stats?.catalogCount ?? 0);
          const donePct = total > 0 ? Math.round(((stats?.catalogCount ?? 0) / total) * 100) : 0;
          return (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24, duration: 0.4 }}
              className="rounded-xl border border-border bg-card p-6"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                    <TrendingUp className="h-5 w-5 text-emerald-500" />
                  </div>
                  <h3 className="font-display text-sm font-bold">文案填寫進度</h3>
                </div>
                <span className="font-mono-data text-xs text-muted-foreground">{donePct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all duration-700"
                  style={{ width: `${donePct}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between font-mono-data text-xs text-muted-foreground">
                <span>已入目錄 {stats?.catalogCount ?? 0}</span>
                <span>待填文案 {stats?.copywritingPending ?? 0}</span>
              </div>
            </motion.div>
          );
        })()}

        {/* 本月業務數據 */}
        <div>
          <h3 className="mb-4 font-display text-sm font-bold text-muted-foreground uppercase tracking-wide">本月業務</h3>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              label="專案成立"
              value={stats?.projectsThisMonth ?? 0}
              icon={FolderKanban}
              color="text-violet-500"
              bg="bg-violet-500/10"
              delay={0.3}
            />
            <StatCard
              label="客戶邀請"
              value={stats?.invitesThisMonth ?? 0}
              icon={Sparkles}
              color="text-sky-500"
              bg="bg-sky-500/10"
              delay={0.36}
            />
            <StatCard
              label="報價單"
              value={stats?.quotesThisMonth ?? 0}
              icon={FileText}
              color="text-rose-500"
              bg="bg-rose-500/10"
              delay={0.42}
            />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.48, duration: 0.4 }}
            onClick={onNavigateToAI}
            className="group flex items-center gap-4 rounded-xl border border-border bg-card p-6 text-left transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-transform group-hover:scale-110">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-sm font-bold">處理新產品</h3>
              <p className="mt-0.5 text-xs text-muted-foreground font-body">
                上傳目錄及圖片進行 AI 分析
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
          </motion.button>

          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.52, duration: 0.4 }}
            onClick={onNavigateToCopywriting}
            className="group flex items-center gap-4 rounded-xl border border-border bg-card p-6 text-left transition-all hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 transition-transform group-hover:scale-110">
              <BookOpen className="h-6 w-6 text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-sm font-bold">填寫產品文案</h3>
              <p className="mt-0.5 text-xs text-muted-foreground font-body">
                {stats?.copywritingPending ?? 0} 件待填寫
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-amber-500" />
          </motion.button>
        </div>

      </div>
    </div>
  );
}
