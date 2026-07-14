import { MapPin } from 'lucide-react';
import type { DesignProject, ProjectZone } from '@/types/solutions';

interface ClientZoneFloorPlanProps {
  project: DesignProject;
  zones: ProjectZone[];
  activeZoneId?: string | null;
  onZoneClick?: (zoneId: string) => void;
}

export function ClientZoneFloorPlan({
  project,
  zones,
  activeZoneId,
  onZoneClick,
}: ClientZoneFloorPlanProps) {
  const hasImage = !!project.floorPlanUrl;

  return (
    <div className="relative aspect-[16/7] w-full overflow-hidden rounded-xl border border-border bg-muted/20">
      {hasImage ? (
        <img
          src={project.floorPlanUrl!}
          alt={`${project.name} 平面圖`}
          className="absolute inset-0 h-full w-full object-fill"
        />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(var(--muted)/0.35)_0%,hsl(var(--background))_100%)]" />
      )}
      {zones.map((z) => {
        const active = activeZoneId === z.id;
        return (
          <button
            key={z.id}
            type="button"
            onClick={() => onZoneClick?.(z.id)}
            className={`absolute rounded-lg border-2 px-2 py-1 text-left transition-all ${
              active
                ? 'border-primary bg-primary/15 shadow-md ring-2 ring-primary/30'
                : 'border-primary/40 bg-primary/5 hover:border-primary/60 hover:bg-primary/10'
            }`}
            style={{
              left: `${z.bounds.x}%`,
              top: `${z.bounds.y}%`,
              width: `${z.bounds.w}%`,
              height: `${z.bounds.h}%`,
            }}
          >
            <span className="flex items-center gap-1 font-display text-[11px] font-bold text-primary">
              <MapPin className="h-3 w-3 shrink-0" />
              {z.code ? `${z.code} · ` : ''}{z.name}
            </span>
          </button>
        );
      })}
      {zones.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-body text-sm text-muted-foreground">此專案尚未設定分區</p>
        </div>
      )}
    </div>
  );
}
