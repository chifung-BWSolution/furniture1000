import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ViewType, PrimarySection } from '@/types/product';
import { Moon, Sun, PanelLeftClose, PanelLeft } from 'lucide-react';
import { inkEase, NavInk } from '@/components/motion/NavInk';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { getSection, filterNavChildren, navItemIsActive } from './navConfig';

interface SidebarNavProps {
  activeSection: PrimarySection;
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  isCollapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
  isAdmin?: boolean;
  /**
   * Quote-share / invite no-login guest:
   * show 客戶專區 pages except「機構採購帳號」.
   */
  quoteShareGuest?: boolean;
}

export function SidebarNav({
  activeSection,
  currentView,
  onViewChange,
  isDarkMode,
  onToggleDarkMode,
  isCollapsed: isCollapsedProp = false,
  onCollapseChange,
  isAdmin = false,
  quoteShareGuest = false,
}: SidebarNavProps) {
  const isCollapsed = isCollapsedProp;
  const setIsCollapsed = (val: boolean) => onCollapseChange?.(val);
  const reduceMotion = useReducedMotion();
  const section = getSection(activeSection);
  const visibleChildren = filterNavChildren(section.children, isAdmin, {
    quoteShareGuest,
  });
  const SectionIcon = section.icon;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'zone-sidebar flex h-full shrink-0 flex-col border-r border-shell-border bg-shell text-shell-foreground transition-all duration-300',
          isCollapsed ? 'w-[72px]' : 'w-[260px]',
        )}
      >
        {/* Section header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-shell-border px-4 py-4">
          {!isCollapsed ? (
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={section.id}
                className="flex min-w-0 flex-1 items-center gap-3"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: reduceMotion ? 0.12 : 0.18, ease: inkEase }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-shell-primary/20">
                  <SectionIcon className="h-[18px] w-[18px] text-shell-primary" />
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="font-mono-data text-[10px] font-semibold uppercase tracking-[0.18em] text-shell-primary">
                    {section.id}
                  </div>
                  <div className="truncate font-display text-[14px] font-bold text-shell-foreground">
                    {section.label}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-shell-primary/20">
              <SectionIcon className="h-[18px] w-[18px] text-shell-primary" />
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-shell-muted hover:bg-shell-accent hover:text-shell-accent-foreground"
          >
            {isCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-1">
            {visibleChildren.map(({ view, label, icon: Icon }) => {
              const isActive = navItemIsActive(view, currentView);
              if (isCollapsed) {
                return (
                  <Tooltip key={view}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onViewChange(view)}
                        className={cn(
                          'relative flex w-full items-center justify-center rounded-lg p-2.5 transition-colors duration-200',
                          isActive
                            ? 'text-shell-primary-foreground'
                            : 'text-shell-muted hover:bg-shell-accent hover:text-shell-accent-foreground',
                        )}
                      >
                        {isActive ? (
                          <NavInk
                            layoutId="sidebar-page-ink"
                            className="absolute inset-0 z-0 rounded-lg bg-shell-primary shadow-sm"
                          />
                        ) : null}
                        <Icon className="relative z-10 h-[18px] w-[18px]" />
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
                    'relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors duration-200',
                    isActive
                      ? 'text-shell-primary-foreground'
                      : 'text-shell-muted hover:bg-shell-accent hover:text-shell-accent-foreground',
                  )}
                >
                  {isActive ? (
                    <NavInk
                      layoutId="sidebar-page-ink"
                      className="absolute inset-0 z-0 rounded-lg bg-shell-primary shadow-sm"
                    />
                  ) : null}
                  <Icon className="relative z-10 h-[18px] w-[18px] shrink-0" />
                  <span className="relative z-10 font-body truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-shell-border px-3 py-3">
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleDarkMode}
                  className="flex w-full items-center justify-center rounded-md p-2 text-shell-muted hover:bg-shell-accent hover:text-shell-accent-foreground"
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
              <div className="flex items-center gap-2 text-xs text-shell-muted">
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
