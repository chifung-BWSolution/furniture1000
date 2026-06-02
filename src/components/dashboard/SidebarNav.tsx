import { cn } from '@/lib/utils';
import { ViewType, PrimarySection } from '@/types/product';
import { Moon, Sun, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { getSection } from './navConfig';

interface SidebarNavProps {
  activeSection: PrimarySection;
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  isCollapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

export function SidebarNav({
  activeSection,
  currentView,
  onViewChange,
  isDarkMode,
  onToggleDarkMode,
  isCollapsed: isCollapsedProp = false,
  onCollapseChange,
}: SidebarNavProps) {
  const isCollapsed = isCollapsedProp;
  const setIsCollapsed = (val: boolean) => onCollapseChange?.(val);
  const section = getSection(activeSection);
  const SectionIcon = section.icon;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col border-r border-border bg-sidebar transition-all duration-300',
          isCollapsed ? 'w-[72px]' : 'w-[260px]'
        )}
      >
        {/* Section header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-4">
          {!isCollapsed ? (
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <SectionIcon className="h-[18px] w-[18px] text-primary" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="font-mono-data text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                  {section.id}
                </div>
                <div className="truncate font-display text-[14px] font-bold">{section.label}</div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <SectionIcon className="h-[18px] w-[18px] text-primary" />
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {isCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-1">
            {section.children.map(({ view, label, icon: Icon }) => {
              const isActive = currentView === view;
              if (isCollapsed) {
                return (
                  <Tooltip key={view}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onViewChange(view)}
                        className={cn(
                          'flex w-full items-center justify-center rounded-lg p-2.5 transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      <p className="font-display text-xs font-semibold">{label}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return (
                <button
                  key={view}
                  onClick={() => onViewChange(view)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="font-body truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-3 py-3">
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleDarkMode}
                  className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  {isDarkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p className="text-xs">{isDarkMode ? '深色模式' : '淺色模式'}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isDarkMode ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                <span className="font-body text-[12px]">{isDarkMode ? '深色模式' : '淺色模式'}</span>
              </div>
              <Switch
                checked={isDarkMode}
                onCheckedChange={onToggleDarkMode}
                className="scale-90"
              />
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
