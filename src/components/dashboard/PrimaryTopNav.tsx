import { cn } from '@/lib/utils';
import { LogOut, ShoppingBag } from 'lucide-react';
import { NAV_CONFIG, type PrimaryItem } from './navConfig';
import { type PrimarySection } from '@/types/product';
import { useAuth } from '@/contexts/AuthProvider';
import { Button } from '@/components/ui/button';

interface PrimaryTopNavProps {
  activeSection: PrimarySection;
  onSectionChange: (section: PrimarySection) => void;
  isConnected?: boolean;
}

export function PrimaryTopNav({ activeSection, onSectionChange }: PrimaryTopNavProps) {
  const { user, signOut } = useAuth();
  return (
    <header className="sticky top-0 z-40 flex h-[68px] shrink-0 items-center border-b border-border bg-background/95 px-6 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex shrink-0 items-center gap-3 mr-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
          <ShoppingBag className="h-5 w-5 text-primary" />
        </div>
        <div className="flex flex-col" style={{ gap: '2px' }}>
          <div style={{ fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, lineHeight: '1.35', letterSpacing: '-0.01em' }}>FDS Furniture Design Platform</div>
          <div style={{ fontSize: '13px', lineHeight: '1.4', color: 'var(--muted-foreground)' }}>
            傢私設計管理平台
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

      {user && (
        <div className="ml-4 flex shrink-0 items-center gap-3 border-l border-border pl-4">
          <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground sm:inline">
            {user.email}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="h-3.5 w-3.5" />
            登出
          </Button>
        </div>
      )}
    </header>
  );
}
