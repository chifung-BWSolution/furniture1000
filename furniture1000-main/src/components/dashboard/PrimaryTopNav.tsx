import { cn } from '@/lib/utils';
import { ShoppingBag, Wifi, WifiOff, Bell } from 'lucide-react';
import { NAV_CONFIG, type PrimaryItem } from './navConfig';
import { type PrimarySection } from '@/types/product';

interface PrimaryTopNavProps {
  activeSection: PrimarySection;
  onSectionChange: (section: PrimarySection) => void;
  isConnected: boolean;
}

export function PrimaryTopNav({ activeSection, onSectionChange, isConnected }: PrimaryTopNavProps) {
  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center border-b border-border bg-background/95 px-6 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex shrink-0 items-center gap-3 mr-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
          <ShoppingBag className="h-5 w-5 text-primary" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-[14px] font-bold tracking-tight">AI 產品管理</div>
          <div className="font-mono-data text-[10px] text-muted-foreground tracking-[0.12em] uppercase">
            Shopify 管理工具
          </div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-1 items-center gap-1 min-w-0 overflow-x-auto">
        {NAV_CONFIG.map((p: PrimaryItem) => {
          const Icon = p.icon;
          const active = p.id === activeSection;
          return (
            <button
              key={p.id}
              onClick={() => onSectionChange(p.id)}
              className={cn(
                'flex h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[13.5px] font-medium transition-all',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className={cn('h-[18px] w-[18px]', active && 'text-primary')} />
              <span className="font-display">{p.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right cluster */}
      <div className="flex shrink-0 items-center gap-3 ml-4">
        <div
          className={cn(
            'flex h-9 items-center gap-2 rounded-full border px-3',
            isConnected
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          )}
        >
          {isConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          <span className="font-mono-data text-[11px] font-medium tracking-wide">
            {isConnected ? '已連接' : '未連接'}
          </span>
        </div>
        <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <Bell className="h-[18px] w-[18px]" />
        </button>
        <div className="flex h-9 items-center gap-2 border-l border-border pl-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary text-[12px] font-bold text-primary-foreground">
            CF
          </div>
        </div>
      </div>
    </header>
  );
}
