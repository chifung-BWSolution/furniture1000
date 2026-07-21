import { cn } from '@/lib/utils';
import { LogOut } from 'lucide-react';
import { NAV_CONFIG, type PrimaryItem } from './navConfig';
import { type PrimarySection } from '@/types/product';
import { useAuth } from '@/contexts/AuthProvider';
import { usePmsStaffName } from '@/hooks/use-pms-staff-name';
import { Button } from '@/components/ui/button';
import { FdsLogo } from '@/components/brand/FdsLogo';

interface PrimaryTopNavProps {
  activeSection: PrimarySection;
  onSectionChange: (section: PrimarySection) => void;
  isConnected?: boolean;
  clientOnly?: boolean;
}

export function PrimaryTopNav({
  activeSection,
  onSectionChange,
  clientOnly = false,
}: PrimaryTopNavProps) {
  const { user, signOut } = useAuth();
  const staffName = usePmsStaffName(user?.id);
  return (
    <header className="sticky top-0 z-40 flex h-[68px] shrink-0 items-center border-b border-shell-border bg-shell px-6 text-shell-foreground">
      {/* Logo */}
      <div className="mr-8 flex shrink-0 items-center gap-3">
        <FdsLogo size="md" />
        <div className="flex flex-col" style={{ gap: '2px' }}>
          <div
            className="text-shell-foreground"
            style={{
              fontFamily: 'inherit',
              fontSize: '16px',
              fontWeight: 700,
              lineHeight: '1.35',
              letterSpacing: '-0.01em',
            }}
          >
            FDS Furniture Design Platform
          </div>
          <div className="text-shell-muted" style={{ fontSize: '13px', lineHeight: '1.4' }}>
            傢私設計管理平台
          </div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {NAV_CONFIG.filter((p) => !clientOnly || p.id === 'customers').map((p: PrimaryItem) => {
          const Icon = p.icon;
          const active = p.id === activeSection;
          return (
            <button
              key={p.id}
              onClick={() => onSectionChange(p.id)}
              className={cn(
                'flex h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[13.5px] font-medium transition-all',
                active
                  ? 'bg-shell-primary text-shell-primary-foreground shadow-sm'
                  : 'text-shell-muted hover:bg-shell-accent hover:text-shell-accent-foreground',
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="font-display">{p.label}</span>
            </button>
          );
        })}
      </nav>

      {user && (
        <div className="ml-4 flex shrink-0 items-center gap-3 border-l border-shell-border pl-4">
          <span className="hidden max-w-[180px] truncate text-xs text-shell-muted sm:inline">
            {staffName ?? user.email}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-shell-muted hover:bg-shell-accent hover:text-shell-accent-foreground"
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
