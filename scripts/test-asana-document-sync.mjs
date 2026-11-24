import assert from 'node:assert/strict';
import {
  buildAsanaStoragePath,
  classifyAsanaDocType,
  decideAsanaAttachment,
  extractAsanaDocumentYear,
  extractDocExt,
  normalizeAttachmentSeriesKey,
  selectLatestVersionPerYear,
} from '../supabase/functions/_shared/asanaDocumentFilter.ts';

// 1. Extension extraction
assert.equal(extractDocExt('卓力家具产品报价2026-3-26.pdf'), 'pdf');
assert.equal(extractDocExt('舒乐活办公椅系列报价202505.XLSX'), 'xlsx');
assert.equal(extractDocExt('price_list.xls'), 'xls');
assert.equal(extractDocExt('WhatsApp Image.jpeg'), null);
assert.equal(extractDocExt('photo.png'), null);
assert.equal(extractDocExt('spec.docx'), null);

// 2. Doc type classification
assert.equal(classifyAsanaDocType('卓力家具产品报价2026-3-26.pdf', 'pdf'), 'quote');
assert.equal(classifyAsanaDocType('舒乐活目录0609.pdf', 'pdf'), 'catalog');
assert.equal(classifyAsanaDocType('超晶石 微晶石电子图册231006.pdf', 'pdf'), 'catalog');
assert.equal(classifyAsanaDocType('创美画册2025.3(1).pdf', 'pdf'), 'catalog');
assert.equal(classifyAsanaDocType('椅子产品资料.pdf', 'pdf'), 'catalog');
assert.equal(classifyAsanaDocType('优博综合册 电子版 .pdf', 'pdf'), 'catalog');
assert.equal(classifyAsanaDocType('Ceiling series - Burgeree.pdf', 'pdf'), 'catalog');
assert.equal(classifyAsanaDocType('合创 电子色卡 .pdf', 'pdf'), 'catalog');
assert.equal(classifyAsanaDocType('MC折页.pdf', 'pdf'), 'catalog');
assert.equal(classifyAsanaDocType('2025报价表V0520更新新品价格.pdf', 'pdf'), 'quote');
assert.equal(classifyAsanaDocType('舒乐活目录2025.xlsx', 'xlsx'), 'quote'); // Excel always quote

// 3. Attachment decision (ignore images & external hosts, skip >200MB, stream >60MB PDF)
assert.deepEqual(
  decideAsanaAttachment({ gid: '1', name: 'chair.jpg', host: 'asana', size: 12000 }),
  { action: 'ignore', reason: 'unsupported_ext' },
);
assert.deepEqual(
  decideAsanaAttachment({ gid: '2', name: 'quote.pdf', host: 'gdrive', size: 12000 }),
  { action: 'ignore', reason: 'external_host' },
);
const bigSkip = decideAsanaAttachment({ gid: '3', name: 'huge.pdf', host: 'asana', size: 220 * 1024 * 1024 });
assert.equal(bigSkip.action, 'skip');
assert.equal(bigSkip.reason, 'oversized');

const streamPdf = decideAsanaAttachment({ gid: '4', name: '2025报价表.pdf', host: 'asana', size: 92 * 1024 * 1024 });
assert.equal(streamPdf.action, 'sync');
assert.equal(streamPdf.streamUpload, true);
assert.equal(streamPdf.docType, 'quote');

const smallExcel = decideAsanaAttachment({ gid: '5', name: '报价202505.xlsx', host: 'asana', size: 17 * 1024 * 1024 });
assert.equal(smallExcel.action, 'sync');
assert.equal(smallExcel.streamUpload, false);
assert.equal(smallExcel.ext, 'xlsx');

// 4. Year extraction
assert.equal(extractAsanaDocumentYear('卓力家具产品报价2026-3-26.pdf', '2025-12-01T00:00:00Z'), 2026);
assert.equal(extractAsanaDocumentYear('舒乐活办公椅系列报价202505.xlsx', '2026-01-05T00:00:00Z'), 2025);
assert.equal(extractAsanaDocumentYear('椅子产品资料.pdf', '2024-08-10T00:00:00Z'), 2024);

// 5. Same factory + same year + same series keeps ONLY latest version, while distinct series coexist
const candidates = [
  { att: { gid: '103', name: '2026报价單-v3.pdf', created_at: '2026-09-01T00:00:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '102', name: '2026报价單-v2.pdf', created_at: '2026-06-01T00:00:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '101', name: '2026报价單-v1.pdf', created_at: '2026-03-01T00:00:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '201', name: '2026圖冊.pdf', created_at: '2026-05-01T00:00:00Z' }, docType: 'catalog', year: 2026 },
  { att: { gid: '202', name: '大理石面花色(2).pdf', created_at: '2026-09-30T07:35:00Z' }, docType: 'catalog', year: 2026 },
  { att: { gid: '203', name: '超晶石 微晶石电子图册231006(2).pdf', created_at: '2026-09-30T07:41:00Z' }, docType: 'catalog', year: 2026 },
  { att: { gid: '301', name: '2025报价單.pdf', created_at: '2025-11-01T00:00:00Z' }, docType: 'quote', year: 2025 },
];
const { latest, superseded } = selectLatestVersionPerYear(candidates);
assert.deepEqual(latest.map((x) => x.att.gid), ['103', '201', '202', '203', '301']);
assert.deepEqual(superseded.map((x) => x.att.gid), ['102', '101']);

// 5b. Duplicate copy / revision of same document still supersedes older copy
const copyGroup = selectLatestVersionPerYear([
  { att: { gid: '602', name: '報價單 BWF-PP26-034-R1 (1).pdf', created_at: '2026-09-28T01:39:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '601', name: '報價單 BWF-PP26-034-R1.pdf', created_at: '2026-09-24T12:16:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '603', name: '天璽天2座41樓FD 20260730.pdf', created_at: '2026-07-31T03:58:00Z' }, docType: 'quote', year: 2026 },
]);
assert.deepEqual(copyGroup.latest.map((x) => x.att.gid), ['602', '603']);
assert.deepEqual(copyGroup.superseded.map((x) => x.att.gid), ['601']);

// 5c. Series key normalization strips copy/date/version tokens cleanly
assert.equal(normalizeAttachmentSeriesKey('卓然系列产品介绍2026-3-23.pdf'), '卓然系列产品介绍');
assert.equal(normalizeAttachmentSeriesKey('宾悦系列产品介绍2026-3-26.pdf'), '宾悦系列产品介绍');
assert.equal(normalizeAttachmentSeriesKey('東泰鋼2021最新圖冊(2).pdf'), normalizeAttachmentSeriesKey('東泰鋼2021最新圖冊.pdf'));

// 6. Storage path builder
assert.equal(
  buildAsanaStoragePath({ factoryId: 'abc-123', docType: 'quote', ext: 'xlsx', contentHash: 'deadbeef', attachmentGid: '999' }),
  'abc-123/quote/deadbeef.xlsx',
);
assert.equal(
  buildAsanaStoragePath({ factoryId: 'abc-123', docType: 'quote', ext: 'pdf', contentHash: null, attachmentGid: '999' }),
  'abc-123/quote/asana_999.pdf',
);

console.log('OK: all Asana document sync unit tests passed.');
