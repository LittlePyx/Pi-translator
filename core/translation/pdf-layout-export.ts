import type {
  PdfDocumentTranslationBlockKind,
  PdfDocumentTranslationSourceAnchor,
} from '../pdf/document-translation';

export interface PdfLayoutTranslationBlock {
  id: string;
  pageNumber: number;
  translatedText: string;
  sourceAnchor?: PdfDocumentTranslationSourceAnchor;
  role?: PdfDocumentTranslationBlockKind;
}

export interface PdfLayoutTranslationPageImage {
  pageNumber: number;
  dataUrl: string;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfLayoutTranslationExport {
  html: string;
  pageCount: number;
  blockCount: number;
  positionedBlockCount: number;
  fallbackBlockCount: number;
  complete: boolean;
}

export interface PdfLayoutTranslationExportOptions {
  totalBlockCount?: number;
  unavailablePageCount?: number;
}

const TRUSTED_PAGE_IMAGE = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/u;
const WHITE_PIXEL_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK0AAAAASUVORK5CYII=';
const DEFAULT_PAGE_WIDTH = 595;
const DEFAULT_PAGE_HEIGHT = 842;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cleanText(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

function safePositiveInteger(value: number): number | undefined {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function safePageDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 72 && value <= 4_000
    ? Math.round(value * 100) / 100
    : fallback;
}

function safeAnchor(
  anchor: PdfDocumentTranslationSourceAnchor | undefined,
): PdfDocumentTranslationSourceAnchor | undefined {
  if (!anchor) return undefined;
  const values = [
    anchor.leftRatio,
    anchor.topRatio,
    anchor.widthRatio,
    anchor.heightRatio,
  ];
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  const leftRatio = Math.min(1, Math.max(0, anchor.leftRatio));
  const topRatio = Math.min(1, Math.max(0, anchor.topRatio));
  const widthRatio = Math.min(1 - leftRatio, Math.max(0, anchor.widthRatio));
  const heightRatio = Math.min(1 - topRatio, Math.max(0, anchor.heightRatio));
  if (widthRatio < .01 || heightRatio < .006) return undefined;
  return { leftRatio, topRatio, widthRatio, heightRatio };
}

function percent(value: number): string {
  return `${Math.round(value * 100_000) / 1_000}%`;
}

function safeRole(value: PdfDocumentTranslationBlockKind | undefined): string {
  return value === 'formula' || value === 'code' || value === 'table'
    ? value
    : 'text';
}

/**
 * Builds a self-contained, script-free print surface. The PDF reader hydrates
 * the escaped placeholders with its already-rendered MathML before printing.
 */
export function buildPdfLayoutTranslationExport(
  inputBlocks: readonly PdfLayoutTranslationBlock[],
  inputImages: readonly PdfLayoutTranslationPageImage[],
  options: PdfLayoutTranslationExportOptions = {},
): PdfLayoutTranslationExport {
  const images = new Map<number, PdfLayoutTranslationPageImage>();
  for (const image of inputImages) {
    const pageNumber = safePositiveInteger(image.pageNumber);
    if (!pageNumber || images.has(pageNumber) || !TRUSTED_PAGE_IMAGE.test(image.dataUrl)) continue;
    images.set(pageNumber, {
      ...image,
      pageNumber,
      pageWidth: safePageDimension(image.pageWidth, DEFAULT_PAGE_WIDTH),
      pageHeight: safePageDimension(image.pageHeight, DEFAULT_PAGE_HEIGHT),
    });
  }
  const blocks = inputBlocks.flatMap((block) => {
    const pageNumber = safePositiveInteger(block.pageNumber);
    const translatedText = cleanText(block.translatedText);
    if (!pageNumber || !translatedText) return [];
    return [{
      ...block,
      id: block.id.trim().slice(0, 180) || `page-${pageNumber}-translation`,
      pageNumber,
      translatedText,
      role: safeRole(block.role) as PdfDocumentTranslationBlockKind,
      sourceAnchor: safeAnchor(block.sourceAnchor),
    }];
  });
  const pageNumbers = [...new Set([
    ...images.keys(),
    ...blocks.map((block) => block.pageNumber),
  ])].sort((left, right) => left - right);
  const pageStyles: string[] = [];
  const content: string[] = [];
  let positionedBlockCount = 0;
  let fallbackBlockCount = 0;

  for (const pageNumber of pageNumbers) {
    const image = images.get(pageNumber);
    const pageWidth = image?.pageWidth ?? DEFAULT_PAGE_WIDTH;
    const pageHeight = image?.pageHeight ?? DEFAULT_PAGE_HEIGHT;
    const pageName = `pi-layout-page-${pageNumber}`;
    pageStyles.push(`@page ${pageName}{size:${pageWidth}pt ${pageHeight}pt;margin:0}`);
    const pageBlocks = blocks.filter((block) => block.pageNumber === pageNumber);
    const positioned = image
      ? pageBlocks.filter((block) => (
          block.sourceAnchor && block.role !== 'code' && block.role !== 'table'
        ))
      : [];
    const fallback = pageBlocks.filter((block) => (
      !image || !block.sourceAnchor || block.role === 'code' || block.role === 'table'
    ));
    positionedBlockCount += positioned.length;
    fallbackBlockCount += fallback.length;
    content.push(
      `<section class="pdf-layout-page${image ? '' : ' source-missing'}" data-layout-source-page="${pageNumber}" style="--page-width:${pageWidth}pt;--page-height:${pageHeight}pt;--page-ratio:${pageWidth}/${pageHeight};page:${pageName}">`,
    );
    if (image) {
      content.push(`<img class="pdf-layout-source" src="${image.dataUrl}" alt="原 PDF 第 ${pageNumber} 页">`);
    } else {
      content.push(`<div class="pdf-layout-source-missing">第 ${pageNumber} 页原页图生成失败，译文已放在续页中。</div>`);
    }
    for (const block of positioned) {
      const anchor = block.sourceAnchor!;
      content.push(
        `<article class="pdf-layout-overlay" data-layout-overlay data-layout-block-id="${escapeHtml(block.id)}" data-layout-page-number="${pageNumber}" data-layout-role="${block.role}" style="left:${percent(anchor.leftRatio)};top:${percent(anchor.topRatio)};width:${percent(anchor.widthRatio)};height:${percent(anchor.heightRatio)}"><img class="pdf-layout-mask" src="${WHITE_PIXEL_IMAGE}" alt="" aria-hidden="true"><div class="pdf-layout-block-content">${escapeHtml(block.translatedText)}</div></article>`,
      );
    }
    content.push('</section>');
    content.push(
      `<section class="pdf-layout-page pdf-layout-continuation" data-layout-overflow-page="${pageNumber}" style="--page-width:${pageWidth}pt;--page-height:${pageHeight}pt;--page-ratio:${pageWidth}/${pageHeight};page:${pageName}"${fallback.length ? '' : ' hidden'}>`,
      `<header><span>Pi Translator</span><strong>第 ${pageNumber} 页版式译文续页</strong><small>无法安全放回原位置或排版后溢出的译文</small></header>`,
      '<div class="pdf-layout-continuation-list" data-layout-runtime-overflow>',
    );
    for (const block of fallback) {
      content.push(
        `<article class="pdf-layout-continuation-item" data-layout-block-id="${escapeHtml(block.id)}"><strong>第 ${pageNumber} 页</strong><div class="pdf-layout-block-content">${escapeHtml(block.translatedText)}</div></article>`,
      );
    }
    content.push('</div></section>');
  }

  const fallbackNote = fallbackBlockCount
    ? `；${fallbackBlockCount} 段将在续页中排版`
    : '';
  const totalBlockCount = Number.isSafeInteger(options.totalBlockCount)
    ? Math.max(blocks.length, options.totalBlockCount ?? 0)
    : blocks.length;
  const unavailablePageCount = Number.isSafeInteger(options.unavailablePageCount)
    ? Math.max(0, options.unavailablePageCount ?? 0)
    : 0;
  const complete = blocks.length > 0 &&
    blocks.length === totalBlockCount &&
    unavailablePageCount === 0;
  const resultStatus = complete
    ? `完整结果 · ${pageNumbers.length} 页 · ${blocks.length} 段`
    : `部分结果 · 已完成 ${blocks.length}/${totalBlockCount} 段${unavailablePageCount ? ` · ${unavailablePageCount} 页未识别` : ''}`;
  if (!complete && pageNumbers.length) {
    const firstPageNumber = pageNumbers[0]!;
    const firstImage = images.get(firstPageNumber);
    const pageWidth = firstImage?.pageWidth ?? DEFAULT_PAGE_WIDTH;
    const pageHeight = firstImage?.pageHeight ?? DEFAULT_PAGE_HEIGHT;
    content.unshift(
      `<section class="pdf-layout-page pdf-layout-partial-cover" data-layout-partial-cover style="--page-width:${pageWidth}pt;--page-height:${pageHeight}pt;--page-ratio:${pageWidth}/${pageHeight};page:pi-layout-page-${firstPageNumber}"><div><span>Pi Translator</span><strong>部分版式翻译结果</strong><p>${resultStatus}</p><small>未完成或尚未识别的内容没有包含在此文件中。</small></div></section>`,
    );
  }
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Pi Translator 版式翻译 PDF</title>
  <style>
    ${pageStyles.join('\n    ')}
    :root{font-family:"Segoe UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#182230;background:#e8ebf2}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#e8ebf2}body{padding:74px 24px 48px}
    .pi-layout-toolbar{position:fixed;z-index:20;top:0;right:0;left:0;display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:58px;padding:10px 22px;border-bottom:1px solid #d7dbe5;background:rgba(255,255,255,.96);box-shadow:0 2px 12px rgba(15,23,42,.08)}
    .pi-layout-toolbar strong{display:block;color:#302d85;font-size:15px}.pi-layout-toolbar span{display:block;margin-top:2px;color:#667085;font-size:11px}.pi-layout-toolbar em{max-width:440px;color:#7a8495;font-size:11px;font-style:normal;line-height:1.45;text-align:right}
    .pi-layout-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px}.pi-layout-actions button{min-height:36px;border:1px solid #4f4bc9;border-radius:8px;padding:7px 14px;color:#fff;background:#5b57dc;font:700 12px/1 "Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer}.pi-layout-actions button:hover{background:#4f4bc9}.pi-layout-actions button:focus-visible{outline:2px solid rgba(86,89,223,.3);outline-offset:2px}
    main{display:grid;justify-content:center;gap:24px}.pdf-layout-page{position:relative;width:var(--page-width);height:var(--page-height);overflow:hidden;background:#fff;box-shadow:0 12px 34px rgba(15,23,42,.18);break-after:page}
    .pdf-layout-source{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}.pdf-layout-source-missing{display:grid;height:100%;place-items:center;padding:48pt;color:#8b5e12;font-size:13pt;line-height:1.6;text-align:center}
    .pdf-layout-overlay{position:absolute;z-index:2;display:block;overflow:hidden;padding:2.1pt 2.5pt;color:#111827;background:#fff;box-shadow:0 0 0 1pt #fff;font-size:11pt;line-height:1.34;overflow-wrap:anywhere;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .pdf-layout-overlay[data-layout-role="formula"]{font-family:"Segoe UI","Microsoft YaHei","Cambria Math",serif}.pdf-layout-overlay[data-layout-role="code"]{font-family:Consolas,"Cascadia Mono",monospace}.pdf-layout-overlay[data-layout-role="table"]{outline:.35pt solid #d8dce6;outline-offset:-.35pt}
    .pdf-layout-mask{position:absolute;z-index:0;inset:0;width:100%;height:100%}.pdf-layout-block-content{position:relative;z-index:1;white-space:pre-wrap}.pi-rich-strong{font-weight:700}.pi-math-inline{display:inline-flex;max-width:100%;vertical-align:-.14em}.pi-math-display{display:block;width:100%;margin:.45em 0;text-align:center}.pi-math-numbered{display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:center;gap:4pt}.pi-math-scroll{min-width:0;overflow:hidden;text-align:center}.pi-equation-tag{white-space:nowrap;font-size:.86em}.pi-math math{color:inherit;font-family:"Cambria Math","STIX Two Math","Latin Modern Math",serif}.pi-math-display math{font-size:1.02em}
    .pdf-layout-overlay[data-layout-overflow-reference]{display:flex;align-items:center;width:auto!important;max-width:30%;height:auto!important;min-height:14pt;padding:2pt 4pt;border:.7pt solid #d69e2e;border-radius:3pt;color:#7a4d00;background:#fff8dc;font-size:7.5pt;font-weight:700;line-height:1.2;box-shadow:0 1pt 3pt rgba(93,63,10,.14)}
    .pdf-layout-partial-cover{display:grid;place-items:center;padding:56pt}.pdf-layout-partial-cover>div{max-width:390pt;padding:30pt;border:1pt solid #ead8aa;border-radius:10pt;background:#fffbeb}.pdf-layout-partial-cover span{color:#5b57dc;font-size:9pt;font-weight:700;letter-spacing:.06em}.pdf-layout-partial-cover strong{display:block;margin-top:8pt;color:#694a12;font-size:22pt}.pdf-layout-partial-cover p{margin:14pt 0 5pt;color:#8b5e12;font-size:12pt}.pdf-layout-partial-cover small{color:#7b6a4d;font-size:9pt;line-height:1.55}
    .pdf-layout-continuation{padding:42pt 46pt 38pt;overflow:hidden}.pdf-layout-continuation[hidden]{display:none}.pdf-layout-continuation header{display:grid;gap:4pt;padding-bottom:14pt;border-bottom:1pt solid #dfe3eb}.pdf-layout-continuation header span{color:#5b57dc;font-size:9pt;font-weight:700;letter-spacing:.06em}.pdf-layout-continuation header strong{color:#263247;font-size:18pt}.pdf-layout-continuation header small{color:#7b8494;font-size:9pt}.pdf-layout-continuation-list{display:grid;gap:14pt;margin-top:20pt}.pdf-layout-continuation-item{break-inside:avoid;padding:0 0 12pt 12pt;border-left:2pt solid #716de0;font-size:10.5pt;line-height:1.62}.pdf-layout-continuation-item>strong{display:block;margin-bottom:5pt;color:#6764cc;font-size:8pt}
    @media(max-width:760px){body{padding:68px 8px 28px}.pi-layout-toolbar{padding:9px 12px}.pi-layout-toolbar em{display:none}.pi-layout-actions button{padding:7px 10px}main{justify-content:start}.pdf-layout-page{max-width:none}}
    @media print{html,body{background:#fff}body{padding:0}.pi-layout-toolbar{display:none}main{display:block}.pdf-layout-page{width:var(--page-width);max-width:none;height:var(--page-height);margin:0;aspect-ratio:auto;box-shadow:none}.pdf-layout-page:last-child{break-after:auto}}
  </style>
</head>
<body>
  <header class="pi-layout-toolbar"><div><strong>版式翻译 PDF</strong><span>${resultStatus}${fallbackNote}</span></div><div class="pi-layout-actions"><em>检查排版后点击保存，在 Edge 打印窗口选择“另存为 PDF”。</em><button id="pi-layout-print" type="button">保存为 PDF…</button></div></header>
  <main>${content.join('\n')}</main>
</body>
</html>`;
  return {
    html,
    pageCount: pageNumbers.length,
    blockCount: blocks.length,
    positionedBlockCount,
    fallbackBlockCount,
    complete,
  };
}
