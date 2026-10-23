/**
 * 檢查報價單 PDF 樣本：逐頁抽文字 + 追蹤圖片繪製矩形，驗證
 *  - 9 欄表頭是否在續頁重複（關鍵詞與 locale 實際標籤一致）
 *  - 頁尾 Page X / Y、A4 尺寸
 *  - 圖片寬高比是否被保留（不變形、不裁切）
 *  - 佈局多樣性：同一個項目內圖片矩形是否出現堆疊/並排等組合
 *
 * 用法： node scripts/inspect-quotation-pdf.mjs [檔名...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const pdfjs = await import(`file://${pdfjsPath.replace(/\\/g, '/')}`);

const DIR = 'tmp/pdf-sample';
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DIR).filter((f) => f.endsWith('.pdf')).sort();

// 與 quotationLocale.ts 實際標籤一致
const HEADER_KEYS = ['序號', '說明', '規格', '材質及明細', '圖例', '數量', '單位', '單價', '總價'];

// 樣本合成圖的來源比例（scripts/render-quotation-pdf-samples.mjs）
const SOURCE_RATIOS = [
  { name: 'landscape', w: 1600, h: 900 },
  { name: 'portrait', w: 900, h: 1600 },
  { name: 'square', w: 1200, h: 1200 },
  { name: 'wide', w: 2000, h: 500 },
  { name: 'drawing', w: 1000, h: 1400 },
];
const RATIO_TOL = 0.06;

function matchSource(ratio) {
  let best = null;
  let bestDiff = Infinity;
  for (const s of SOURCE_RATIOS) {
    const diff = Math.abs(ratio - s.w / s.h) / (s.w / s.h);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s.name;
    }
  }
  return { name: best, ok: bestDiff <= RATIO_TOL, diff: bestDiff };
}

/** 追蹤 CTM，回傳每張圖的繪製矩形（PDF 使用者空間，y 向上） */
async function collectImageRects(page) {
  const ops = await page.getOperatorList();
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const rects = [];
  const compose = (m1, m2) => [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === pdfjs.OPS.save) {
      stack.push(ctm);
    } else if (fn === pdfjs.OPS.restore) {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (fn === pdfjs.OPS.transform) {
      ctm = compose(args, ctm);
    } else if (
      fn === pdfjs.OPS.paintImageXObject ||
      fn === pdfjs.OPS.paintInlineImageXObject ||
      fn === pdfjs.OPS.paintImageMaskXObject
    ) {
      const w = Math.hypot(ctm[0], ctm[1]);
      const h = Math.hypot(ctm[2], ctm[3]);
      if (w > 4 && h > 4) {
        rects.push({ x: ctm[4], y: ctm[5], w: +w.toFixed(1), h: +h.toFixed(1) });
      }
    }
  }
  return rects;
}

async function inspect(file) {
  const full = path.join(DIR, file);
  const data = new Uint8Array(fs.readFileSync(full));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const rows = new Map();
    for (const t of textContent.items) {
      if (!('str' in t)) continue;
      const str = t.str.trim();
      if (!str) continue;
      const y = Math.round(t.transform[5] * 2) / 2;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: t.transform[4], str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, items]) => ({
        y,
        text: items.sort((a, b) => a.x - b.x).map((it) => it.str).join(' '),
      }));

    const fullText = lines.map((l) => l.text).join('\n');
    const rects = await collectImageRects(page);

    // 判斷每張圖的來源比例
    const analyzed = rects.map((r) => {
      const src = matchSource(r.w / r.h);
      return { ...r, srcName: src.name, ratioOk: src.ok };
    });

    const footerMatch = fullText.match(/Page\s+(\d+)\s*\/\s*(\d+)/i);
    pages.push({
      index: i,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      images: analyzed,
      headerHits: HEADER_KEYS.filter((k) => fullText.includes(k)),
      footer: footerMatch ? footerMatch[0] : null,
      pageNo: footerMatch ? Number(footerMatch[1]) : null,
      totalNo: footerMatch ? Number(footerMatch[2]) : null,
      hasTotals: /合計|總金額/.test(fullText),
      hasTerms: /條款及付款|訂單確認/.test(fullText),
      lineCount: lines.length,
      firstLines: lines.slice(0, 3).map((l) => l.text.slice(0, 70)),
      lastLines: lines.slice(-4).map((l) => l.text.slice(0, 70)),
    });
  }
  await doc.destroy();
  return pages;
}

function groupByRow(images) {
  // 依 y 座標聚成「行」（容差 3pt），行內依 x 排序 → 觀察堆疊 vs 並排
  const sorted = [...images].sort((a, b) => b.y - a.y);
  const rows = [];
  for (const img of sorted) {
    const row = rows.find((r) => Math.abs(r.y - img.y) <= 3);
    if (row) row.items.push(img);
    else rows.push({ y: img.y, items: [img] });
  }
  return rows;
}

const summary = [];
for (const file of files) {
  const pages = await inspect(file);
  console.log(`\n=== ${file} (${pages.length} pages) ===`);
  for (const p of pages) {
    const headerMark = p.headerHits.length === 9 ? '表頭✓9' : p.headerHits.length ? `表頭~${p.headerHits.length}` : '表頭✗';
    console.log(
      `  p${String(p.index).padStart(2)} | ${p.width}x${p.height} | 圖${String(p.images.length).padStart(2)} | ${headerMark} | ${p.footer || '頁碼✗'} | 行${String(p.lineCount).padStart(2)}${p.hasTotals ? ' | 合計✓' : ''}${p.hasTerms ? ' | 條款/簽署✓' : ''}`,
    );
    if (p.images.length) {
      for (const row of groupByRow(p.images)) {
        const desc = row.items
          .sort((a, b) => a.x - b.x)
          .map((im) => `${im.w}x${im.h}@${im.srcName}${im.ratioOk ? '' : '!'}`)
          .join(' + ');
        const tag = row.items.length > 1 ? '  ← 並排' : '';
        console.log(`        y=${Math.round(row.y)}: ${desc}${tag}`);
      }
    }
  }

  const problems = [];
  pages.forEach((p) => {
    if (!p.footer) problems.push(`p${p.index} 缺頁碼`);
    else if (p.pageNo !== p.index) problems.push(`p${p.index} 頁碼序號不符(${p.pageNo})`);
    if (p.totalNo !== pages.length) problems.push(`p${p.index} 總頁數不符`);
    if (p.width !== 595 || p.height !== 842) problems.push(`p${p.index} 尺寸非 A4`);
    p.images.forEach((im) => {
      if (!im.ratioOk) problems.push(`p${p.index} 圖片比例失真(${im.srcName} ${im.w}x${im.h})`);
    });
  });
  if (problems.length) console.log('  ⚠ ' + problems.join('; '));
  else console.log('  ✓ 尺寸/頁碼/總頁數/圖片比例 全部通過');
  summary.push({ file, pages: pages.length, problems });
}

const allBad = summary.flatMap((s) => s.problems);
console.log(`\n=== 總結: ${summary.length} 檔, ${allBad.length} 個問題 ===`);
if (allBad.length) allBad.forEach((p) => console.log('  - ' + p));
else console.log('全部通過 ✓');
