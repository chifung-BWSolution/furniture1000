// ============================================================================
// Floor-plan generator — renders an SVG floor plan from a project's zones.
// Zones use percentage bounds (x/y/w/h, 0-100); the SVG uses a 16:10 viewBox so
// the produced image lines up 1:1 with the zone overlay boxes in the UI
// (same container aspect ratio + object-contain).
// Output is a `data:image/svg+xml` URL, persisted like an uploaded floor plan.
// ============================================================================
import type { ProjectZone, ZoneBounds } from '@/types/solutions';

const VW = 1000; // viewBox width
const VH = 625; // viewBox height (16:10)
const WALL = 14; // outer wall thickness

/** Default AI-suggested zones for a project that has none yet. */
export function defaultZoneSeeds(): { code: string; name: string; bounds: ZoneBounds }[] {
  return [
    { code: 'B1', name: '老闆區', bounds: { x: 6, y: 8, w: 28, h: 40 } },
    { code: 'M1', name: '會議室', bounds: { x: 38, y: 8, w: 28, h: 40 } },
    { code: 'O1', name: '開放辦公區', bounds: { x: 70, y: 8, w: 24, h: 40 } },
    { code: 'R1', name: '接待區', bounds: { x: 6, y: 54, w: 44, h: 38 } },
    { code: 'P1', name: '茶水／打印區', bounds: { x: 54, y: 54, w: 40, h: 38 } },
  ];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build an SVG floor plan string from zones.
 *
 * The SVG uses preserveAspectRatio="none" and is rendered with object-fill, so
 * its viewBox maps linearly onto the container in x and y independently. Zone
 * overlay boxes are positioned with the SAME percentage bounds, so the drawn
 * rooms line up exactly with the zone boxes at any container size. Room names
 * are intentionally NOT drawn here — the crisp HTML zone overlays provide them,
 * which keeps text undistorted regardless of stretching.
 */
export function buildFloorPlanSvg(zones: ProjectZone[], _title?: string): string {
  const rooms = zones
    .map((z) => {
      const x = (z.bounds.x / 100) * VW;
      const y = (z.bounds.y / 100) * VH;
      const w = (z.bounds.w / 100) * VW;
      const h = (z.bounds.h / 100) * VH;
      return `
    <g>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"
            rx="6" fill="#ffffff" stroke="#94a3b8" stroke-width="3" />
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="22"
            rx="6" fill="#eef2ff" />
    </g>`;
    })
    .join('');

  // a door opening drawn as an arc on the bottom outer wall
  const doorX = VW * 0.46;
  const doorArc = `<path d="M ${doorX} ${VH - WALL} a 60 60 0 0 1 60 -60" fill="none" stroke="#cbd5e1" stroke-width="2.5" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}" preserveAspectRatio="none">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" stroke-width="1" />
    </pattern>
  </defs>
  <rect x="0" y="0" width="${VW}" height="${VH}" fill="#f8fafc" />
  <rect x="${WALL}" y="${WALL}" width="${VW - WALL * 2}" height="${VH - WALL * 2}" fill="url(#grid)" />
  <rect x="${WALL / 2}" y="${WALL / 2}" width="${VW - WALL}" height="${VH - WALL}"
        fill="none" stroke="#475569" stroke-width="${WALL}" />
  ${doorArc}
  ${rooms}
</svg>`;
}

/** Build the floor plan and return it as a data URL ready to store/render. */
export function generateFloorPlanDataUrl(zones: ProjectZone[], title?: string): string {
  const svg = buildFloorPlanSvg(zones, title);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/** True if a floor-plan URL was produced by this generator (vs an uploaded file). */
export function isGeneratedFloorPlan(url: string | null): boolean {
  return !!url && url.startsWith('data:image/svg+xml');
}
