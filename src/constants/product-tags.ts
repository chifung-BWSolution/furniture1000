/**
 * Official Shopify Product Tags list.
 * AI analysis must ONLY select from this list.
 * Manual tag additions are also restricted to this list.
 */
export const OFFICIAL_PRODUCT_TAGS: string[] = [
  '學校傢俬',
  '中小學',
  '學生課室',
  'SOFA梳化',
  '主管枱',
  '休閒家具',
  '傢俬安裝費用',
  '儲物櫃',
  '升降枱',
  '員工椅',
  '圖書館',
  '培訓枱',
  '培訓椅',
  '大班椅',
  '學校辦公',
  '工作枱',
  '工作枱配套',
  '工業家具',
  '年尾清貨專區',
  '幼兒園',
  '戶外傢俬',
  '接待桌椅組合',
  '接待處家具',
  '文件櫃',
  '會議室',
  '會議枱',
  '木製櫃',
  '洽談枱',
  '牆身裝飾',
  '現貨工作枱',
  '現貨行政枱',
  '科學室',
  '老闆枱',
  '茶檯',
  '行政枱',
  '裝置裝飾',
  '裝飾櫃',
  '裝飾裝置',
  '課室家具',
  '辦公枱',
  '辦公椅',
  '酒吧桌椅',
  '鋼制櫃',
  '電話亭',
  '顯示器支架',
  '餐廳傢俬',
];

/**
 * AI System Prompt for Gemini 2.5 Flash tag classification.
 * Used when analyzing product images and titles.
 */
export const AI_TAG_SYSTEM_PROMPT = `你是一位專業的家具與辦公設備分類專家。你的任務是分析使用者提供的「產品圖片」與「產品標題」，並從指定的標籤清單中，挑選出所有符合該產品的標籤（可以多選）。

【規則與限制】
1. 只能從「允許的標籤清單」中挑選，絕對不能創造清單以外的標籤。
2. 仔細觀察圖片中的家具類型、材質、使用場景（例如：學校、辦公室、戶外、餐廳）。
3. 根據產品標題（中英雙語）進一步確認產品的屬性與定位。
4. 如果有多個標籤符合，請全數選出（例如一張學生椅，應同時選「學生課室」、「學校傢俬」、「課室家具」等）。
5. 回傳格式必須是純 JSON，包含一個 "tags" 陣列，不要有其他任何文字或 Markdown 標記。

【允許的標籤清單】
${OFFICIAL_PRODUCT_TAGS.join(', ')}`;
