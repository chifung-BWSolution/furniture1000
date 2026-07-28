/** Stable deep links for 設計專案. */

/** Canonical base (under 傢俬方案 /project). */
export const DESIGN_PROJECTS_PATH = '/project/design-projects';

/** Legacy path kept for redirects / old share links. */
export const LEGACY_DESIGN_PROJECTS_PATH = '/design-projects';

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
    normalized.startsWith(`${DESIGN_PROJECTS_PATH}/`) ||
    normalized === LEGACY_DESIGN_PROJECTS_PATH ||
    normalized.startsWith(`${LEGACY_DESIGN_PROJECTS_PATH}/`)
  );
}

function parseUnderBase(
  pathname: string,
  base: string,
): ParsedDesignProjectPath | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === base) return { kind: 'list' };
  const match = normalized.match(
    new RegExp(`^${base.replace(/\//g, '\\/')}/([^/]+)$`),
  );
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

/** Parse `/project/design-projects` or `/project/design-projects/:projectId` (and legacy `/design-projects…`). */
export function parseDesignProjectPathname(
  pathname: string,
): ParsedDesignProjectPath | null {
  return (
    parseUnderBase(pathname, DESIGN_PROJECTS_PATH) ||
    parseUnderBase(pathname, LEGACY_DESIGN_PROJECTS_PATH)
  );
}

/** Canonical path for a parsed design-project location (used for legacy redirects). */
export function canonicalDesignProjectPath(
  parsed: ParsedDesignProjectPath,
): string {
  if (parsed.kind === 'list') return DESIGN_PROJECTS_PATH;
  return buildDesignProjectPath(parsed.projectId);
}
