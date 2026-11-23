import assert from 'node:assert/strict';
import {
  buildAsanaStoragePath,
  classifyAsanaDocType,
  decideAsanaAttachment,
  extractAsanaDocumentYear,
  extractDocExt,
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

// 5. Same factory + same year + same doc_type keeps ONLY latest version
const candidates = [
  { att: { gid: '103', name: '2026报价單-v3.pdf', created_at: '2026-09-01T00:00:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '102', name: '2026报价單-v2.pdf', created_at: '2026-06-01T00:00:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '101', name: '2026报价單-v1.pdf', created_at: '2026-03-01T00:00:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '201', name: '2026圖冊.pdf', created_at: '2026-05-01T00:00:00Z' }, docType: 'catalog', year: 2026 },
  { att: { gid: '301', name: '2025报价單.pdf', created_at: '2025-11-01T00:00:00Z' }, docType: 'quote', year: 2025 },
];
const { latest, superseded } = selectLatestVersionPerYear(candidates);
assert.deepEqual(latest.map((x) => x.att.gid), ['103', '201', '301']);
assert.deepEqual(superseded.map((x) => x.att.gid), ['102', '101']);

// 5b. Explicitly named quote takes priority over unnamed fallback PDF in same year
const quotePriority = selectLatestVersionPerYear([
  { att: { gid: '502', name: '长河.pdf', created_at: '2026-04-01T00:00:00Z' }, docType: 'quote', year: 2026 },
  { att: { gid: '501', name: '卓力家具产品报价2026-3-26.pdf', created_at: '2026-03-26T00:00:00Z' }, docType: 'quote', year: 2026 },
]);
assert.deepEqual(quotePriority.latest.map((x) => x.att.gid), ['501']);
assert.deepEqual(quotePriority.superseded.map((x) => x.att.gid), ['502']);

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
