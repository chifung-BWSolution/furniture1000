// ============================================================================
// FDS 2.1 Day 9 — PPTX 渲染器（F-AI-009，T-902）
// 把 PresentationDoc 畫成 .pptx（瀏覽器端 pptxgenjs，直接下載）。
// 這就是驗收標準「至少生成一份可編輯的家具產品簡報」的交付通路：
// 產出的 PPTX 既可直接下載，也可經 edge generate-canva-presentation 匯入
// Canva（Design Imports）變成可編輯 Canva 設計。
// 版面常數全部取自 PRESENTATION_THEME（與未來專業 PDF 共用，C-07）。
// ============================================================================

import pptxGenJS from 'pptxgenjs';
import { toThumbUrl } from '@/lib/imageThumb';
import { PRESENTATION_THEME as T, type PresentationDoc, type PresentationItem } from '@/lib/presentation';

const PER_PAGE = 6; // 產品清單每頁 6 件（2 行 × 3 欄）
const IMAGE_TIMEOUT_MS = 15000;

/** PowerPoint 不吃 WebP——可以取 transform 的 origin 版（仍是 JPEG/PNG）。 */
function embedUrl(url: string): string {
  return toThumbUrl(url, { width: 1200, format: 'origin', quality: 80 });
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(embedUrl(url));
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size <= 0) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Preload every product image once — failed loads render as a grey panel. */
async function loadImages(items: PresentationItem[]): Promise<Map<string, string | null>> {
  const urls = [...new Set(items.map((i) => i.image_url).filter((u): u is string => Boolean(u)))];
  const out = new Map<string, string | null>();
  await Promise.all(
    urls.map(async (url) => {
      const data = await Promise.race([
        fetchAsDataUrl(url),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), IMAGE_TIMEOUT_MS)),
      ]);
      out.set(url, data);
    }),
  );
  return out;
}

function infoLines(item: PresentationItem): string[] {
  const lines: string[] = [];
  if (item.size) lines.push(`尺寸：${item.size} mm`);
  if (item.material) lines.push(`材質：${item.material}`);
  if (item.color) lines.push(`顏色：${item.color}`);
  if (item.factory_name) lines.push(`供應商：${item.factory_name}`);
  if (item.in_stock) lines.push('現貨');
  return lines;
}

function drawBrandBar(slide: pptxGenJS.Slide, label: string) {
  slide.addShape('rect', {
    x: 0.55, y: 0.55, w: 0.16, h: 0.75,
    fill: { color: T.accent },
    line: { type: 'none' },
  });
  slide.addText(label, {
    x: 0.85, y: 0.45, w: T.width - 1.7, h: 0.55,
    fontFace: T.font, fontSize: 15, color: T.muted, bold: false,
    align: 'left', valign: 'middle',
  });
}

