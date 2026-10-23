/**
 * 直接驗證 layoutItemImages：對 PRD §9.1 的每個圖片組合印出 recipe 與 cells。
 * 用法： node scripts/test-quotation-image-layouts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const OUT = 'tmp/pdf-sample/layout-test.mjs';
await esbuild.build({
  entryPoints: ['src/lib/quotationPdfImages.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  logLevel: 'silent',
});
const mod = await import(`file://${path.resolve(OUT).replace(/\\/g, '/')}`);
const { layoutItemImages, classifyImageShape } = mod;

// 與 quotationPdfMetrics.ts 相同的欄寬（zh）：image 欄 18%
const CONTENT_W = 595.276 - 2 * (10 / 25.4 * 72); // 538.58
const IMAGE_COL_W = CONTENT_W * 0.18 - 4; // 減 cell padding，與文件組件一致
const OPTIONS = {
  widthPt: IMAGE_COL_W,
  limits: { gapPt: (1.8 * 72) / 25.4, maxImageHeightPt: (45 * 72) / 25.4 },
};

console.log(
  `image col width ≈ ${IMAGE_COL_W.toFixed(1)}pt, maxImageHeight ≈ ${OPTIONS.limits.maxImageHeightPt.toFixed(1)}pt\n`,
);

const R = {
  landscape: [1600, 900],
  portrait: [900, 1600],
  square: [1200, 1200],
  wide: [2000, 500],
  drawing: [1000, 1400],
};

const cases = [
  ['1 橫', [R.landscape]],
  ['1 直', [R.portrait]],
  ['1 方', [R.square]],
  ['2 橫', [R.landscape, R.landscape]],
  ['2 直', [R.portrait, R.portrait]],
  ['1橫+1直', [R.landscape, R.portrait]],
  ['1直+1橫', [R.portrait, R.landscape]],
  ['2 方', [R.square, R.square]],
  ['3 混合(橫直方)', [R.landscape, R.portrait, R.square]],
  ['3 直', [R.portrait, R.portrait, R.portrait]],
  ['3 橫', [R.landscape, R.landscape, R.landscape]],
  ['4+ (橫直橫直)', [R.landscape, R.portrait, R.landscape, R.portrait]],
  ['極端寬 + 直', [R.wide, R.portrait]],
  ['圖紙(直) + 實拍(橫)', [R.drawing, R.landscape]],
  ['5 張混合', [R.landscape, R.portrait, R.square, R.landscape, R.portrait]],
];

for (const [label, sizes] of cases) {
  const gallery = layoutItemImages(
    sizes.map(([width, height], i) => ({ url: `img-${i}`, width, height })),
    OPTIONS,
  );
  const rows = new Map();
  for (const cell of gallery.images) {
    const key = Math.round(cell.topPt * 2) / 2;
    const row = [...rows.keys()].find((k) => Math.abs(k - key) <= 2);
    if (row !== undefined) rows.get(row).push(cell);
    else rows.set(key, [cell]);
  }
  const shapes = sizes.map(([width, height]) => classifyImageShape(width / height, { landscapeThreshold: 1.1, squareThreshold: 0.9 }));
  console.log(`${label.padEnd(16)} → ${gallery.recipe.padEnd(20)} 高=${gallery.heightPt.toFixed(1)}pt 形狀=[${shapes.join(',')}]`);
  for (const [top, cells] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    console.log(
      `      y=${String(Math.round(top)).padStart(3)}: ` +
        cells
          .sort((a, b) => a.leftPt - b.leftPt)
          .map((c) => `${c.widthPt.toFixed(1)}x${c.heightPt.toFixed(1)}`)
          .join(' + '),
    );
  }
}

fs.rmSync(OUT, { force: true });
