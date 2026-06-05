import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

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

interface SectionProps {
  title: string;
  delay?: number;
  children: React.ReactNode;
}

function Section({ title, delay = 0, children }: SectionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
    >
      <p style={{ fontSize: 12 }} className="mb-3 font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <div className="rounded-xl border border-border bg-card">
        {children}
      </div>
    </motion.div>
  );
}

interface RowProps {
  label: string;
  value: number | string;
  sub?: string;
  onClick?: () => void;
  last?: boolean;
}

function Row({ label, value, sub, onClick, last }: RowProps) {
  const base =
    'flex items-center justify-between px-5 py-4' +
    (last ? '' : ' border-b border-border') +
    (onClick ? ' cursor-pointer hover:bg-muted/40 transition-colors' : '');
  return (
    <div className={base} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="flex flex-col gap-0.5">
        <span style={{ fontSize: 13 }} className="font-medium text-foreground leading-tight">
          {label}
        </span>
        {sub && (
          <span style={{ fontSize: 12 }} className="text-muted-foreground">
            {sub}
          </span>
        )}
      </div>
      <span style={{ fontSize: 22 }} className="font-bold font-mono-data tabular-nums text-foreground">
        {value}
      </span>
    </div>
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
      <div className="space-y-7 p-6 max-w-2xl">

        {/* 產品概覽 */}
        <Section title="產品概覽" delay={0}>
          <Row
            label="本月上載產品"
            value={stats?.uploadedThisMonth ?? 0}
          />
          <Row
            label="待填寫產品文案"
            sub="已加入 Shopify 佇列，文案尚未填寫"
            value={stats?.copywritingPending ?? 0}
            onClick={onNavigateToCopywriting}
          />
          <Row
            label="產品目錄"
            sub="已加入產品目錄的產品"
            value={stats?.catalogCount ?? 0}
            last
          />
        </Section>

        {/* A/B/C 類別分布 */}
        <Section title="A / B / C 類別分布" delay={0.08}>
          <Row
            label="A 類（≥ $4,000）"
            value={`${stats?.tierA ?? 0}　${tierAPercent}%`}
          />
          <Row
            label="B 類（$1,500 – $3,999）"
            value={`${stats?.tierB ?? 0}　${tierBPercent}%`}
          />
          <Row
            label="C 類（< $1,500）"
            value={`${stats?.tierC ?? 0}　${tierCPercent}%`}
            last
          />
        </Section>

        {/* 本月業務 */}
        <Section title="本月業務" delay={0.16}>
          <Row
            label="專案成立"
            value={stats?.projectsThisMonth ?? 0}
          />
          <Row
            label="客戶邀請"
            value={stats?.invitesThisMonth ?? 0}
          />
          <Row
            label="報價單"
            value={stats?.quotesThisMonth ?? 0}
            last
          />
        </Section>

        {/* 快捷操作 */}
        <Section title="快捷操作" delay={0.24}>
          <Row
            label="處理新產品"
            sub="上傳目錄及圖片進行 AI 分析"
            value="→"
            onClick={onNavigateToAI}
          />
          <Row
            label="填寫產品文案"
            sub={`${stats?.copywritingPending ?? 0} 件待填寫`}
            value="→"
            onClick={onNavigateToCopywriting}
            last
          />
        </Section>

      </div>
    </div>
  );
}
