import type { ReactNode } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import {
  BW_PUBLIC_CLIENT_MARKS,
  BW_TRUST_STATS,
  BW_YOUTUBE_VIDEOS,
} from '@/content/bwCorporate';

export function CorporateSection({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          {icon}
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function CorporateTrustStats() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {BW_TRUST_STATS.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-primary/20 bg-primary/5 p-5"
        >
          <p className="font-display text-2xl font-bold text-primary">
            {stat.value}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}

export function CorporateLogoWall() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {BW_PUBLIC_CLIENT_MARKS.map((name) => (
        <div
          key={name}
          className="flex min-h-24 items-center justify-center rounded-2xl border border-border bg-card px-4 py-5 text-center shadow-sm transition-colors hover:border-primary/35"
        >
          <div>
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted font-display text-sm font-bold text-primary">
              {name.slice(0, 2)}
            </div>
            <p className="font-semibold">{name}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CorporateYouTubeGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {BW_YOUTUBE_VIDEOS.map((video) => (
        <a
          key={video.id}
          href={`https://www.youtube.com/watch?v=${video.id}`}
          target="_blank"
          rel="noreferrer"
          className="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          <div className="relative aspect-video overflow-hidden bg-muted">
            <img
              src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
              alt={video.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/20">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card/95 text-primary shadow-lg">
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 p-4">
            <p className="font-semibold">{video.title}</p>
            <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        </a>
      ))}
    </div>
  );
}
