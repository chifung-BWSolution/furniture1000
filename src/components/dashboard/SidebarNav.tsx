import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ViewType } from '@/types/product';
import {
  LayoutDashboard,
  ListChecks,
  Settings,
  Moon,
  Sun,
  ShoppingBag,
  Wifi,
  WifiOff,
  Store,
  ChevronDown,
  Layers,
  Calculator,
  ShieldCheck,
  FileUp,
  BookOpen,
  Search,
  UserPlus,
  CheckCircle2,
  Factory,
  Zap,
  FileBarChart,
  ClipboardList,
  PanelLeftClose,
  PanelLeft,
  FolderTree,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

interface SidebarNavProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  isConnected: boolean;
  isCollapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

interface NavChild {
  view: ViewType;
  icon: React.ElementType;
  label: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  children: NavChild[];
}

const navGroups: NavGroup[] = [
  {
    id: 'projects',
    label: '傢俬方案平台',
    icon: Layers,
    children: [
      { view: 'design-projects', icon: LayoutDashboard, label: '設計專案' },
      { view: 'product-search', icon: Search, label: '產品搜尋' },
      { view: 'invite-clients', icon: UserPlus, label: '邀請客戶' },
      { view: 'confirmed-projects', icon: CheckCircle2, label: '已確定方案' },
    ],
  },
  {
    id: 'quotation',
    label: '傢俬報價平台',
    icon: Calculator,
    children: [
      { view: 'factory-catalog-quote', icon: Factory, label: '廠家目錄' },
      { view: 'quick-quote', icon: Zap, label: '快速報價' },
      { view: 'product-report', icon: FileBarChart, label: '產品報告' },
      { view: 'quotation-list', icon: ClipboardList, label: '報價表一覽' },
    ],
  },
  {
    id: 'admin',
    label: '管理後台',
    icon: ShieldCheck,
    children: [
      { view: 'dashboard', icon: LayoutDashboard, label: '儀表板' },
      { view: 'manufacturer-catalog', icon: BookOpen, label: '廠家目錄' },
      { view: 'ai-processor', icon: FileUp, label: '上載PDF' },
      { view: 'ready-to-publish', icon: ListChecks, label: '待上傳到 Shopify' },
      { view: 'listed-products', icon: Store, label: '產品目錄' },
      { view: 'category-management', icon: FolderTree, label: '產品分類' },
      { view: 'settings', icon: Settings, label: '設定' },
    ],
  },
];

function findGroupForView(view: ViewType): string | null {
  for (const group of navGroups) {
    if (group.children.some((child) => child.view === view)) {
      return group.id;
    }
  }
  return null;
}

export function SidebarNav({
  currentView,
  onViewChange,
  isDarkMode,
  onToggleDarkMode,
  isConnected,
  isCollapsed: isCollapsedProp = false,
  onCollapseChange,
}: SidebarNavProps) {
  const activeGroupId = findGroupForView(currentView);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (activeGroupId) initial.add(activeGroupId);
    return initial;
  });

  const isCollapsed = isCollapsedProp;
  const setIsCollapsed = (val: boolean) => onCollapseChange?.(val);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleViewChange = (view: ViewType) => {
    const groupId = findGroupForView(view);
    if (groupId && !expandedGroups.has(groupId)) {
      setExpandedGroups((prev) => new Set(prev).add(groupId));
    }
    onViewChange(view);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'noise-overlay fixed left-0 top-0 z-40 flex h-full flex-col border-r border-border bg-sidebar transition-all duration-300',
          isCollapsed ? 'w-[68px]' : 'w-[200px]'
        )}
      >
        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3 px-4 py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <ShoppingBag className="h-5 w-5 text-primary" />
          </div>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <h1 className="font-display text-sm font-bold tracking-tight text-sidebar-foreground whitespace-nowrap">
                AI 產品管理
              </h1>
              <p className="font-mono-data text-[10px] text-muted-foreground tracking-wider uppercase whitespace-nowrap">
                Shopify 管理工具
              </p>
            </div>
          )}
        </div>

        {/* Collapse Toggle */}
        <div className="relative z-10 px-3 pb-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex w-full items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            {isCollapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Navigation Groups */}
        <nav className="relative z-10 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {navGroups.map((group) => {
            const isExpanded = expandedGroups.has(group.id);
            const isGroupActive = activeGroupId === group.id;
            const GroupIcon = group.icon;

            return (
              <div key={group.id} className="space-y-0.5">
                {/* Group Header */}
                {isCollapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          setIsCollapsed(false);
                          if (!expandedGroups.has(group.id)) {
                            toggleGroup(group.id);
                          }
                        }}
                        className={cn(
                          'flex w-full items-center justify-center rounded-lg p-2.5 transition-all duration-200',
                          isGroupActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        )}
                      >
                        <GroupIcon className="h-[18px] w-[18px]" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      <p className="font-display text-xs font-semibold">{group.label}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold tracking-wide transition-all duration-200',
                      isGroupActive
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-sidebar-accent-foreground'
                    )}
                  >
                    <GroupIcon className={cn('h-4 w-4 shrink-0', isGroupActive && 'text-primary')} />
                    <span className="font-display truncate">{group.label}</span>
                    <ChevronDown
                      className={cn(
                        'ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                        isExpanded && 'rotate-180'
                      )}
                    />
                  </button>
                )}

                {/* Group Children */}
                {!isCollapsed && (
                  <div
                    className={cn(
                      'overflow-hidden transition-all duration-200',
                      isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                    )}
                  >
                    <div className="ml-2 space-y-0.5 border-l border-border/50 pl-2">
                      {group.children.map(({ view, icon: Icon, label }) => {
                        const isActive = currentView === view;
                        return (
                          <button
                            key={view}
                            onClick={() => handleViewChange(view)}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-all duration-200',
                              isActive
                                ? 'bg-primary/10 text-primary shadow-sm'
                                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                            )}
                          >
                            <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive && 'text-primary')} />
                            <span className="font-body truncate">{label}</span>
                            {isActive && (
                              <div className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="relative z-10 space-y-3 border-t border-border px-3 py-3">
          {/* Connection Status */}
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'flex items-center justify-center rounded-lg p-2',
                    isConnected ? 'bg-emerald-500/10' : 'bg-rose-500/10'
                  )}
                >
                  {isConnected ? (
                    <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-rose-500" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p className="text-xs">{isConnected ? 'Shopify 已連接' : '未連接'}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium',
                isConnected
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-rose-500/10 text-rose-500'
              )}
            >
              {isConnected ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              <span className="font-mono-data text-[11px] tracking-wide">
                {isConnected ? 'Shopify 已連接' : '未連接'}
              </span>
            </div>
          )}

          {/* Dark/Light Toggle */}
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleDarkMode}
                  className="flex w-full items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                >
                  {isDarkMode ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
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
                <span className="font-body text-[12px]">
                  {isDarkMode ? '深色模式' : '淺色模式'}
                </span>
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
