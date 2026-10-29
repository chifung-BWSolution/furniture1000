export function gammaEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'gamma.app') return null;
    const match = parsed.pathname.match(/^\/(?:docs|embed)\/([A-Za-z0-9_-]+)\/?$/);
    return match ? `https://gamma.app/embed/${match[1]}` : null;
  } catch { return null; }
}
