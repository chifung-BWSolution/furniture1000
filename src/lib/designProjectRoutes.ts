/** Stable deep links for 設計專案. */

export const DESIGN_PROJECTS_PATH = '/design-projects';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ParsedDesignProjectPath =
  | { kind: 'list' }
  | { kind: 'project'; projectId: string };

/** Build shareable URL for a design project. */
export function buildDesignProjectPath(projectId: string): string {
  const id = (projectId || '').trim();
  if (!id) return DESIGN_PROJECTS_PATH;
  return `${DESIGN_PROJECTS_PATH}/${encodeURIComponent(id)}`;
}

export function isDesignProjectPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    normalized === DESIGN_PROJECTS_PATH ||
    normalized.startsWith(`${DESIGN_PROJECTS_PATH}/`)
  );
}

/** Parse `/design-projects` or `/design-projects/:projectId`. */
export function parseDesignProjectPathname(
  pathname: string,
): ParsedDesignProjectPath | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === DESIGN_PROJECTS_PATH) return { kind: 'list' };
  const match = normalized.match(/^\/design-projects\/([^/]+)$/);
  if (!match) return null;
  let projectId = match[1];
  try {
    projectId = decodeURIComponent(projectId);
  } catch {
    // keep raw segment
  }
  projectId = projectId.trim();
  if (!projectId || !UUID_RE.test(projectId)) return { kind: 'list' };
  return { kind: 'project', projectId };
}
