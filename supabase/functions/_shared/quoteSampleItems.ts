/**
 * English quotation emails list a few furniture names in the summary.
 * Stored names are often Traditional Chinese, sometimes with an English
 * name already appended. Prefer that English name; otherwise the caller
 * translates the Chinese name.
 */

const HAN = /\p{Script=Han}/u;

export function splitSampleItemNames(sample: string): string[] {
  return sample.split("、").map((part) => part.trim()).filter(Boolean);
}

/** English already stored on the quote line, or the whole name when it has no Chinese. */
export function englishNameInSample(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (!HAN.test(trimmed)) return trimmed;
  const match = trimmed.match(/\s+([A-Za-z][A-Za-z0-9 .’'"()\/,&+-]*)$/);
  if (!match) return null;
  const english = match[1].trim().replace(/[.,;:]+$/g, "").trim();
  if (english.split(/\s+/).filter(Boolean).length < 2) return null;
  return english;
}

export function cleanTranslatedName(value: string): string {
  const decoded = value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return decoded.trim().replace(/[.。]+$/u, "").trim();
}

export function englishSampleFallback(sample: string | null | undefined): string | null {
  const names = splitSampleItemNames(String(sample ?? ""));
  if (!names.length) return null;
  return names.map((name) => englishNameInSample(name) ?? name).join(", ");
}

export async function localizeEnglishItemNames(
  names: string[],
  translate: (names: string[]) => Promise<string[]>,
): Promise<string[]> {
  const pending = names.filter((name) => englishNameInSample(name) === null && HAN.test(name));
  const translated = new Map<string, string>();
  if (pending.length) {
    const results = await translate(pending);
    if (!Array.isArray(results) || results.length !== pending.length) {
      throw new Error("傢私名稱翻譯不完整");
    }
    pending.forEach((name, index) => {
      const text = cleanTranslatedName(String(results[index] ?? ""));
      if (text) translated.set(name, text);
    });
  }
  return names.map((name) => englishNameInSample(name) ?? translated.get(name) ?? name);
}

export async function localizeEnglishSampleItems(
  sample: string | null | undefined,
  translate: (names: string[]) => Promise<string[]>,
): Promise<string | null> {
  const names = splitSampleItemNames(String(sample ?? ""));
  if (!names.length) return null;
  const localized = await localizeEnglishItemNames(names, translate);
  return localized.join(", ");
}
