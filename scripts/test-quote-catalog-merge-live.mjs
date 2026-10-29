import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, degrees } from 'pdf-lib';

/**
 * FDS-07 圖冊附錄合併（分支實測）：跨頁圖冊的每個附件都要輸出成直向頁。
 *
 * 需要 `.env.local` 的一鍵登入帳號與一份跨頁圖冊（開發分支的「向氏产品图册2026」）。
 * 這支只驗形狀與數量，不截圖；視覺核對用 render 出來的 PNG（見下方 --png）。
 */

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const source = readFileSync('src/lib/quoteCatalogPages.ts', 'utf8');
const start = source.indexOf('export const QUOTE_CATALOG_PAGE_LIMIT');
const end = source.indexOf('export async function listQuoteCatalogs');
assert.ok(start >= 0 && end > start, 'catalog page helpers are present');
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {}, crypto: { randomUUID: () => crypto.randomUUID() } };
sandbox.module = { exports: sandbox.exports };
vm.runInNewContext(code, sandbox);
const M = sandbox.exports;

const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(url, anon, { auth: { persistSession: false } });
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: env.VITE_QUICK_LOGIN_EMAIL,
  password: env.VITE_QUICK_LOGIN_PASSWORD,
});
assert.equal(authError, null, authError?.message);

const { data: catalogs, error: listError } = await supabase.rpc('fds_list_quote_catalogs', { p_query: null });
assert.equal(listError, null, listError?.message);
assert.ok(catalogs.length > 0, '開發庫要有至少一份圖冊');

const fetchPages = async (pages) => {
  const res = await fetch(`${url}/functions/v1/supabase-functions-quote-catalog-pages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.session.access_token}`,
      apikey: anon,
    },
    body: JSON.stringify({ pages }),
  });
  if (!res.ok) {
    throw new Error(`edge ${res.status}: ${await res.text()}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

// 先找一份跨頁圖冊（第一頁寬比高大一截）。
let catalog = null;
let pageSize = null;
for (const row of catalogs) {
  const bytes = await fetchPages([{ documentId: row.id, pageNo: 1 }]);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = doc.getPages()[0];
  const rotation = M.normalizePageRotation(page.getRotation().angle);
  const { width, height } = page.getSize();
  const displayWidth = rotation % 180 === 90 ? height : width;
  const displayHeight = rotation % 180 === 90 ? width : height;
  if (M.isSpreadSize(displayWidth, displayHeight) && row.page_count > 2) {
    catalog = row;
    pageSize = { width, height, rotation, displayWidth, displayHeight };
    break;
  }
}
assert.ok(catalog, '找不到跨頁圖冊可以驗證（開發庫的圖冊要是左右並排版面）');

const pageNo = 2;
const entries = [
  { id: 'left', documentId: catalog.id, pageNo, split: 'left' },
  { id: 'right', documentId: catalog.id, pageNo, split: 'right' },
  { id: 'whole', documentId: catalog.id, pageNo },
  { id: 'framed', documentId: catalog.id, pageNo, crop: { x: 0, y: 0, width: 0.25, height: 0.6 } },
];

const extraBytes = await fetchPages(entries.map((entry) => ({ documentId: entry.documentId, pageNo: entry.pageNo })));
const quote = await PDFDocument.create();
quote.addPage([595.28, 841.89]).drawText('QUOTATION', { x: 60, y: 760, size: 24 });
const base = await PDFDocument.load(await quote.save());
const extra = await PDFDocument.load(extraBytes, { ignoreEncryption: true });
const sources = extra.getPages();

const output = [];
for (let index = 0; index < entries.length; index += 1) {
  const entry = entries[index];
  const src = sources[index];
  const rotation = M.normalizePageRotation(src.getRotation().angle);
  const { width, height } = src.getSize();
  const displayWidth = rotation % 180 === 90 ? height : width;
  const displayHeight = rotation % 180 === 90 ? width : height;
  const pieces = M.catalogPagePieces(entry, displayWidth, displayHeight);
  for (const piece of pieces) {
    const box = M.catalogCropBox(width, height, piece, rotation);
    const embedded = await base.embedPage(src, box);
    const page = base.addPage([embedded.width, embedded.height]);
    page.drawPage(embedded, { x: 0, y: 0 });
    if (rotation !== 0) page.setRotation(degrees(rotation));
    output.push({ entry: entry.id, width: embedded.width, height: embedded.height });
  }
}

// 半頁 ×2 → 2 張、整頁跨頁 → 2 張、框選 → 1 張。
assert.equal(output.length, 5, JSON.stringify(output));
assert.deepEqual(
  output.map((row) => row.entry),
  ['left', 'right', 'whole', 'whole', 'framed'],
);
for (const row of output.filter((item) => item.entry !== 'framed')) {
  assert.ok(row.width < row.height, `${row.entry} 應是直向頁，實際 ${row.width} × ${row.height}`);
}

console.log(
  `PASS 圖冊附錄合併：${catalog.factory_name}「${catalog.title}」第 ${pageNo} 頁 → `
  + output.map((row) => `${row.entry} ${Math.round(row.width)}×${Math.round(row.height)}`).join('、'),
);
