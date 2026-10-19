export const MATERIAL_TAG_RULES = [
  { tag: '玻纖背架', terms: ['玻纖背架', '玻璃纖維背架'] },
  { tag: '不鏽鋼', terms: ['不鏽鋼', '不銹鋼', 'stainless steel'] },
  { tag: '鋁合金', terms: ['鋁合金', '铝合金', 'aluminium', 'aluminum'] },
  { tag: '密度板', terms: ['密度板', '中纖板', '中纤板', 'MDF'] },
  { tag: '刨花板', terms: ['刨花板', 'particle board', 'chipboard'] },
  { tag: '夾板', terms: ['夾板', '夹板', '膠合板', '胶合板', 'plywood'] },
  { tag: '防火板', terms: ['防火板'] },
  { tag: '實木', terms: ['實木', '实木', 'solid wood'] },
  { tag: '木皮', terms: ['木皮', 'veneer'] },
  { tag: '橡木', terms: ['橡木', 'oak'] },
  { tag: '胡桃木', terms: ['胡桃木', 'walnut'] },
  { tag: '白蠟木', terms: ['白蠟木', '白蜡木', 'ash wood'] },
  { tag: '網布', terms: ['網布', '网布', 'mesh'] },
  { tag: '尼龍', terms: ['尼龍', '尼龙', 'nylon'] },
  { tag: '西皮', terms: ['西皮'] },
  { tag: '科技布', terms: ['科技布'] },
  { tag: '絨布', terms: ['絨布', '绒布', 'velvet'] },
  { tag: '麻布', terms: ['麻布', 'linen'] },
  { tag: '真皮', terms: ['真皮', 'genuine leather'] },
  { tag: '仿皮', terms: ['仿皮', 'faux leather', 'synthetic leather'] },
  { tag: '皮革', terms: ['皮革', 'leather'] },
  { tag: '布藝', terms: ['布藝', '布艺', 'fabric'] },
  { tag: '海綿', terms: ['海綿', '海绵', 'foam'] },
  { tag: '塑膠', terms: ['塑膠', '塑料', 'plastic'] },
  { tag: '玻璃', terms: ['玻璃', 'glass'] },
  { tag: '亞克力', terms: ['亞克力', '亚克力', 'acrylic'] },
  { tag: '藤材', terms: ['藤材', '藤編', '藤编', 'rattan'] },
  { tag: '竹材', terms: ['竹材', 'bamboo'] },
  { tag: '鋼材', terms: ['鋼材', '钢材', 'steel'] },
  { tag: '金屬', terms: ['金屬', '金属', 'metal'] },
  { tag: 'MFC', terms: ['MFC'] },
  { tag: 'HPL', terms: ['HPL'] },
  { tag: 'PP', terms: ['PP'] },
  { tag: 'PU', terms: ['PU'] },
] as const;

export type MaterialTag = (typeof MATERIAL_TAG_RULES)[number]['tag'];

/** All search terms behind the chosen tags (any match counts). */
export function materialTermsForTags(tags: readonly string[]): string[] {
  const chosen = new Set(tags);
  return MATERIAL_TAG_RULES.filter((rule) => chosen.has(rule.tag)).flatMap((rule) => [...rule.terms]);
}
