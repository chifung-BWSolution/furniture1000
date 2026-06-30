export type RemarksBlock =
  | { type: "text"; content: string; id: string }
  | { type: "image"; src: string; id: string };

export const MAX_REMARKS_IMAGES = 4;

const newBlockId = () => Math.random().toString(36).slice(2, 12);

function normalizeBlock(raw: unknown): RemarksBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" && obj.id ? obj.id : newBlockId();
  if (obj.type === "text") {
    return { type: "text", content: typeof obj.content === "string" ? obj.content : "", id };
  }
  if (obj.type === "image" && typeof obj.src === "string" && obj.src) {
    return { type: "image", src: obj.src, id };
  }
  return null;
}

/** Parse stored remarks (plain text, legacy text+image, or JSON blocks). */
export function parseRemarksContent(
  remarks?: string,
  legacyImage?: string,
): RemarksBlock[] {
  const trimmed = (remarks || "").trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const blocks = parsed.map(normalizeBlock).filter(Boolean) as RemarksBlock[];
        if (blocks.length > 0) return blocks;
      }
    } catch {
      // fall through to plain text
    }
  }

  const blocks: RemarksBlock[] = [];
  if (trimmed) {
    blocks.push({ type: "text", content: trimmed, id: newBlockId() });
  } else {
    blocks.push({ type: "text", content: "", id: newBlockId() });
  }
  if (legacyImage) {
    blocks.push({ type: "image", src: legacyImage, id: newBlockId() });
  }
  return blocks;
}

/** Serialize blocks for storage in `products.remarks` / draft items. */
export function serializeRemarksContent(blocks: RemarksBlock[]): string {
  const normalized =
    blocks.length > 0
      ? blocks
      : [{ type: "text" as const, content: "", id: newBlockId() }];

  const onlyEmptyText =
    normalized.length === 1 &&
    normalized[0].type === "text" &&
    !normalized[0].content.trim() &&
    !normalized.some((b) => b.type === "image");

  if (onlyEmptyText) return "";

  return JSON.stringify(
    normalized.map((block) =>
      block.type === "text"
        ? { type: "text", content: block.content, id: block.id }
        : { type: "image", src: block.src, id: block.id },
    ),
  );
}

export function countRemarksImages(blocks: RemarksBlock[]): number {
  return blocks.filter((b) => b.type === "image").length;
}

/** Plain text for simple display (legacy consumers). */
export function remarksPlainText(remarks?: string, legacyImage?: string): string {
  return parseRemarksContent(remarks, legacyImage)
    .filter((b): b is Extract<RemarksBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.content)
    .join("\n")
    .trim();
}
