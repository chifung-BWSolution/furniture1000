/**
 * 成功案例 › 案例集 PDF（PRD：docs/prd/成功案例-PRD.md F-CASE-004）。
 *
 * - 復用報價單 PDF 的字體載入管線（QuotationPDFPreview.ensureQuotationPdfModule）。
 * - 相片先抓取並壓成 JPEG dataURL（與入選一致，不靜默截斷），避免 PDF 過大或 CORS 問題。
 * - 版面刻意簡單：封面（標題＋合作品牌 Logo 牆）→ 逐案例（標題、說明、PM 可選、相片格）。
 * - 內容一律來自 CaseExportItem（結構上已脫敏，見 caseExport.ts）。
 */

import { ensureQuotationPdfModule } from '@/components/dashboard/QuotationPDFPreview';
import { safeCaseDate } from '@/lib/caseShowcasePublish';
import type { CaseExportItem } from '@/lib/caseExport';

const PHOTO_MAX_WIDTH_PX = 1200;
const PHOTO_JPEG_QUALITY = 0.82;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

/** 抓取圖片並壓成 JPEG dataURL；失敗回 null（跳過，不中斷導出）。 */
async function fetchImageForPdf(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      mode: 'cors',
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, PHOTO_MAX_WIDTH_PX / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
    return dataUrl.startsWith('data:image/jpeg') ? dataUrl : null;
  } catch {
    return null;
  }
}

async function fetchAllForPdf(urls: string[]): Promise<(string | null)[]> {
  return Promise.all(urls.map(fetchImageForPdf));
}

export type CaseShowcasePdfResult = {
  blob: Blob;
  /** 入選但抓取／解碼失敗的相片／Logo 數量（AC-004-6）。 */
  failedImageCount: number;
  /** 入選相片總數（含失敗）。 */
  requestedPhotoCount: number;
};

/**
 * 生成案例集 PDF。
 * 相片／Logo 抓取失敗會計入 failedImageCount；呼叫端必須據此提示，不得只報成功。
 * 入選相片全部寫入（不靜默截斷；AC-004-3）。
 */
