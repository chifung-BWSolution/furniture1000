/** Quotation draft editor + PDF locale (zh / en). Labels only — product data unchanged. */

export type QuoteLocale = 'zh' | 'en';

/** Branding Works company address defaults by locale. */
export const DEFAULT_COMPANY_ADDRESS = {
  zh: '香港荃灣青山公路459-469號華力工業中心5字樓D-G室',
  en: '5/F, Units D-G, Wah Lik Industrial Centre, 459-469 Castle Peak Road, Tsuen Wan, Hong Kong',
} as const;

/** Default company website for quotation company info (zh & en). */
export const DEFAULT_COMPANY_WEBSITE = 'https://www.bwoffice.asia/';

export const QUOTE_UI = {
  zh: {
    previewPdf: '預覽 PDF',
    generateQrLink: '生成QR Code 及連結',
    confirm: '確認',
    saveDraft: '保存現有版本',
    autoSaving: '自動暫存中…',
    autoSavedAt: '已自動暫存',
    autoSaveHint: '寫入伺服器（不開新版本）；全新報價單會存為 v1',
    versionReview: '版本審核',
    langToggle: 'ENG',
    quoteContent: '報價內容',
    addSectionTitle: '新增標題',
    addField: '新建欄位',
    addValueService: '增值服務',
    addProduct: '新增產品',
    sectionTitleLabel: '區隔標題',
    sectionTitlePlaceholder: '例如：開放區、休閒區…',
    category: '類別',
    dimensionsMm: '尺寸(mm),',
    dimLwh: '長 x 闊 x 高',
    dimDh: '直徑 x 高',
    color: '顏色',
    material: '材質及明細',
    quantity: '數量',
    factory: '廠家',
    sku: 'SKU',
    cnyCost: 'CNY¥成本價',
    exchangeRate: '匯率',
    unifyExchangeRate: '統一匯率',
    /** Button label after clicking 統一匯率 / Exchange Rate. */
    unifyExchangeRateApplied: '已套用全部',
    hkdCost: 'HKD$成本價',
    unit: '單位',
    remarks: '備註',
    image: '圖片',
    referenceImage: '參考圖',
    hkdUnitPrice: 'HKD$單價',
    optionalProduct: '可選',
    hkdSubtotal: 'HKD$小計',
    duplicateItem: '複製此列',
    cutItem: '剪下此列',
    pasteItem: '貼上',
    valueServiceDesc: '增值服務說明',
    valueServicePlaceholder: '輸入額外增值服務（例如：清拆、拆裝舊家私等）...',
    defaultValueServiceName: '運輸安裝費用 (包含清理傢俬包裝垃圾)',
    priceMultiplier: '單價規則：成本倍率',
    apply: '套用',
    grandTotal: '合計',
    deliverySection: '訂單確認及交付細節',
    termsSection: '條款及付款',
    editTerms: '編輯條款',
    doneEditTerms: '完成編輯',
    installFeeSectionHint: '安裝費用列（客戶 PDF）',
    quoteInfo: '報價資訊',
    quoteNo: '報價單號',
    pic: '負責人',
    quoteDate: '日期',
    validityDays: '報價有效期 (天)',
    deliveryAddress: '送貨地址',
    deliveryAddressPlaceholder: '請輸入送貨地址',
  },
  en: {
    previewPdf: 'Preview PDF',
    generateQrLink: 'Generate QR & Link',
    confirm: 'Confirm',
    saveDraft: 'Save Current Version',
    autoSaving: 'Auto-saving…',
    autoSavedAt: 'Auto-saved',
    autoSaveHint: 'Saves to server (no new version); new quotes become v1',
    versionReview: 'Version Review',
    langToggle: '中',
    quoteContent: 'Quotation Content',
    addSectionTitle: 'Add Title',
    addField: 'New Field',
    addValueService: 'Value-added Service',
    addProduct: 'Add Product',
    sectionTitleLabel: 'Section Title',
    sectionTitlePlaceholder: 'e.g. Open Area, Lounge…',
    category: 'Category',
    dimensionsMm: 'Dimensions (mm),',
    dimLwh: 'L x W x H',
    dimDh: 'Dia x H',
    color: 'Color',
    material: 'Materials & Details',
    quantity: 'Qty',
    factory: 'Supplier',
    sku: 'SKU',
    cnyCost: 'CNY¥ Cost Price',
    exchangeRate: 'Exchange Rate',
    unifyExchangeRate: 'Exchange Rate',
    /** Button label after clicking 統一匯率 / Exchange Rate. */
    unifyExchangeRateApplied: 'Apply to all',
    hkdCost: 'HKD$ Cost Price',
    unit: 'Unit',
    remarks: 'Remarks',
    image: 'Image',
    referenceImage: 'Reference Image',
    hkdUnitPrice: 'HKD$ Unit Price',
    optionalProduct: 'Optional',
    hkdSubtotal: 'HKD$ Subtotal',
    duplicateItem: 'Duplicate row',
    cutItem: 'Cut row',
    pasteItem: 'Paste',
    valueServiceDesc: 'Value-added Service Description',
    valueServicePlaceholder:
      'Enter additional value-added services (e.g. dismantling, removal of old furniture)...',
    defaultValueServiceName:
      'Furniture Installation (Fee Installation of furniture items listed in the order and disposal of all packaging waste)',
    priceMultiplier: 'Unit Price Rule: Cost Multiplier',
    apply: 'Apply',
    grandTotal: 'Total',
    deliverySection: 'Order Confirmation and Delivery Details',
    termsSection: 'TERMS AND CONDITIONS',
    editTerms: 'Edit Terms',
    doneEditTerms: 'Done',
    installFeeSectionHint: 'Installation fee row (customer PDF)',
    quoteInfo: 'Quotation Info',
    quoteNo: 'Quotation No.',
    pic: 'Person in Charge',
    quoteDate: 'Date',
    validityDays: 'Validity (days)',
    deliveryAddress: 'Delivery Address',
    deliveryAddressPlaceholder: 'Enter delivery address',
  },
} as const;

