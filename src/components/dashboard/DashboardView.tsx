import { cn } from '@/lib/utils';
import { Product } from '@/types/product';
import { StatusBadge } from './StatusBadge';
import { motion } from 'framer-motion';
import {
  Package,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface DashboardViewProps {
  products: Product[];
  stats: {
    total: number;
    drafts: number;
    publishing: number;
    success: number;
    errors: number;
  };
  onProductClick: (productId: string) => void;
  onNavigateToAI: () => void;
}

export function DashboardView({ products, stats, onProductClick, onNavigateToAI }: DashboardViewProps) {
  const pendingProducts = products.filter(p => p.status === 'draft' || p.status === 'error');

  return (
    <div className="h-full overflow-y-auto">
    <div className="space-y-8 p-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: '全部產品',
            value: stats.total,
            icon: Package,
            color: 'text-primary',
            bg: 'bg-primary/10',
          },
          {
            label: '準備發佈',
            value: stats.drafts,
            icon: Clock,
            color: 'text-muted-foreground',
            bg: 'bg-muted',
          },
          {
            label: '已發佈',
            value: stats.success,
            icon: CheckCircle2,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
          },
          {
            label: '錯誤',
            value: stats.errors,
            icon: AlertTriangle,
            color: 'text-rose-500',
            bg: 'bg-rose-500/10',
          },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            className="rounded-xl border border-border bg-card p-5 transition-all hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="flex items-center justify-between">
              <span className="font-body text-xs text-muted-foreground">{stat.label}</span>
              <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', stat.bg)}>
                <stat.icon className={cn('h-4 w-4', stat.color)} />
              </div>
            </div>
            <p className="mt-2 font-mono-data text-3xl font-bold tracking-tight">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4 }}
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

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="flex items-center gap-4 rounded-xl border border-border bg-card p-6"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
            <TrendingUp className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-sm font-bold">流水線狀態</h3>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all duration-700"
                    style={{
                      width: `${stats.total > 0 ? ((stats.success / stats.total) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
              <span className="font-mono-data text-xs text-muted-foreground">
                {stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0}%
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Product Cards — Bento Grid */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base font-bold">待處理產品</h3>
          <span className="font-mono-data text-xs text-muted-foreground">
            {pendingProducts.length} 個項目
          </span>
        </div>

        {pendingProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
            <Package className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-body text-sm text-muted-foreground">暫無待處理產品</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              透過 AI 處理器處理新項目
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {pendingProducts.map((product, i) => (
              <motion.button
                key={product.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.04, duration: 0.4 }}
                onClick={() => onProductClick(product.id)}
                className={cn(
                  'group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all duration-300',
                  'hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5'
                )}
              >
                {/* Image */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      className="h-full w-full object-cover bg-white transition-transform duration-500 group-hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : null}

                </div>

                {/* Content */}
                <div className="flex flex-1 flex-col p-3">
                  <h4 className="font-display text-xs font-bold leading-tight line-clamp-1">
                    {product.title}
                  </h4>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono-data text-sm font-bold text-primary">
                      ${product.price.toFixed(2)}
                    </span>
                    <StatusBadge status={product.status} />
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
