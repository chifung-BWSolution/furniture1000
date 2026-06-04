/**
 * Simplified Chinese → Traditional Chinese (Hong Kong) Converter
 * ─────────────────────────────────────────────────────────────────
 * Provides a character-level mapping from common Simplified Chinese characters
 * to their Traditional Chinese (Hong Kong) equivalents.
 * 
 * This is a focused subset covering furniture/product catalog vocabulary.
 * For full-text translation, a more comprehensive dictionary would be needed.
 */

// ─── Simplified → Traditional Character Map ─────────────────────────
// Covers: materials, dimensions, furniture terms, common descriptors
const SC_TO_TC_MAP: Record<string, string> = {
  // Common material/furniture terms
  '质': '質', '钢': '鋼', '铝': '鋁', '铁': '鐵', '铜': '銅',
  '银': '銀', '锌': '鋅', '镀': '鍍', '锈': '銹', '钉': '釘',
  '针': '針', '线': '線', '纤': '纖', '绒': '絨', '缎': '緞',
  '绸': '綢', '纱': '紗', '绵': '綿', '织': '織', '编': '編',
  '绳': '繩', '纹': '紋', '缝': '縫', '补': '補', '衬': '襯',
  
  // Furniture terms
  '柜': '櫃', '椅': '椅', '桌': '桌', '橱': '櫥', '龛': '龕',
  '层': '層', '栏': '欄', '窗': '窗', '门': '門', '锁': '鎖',
  '钥': '鑰', '轮': '輪', '轴': '軸', '齿': '齒',
  
  // Dimensions and measurement
  '长': '長', '宽': '寬', '高': '高', '厚': '厚', '径': '徑',
  '规': '規', '标': '標', '号': '號', '码': '碼',
  
  // Common descriptors
  '颜': '顏', '色': '色', '亮': '亮', '暗': '暗', '浅': '淺',
  '深': '深', '红': '紅', '绿': '綠', '蓝': '藍', '黄': '黃',
  '黑': '黑', '白': '白', '灰': '灰', '紫': '紫', '粉': '粉',
  '橙': '橙', '棕': '棕', '褐': '褐',
  
  // Actions/states
  '调': '調', '装': '裝', '设': '設', '计': '計', '画': '畫',
  '涂': '塗', '喷': '噴', '烤': '烤', '磨': '磨', '抛': '拋',
  '镜': '鏡', '亮': '亮', '哑': '啞',
  
  // General high-frequency characters
  '国': '國', '产': '產', '进': '進', '这': '這', '个': '個',
  '们': '們', '对': '對', '与': '與', '关': '關', '开': '開',
  '从': '從', '东': '東', '发': '發', '实': '實', '现': '現',
  '来': '來', '里': '裡', '后': '後', '间': '間', '时': '時',
  '机': '機', '为': '為', '动': '動', '电': '電', '气': '氣',
  '学': '學', '经': '經', '过': '過', '车': '車', '头': '頭',
  '体': '體', '种': '種', '总': '總', '样': '樣', '应': '應',
  '给': '給', '条': '條', '边': '邊', '场': '場', '见': '見',
  '说': '說', '话': '話', '点': '點', '部': '部', '问': '問',
  '情': '情', '处': '處', '面': '面', '连': '連', '运': '運',
  '选': '選', '费': '費', '价': '價', '钱': '錢', '货': '貨',
  '买': '買', '卖': '賣', '单': '單', '复': '複', '杂': '雜',
  '简': '簡', '难': '難', '轻': '輕', '重': '重', '满': '滿',
  '空': '空', '全': '全', '半': '半', '双': '雙',
  
  // Material-specific
  '树': '樹', '脂': '脂', '胶': '膠', '漆': '漆', '蜡': '蠟',
  '油': '油', '粘': '粘', '贴': '貼', '压': '壓', '弯': '彎',
  '环': '環', '氧': '氧', '碳': '碳', '合': '合', '金': '金',
  '板': '板', '材': '材', '木': '木', '竹': '竹', '藤': '藤',
  '皮': '皮', '革': '革', '布': '布', '棉': '棉', '麻': '麻',
  '丝': '絲', '毛': '毛', '玻': '玻', '璃': '璃', '陶': '陶',
  '瓷': '瓷', '石': '石', '砖': '磚', '泥': '泥', '沙': '沙',
  '岩': '岩', '理': '理', '纯': '純',
  
  // Additional furniture/product terms
  '垫': '墊', '靠': '靠', '背': '背', '扶': '扶', '手': '手',
  '脚': '腳', '腿': '腿', '底': '底', '顶': '頂', '侧': '側',
  '弹': '彈', '簧': '簧', '海': '海', '绵': '綿', '泡': '泡',
  '沫': '沫', '记': '記', '忆': '憶', '回': '回',
  
  // More common conversions
  '厂': '廠', '区': '區', '仓': '倉', '库': '庫', '储': '儲',
  '备': '備', '注': '註', '释': '釋', '览': '覽', '细': '細',
  '节': '節', '组': '組', '构': '構', '结': '結', '份': '份',
  '系': '系', '统': '統', '能': '能', '功': '功', '效': '效',
  '率': '率', '度': '度', '温': '溫', '热': '熱', '冷': '冷',
  '干': '乾', '湿': '濕', '防': '防', '水': '水', '火': '火',
  '耐': '耐', '磨': '磨', '损': '損', '寿': '壽', '命': '命',
  '换': '換', '修': '修', '维': '維', '护': '護', '保': '保',
  '养': '養', '清': '清', '洁': '潔', '脏': '髒',
  
  // 描述 / description terms
  '描': '描', '述': '述', '尺': '尺', '寸': '寸', '型': '型',
  '款': '款', '式': '式', '配': '配', '套': '套', '装': '裝',
  '组': '組', '件': '件', '个': '個', '只': '隻', '张': '張',
  '把': '把', '块': '塊', '片': '片', '根': '根', '条': '條',
};

/**
 * Convert a Simplified Chinese string to Traditional Chinese (HK).
 * Performs character-by-character substitution.
 * Non-Chinese characters and characters not in the map pass through unchanged.
 */
export function simplifiedToTraditional(text: string): string {
  if (!text) return text;
  let result = '';
  for (const char of text) {
    result += SC_TO_TC_MAP[char] || char;
  }
  return result;
}

/**
 * Detect if a string contains Simplified Chinese characters
 * (characters that have a different Traditional Chinese form).
 */
export function containsSimplifiedChinese(text: string): boolean {
  if (!text) return false;
  for (const char of text) {
    if (SC_TO_TC_MAP[char]) return true;
  }
  return false;
}

/**
 * Convert all string cells in a row from Simplified to Traditional Chinese.
 * Returns a new array with converted values.
 */
export function convertRowToTraditional(cells: (string | number | null)[]): (string | number | null)[] {
  return cells.map(cell => {
    if (cell === null || typeof cell === 'number') return cell;
    return simplifiedToTraditional(cell);
  });
}
