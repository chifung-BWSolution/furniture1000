import { useNavigate } from 'react-router-dom';
import { DoorOpen, Sofa, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DESIGN_PROJECTS_PATH } from '@/lib/designProjectRoutes';
import { pathFromAppView } from '@/lib/appSectionRoutes';
import { DesignProjectsView } from './DesignProjectsView';
import { InviteClientsView } from './InviteClientsView';
import { SolutionProjectListView } from './SolutionProjectListView';

export type DesignSchemePanel = 'design' | 'setup' | 'invite';

const PANELS: { id: DesignSchemePanel; label: string; icon: typeof Sofa }[] = [
  { id: 'setup', label: '平面圖與房間', icon: DoorOpen },
  { id: 'design', label: '配置傢俬', icon: Sofa },
  { id: 'invite', label: '邀請客戶', icon: UserPlus },
];

/**
 * Staff workspace for a furniture scheme.
 * Project setup, furniture placement, and client invite used to be three sidebar items.
 */
export function DesignSchemeWorkspace({ panel }: { panel: DesignSchemePanel }) {
  const navigate = useNavigate();
  const customerQuotesPath = pathFromAppView('fds2-customer-quotes') || '/fds/customer/quote-schemes';

  const openPanel = (next: DesignSchemePanel) => {
    if (next === panel) return;
    if (next === 'setup') {
      navigate('/project/project-list');
      return;
    }
    if (next === 'invite') {
      navigate('/project/invite-clients');
      return;
    }
    navigate(DESIGN_PROJECTS_PATH);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex flex-wrap gap-1.5">
          {PANELS.map((item) => {
            const Icon = item.icon;
            const active = panel === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openPanel(item.id)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => navigate(customerQuotesPath)}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/10"
        >
          客戶報價方案
        </button>
      </div>

      {panel === 'design' ? (
        <div className="min-h-0 flex-1">
          <DesignProjectsView />
        </div>
      ) : null}
      {panel === 'setup' ? (
        <div className="min-h-0 flex-1">
          <SolutionProjectListView />
        </div>
      ) : null}
      {panel === 'invite' ? (
        <div className="min-h-0 flex-1">
          <InviteClientsView />
        </div>
      ) : null}
    </div>
  );
}