export type QuoteUiLabels = (typeof QUOTE_UI)[QuoteLocale];

export const QUOTE_PDF = {
  zh: {
    title: '傢俱報價單',
    customerCompanyName: '公司名稱',
    customerName: '客戶名稱',
    customerPhone: '客戶電話',
    customerEmail: '客戶電郵',
    quotationNo: '報價單號',
    date: '日期',
    projectInCharge: '項目負責人',
    company: '公司',
    address: '地址',
    tel: '電話',
    email: '電郵',
    website: '網站',
    colNo: '序號',
    colDesc: '說明',
    colMaterial: '材質及明細',
    colRemarks: '備註',
    colImage: '圖例',
    colQty: '數量',
    colUnit: '單位',
    colUnitPrice: '單價 (HKD)',
    colTotal: '總價 (HKD)',
    descCategory: '類別',
    descDimensions: '規格\n(mm)',
    descColor: '顏色',
    optionalProduct: '可選',
    grandTotal: '總金額',
    deliveryTitle: '<訂單確認及交付細節>',
    termsTitle: '條款及付款',
    customerAcceptance: '客戶確認',
    customerSignLabel: '客戶授權人姓名及簽名',
    dateOfSignature: '簽署日期:',
    modalTitle: '報價單預覽',
    modalSubtitle: 'PDF Preview — A4 Format',
    downloadPdf: '下載 PDF',
    installTitle: '傢俱安裝費用',
    installSubtitle: '安裝清單中傢俱產品並清理包裝垃圾',
    installCondition: '訂單總金額滿 HK$12,000\n將不收取安裝費用',
  },
  en: {
    title: 'Furniture Quotation',
    customerCompanyName: 'Client Company',
    customerName: 'Contact Person',
    customerPhone: 'Customer Contact No.',
    customerEmail: 'Customer Email',
    quotationNo: 'Quotation No.',
    date: 'Date',
    projectInCharge: 'Project In-charge',
    company: 'Company',
    address: 'Address',
    tel: 'Tel',
    email: 'Email',
    website: 'Website',
    colNo: 'NO.',
    colDesc: 'Description',
    colMaterial: 'Materials & Details',
    colRemarks: 'Remarks',
    colImage: 'Image',
    colQty: 'Qty',
    colUnit: 'Unit',
    colUnitPrice: 'Unit Price (HKD)',
    colTotal: 'Total Price (HKD)',
    descCategory: 'Category',
    descDimensions: 'Dimensions\n(mm)',
    descColor: 'Color',
    optionalProduct: 'Optional',
    grandTotal: 'Grand Total',
    deliveryTitle: '<Order Confirmation and Delivery Details>',
    termsTitle: 'TERMS AND CONDITIONS',
    customerAcceptance: 'CUSTOMER ACCEPTANCE',
    customerSignLabel: 'Customer Authorised Person – Name and Signature',
    dateOfSignature: 'Date of Signature:',
    modalTitle: 'Quotation Preview',
    modalSubtitle: 'PDF Preview — A4 Format',
    downloadPdf: 'Download PDF',
    installTitle: 'Furniture Installation Fee',
    installSubtitle:
      'Installation of furniture items listed in the order and disposal of all packaging waste',
    installCondition:
      'Installation fee will be waived for orders with a total amount of HKD 12,000 or above',
  },
} as const;

export type QuotePdfLabels = (typeof QUOTE_PDF)[QuoteLocale];

export function quoteUi(locale: QuoteLocale): QuoteUiLabels {
  return QUOTE_UI[locale];
}

export function quotePdf(locale: QuoteLocale): QuotePdfLabels {
  return QUOTE_PDF[locale];
}

/** Today's calendar date as YYYY-MM-DD (local timezone). */
export function todayQuoteDateIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalize a stored quote date to YYYY-MM-DD for `<input type="date">`.
 * Accepts ISO, or common D/M/YYYY display strings from zh-HK / en-GB.
 * Empty / unparseable → today.
 */
export function normalizeQuoteDateInput(raw?: string | null): string {
  const s = (raw ?? '').trim();
  if (!s) return todayQuoteDateIso();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return todayQuoteDateIso();
}

/** Format a quote date (ISO or display) for PDF / preview labels. */
export function formatQuoteDisplayDate(
  raw: string | undefined | null,
  locale: QuoteLocale,
): string {
  const iso = normalizeQuoteDateInput(raw);
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(locale === 'en' ? 'en-GB' : 'zh-HK', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}
