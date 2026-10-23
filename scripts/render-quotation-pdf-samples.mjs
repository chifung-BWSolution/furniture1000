/**
 * 產生報價單 PDF 樣本（2／5／10／30 個 Item、各種圖片版式），
 * 用於人工與自動驗收（PRD 9.1–9.3）。
 *
 * 執行：node scripts/render-quotation-pdf-samples.mjs
 * 產出：tmp/pdf-sample/*.pdf（含左側版面文字檢查報告）
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { build } from 'esbuild';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'tmp', 'pdf-sample');
const IMG_DIR = path.join(OUT_DIR, 'images');

// ─── 1. 產生不同比例的測試圖片（純色 PNG，免額外依賴）─────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePng(filePath, width, height, rgb, accent) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const border = x < 6 || y < 6 || x > width - 7 || y > height - 7;
      const line = Math.abs(y - height / 2) < 3;
      const color = border || line ? accent : rgb;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
  // react-pdf 在 node 只認 data URI／可 fetch 的網址，樣本一律用 data URI。
  return `data:image/png;base64,${png.toString('base64')}`;
}

fs.mkdirSync(IMG_DIR, { recursive: true });

const photo = (name, width, height, rgb, accent) => ({
  url: makePng(path.join(IMG_DIR, `${name}.png`), width, height, rgb, accent),
  width,
  height,
});

const IMAGES = {
  landscape: photo('landscape', 1600, 900, [200, 184, 166], [120, 104, 92]),
  portrait: photo('portrait', 900, 1600, [185, 196, 204], [110, 122, 132]),
  square: photo('square', 1200, 1200, [217, 199, 168], [120, 104, 92]),
  wide: photo('wide', 2000, 500, [206, 214, 208], [110, 122, 132]),
  drawing: photo('drawing', 1000, 1400, [226, 228, 232], [90, 96, 104]),
};

const LOGO_DATA_URI = `data:image/png;base64,${fs
  .readFileSync(path.join(ROOT, 'public/assets/bwf-logo.png'))
  .toString('base64')}`;

// ─── 2. 產生樣本資料 ────────────────────────────────────────────────────────

const MATERIAL_LONG = [
  '• Top panel with tempered glass, thickness 8mm',
  '• 2 adjustable shelves with anti-scratch coating',
  '• Frame in matte dark bronze aluminium profiles',
  '• Drawer materials: birch plywood with soft-close slides, 4 nos',
  '• A wooden back panel is fixed in birch plywood 18mm',
  '• 4 pcs of castors give 40mm height, 2 pcs with brake',
  '• Units are flexible to join with linking device hidden',
  '• Cut-outs for socket boxes are included',
  '• Full installation at site by our team, including assembly, casting, fitting',
  '• 保養：結構五年、五金兩年，非人為損壞免費更換',
].join('\n');

const MATERIAL_SHORT = [
  '• E0 grade melamine board with wood grain finish',
  '• 25mm thick table top with 2mm PVC edge banding',
  '• 2 lockable drawers with central locking',
  '• Steel legs made of 60x30mm tubing, 1.5mm wall thickness',
].join('\n');

function makeItem(index, options = {}) {
  const {
    name = `產品 ${index}`,
    category = 'Storage / Display',
    material = MATERIAL_SHORT,
    images = [],
    quantity = 2,
    unitPrice = 4800,
    color = 'SaddleBrown,Black',
    dims = [1600, 450, 1800],
    isOptional = false,
    remarks,
  } = options;
  return {
    image: '',
    referenceImage: '',
    images: images.map((entry) => ({ url: entry.url, width: entry.width, height: entry.height })),
    remarks: remarks || '',
    name,
    category,
    material,
    color,
    quantity,
    unitPrice,
    unit: 'set',
    dimensionLMm: dims[0],
    dimensionWMm: dims[1],
    dimensionHMm: dims[2],
    dimensionMode: 'lwh',
    isOptional,
  };
}

function makeData(itemCount) {
  const variants = [
    { name: '展示櫃 Display unit for posters', images: [IMAGES.landscape, IMAGES.portrait, IMAGES.square], material: MATERIAL_LONG, unitPrice: 4980 },
    { name: '會語桌 Meeting table', images: [IMAGES.landscape, IMAGES.wide], material: MATERIAL_SHORT, unitPrice: 3900 },
    { name: '收納櫃 Storage cabinet', images: [IMAGES.portrait, IMAGES.portrait], material: MATERIAL_SHORT, unitPrice: 2800 },
    { name: '接待櫃 Reception counter', images: [IMAGES.landscape, IMAGES.portrait], material: MATERIAL_LONG, unitPrice: 5800 },
    { name: '展示牆 Display wall panel', images: [IMAGES.square], material: MATERIAL_SHORT, unitPrice: 12000 },
    { name: '高腳展示台 Product display stand', images: [], material: MATERIAL_SHORT, unitPrice: 1550 },
  ];

  const items = [];
  items.push({ name: '開放陳列區', isSectionTitle: true, image: '', unitPrice: 0, quantity: 0 });
  for (let index = 0; index < itemCount; index += 1) {
    const variant = variants[index % variants.length];
    items.push(
      makeItem(index + 1, {
        ...variant,
        quantity: (index % 4) + 1,
        isOptional: index === itemCount - 1 && itemCount > 1,
      }),
    );
  }

  const subtotal = items
    .filter((item) => !item.isSectionTitle && !item.isOptional)
    .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  return {
    companyInfo: {
      name: 'Branding Works Design Ltd',
      address: '香港荃灣青山公路459-469號華力工業中心5字樓D-G室',
      phone: '5163 7535 / 9177 3545',
      email: 'sales@brandingworks-furniture.com',
      website: 'https://www.bwoffice.asia/',
    },
    clientInfo: {
      name: '香港專業教育學院',
      contactName: '甄小玲',
      phone: '3528 2779',
      email: 'client@example.com',
    },
    quoteMeta: {
      projectName: 'BWF-SH26-114',
      pmName: 'Winnie Zhu',
      validity: '30 天',
      deliveryAddress: '新界沙田源禾路 21 號',
      quoteNumber: 'BWF-SH26-114',
      version: 'v7',
      date: '2026-10-23',
    },
    format: {
      showRevisionDate: true,
      showLatestModifiedDate: true,
      revisionDate: '2026-10-23',
      latestModifiedDate: '2026-10-23',
      zoneSubtotalPlacement: 'section_and_summary',
    },
    deliveryDetails:
      '訂單確認後 30 個工作天內送貨及安裝。送貨前兩天會有專人聯絡安排，搬運通道如超過 50 米或需上樓梯，將另行報價。',
    locale: 'zh',
    items,
    subtotal,
    discountNote: '',
    installationFee: { amount: 3000 },
    termsContent: {
      fullHtml: `
        <p><strong>1　交付地址: </strong>新界沙田源禾路 21 號</p>
        <p><strong>2　付款條款</strong></p>
        <p>2.1 訂單確認後支付 50% 訂金，餘款於送貨前支付。</p>
        <p>2.2 所有款項以港幣結算。</p>
        <p><strong>3　運輸及安裝條款</strong></p>
        <p>3.1 報價已包括標準地區的送貨及安裝，偏遠地區另議。</p>
        <p>3.2 如現場環境與圖則不符，須先確認後方可施工。</p>
        <p><strong>4　額外費用</strong></p>
        <p>4.1 清除舊傢俬、拆裝、夜間施工另加費用。</p>
        <p><strong>5　保養及維修</strong></p>
        <p>5.1 結構保養五年，五金配件兩年，非人為損壞免費維修。</p>
        <p><strong>6　其他</strong></p>
        <p>6.1 本報價單有效期 30 天，逾期需重新確認。</p>
      `,
    },
  };
}

// ─── 3. 打包並輸出 PDF ─────────────────────────────────────────────────────

const ENTRY = path.join(OUT_DIR, 'entry.tsx');
fs.writeFileSync(
  ENTRY,
  `
import { Font, renderToFile } from '@react-pdf/renderer';
import { QuotationDocument } from '@/components/dashboard/quotationPdfDocument';
import { makeData } from './sample-data.mjs';

const ROOT = ${JSON.stringify(ROOT)};

Font.register({
  family: 'NotoSansTC',
  fonts: [
    { src: ROOT + '/public/fonts/pdf/NotoSansTC-Regular.ttf', fontWeight: 400 },
    { src: ROOT + '/public/fonts/pdf/NotoSansTC-Bold.ttf', fontWeight: 700 },
  ],
});
Font.register({
  family: 'NotoSansHK',
  fonts: [
    { src: ROOT + '/public/fonts/pdf/NotoSansHK-Fallback-Regular-v1.ttf', fontWeight: 400 },
    { src: ROOT + '/public/fonts/pdf/NotoSansHK-Fallback-Bold-v1.ttf', fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const pdfMod = await import('@react-pdf/renderer');
const logoUrl = ${JSON.stringify(LOGO_DATA_URI)};

for (const count of [2, 5, 10, 30]) {
  const data = makeData(count);
  const file = ROOT + '/tmp/pdf-sample/quotation-' + count + '-items.pdf';
  await renderToFile(
    <QuotationDocument data={data} pdfMod={pdfMod} logoUrl={logoUrl} />,
    file,
  );
  console.log('rendered', file);
}
`,
);

// 樣本資料以 ESM 供 entry 引用（避免 JSX 檔塞入大量資料）
fs.writeFileSync(
  path.join(OUT_DIR, 'sample-data.mjs'),
  [
    `export const MATERIAL_LONG = ${JSON.stringify(MATERIAL_LONG)};`,
    `export const MATERIAL_SHORT = ${JSON.stringify(MATERIAL_SHORT)};`,
    `export const IMAGES = ${JSON.stringify(IMAGES)};`,
    'export ' + makeItem.toString(),
    'export ' + makeData.toString(),
  ].join('\n\n'),
);

await build({
  entryPoints: [ENTRY],
  outfile: path.join(OUT_DIR, 'bundle.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  jsx: 'automatic',
  alias: { '@': path.join(ROOT, 'src') },
  external: ['react', 'react-dom', '@react-pdf/renderer', 'canvas'],
  logLevel: 'warning',
  plugins: [
    {
      // 樣本渲染不需要 Supabase：以最小 stub 取代，保持 quoteFormatSettings 邏輯不變。
      name: 'stub-supabase',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({
          path: 'supabase-stub',
          namespace: 'stub',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const supabase = { from: () => { throw new Error("stub"); } };',
          loader: 'js',
        }));
      },
    },
  ],
});

await import(`file://${path.join(OUT_DIR, 'bundle.mjs').replace(/\\/g, '/')}`);