export async function buildPresentationBlob(doc: PresentationDoc): Promise<Blob> {
  const images = await loadImages(doc.items);
  const pptx = new pptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 (inches) matches PRESENTATION_THEME

  pptx.defineSlideMaster({
    title: 'FDSTHEME',
    background: { color: T.white },
    objects: [
      // 底部品牌線（每頁共用模板元素）
      { rect: { x: 0.55, y: T.height - 0.42, w: T.width - 1.1, h: 0.01, fill: { color: T.line } } },
      {
        text: {
          text: 'Furniture 1000',
          options: { x: 0.55, y: T.height - 0.38, w: 3, h: 0.3, fontFace: T.font, fontSize: 9, color: T.muted },
        },
      },
      {
        text: {
          text: `${doc.meta.dateLabel}`,
          options: {
            x: T.width - 3.3, y: T.height - 0.38, w: 2.75, h: 0.3,
            align: 'right', fontFace: T.font, fontSize: 9, color: T.muted,
          },
        },
      },
    ],
  });

  // ── 封面 ────────────────────────────────────────────────────────────
  const cover = pptx.addSlide({ masterName: 'FDSTHEME' });
  cover.addShape('rect', { x: 0, y: 0, w: T.width, h: 0.22, fill: { color: T.accent }, line: { type: 'none' } });
  cover.addText(doc.meta.title, {
    x: 0.9, y: 2.35, w: T.width - 1.8, h: 1.4,
    fontFace: T.font, fontSize: 44, bold: true, color: T.primary,
  });
  if (doc.meta.subtitle) {
    cover.addText(doc.meta.subtitle, {
      x: 0.9, y: 3.7, w: T.width - 1.8, h: 0.6,
      fontFace: T.font, fontSize: 20, color: T.muted,
    });
  }
  cover.addText(`${doc.items.length} 件產品${doc.meta.showPrices ? '・含報價' : ''}`, {
    x: 0.9, y: 4.45, w: T.width - 1.8, h: 0.45,
    fontFace: T.font, fontSize: 15, color: T.accent,
  });

  // ── 產品清單（每頁 6 件，2×3 格） ───────────────────────────────────
  const pages: PresentationItem[][] = [];
  for (let i = 0; i < doc.items.length; i += PER_PAGE) pages.push(doc.items.slice(i, i + PER_PAGE));
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const slide = pptx.addSlide({ masterName: 'FDSTHEME' });
    drawBrandBar(slide, pageIdx === 0 ? '產品清單' : `產品清單（${pageIdx * PER_PAGE + 1} 起）`);
    const cellW = (T.width - 1.1 - 0.6) / 3; // margin 0.55×2 + gutters 0.3×2
    const cellH = 2.55;
    pages[pageIdx].forEach((item, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const x = 0.55 + col * (cellW + 0.3);
      const y = 1.15 + row * (cellH + 0.35);
      slide.addShape('roundRect', {
        x, y, w: cellW, h: cellH,
        fill: { color: T.panel }, line: { color: T.line }, rectRadius: 0.08,
      });
      const img = item.image_url ? images.get(item.image_url) : null;
      if (img) {
        slide.addImage({
          data: img,
          x: x + 0.12, y: y + 0.12, w: cellW - 0.24, h: 1.28,
          sizing: { type: 'contain', w: cellW - 0.24, h: 1.28 },
        });
      } else {
        slide.addShape('rect', {
          x: x + 0.12, y: y + 0.12, w: cellW - 0.24, h: 1.28,
          fill: { color: T.line }, line: { type: 'none' },
        });
        slide.addText('無圖片', {
          x: x + 0.12, y: y + 0.12, w: cellW - 0.24, h: 1.28,
          align: 'center', valign: 'middle', fontFace: T.font, fontSize: 11, color: T.muted,
        });
      }
      const nameLines: pptxGenJS.TextProps[] = [];
      nameLines.push({ text: `${item.title}\n`, options: { fontSize: 12.5, bold: true, color: T.primary } });
      if (item.model) nameLines.push({ text: `${item.model}\n`, options: { fontSize: 10.5, color: T.accent } });
      const detail = [item.size ? `${item.size} mm` : '', item.material ?? ''].filter(Boolean).join(' ｜ ');
      if (detail) nameLines.push({ text: detail, options: { fontSize: 9.5, color: T.muted } });
      slide.addText(nameLines, {
        x: x + 0.16, y: y + 1.44, w: cellW - 0.32, h: 0.62,
        fontFace: T.font, valign: 'top', align: 'left',
      });
      const priceLines: pptxGenJS.TextProps[] = [];
      if (item.discountLabel) priceLines.push({ text: `${item.discountLabel}\n`, options: { fontSize: 13, bold: true, color: T.primary } });
      if (item.originalLabel) priceLines.push({ text: item.originalLabel, options: { fontSize: 9.5, color: T.muted, strike: true } });
      if (priceLines.length > 0) {
        slide.addText(priceLines, {
          x: x + 0.16, y: y + 2.06, w: cellW - 0.32, h: 0.4,
          fontFace: T.font, valign: 'middle',
        });
      }
    });
  }

  // ── 收尾 ───────────────────────────────────────────────────────────
  const closing = pptx.addSlide({ masterName: 'FDSTHEME' });
  closing.addText('感謝垂注', {
    x: 0.9, y: 2.6, w: T.width - 1.8, h: 1.1,
    fontFace: T.font, fontSize: 40, bold: true, color: T.primary,
  });
  if (doc.meta.subtitle) {
    closing.addText(doc.meta.subtitle, {
      x: 0.9, y: 3.7, w: T.width - 1.8, h: 0.5,
      fontFace: T.font, fontSize: 16, color: T.muted,
    });
  }

  const out = (await pptx.write({ outputType: 'arraybuffer' })) as unknown;
  let bytes: Uint8Array;
  if (out instanceof ArrayBuffer) {
    bytes = new Uint8Array(out);
  } else if (typeof Blob !== 'undefined' && out instanceof Blob) {
    bytes = new Uint8Array(await out.arrayBuffer());
  } else {
    bytes = new Uint8Array(out as Uint8Array);
  }
  return new Blob([bytes as unknown as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}

export function slideCount(doc: PresentationDoc): number {
  const listPages = Math.max(1, Math.ceil(doc.items.length / PER_PAGE));
  return 2 + listPages; // 封面 + 清單頁 + 收尾
}

export function safeFileName(base: string): string {
  return (
    base.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'product-briefing'
  );
}
