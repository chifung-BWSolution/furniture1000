/**
 * Read-only catalog for 系統設定 → PRD功能描述.
 * Markdown ships with the app via Vite glob (docs/prd, docs, CLAUDE.md, README.md).
 */

const eagerModules = import.meta.glob(
  ['/docs/**/*.md', '/CLAUDE.md', '/README.md'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

export type PrdDocGroup = '逐頁功能描述' | '系統 PRD';

export type PrdDoc = {
  id: string;
  path: string;
  shortPath: string;
  slug: string;
  title: string;
  group: PrdDocGroup;
  date: string | null;
  content: string;
};

const GROUP_ORDER: PrdDocGroup[] = ['逐頁功能描述', '系統 PRD'];

function titleFromPath(path: string) {
  const file = path.split('/').pop() ?? path;
  return file
    .replace(/\.md$/i, '')
    .replace(/_zh-HK$/i, '')
    .replace(/[-_]/g, ' ')
    .trim();
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function normalizeDate(year: string, month: string, day: string): string | null {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
}

function dateFromPath(path: string) {
  const match = path.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  return match ? normalizeDate(match[1], match[2], match[3]) : null;
}

function dateFromContent(content: string) {
  const dashed = content.match(
    /(?:最後更新|更新日期|日期)\s*\**\s*[:：]\s*\**\s*(20\d{2})-(\d{1,2})-(\d{1,2})/,
  );
  if (dashed) return normalizeDate(dashed[1], dashed[2], dashed[3]);
  const cjk = content.match(
    /(?:最後更新|更新日期|日期)\s*\**\s*[:：]\s*\**\s*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
  );
  if (cjk) return normalizeDate(cjk[1], cjk[2], cjk[3]);
  return null;
}

function groupFor(path: string): PrdDocGroup {
  return path.replace(/^\//, '').startsWith('docs/prd/') ? '逐頁功能描述' : '系統 PRD';
}

function buildDoc(path: string, content: string): PrdDoc {
  const clean = path.replace(/^\//, '');
  const file = clean.split('/').pop() ?? clean;
  return {
    id: clean,
    path: clean,
    shortPath: clean.replace(/^docs\//, ''),
    slug: file.replace(/\.md$/i, ''),
    title: titleFromPath(clean),
    group: groupFor(clean),
    date: dateFromContent(content) ?? dateFromPath(clean),
    content,
  };
}

export const prdDocs: PrdDoc[] = Object.entries(eagerModules)
  .map(([path, content]) => buildDoc(path, content))
  .sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    const groupDelta = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (groupDelta !== 0) return groupDelta;
    return a.title.localeCompare(b.title, 'zh-Hant');
  });

export const prdDocGroups = GROUP_ORDER.filter((group) =>
  prdDocs.some((doc) => doc.group === group),
);
