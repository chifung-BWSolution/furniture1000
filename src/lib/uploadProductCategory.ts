import {
  categorySelectorValue,
  matchExistingProductCategory,
  productCategoryChoiceLabel,
  type ProductCategoryPair,
} from '@/lib/productCategoryOptions';
import { DEFAULT_GEMINI_MODEL } from '@/lib/geminiModel';

export type CategoryClassifiable = {
  id: string;
  title: string;
  material?: string;
  modelNumber?: string;
  productCategory?: string;
  categoryLevel1?: string | null;
};

/** Ask Gemini to pick an existing category for each catalogue row. Unmatched ids are omitted. */
export async function classifyProductsByExistingCategories(
  items: CategoryClassifiable[],
  pairs: ProductCategoryPair[],
): Promise<Map<string, ProductCategoryPair>> {
  const found = new Map<string, ProductCategoryPair>();
  const labels = [...new Set(pairs.map(productCategoryChoiceLabel).filter(Boolean))];
  const pending = items.filter((item) => item.id && item.title.trim() && !matchExistingProductCategory(pairs, item.productCategory, item.categoryLevel1));
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!labels.length || !pending.length || !supabaseUrl || !supabaseAnonKey) return found;

  for (let offset = 0; offset < pending.length; offset += 25) {
    const chunk = pending.slice(offset, offset + 25);
    const prompt = [
      'Classify each furniture product into exactly one existing category label, or null when none fits.',
      'Copy a label character-for-character. Do not invent, translate, or shorten a label.',
      'Labels:',
      ...labels.map((label) => `- ${label}`),
      'Products:',
      ...chunk.map((item) => JSON.stringify({
        id: item.id,
        title: item.title.slice(0, 180),
        material: (item.material || '').slice(0, 120),
        model: (item.modelNumber || '').slice(0, 80),
      })),
      'Return JSON only: {"assignments":[{"id":"...","product_category":"label or null"}]}',
    ].join('\n');

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/supabase-functions-gemini-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseAnonKey}`,
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify({
          model: DEFAULT_GEMINI_MODEL,
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start < 0 || end <= start) continue;
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { assignments?: Array<{ id?: string; product_category?: string | null }> };
      for (const row of parsed.assignments ?? []) {
        const pair = matchExistingProductCategory(pairs, row.product_category);
        if (pair && row.id) found.set(String(row.id), pair);
      }
    } catch (err) {
      console.warn('[uploadProductCategory] category classify skipped:', err);
    }
  }
  return found;
}

export function assignUploadCategories<T extends CategoryClassifiable>(
  items: T[],
  pairs: ProductCategoryPair[],
  fallback: string,
  classified: Map<string, ProductCategoryPair>,
): T[] {
  const fallbackPair = matchExistingProductCategory(pairs, fallback);
  return items.map((item) => {
    const pair = matchExistingProductCategory(pairs, item.productCategory, item.categoryLevel1)
      ?? classified.get(item.id)
      ?? fallbackPair
      ?? null;
    if (!pair) return { ...item, productCategory: '', categoryLevel1: null };
    return { ...item, productCategory: categorySelectorValue(pair), categoryLevel1: pair.level1 };
  });
}
