/**
 * Strip Tailwind / editor artifact markup from rich-text HTML before saving or displaying.
 * Contenteditable inside a Tailwind page can leak --tw-* inline styles into saved HTML.
 */
export function stripEditorArtifactHtml(html: string): string {
  if (!html) return html;
  let out = html;
  // Remove style attributes that contain Tailwind CSS variables.
  out = out.replace(/\s+style="[^"]*--tw-[^"]*"/gi, '');
  out = out.replace(/\s+style='[^']*--tw-[^']*'/gi, '');
  // Remove class attributes with tw- utility classes.
  out = out.replace(/\s+class="[^"]*\btw-[^\s"]+[^"]*"/gi, (match) => {
    const cleaned = match
      .replace(/class="/i, '')
      .replace(/"$/, '')
      .split(/\s+/)
      .filter((c) => c && !c.startsWith('tw-'))
      .join(' ');
    return cleaned ? ` class="${cleaned}"` : '';
  });
  // Unwrap spans that became empty after stripping attributes.
  out = out.replace(/<span>([^<]*)<\/span>/gi, '$1');
  // Normalize <br> tags polluted with empty attributes.
  out = out.replace(/<br\s*\/?>/gi, '<br>');
  return out;
}

const BLOCK_TAG = '(?:p|div|ul|ol|li|h[1-6]|table|tr|td|th|thead|tbody|blockquote|br|hr|section|article)';

/**
 * Shopify renders body_html as normal HTML where bare \\n collapses to a single
 * space — convert genuine in-text newlines to <br> before saving.
 */
export function normalizeBodyHtmlForShopify(html: string): string {
  if (!html) return html;
  let out = stripEditorArtifactHtml(html);
  out = out.replace(/\r\n/g, '\n');
  out = out.replace(new RegExp(`(</?${BLOCK_TAG}[^>]*>)\\n+`, 'gi'), '$1');
  out = out.replace(new RegExp(`\\n+(</?${BLOCK_TAG}[^>]*>)`, 'gi'), '$1');
  out = out.replace(/\n/g, '<br>');
  return stripEditorArtifactHtml(out);
}