export async function buildCaseShowcasePdf(
  items: CaseExportItem[],
  onProgress?: (message: string) => void,
): Promise<CaseShowcasePdfResult> {
  onProgress?.('載入 PDF 字體…');
  const P = await ensureQuotationPdfModule();

  const photoItems = items.filter(
    (item) => item.kind === 'photo' && (item.photos || []).some((p) => p.include),
  );
  const orderItems = items.filter(
    (item) => item.kind === 'order' && item.orders?.length,
  );
  const orderPhotoItems = orderItems.filter((item) =>
    (item.photos || []).some((p) => p.include),
  );
  const brandItems = items.filter((item) => item.kind === 'brand' && item.brand);

  onProgress?.('下載完工相片…');
  let failedImageCount = 0;
  let requestedPhotoCount = 0;
  const fetchIncludedPhotos = async (item: CaseExportItem) => {
    const urls = (item.photos || []).filter((p) => p.include).map((p) => p.url);
    requestedPhotoCount += urls.length;
    const fetched = await fetchAllForPdf(urls);
    const photos = fetched.filter((url): url is string => Boolean(url));
    failedImageCount += fetched.length - photos.length;
    return photos;
  };
  const photoAlbums = await Promise.all(
    photoItems.map(async (item) => ({
      item,
      photos: await fetchIncludedPhotos(item),
    })),
  );
  const orderAlbums = await Promise.all(
    orderPhotoItems.map(async (item) => ({
      item,
      photos: await fetchIncludedPhotos(item),
    })),
  );

  onProgress?.('下載客戶 Logo…');
  const brandLogos = await Promise.all(
    brandItems.map(async (item) => {
      const logoUrl = item.brand!.branding_icon || '';
      if (!logoUrl) return { item, logo: null as string | null };
      const logo = await fetchImageForPdf(logoUrl);
      if (!logo) failedImageCount += 1;
      return { item, logo };
    }),
  );

  onProgress?.('排版生成 PDF…');
  const { Document, Page, Text, View, Image, StyleSheet } = P;
  const styles = StyleSheet.create({
    page: {
      padding: 36,
      fontSize: 10,
      fontFamily: ['NotoSansTC', 'NotoSansHK'] as unknown as string,
      color: '#1c1917',
    },
    coverTitle: {
      fontSize: 22,
      fontWeight: 700,
      marginTop: 24,
    },
    coverMeta: {
      fontSize: 10,
      color: '#78716c',
      marginTop: 10,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: 700,
      marginTop: 20,
      marginBottom: 8,
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: '#e7e5e4',
    },
    logoWall: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    logoCell: {
      width: '23%',
      height: 52,
      padding: 8,
      borderWidth: 1,
      borderColor: '#e7e5e4',
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logo: {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
    },
    caseTitle: {
      fontSize: 12,
      fontWeight: 700,
      marginTop: 10,
    },
    caseNote: {
      fontSize: 9.5,
      color: '#57534e',
      marginTop: 3,
      lineHeight: 1.5,
    },
    casePm: {
      fontSize: 9,
      color: '#78716c',
      marginTop: 3,
    },
    caseStats: {
      fontSize: 9,
      color: '#78716c',
      marginTop: 3,
    },
    photoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 6,
      marginBottom: 10,
    },
    photo: {
      width: '31%',
      aspectRatio: 1.4,
      borderRadius: 4,
      backgroundColor: '#f5f5f4',
    },
    table: {
      marginTop: 6,
      borderWidth: 1,
      borderColor: '#e7e5e4',
      borderRadius: 4,
      overflow: 'hidden',
    },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: '#f0efee',
    },
    tableHeaderRow: {
      flexDirection: 'row',
      backgroundColor: '#f5f5f4',
    },
    tableHeaderText: {
      fontSize: 8.5,
      fontWeight: 700,
      color: '#57534e',
      paddingVertical: 4,
      paddingHorizontal: 5,
    },
    tableCellText: {
      fontSize: 8.5,
      color: '#44403c',
      paddingVertical: 4,
      paddingHorizontal: 5,
    },
  });

  const today = new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const elements: JSX.Element[] = [];

  // 封面
  elements.push(
    <Text key="cover-title" style={styles.coverTitle}>
      成功案例集
    </Text>,
    <Text key="cover-meta" style={styles.coverMeta}>
      {today}　·　B&W Furniture
    </Text>,
  );

  const withLogos = brandLogos.filter((b) => b.logo);
  if (withLogos.length) {
    elements.push(
      <Text key="brand-heading" style={styles.sectionTitle}>
        合作品牌
      </Text>,
      <View key="brand-wall" style={styles.logoWall} wrap>
        {withLogos.map((b) => (
          <View key={b.item.key} style={styles.logoCell}>
            <Image style={styles.logo} src={b.logo!} />
          </View>
        ))}
      </View>,
    );
  }

  // 完工相片案例
  for (const album of photoAlbums) {
    const item = album.item;
    elements.push(
      <View key={`case-${item.key}`} wrap={false}>
        <Text style={styles.caseTitle}>{item.title}</Text>
        {item.note ? <Text style={styles.caseNote}>{item.note}</Text> : null}
        {item.showPm && item.photoProject?.pm_name ? (
          <Text style={styles.casePm}>PM：{item.photoProject.pm_name}</Text>
        ) : null}
        {item.showDates && item.photoProject?.handover_date
          ? (() => {
              const d = safeCaseDate(item.photoProject.handover_date);
              return d ? <Text style={styles.casePm}>交付日期：{d}</Text> : null;
            })()
          : null}
      </View>,
    );
    if (album.photos.length) {
      elements.push(
        <View key={`photos-${item.key}`} style={styles.photoGrid} wrap>
          {album.photos.map((src, index) => (
            <Image key={`${item.key}-${index}`} style={styles.photo} src={src} />
          ))}
        </View>,
      );
    }
  }

  // 訂單數據案例：產品明細表＋完工相片
  for (const item of orderItems) {
    const quantities = item.orders!
      .map((o) => o.quantity)
      .filter((q): q is number => q !== null);
    const totalQuantity = quantities.length
      ? quantities.reduce((sum, n) => sum + n, 0)
      : null;
    const album = orderAlbums.find((a) => a.item.key === item.key);
    const productCols = [
      { key: 'name', label: '產品', width: '34%' },
      { key: 'type', label: '類型', width: '15%' },
      { key: 'qty', label: '數量', width: '8%' },
      { key: 'status', label: '訂單狀態', width: '17%' },
      { key: 'arrival', label: '預計到場', width: '13%' },
      { key: 'install', label: '預計安裝', width: '13%' },
    ];
    elements.push(
      <View key={`order-${item.key}`} wrap={false}>
        <Text style={styles.caseTitle}>{item.title}</Text>
        {item.note ? <Text style={styles.caseNote}>{item.note}</Text> : null}
        {item.showPm && item.orders![0]?.pm_name ? (
          <Text style={styles.casePm}>PM：{item.orders![0].pm_name}</Text>
        ) : null}
        <Text style={styles.caseStats}>
          產品 {item.orders!.length} 項
          {totalQuantity !== null ? `　·　總數量 ${totalQuantity}` : ''}
        </Text>
        <View style={styles.table}>
          <View style={[styles.tableHeaderRow, styles.tableRow]}>
            {productCols.map((col) => (
              <Text
                key={col.key}
                style={[styles.tableHeaderText, { width: col.width }]}
              >
                {col.label}
              </Text>
            ))}
          </View>
          {item.orders!.map((o, index) => (
            <View
              key={o.id}
              style={[
                styles.tableRow,
                index === item.orders!.length - 1
                  ? { borderBottomWidth: 0 }
                  : null,
              ]}
            >
              <Text style={[styles.tableCellText, { width: '34%' }]}>
                {o.product_name || '—'}
              </Text>
              <Text style={[styles.tableCellText, { width: '15%' }]}>
                {o.product_type || '—'}
              </Text>
              <Text style={[styles.tableCellText, { width: '8%' }]}>
                {o.quantity ?? '—'}
              </Text>
              <Text style={[styles.tableCellText, { width: '17%' }]}>
                {o.status || '—'}
              </Text>
              <Text style={[styles.tableCellText, { width: '13%' }]}>
                {item.showDates ? safeCaseDate(o.est_delivery_date) || '—' : '—'}
              </Text>
              <Text style={[styles.tableCellText, { width: '13%' }]}>
                {item.showDates ? safeCaseDate(o.est_installation_date) || '—' : '—'}
              </Text>
            </View>
          ))}
        </View>
        {album && album.photos.length ? (
          <View style={styles.photoGrid} wrap>
            {album.photos.map((src, index) => (
              <Image
                key={`${item.key}-${index}`}
                style={styles.photo}
                src={src}
              />
            ))}
          </View>
        ) : null}
      </View>,
    );
  }

  const doc = (
    <Document
      title="成功案例集"
      author="B&W Furniture"
    >
      <Page size="A4" style={styles.page}>
        {elements}
      </Page>
    </Document>
  );

  const blob = await P.pdf(doc).toBlob();
  return { blob, failedImageCount, requestedPhotoCount };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
