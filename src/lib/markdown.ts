/**
 * Minimal, dependency-free Markdown → HTML renderer for the read-only
 * 「PRD功能描述」 document viewer in 系統設定.
 *
 * It intentionally supports the GitHub-Flavored subset the QMS documents use
 * (headings, paragraphs, bold/italic/strikethrough, inline code, fenced code
 * blocks, links, blockquotes, ordered/unordered lists, horizontal rules and
 * tables). Output is a raw HTML string that every caller MUST pass through the
 * shared `sanitizeRichTextHtml` helper before rendering, per the QMS rich-text
 * rule; this module does not sanitize by itself.
 */

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CODE_PLACEHOLDER = "\u0000";

/** Inline spans: code first (protected from later passes), then links/emphasis. */
function renderInline(text: string): string {
  const codes: string[] = [];
  let value = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `${CODE_PLACEHOLDER}${codes.length - 1}${CODE_PLACEHOLDER}`;
  });

  value = escapeHtml(value);

  value = value.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, label: string, url: string) => {
      const safe = /^(https?:|mailto:|\/|#)/i.test(url) ? url : "";
      return safe ? `<a href="${safe}">${label}</a>` : label;
    },
  );

  value = value
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return value.replace(
    new RegExp(`${CODE_PLACEHOLDER}(\\d+)${CODE_PLACEHOLDER}`, "g"),
    (_match, index: string) => codes[Number(index)] ?? "",
  );
}

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function splitRow(row: string) {
  let value = row.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

function renderTable(lines: string[], start: number) {
  const header = splitRow(lines[start]);
  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length && lines[index].includes("|") && !/^\s*$/.test(lines[index])) {
    rows.push(splitRow(lines[index]));
    index += 1;
  }
  const head = `<thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return { html: `<table>${head}${body}</table>`, next: index };
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function renderList(lines: string[], start: number) {
  const baseIndent = (lines[start].match(/^(\s*)/)?.[1] ?? "").length;
  const ordered = /^\s*\d+[.)]\s+/.test(lines[start]);
  const items: string[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) {
      const next = lines[index + 1] ?? "";
      if (LIST_ITEM.test(next) && (next.match(/^(\s*)/)?.[1] ?? "").length >= baseIndent) {
        index += 1;
        continue;
      }
      break;
    }
    const match = line.match(LIST_ITEM);
    if (!match) break;
    const indent = match[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      const nested = renderList(lines, index);
      if (items.length) items[items.length - 1] += nested.html;
      else items.push(nested.html);
      index = nested.next;
      continue;
    }

    let content = match[3];
    index += 1;
    while (index < lines.length) {
      const continuation = lines[index];
      if (/^\s*$/.test(continuation)) break;
      const nextItem = continuation.match(LIST_ITEM);
      if (nextItem && nextItem[1].length === baseIndent) break;
      if ((continuation.match(/^(\s*)/)?.[1] ?? "").length > baseIndent) {
        content += `\n${continuation.trim()}`;
        index += 1;
        continue;
      }
      break;
    }
    items.push(`<li>${renderInline(content).replace(/\n/g, "<br>")}</li>`);
  }

  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${items.join("")}</${tag}>`, next: index };
}

/** Render a Markdown document to raw HTML (caller must sanitize before use). */
export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${renderInline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flushParagraph();
      const marker = fence[1];
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      output.push("<hr />");
      index += 1;
      continue;
    }

    if (line.includes("|") && isTableSeparator(lines[index + 1] ?? "")) {
      flushParagraph();
      const table = renderTable(lines, index);
      output.push(table.html);
      index = table.next;
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      output.push(`<blockquote>${renderMarkdownToHtml(quote.join("\n"))}</blockquote>`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushParagraph();
      const list = renderList(lines, index);
      output.push(list.html);
      index = list.next;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushParagraph();
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return output.join("");
}
