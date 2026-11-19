import type { QuoteLocale } from '@/lib/quotationLocale';

/** English-quotation labels for surfaces that are not in QUOTE_UI. */
export function placementCopy(locale: QuoteLocale) {
  const en = locale === 'en';
  return {
    label: en ? 'Placement' : '擺放位置',
    selected: (count: number) => (en ? `${count} placed` : `已選 ${count} 個位置`),
    pickZone: en ? 'Select a zone first' : '先選擇分區',
    pick: en ? 'Choose placement' : '選擇擺放位置',
    noRegion: en
      ? 'A floor plan is uploaded, but this zone has no marked area yet.'
      : '已有平面圖，但此產品所屬分區尚未框選範圍。',
    noPlan: en ? 'Upload a floor plan that can be previewed first.' : '請先上傳可預覽的平面圖。',
    openZones: en ? 'Open zone manager' : '開啟分區管理',
    title: en ? 'Placement' : '擺放位置',
    description: en
      ? 'Choose where this furniture sits on the floor plan. You can select more than one.'
      : '在平面圖上選擇傢俬的擺放位置，可多選。',
    cancel: en ? 'Cancel' : '取消',
    confirm: en ? 'Confirm placement' : '確認位置',
    currentItem: en ? 'This item' : '當前傢俬',
    viewAll: en ? 'View all selected positions' : '查看全部已選位置',
    drawing: en ? 'Drag on the plan to mark a new position' : '請在平面圖上拖曳框選新位置',
    zoneLimit: (zone: string, limit: number) =>
      en ? `${zone} · up to ${limit}. Facing follows the plan.` : `${zone} · 最多選 ${limit} 件，方向沿用平面圖設定`,
    kindLabel: en ? 'Furniture type' : '選擇傢俬類型',
    cancelDraw: en ? 'Cancel box' : '取消拉框',
    addOne: en ? 'Add a placement' : '新增一件擺放位置',
    selectSame: (count: number) => (en ? `Select the same type (${count})` : `一鍵選擇同類（${count}）`),
    emptyPlan: en
      ? 'This zone has no usable floor plan. Mark the area in Manage zones first.'
      : '此分區尚未有可用平面圖，請先在分區管理框選。',
    newPosition: (index: number) => (en ? `New ${index}` : `新位置 ${index}`),
    remove: (name: string) => (en ? `Remove ${name}` : `移除 ${name}`),
    occupied: en ? ' (already paired)' : '（已配對其他產品）',
    planAlt: (name: string) => (en ? `${name} floor plan` : `${name}分區平面圖`),
    pickMarker: (label: string, category: string) => (en ? `Select ${label} ${category}` : `選擇${label} ${category}`),
  };
}

export function photoPagesCopy(locale: QuoteLocale) {
  const en = locale === 'en';
  return {
    hint: en
      ? 'Images sit after the total and before order confirmation. Each layout stays on one page and moves to the next page if it does not fit.'
      : '圖片放在總價之後、訂單確認及交付細節之前；每個佈局完整放在同一頁，放不下會移到下一頁。',
    arrange: en ? 'Arrange' : '排版',
    layout: (index: number) => (en ? `Layout ${index}` : `佈局 ${index}`),
    photoCount: (count: number) => (en ? `${count} photo${count === 1 ? '' : 's'}` : `${count} 張`),
    editLayout: (index: number) => (en ? `Edit layout ${index}` : `編輯佈局 ${index}`),
    edit: en ? 'Edit layout' : '編輯佈局',
    moveUpLabel: (index: number) => (en ? `Move layout ${index} up` : `上移佈局 ${index}`),
    moveUp: en ? 'Move up' : '上移',
    moveDownLabel: (index: number) => (en ? `Move layout ${index} down` : `下移佈局 ${index}`),
    moveDown: en ? 'Move down' : '下移',
    deleteLabel: (index: number) => (en ? `Delete layout ${index}` : `刪除佈局 ${index}`),
    delete: en ? 'Delete layout' : '刪除佈局',
    deleteConfirm: en ? 'Delete' : '刪除',
    deleteDescription: (index: number, name: string, count: number) =>
      en
        ? `Remove “Layout ${index} · ${name}” and its ${count} photo placements from this quote. The images stay in the library.`
        : `從這張報價刪除「佈局 ${index}・${name}」及其中 ${count} 張圖片的排版。圖片仍保留在圖片庫。`,
    empty: en ? 'No images yet. Choose a layout.' : '尚未加入圖片，按此選擇佈局',
    add: en ? 'Add layout' : '新增佈局',
    max: (groups: number, photos: number) =>
      en
        ? `A quote can have at most ${groups} layouts and ${photos} photos.`
        : `一張報價最多 ${groups} 個佈局、合計 ${photos} 張圖片`,
  };
}

