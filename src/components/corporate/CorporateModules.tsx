import type { ReactNode } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import {
  BW_CLIENT_LOGO_WALL_IMAGE,
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
    <div className="overflow-hidden rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-6">
      <img
        src={BW_CLIENT_LOGO_WALL_IMAGE}
        alt="BW Furniture 客戶 Logo 牆：教育、金融及專業服務、香港政府及法定機構、酒店、科技、醫療及社福機構"
        loading="lazy"
        className="mx-auto h-auto w-full max-w-4xl object-contain"
      />
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
