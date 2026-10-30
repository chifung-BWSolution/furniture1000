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
    editorTitle: '報價單草稿編輯',
    currentVersion: '目前版本',
    nextReviewVersion: '送出新版本審核',
    basicInfo: '基本資料',
    feesAndTotal: '費用與總價',
    quotePhotos: '報價單圖片',
    versionAndOutput: '版本與輸出',
    back: '返回',
    selectFactory: '選擇廠家',
    searchFactory: '搜尋廠家…',
    noFactory: '沒有找到廠家',
    loading: '載入中…',
    productNamePlaceholder: '產品名稱',
    previewPdf: '預覽 PDF',
    generateQrLink: '生成QR Code 及連結',
    confirm: '確認',
    cancel: '取消',
    saveDraft: '保存現有版本',
    autoSaving: '自動暫存中…',
    autoSavedAt: '已自動暫存',
    autoSaveHint: '儲存目前看到的內容，不會另開新版本。第一次儲存會成為第 1 版。',
    autoSaveFailed: '自動儲存失敗，請按「保存現有版本」',
    versionReview: '版本審核',
    langToggle: 'ENG',
    quoteContent: '報價內容',
    addSectionTitle: '新增標題',
    addField: '新建欄位',
    addValueService: '增值服務',
    addProduct: '新增產品',
    copyFromOtherQuote: '從其他表單複製',
    copyFromOtherQuoteTitle: '從其他報價單複製項目',
    copyFromOtherQuoteHint: '先選提案名稱，再選版本，勾選要複製的項目後按新增。這些項目會加在這張報價的最前面。',
    copyFromOtherQuoteName: '提案顯示名稱',
    copyFromOtherQuoteVersion: '版本',
    copyFromOtherQuoteAdd: '新增',
    copyFromOtherQuoteAddSelected: '新增所選',
    copyFromOtherQuoteEmpty: '此版本沒有報價內容',
    copyFromOtherQuotePickName: '請先選擇提案顯示名稱',
    copyFromOtherQuotePickVersion: '請選擇版本',
    copyFromOtherQuoteLoading: '載入中…',
    copyFromOtherQuoteSearch: '搜尋提案顯示名稱',
    copyFromOtherQuoteSuccess: '已複製到報價內容最前',
    copyFromOtherQuoteClose: '關閉',
    sectionTitleLabel: '區隔標題',
    sectionTitlePlaceholder: '例如：開放區、休閒區…',
    zoneAddItemAbove: '上方新增項目',
    zoneAddItemBelow: '下方新增項目',
    zoneItemCount: '已加入 {n} 項',
    zoneEmptyHint: '未加入項目',
    uploadFloorPlan: '上傳平面圖',
    replaceFloorPlan: '更換平面圖',
    manageZones: '分區管理',
    addZoneSpace: '新增空間',
    noZonesYet: '尚未有分區',
    manageZonesHint: '可改空間名稱、類型和數量，或移除分區。移除後，裡面的傢俬會回到未分區。',
    dropFloorPlan: '把平面圖拖到這裡，或按一下',
    dropFloorPlanAction: '上傳',
    zoneSpaceName: '空間名稱',
    zoneNameEn: '英文名稱',
    zoneSpaceType: '類型',
    zoneQuantity: '數量',
    zoneSpaceNamePlaceholder: '例如：接待區',
    zoneNameEnPlaceholder: 'Reception',
    zoneSpaceTypePlaceholder: '例如：會議室 / 工作區',
    recognizingZones: '識別中…',
    recognizingZonesDetail: '正在讀取平面圖上的房間名稱，完成後可以在這裡調整範圍。',
    uploadFloorPlanRecognize: '上傳平面圖識別',
    reuploadFloorPlanRecognize: '重新上傳並識別',
    floorPlanRecognizeHint: '在圖上空白的地方拉一個框，就會多一個空間。框可以移動、改大小，也可以刪掉；按左上角複製可以為同一個空間加第二個範圍。按確認後才會加進報價。',
    floorPlanReconfirmHint: '已更換平面圖，請在新圖上調整範圍後再確認。',
    zoneUnboxedHint: '有 {n} 個分區尚未畫範圍，請在左邊平面圖上拉框補上。',
    zoneBoxed: '已畫範圍',
    zoneUnboxed: '尚未畫範圍',
    uploadingFloorPlan: '上傳中…',
    itemZone: '分區',
    unzoned: '未分區',
    addZoneHere: '在此前面新增分區',
    uploadZoneImage: '上傳圖片',
    removeZoneImage: '移除分區圖片',
    reviewDetectedZones: '確認識別到的分區',
    reviewDetectedZonesHint: '可以改名稱，或不勾選不需要的房間。確認後會加在報價最前面，再用每件傢俬前面的選單放進對應房間。',
    category: '類別',
    level1Category: '一級分類',
    level2Category: '二級分類',
    productCategoryLockedHint: '已連到產品資料，分類跟產品目錄，這裡不能改',
    dimensionsMm: '尺寸(mm),',
    dimLwh: '長 x 闊 x 高',
    dimDh: '直徑 x 高',
    color: '顏色',
    material: '材質及明細',
    quantity: '數量',
    factory: '廠家',
    sku: 'SKU',
    skuHint: '產品編號。只在編輯時看得到，客戶的報價單不會顯示。',
    cnyCost: 'CNY¥成本價',
    exchangeRate: '匯率',
    unifyExchangeRate: '統一匯率',
    /** Button label after clicking（EN switches to Apply to all; ZH stays 統一匯率）. */
    unifyExchangeRateApplied: '統一匯率',
    unifyRateHint: '輸入匯率後，所有產品的成本價和港幣金額會一起重算。',
    unifyRateScope: '將套用到 {n} 件產品',
    unifyRateTodayLoaded: '已填入今天的匯率（人民幣換港幣）',
    unifyRateTodayLoading: '正在抓取今日匯率…',
    hkdCost: 'HKD$成本價',
    /** Value-added service row — user-entered HKD cost (feeds GP Cost). */
    hkdCostAmount: 'HKD$成本',
    unit: '單位',
    remarks: '備註',
    image: '圖片',
    referenceImage: '參考圖',
    hkdUnitPrice: 'HKD$單價',
    optionalProduct: '可選',
    hideInPdf: '於PDF 隱藏',
    hideInPdfOn: '客戶看不到這項，編輯畫面仍會顯示',
    hideInPdfOff: '勾選後，客戶的報價單不會出現這項',
    hkdSubtotal: 'HKD$小計',
    duplicateItem: '複製這項',
    cutItem: '剪下這項',
    pasteItem: '貼上',
    openLinkedProduct: '查看或修改這件產品',
    createLinkedProduct: '用這項報價建立產品資料',
    valueServiceDesc: '增值服務說明',
    valueServicePlaceholder: '輸入額外增值服務（例如：清拆、拆裝舊家私等）...',
    defaultValueServiceName: '運輸安裝費用 (包含清理傢俬包裝垃圾)',
    priceMultiplier: '單價規則：成本倍率',
    priceMultiplierHint: '用港幣成本（沒有就用人民幣成本）乘這個倍數，四捨五入後填入單價。標題和增值服務不會改。',
    apply: '套用',
    grandTotal: '合計',
    deliverySection: '訂單確認及交付細節',
    termsSection: '條款及付款',
    editTerms: '編輯條款',
    doneEditTerms: '完成編輯',
    installFeeSectionHint: '這列會出現在給客戶的報價單上',
    quoteInfo: '報價資訊',
    quoteNo: '報價單號',
    pic: '負責人',
    quoteDate: '日期',
    validityDays: '報價有效期 (天)',
    deliveryAddress: '送貨地址',
    deliveryAddressPlaceholder: '請輸入送貨地址',
  },
  en: {
    editorTitle: 'Quotation Draft Editor',
    currentVersion: 'Current version',
    nextReviewVersion: 'Next review version',
    basicInfo: 'Basic Information',
    feesAndTotal: 'Fees & Total',
    quotePhotos: 'Quotation Images',
    versionAndOutput: 'Versions & Output',
    back: 'Back',
    selectFactory: 'Select supplier',
    searchFactory: 'Search suppliers…',
    noFactory: 'No suppliers found',
    loading: 'Loading…',
    productNamePlaceholder: 'Product name',
    previewPdf: 'Preview PDF',
    generateQrLink: 'Generate QR & Link',
    confirm: 'Confirm',
    cancel: 'Cancel',
    saveDraft: 'Save Current Version',
    autoSaving: 'Auto-saving…',
    autoSavedAt: 'Auto-saved',
    autoSaveHint: 'Saves what you see now, without opening a new version. The first save becomes version 1.',
    autoSaveFailed: 'Auto-save failed. Use Save Current Version.',
    versionReview: 'Version Review',
    langToggle: '中',
    quoteContent: 'Quotation Content',
    addSectionTitle: 'Add Title',
    addField: 'New Field',
    addValueService: 'Value-added Service',
    addProduct: 'Add Product',
    copyFromOtherQuote: 'Copy from another quote',
    copyFromOtherQuoteTitle: 'Copy items from another quote',
    copyFromOtherQuoteHint:
      'Pick a proposal, then a version. Tick the items you want — they are added at the top of this quote.',
    copyFromOtherQuoteName: 'Proposal name',
    copyFromOtherQuoteVersion: 'Version',
    copyFromOtherQuoteAdd: 'Add',
    copyFromOtherQuoteAddSelected: 'Add selected',
    copyFromOtherQuoteEmpty: 'This version has no quote lines',
    copyFromOtherQuotePickName: 'Select a proposal name first',
    copyFromOtherQuotePickVersion: 'Select a version',
    copyFromOtherQuoteLoading: 'Loading…',
    copyFromOtherQuoteSearch: 'Search proposal name',
    copyFromOtherQuoteSuccess: 'Copied to the top of this quote',
    copyFromOtherQuoteClose: 'Close',
    sectionTitleLabel: 'Section Title',
    sectionTitlePlaceholder: 'e.g. Open Area, Lounge…',
    zoneAddItemAbove: 'Add item above',
    zoneAddItemBelow: 'Add item below',
    zoneItemCount: '{n} item(s) added',
    zoneEmptyHint: 'No items yet',
    uploadFloorPlan: 'Upload floor plan',
    replaceFloorPlan: 'Replace floor plan',
    manageZones: 'Manage zones',
    addZoneSpace: 'Add space',
    noZonesYet: 'No zones yet',
    manageZonesHint: 'Edit the space name, type, and quantity, or remove a zone. Furniture in a removed zone goes back to No zone.',
    dropFloorPlan: 'Drop the floor plan here, or click',
    dropFloorPlanAction: 'Upload',
    zoneSpaceName: 'Space name',
    zoneNameEn: 'English name',
    zoneSpaceType: 'Type',
    zoneQuantity: 'Qty',
    zoneSpaceNamePlaceholder: 'e.g. Reception',
    zoneNameEnPlaceholder: 'Reception',
    zoneSpaceTypePlaceholder: 'e.g. Meeting room / Workspace',
    recognizingZones: 'Detecting…',
    recognizingZonesDetail: 'Reading room names on the floor plan. Adjust the areas here when it finishes.',
    uploadFloorPlanRecognize: 'Upload floor plan to detect',
    reuploadFloorPlanRecognize: 'Upload again and detect',
    floorPlanRecognizeHint: 'Draw a box on an empty part of the plan to add a room. You can move it, resize it, or delete it; the copy button at the top-left adds a second area to the same space. It joins the quote after you confirm.',
    floorPlanReconfirmHint: 'The floor plan changed. Adjust the areas on the new drawing, then confirm.',
    zoneUnboxedHint: '{n} zone(s) have no area yet. Drag a box over them on the floor plan.',
    zoneBoxed: 'Area marked',
    zoneUnboxed: 'No area yet',
    uploadingFloorPlan: 'Uploading…',
    itemZone: 'Zone',
    unzoned: 'No zone',
    addZoneHere: 'Add zone before this',
    uploadZoneImage: 'Upload image',
    removeZoneImage: 'Remove zone image',
    reviewDetectedZones: 'Confirm detected zones',
    reviewDetectedZonesHint: 'Rename rooms, or untick ones you do not need. After you confirm, they appear at the top. Use the menu in front of each item to place it.',
    category: 'Category',
    level1Category: 'Level 1 category',
    level2Category: 'Level 2 category',
    productCategoryLockedHint: 'Linked to a product. The category follows the product catalogue and cannot be changed here.',
    dimensionsMm: 'Dimensions (mm),',
    dimLwh: 'L x W x H',
    dimDh: 'Dia x H',
    color: 'Color',
    material: 'Materials & Details',
    quantity: 'Qty',
    factory: 'Supplier',
    sku: 'SKU',
    skuHint: 'Product code. Visible while editing only — it does not appear on the customer quotation.',
    cnyCost: 'CNY¥ Cost Price',
    exchangeRate: 'Exchange Rate',
    unifyExchangeRate: 'Exchange Rate',
    /** Button label after clicking 統一匯率 / Exchange Rate. */
    unifyExchangeRateApplied: 'Apply to all',
    unifyRateHint:
      'Enter a rate and every product’s cost and Hong Kong dollar amounts are recalculated together.',
    unifyRateScope: 'Applies to {n} products',
    unifyRateTodayLoaded: "Filled with today's rate (CNY to HKD)",
    unifyRateTodayLoading: "Fetching today's rate…",
    hkdCost: 'HKD$ Cost Price',
    hkdCostAmount: 'HKD$ Cost',
    unit: 'Unit',
    remarks: 'Remarks',
    image: 'Image',
    referenceImage: 'Reference Image',
    hkdUnitPrice: 'HKD$ Unit Price',
    optionalProduct: 'Optional',
    hideInPdf: 'Hide in PDF',
    hideInPdfOn: 'Hidden from the customer. You can still see it while editing.',
    hideInPdfOff: 'Tick this to leave the item off the customer quotation.',
    hkdSubtotal: 'HKD$ Subtotal',
    duplicateItem: 'Copy this item',
    cutItem: 'Cut this item',
    pasteItem: 'Paste',
    openLinkedProduct: 'View or edit this product',
    createLinkedProduct: 'Create a product from this item',
    valueServiceDesc: 'Value-added Service Description',
    valueServicePlaceholder:
      'Enter additional value-added services (e.g. dismantling, removal of old furniture)...',
    defaultValueServiceName:
      'Furniture Installation (Fee Installation of furniture items listed in the order and disposal of all packaging waste)',
    priceMultiplier: 'Unit Price Rule: Cost Multiplier',
    priceMultiplierHint: 'Multiplies the Hong Kong dollar cost (or the renminbi cost if there is none) and rounds it into the unit price. Titles and value-added services are left as they are.',
    apply: 'Apply',
    grandTotal: 'Total',
    deliverySection: 'Order Confirmation and Delivery Details',
    termsSection: 'TERMS AND CONDITIONS',
    editTerms: 'Edit Terms',
    doneEditTerms: 'Done',
    installFeeSectionHint: 'This row appears on the customer quotation',
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
    zoneSubtotal: '小計',
    zoneSummary: '分區總表',
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
    itemContinued: '（續）',
    grandTotal: '總金額',
    deliveryTitle: '<訂單確認及交付細節>',
    termsTitle: '條款及付款',
    customerAcceptance: '客戶確認',
    customerSignLabel: '客戶授權人姓名及簽名',
    dateOfSignature: '簽署日期:',
    modalTitle: '報價單預覽',
    modalSubtitle: 'PDF Preview — A4 Format',
    downloadPdf: '下載 PDF',
    addCnyTotal: '加入CNY總價',
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
    zoneSubtotal: 'subtotal',
    zoneSummary: 'Zone summary',
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
    itemContinued: '(continued)',
    grandTotal: 'Grand Total',
    deliveryTitle: '<Order Confirmation and Delivery Details>',
    termsTitle: 'TERMS AND CONDITIONS',
    customerAcceptance: 'CUSTOMER ACCEPTANCE',
    customerSignLabel: 'Customer Authorised Person – Name and Signature',
    dateOfSignature: 'Date of Signature:',
    modalTitle: 'Quotation Preview',
    modalSubtitle: 'PDF Preview — A4 Format',
    downloadPdf: 'Download PDF',
    addCnyTotal: 'Add CNY Total',
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

/** Display-only localization; switching languages never rewrites stored units. */
export function quoteUnitLabel(value: string | undefined, locale: QuoteLocale): string {
  if (locale !== 'en' || !value) return value || '';
  const units: Record<string, string> = { '張': 'pc', '個': 'pc', '件': 'pc', '隻': 'pc', '把': 'pc', '支': 'pc', '套': 'set', '組': 'set', '米': 'm', '平方米': 'm²', '平方呎': 'sq ft', '項': 'item', '次': 'time' };
  return units[value.trim()] || value;
}