export function photoLayoutCopy(locale: QuoteLocale) {
  const en = locale === 'en';
  return {
    title: en ? 'Quotation image layout' : '報價單圖片排版',
    filters: {
      all: en ? 'All' : '全部',
      '1': en ? '1' : '1 張',
      '2': en ? '2' : '2 張',
      '3': en ? '3' : '3 張',
      '4+': en ? '4+' : '4 張以上',
    } as Record<'all' | '1' | '2' | '3' | '4+', string>,
    presets: en ? 'Preset layouts' : '預設佈局',
    canvas: en ? 'Canvas' : '排版畫布',
    howShown: en ? 'How this photo shows' : '這張圖怎樣顯示',
    contain: en ? 'Fit' : '完整顯示',
    cover: en ? 'Fill' : '裁滿',
    pickFirst: en ? 'Select a photo on the canvas first' : '先在畫布選取一張圖片',
    layoutProgress: (layout: number, layouts: number, photos: number, maxPhotos: number) =>
      en
        ? `Layout ${layout} / ${layouts} · Photos ${photos} / ${maxPhotos}`
        : `佈局 ${layout} / ${layouts}・圖片 ${photos} / ${maxPhotos}`,
    showCaptions: en ? 'Show captions' : '顯示圖片說明',
    slots: en ? 'Slots' : '格數',
    fillTitle: en ? 'Enter the title and caption below' : '在下面填寫標題和說明',
    chooseLayout: en ? 'Choose a layout on the left' : '先在左邊選擇一個佈局',
    captionOf: (index: number) => (en ? `Caption ${index}` : `圖 ${index} 說明`),
    captionPlaceholder: en ? 'e.g. Lobby entrance' : '例如：大堂入口現況',
    emptySlot: en ? 'No photo in this slot yet' : '這個位置還沒有圖片',
    captionHint: (max: number) =>
      en
        ? `Up to ${max} characters, printed under the photo in two lines. Leave blank for empty space.`
        : `每張最多 ${max} 字，印在圖片下方兩行內；留空只留白。`,
    sideTitle: en ? 'Title' : '標題',
    sideCaption: en ? 'Caption' : '說明',
    sideHint: en ? 'The title and caption print to the right of the photo. Leave blank for empty space.' : '標題和說明印在圖片右邊；留空只留白。',
    tray: en ? 'Photos' : '圖片素材',
    placed: (count: number, max: number) => (en ? `Placed ${count} / ${max}` : `已放 ${count} / ${max}`),
    fromLibrary: en ? 'Add from library' : '從圖片庫加入',
    ai: en ? 'Generate' : 'AI 生成',
    aiDenied: en ? 'Only an admin or uploader can generate images' : '只有管理員或上載員可以生成圖片',
    productReady: (count: number) =>
      en ? `${count} product photos from this quote are already here.` : `報價的 ${count} 張產品圖已預設加入。`,
    uploadHint: en ? 'JPG, PNG or WebP, up to 15 MB each.' : 'JPG、PNG 或 WebP，每張最多 15 MB。',
    loadingSize: en ? 'Loading' : '讀取中',
    aboutRatio: (ratio: string) => (en ? ` · about ${ratio}` : `・約 ${ratio}`),
    used: en ? 'Placed' : '已放入',
    unused: en ? 'Unused' : '未使用',
    product: en ? 'Product' : '產品圖',
    aiRef: en ? 'AI reference' : 'AI 參考圖',
    lowRes: en ? 'Low resolution' : '解析度低',
    lowResTitle: en ? 'This image is not sharp enough and may look soft when printed.' : '這張圖不夠清晰，印出來可能會糊',
    place: en ? 'Place' : '放入',
    placeNamed: (title: string) => (en ? `Place “${title}”` : `放入「${title}」`),
    chooseUpload: en ? 'Choose images to upload' : '選擇圖片上載',
    uploadLimit: (max: number) =>
      en
        ? `Manual uploads have reached the limit of ${max}. Delete unused images to upload more.`
        : `手動上載已達 ${max} 張上限，刪除不再用的圖後可再上載`,
    dropEmpty: en ? 'Click, drop or paste (Ctrl+V) images here, or add them from the library.' : '點擊、拖放或貼上（Ctrl+V）圖片到這裡上載，或從圖片庫加入。',
    dropMore: en ? 'Click, drop or paste (Ctrl+V) images here to upload' : '點擊、拖放或貼上（Ctrl+V）圖片到這裡上載',
    uploadDenied: en ? 'Only an admin or uploader can add images' : '只有管理員或上載員可以新增圖片',
    noLayout: en ? 'No layout selected' : '尚未選擇版面',
    emptySlots: (count: number) => (en ? `${count} empty slots left` : `還有 ${count} 個空位`),
    full: en ? 'Every slot has a photo' : '每個位置都已放入圖片',
    cancel: en ? 'Cancel' : '取消',
    removeFromQuote: en ? 'Remove from quote' : '從報價移除',
    apply: en ? 'Apply to quote' : '套用到報價單',
    libraryNote: en ? 'The photo library could not be loaded. Try again shortly.' : '圖片庫暫時讀不到，請稍後再試。',
    productPhoto: en ? 'Product photo' : '產品圖',
    photo: en ? 'Photo' : '圖片',
    displaced: (count: number) =>
      en
        ? `${count} photos do not fit the new layout and stayed in the tray.`
        : `${count} 張圖片放不下新佈局，已留在素材區。`,
    maxPhotos: (max: number) => (en ? `A quote can have at most ${max} photos` : `一張報價最多 ${max} 張圖片`),
    chooseLayoutFirst: en ? 'Choose a layout first.' : '請先選擇一個佈局。',
    slotsFull: en ? 'Every slot already has a photo. Select the one to replace on the canvas.' : '每個位置都已有圖片。請先在畫布點選要換掉的那一格。',
    uploaded: (count: number) => (en ? `Uploaded ${count} photos` : `已上載 ${count} 張圖片`),
    needOne: en ? 'Place at least one photo before applying.' : '請最少放入一張圖片才套用。',
    slotLabel: (index: number, title: string | null) =>
      en
        ? title
          ? `Slot ${index}: ${title}. Click to crop.`
          : `Slot ${index}: empty. Click to select.`
        : title
          ? `位置 ${index}：${title}，按一下可裁剪`
          : `位置 ${index}：還沒有圖片，按一下可選取`,
    dropPhoto: en ? 'Drop a photo' : '拖入照片',
    removeSlot: (index: number) => (en ? `Remove from slot ${index}` : `移出位置 ${index}`),
    removeSlotTitle: en ? 'Remove from this slot' : '移出這個位置',
    removeSlotConfirm: en ? 'Remove' : '移出',
    removeSlotDescription: (title: string, index: number) =>
      en
        ? `Remove “${title}” from slot ${index}. It stays in the tray until you apply.`
        : `把「${title}」從位置 ${index} 移出。圖片會留在旁邊的素材區，按「套用到報價單」後才會更新。`,
    cropTitle: en ? 'Crop photo' : '裁剪圖片',
    reset: en ? 'Reset' : '重設',
    backToCrop: en ? 'Back to crop' : '返回裁剪',
    compare: en ? 'Compare original' : '原圖對照',
    applyCrop: en ? 'Apply crop' : '套用裁剪',
    imageFailed: en ? 'Could not load the image' : '圖片載入失敗',
    original: en ? 'Original' : '原圖',
    cropHint: (ratio: string) => (en ? `Crop ${ratio} · drag to reposition` : `裁剪 ${ratio}・拖動調整位置`),
    display: en ? 'Display' : '顯示方式',
    cropRatio: en ? 'Crop ratio' : '裁剪比例',
    suggested: en ? 'Suggested' : '建議',
    zoom: en ? 'Zoom' : '縮放',
    zoomOut: en ? 'Zoom out' : '縮小',
    zoomIn: en ? 'Zoom in' : '放大',
    zoomLevel: en ? 'Zoom level' : '縮放比例',
    caption: en ? 'Caption' : '圖片說明',
    captionExample: en ? 'e.g. Lobby entrance' : '例如：大堂入口現況',
    captionPrint: (max: number) => (en ? `Printed under the photo, up to ${max} characters.` : `印在圖片下方，最多 ${max} 字。`),
    captionOff: en ? 'Captions are off for this layout. Turn them on to print this text.' : '這一組未開啟「顯示圖片說明」，開啟後才會印出。',
    cropOverflow: en ? 'Anything outside the frame will not print on the quote.' : '超出框外的部分不會印在報價單上。',
    softPrint: (w: number, h: number) =>
      en ? `This image is not sharp enough (${w}×${h}) and may look soft when printed.` : `這張圖不夠清晰（${w}×${h}），印出來可能會糊。`,
    replaceTitle: en ? 'Replace the photo in this slot?' : '取代這個位置的圖片？',
    replaceDescription: en
      ? 'This slot already has a photo. The current one stays in the tray and is not deleted from the library.'
      : '這個位置已有圖片。放入後，原本那張會留在旁邊的素材區，不會從圖片庫刪除。',
    replace: en ? 'Replace' : '取代',
    emptyTitle: en ? 'Some slots are empty. Apply anyway?' : '還有空位，仍要套用？',
    emptyDescription: (count: number) =>
      en ? `This layout still has ${count} empty slots. They will be blank on the quote.` : `這個版面還有 ${count} 個空位，報價單上會留白。`,
    applyAnyway: en ? 'Apply anyway' : '仍要套用',
    discardTitle: en ? 'Discard unapplied changes?' : '放棄未套用的改動？',
    discardDescription: en ? 'Leaving now will not save this layout onto the quote.' : '離開後，這次排版的改動不會保存到報價單。',
    discard: en ? 'Discard' : '放棄改動',
    libraryTitle: en ? 'Add from library' : '從圖片庫加入',
    libraryDescription: en ? 'Pick uploaded photos to add to the tray. You can also upload new ones here.' : '點選已上載的圖片，再加入素材區。也可以在這裡上載新圖片。',
    uploadNew: en ? 'Upload new photos' : '上載新圖片',
    addSelected: (count: number) => (en ? `Add selected${count > 0 ? ` (${count})` : ''}` : `加入所選${count > 0 ? `（${count}）` : ''}`),
    libraryLoading: en ? 'Loading the photo library…' : '正在讀取圖片庫…',
    libraryEmpty: en ? 'No other photos in the library. Upload some, then add them to the tray.' : '圖片庫沒有其他圖片。可先上載，再加入素材區。',
    unselect: en ? 'Deselect' : '取消選取',
    select: en ? 'Select' : '選取',
    confirm: en ? 'Confirm' : '確定',
  };
}
