import { cn } from '@/lib/utils';
import { ShoppingBag } from 'lucide-react';
import { NAV_CONFIG, type PrimaryItem } from './navConfig';
import { type PrimarySection } from '@/types/product';

interface PrimaryTopNavProps {
  activeSection: PrimarySection;
  onSectionChange: (section: PrimarySection) => void;
  isConnected?: boolean;
}

export function PrimaryTopNav({ activeSection, onSectionChange }: PrimaryTopNavProps) {
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
    </header>
  );
}
