/** Helpers for 材質及明細 rich-text (TipTap HTML) stored on quote items. */

export function looksLikeMaterialHtml(value: string | undefined | null): boolean {
  const text = String(value || '');
  return /<\/?(?:p|br|strong|b|em|i|u|span|div)\b/i.test(text);
}

/** Strip tags / entities for emptiness checks and plain-text fallbacks. */
export function materialPlainText(value: string | undefined | null): string {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  if (!looksLikeMaterialHtml(raw)) {
    return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert legacy plain text into TipTap-friendly HTML. */
export function materialToEditorHtml(value: string | undefined | null): string {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  if (looksLikeMaterialHtml(raw)) return raw;
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<p></p>'))
    .join('');
}

/** Normalize color strings from TipTap / CSS into #rrggbb when possible. */
export function normalizeCssColor(input: string | undefined | null): string | undefined {
  const raw = String(input || '').trim();
  if (!raw) return undefined;
  if (/^#[0-9a-fA-F]{3,8}$/.test(raw)) {
    if (raw.length === 4) {
      const r = raw[1];
      const g = raw[2];
      const b = raw[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return raw.toLowerCase();
  }
  const rgb = raw.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i,
  );
  if (rgb) {
    const toHex = (n: string) =>
      Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }
  return raw;
}
