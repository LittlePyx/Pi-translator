import type {
  PdfDocumentTranslationBlockKind,
  PdfDocumentTranslationSourceAnchor,
} from '../pdf/document-translation';
import {isPdfPaperRole,type PdfPaperRole} from '../pdf/paper-metadata';

export interface PdfLayoutTranslationBlock {
  formulaDocument?: import('./formula-document').FormulaDocument;
  id: string;
  pageNumber: number;
  translatedText: string;
  sourceAnchor?: PdfDocumentTranslationSourceAnchor;
  role?: PdfDocumentTranslationBlockKind;
  headingLevel?: 1 | 2 | 3 | undefined;
  paperRole?: PdfPaperRole | undefined;
  formulaReviewDraft?: true;
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
  complete: boolean;
}

export interface PdfLayoutTranslationExportOptions {
  totalBlockCount?: number;
  unavailablePageCount?: number;
}

const TRUSTED_PAGE_IMAGE = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/u;
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

function safeRole(value: PdfDocumentTranslationBlockKind | undefined): string {
  return value === 'formula' || value === 'code' || value === 'table' || value === 'figure' ||
    value === 'footnote'
    ? value
    : 'text';
}

function listNumber(block: { translatedText: string; role: PdfDocumentTranslationBlockKind; headingLevel?: number | undefined }): number | undefined {
  if (block.headingLevel || block.role !== 'text' && block.role !== 'formula') return undefined;
  const match = /^(\d{1,3})(?:[.)．]\s+|、\s*)/u.exec(block.translatedText);
  return match ? Number(match[1]) : undefined;
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
      headingLevel: block.headingLevel === 1 || block.headingLevel === 2 || block.headingLevel === 3
        ? block.headingLevel : undefined,
      role: safeRole(block.role) as PdfDocumentTranslationBlockKind,
      paperRole:isPdfPaperRole(block.paperRole)?block.paperRole:undefined,
    }];
  });
  const pageNumbers = [...new Set([
    ...images.keys(),
    ...blocks.map((block) => block.pageNumber),
  ])].sort((left, right) => left - right);
  const pageStyles: string[] = [];
  const content: string[] = [];

  for (const pageNumber of pageNumbers) {
    const image = images.get(pageNumber);
    const pageWidth = image?.pageWidth ?? DEFAULT_PAGE_WIDTH;
    const pageHeight = image?.pageHeight ?? DEFAULT_PAGE_HEIGHT;
    const pageName = `pi-layout-page-${pageNumber}`;
    pageStyles.push(`@page ${pageName}{size:${pageWidth}pt ${pageHeight}pt;margin:0}`);
    const pageBlocks = blocks.filter((block) => block.pageNumber === pageNumber);
    content.push(
      `<section class="pdf-layout-page pdf-layout-source-page${image ? '' : ' source-missing'}" data-layout-source-page="${pageNumber}" style="--page-width:${pageWidth}pt;--page-height:${pageHeight}pt;--page-ratio:${pageWidth}/${pageHeight};page:${pageName}">`,
    );
    if (image) {
      content.push(`<img class="pdf-layout-source" src="${image.dataUrl}" alt="原 PDF 第 ${pageNumber} 页">`);
    } else {
      content.push(`<div class="pdf-layout-source-missing">第 ${pageNumber} 页原页图生成失败，译文已放在续页中。</div>`);
    }
    content.push('</section>');
    content.push(
      `<section class="pdf-layout-page pdf-layout-continuation pdf-layout-translation-page" data-layout-translation-page="${pageNumber}" data-layout-overflow-page="${pageNumber}" style="--page-width:${pageWidth}pt;--page-height:${pageHeight}pt;--page-ratio:${pageWidth}/${pageHeight};page:${pageName}"${pageBlocks.length ? '' : ' hidden'}>`,
      `<header><span>Pi Translator · 原文第 ${pageNumber} 页</span><strong>第 ${pageNumber} 页译文</strong><small>按原文阅读顺序排列；上一页完整保留原始版式、公式、图表和表格</small></header>`,
      '<div class="pdf-layout-continuation-list" data-layout-runtime-overflow>',
    );
    for (let index = 0; index < pageBlocks.length; index += 1) {
      const first = pageBlocks[index]!;
      const number = listNumber(first);
      const items = [first];
      while (number !== undefined && pageBlocks[index + items.length] &&
          listNumber(pageBlocks[index + items.length]!) === number + items.length) {
        items.push(pageBlocks[index + items.length]!);
      }
      if (items.length > 1) content.push('<div class="pdf-layout-list" data-layout-list>');
      for (const block of items) {
        const tag = block.paperRole==='title'?'h1':block.headingLevel ? `h${block.headingLevel + 1}` : 'div';
        content.push(
          `<article class="pdf-layout-continuation-item" data-layout-block-id="${escapeHtml(block.id)}" data-layout-role="${block.role}"${block.paperRole?` data-paper-role="${block.paperRole}"`:''}${block.headingLevel ? ` data-heading-level="${block.headingLevel}"` : ''}><${tag} class="pdf-layout-block-content">${escapeHtml(block.translatedText)}</${tag}></article>`,
        );
      }
      if (items.length > 1) content.push('</div>');
      index += items.length - 1;
    }
    content.push('</div></section>');
  }

  const fallbackNote = blocks.length
    ? '；每张原页后紧跟对应译文页'
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
      `<section class="pdf-layout-page pdf-layout-partial-cover" data-layout-partial-cover style="--page-width:${pageWidth}pt;--page-height:${pageHeight}pt;--page-ratio:${pageWidth}/${pageHeight};page:pi-layout-page-${firstPageNumber}"><div><span>Pi Translator</span><strong>部分原页对照翻译结果</strong><p>${resultStatus}</p><small>未完成或尚未识别的内容没有包含在此文件中。</small></div></section>`,
    );
  }
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Pi Translator 原页对照翻译 PDF</title>
  <style>
    ${pageStyles.join('\n    ')}
    :root{font-family:"Segoe UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#182230;background:#e8ebf2}
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#e8ebf2}body{padding:0 24px 48px}
    .pi-layout-toolbar{position:relative;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:58px;margin:0 -24px 16px;padding:10px 22px;border-bottom:1px solid #d7dbe5;background:#fff;box-shadow:0 2px 12px rgba(15,23,42,.08)}
    .pi-layout-toolbar strong{display:block;color:#302d85;font-size:15px}.pi-layout-toolbar span{display:block;margin-top:2px;color:#667085;font-size:11px}.pi-layout-toolbar em{max-width:440px;color:#7a8495;font-size:11px;font-style:normal;line-height:1.45;text-align:right}
    .pi-layout-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px}.pi-layout-actions button{min-height:36px;border:1px solid #4f4bc9;border-radius:8px;padding:7px 14px;color:#fff;background:#5b57dc;font:700 12px/1 "Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer}.pi-layout-actions button:hover{background:#4f4bc9}.pi-layout-actions button:focus-visible{outline:2px solid rgba(86,89,223,.3);outline-offset:2px}
    main{display:grid;justify-content:center;gap:24px}.pdf-layout-page{position:relative;width:var(--page-width);height:var(--page-height);overflow:hidden;background:#fff;box-shadow:0 12px 34px rgba(15,23,42,.18);break-after:page}
    .pdf-layout-source{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}.pdf-layout-source-missing{display:grid;height:100%;place-items:center;padding:48pt;color:#8b5e12;font-size:13pt;line-height:1.6;text-align:center}
    .pdf-layout-block-content{position:relative;z-index:1;white-space:pre-wrap}.pi-rich-strong{font-weight:700}.pi-math-inline{display:inline-flex;max-width:100%;vertical-align:-.14em}.pi-math-display{display:block;width:100%;margin:.45em 0;text-align:center}.pi-math-numbered{display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:center;gap:4pt}.pi-math-scroll{min-width:0;overflow:hidden;text-align:center}.pi-equation-tag{white-space:nowrap;font-size:.86em}.pi-math math{color:inherit;font-family:"Cambria Math","STIX Two Math","Latin Modern Math",serif}.pi-math-display math{font-size:1.02em}
    .pdf-layout-partial-cover{display:grid;place-items:center;padding:56pt}.pdf-layout-partial-cover>div{max-width:390pt;padding:30pt;border:1pt solid #ead8aa;border-radius:10pt;background:#fffbeb}.pdf-layout-partial-cover span{color:#5b57dc;font-size:9pt;font-weight:700;letter-spacing:.06em}.pdf-layout-partial-cover strong{display:block;margin-top:8pt;color:#694a12;font-size:22pt}.pdf-layout-partial-cover p{margin:14pt 0 5pt;color:#8b5e12;font-size:12pt}.pdf-layout-partial-cover small{color:#7b6a4d;font-size:9pt;line-height:1.55}
    .pdf-layout-continuation{padding:42pt 46pt 38pt;overflow:hidden}.pdf-layout-continuation[hidden]{display:none}.pdf-layout-continuation>header{display:grid;gap:4pt;padding-bottom:14pt;border-bottom:1pt solid #dfe3eb}.pdf-layout-continuation>header span{color:#727985;font-size:9pt;font-weight:500}.pdf-layout-continuation>header strong{color:#263247;font-size:18pt}.pdf-layout-continuation>header small{color:#7b8494;font-size:9pt}
    .pdf-layout-continuation-list{margin-top:18pt}.pdf-layout-continuation-item{break-inside:avoid;margin:0 0 10pt;padding:0;font-size:11pt;line-height:1.75}.pdf-layout-continuation-item:last-child{margin-bottom:0}
    [data-heading-level]{break-after:avoid}.pdf-layout-continuation-item[data-heading-level]{margin:18pt 0 7pt}.pdf-layout-continuation-item[data-heading-level="2"]{margin-top:13pt}.pdf-layout-continuation-item[data-heading-level="3"]{margin-top:10pt}.pdf-layout-continuation-item[data-heading-level]:first-child{margin-top:0}.pdf-layout-continuation-item[data-heading-level] .pdf-layout-block-content{margin:0;color:#202b3a;font-weight:650;line-height:1.4;overflow-wrap:anywhere}.pdf-layout-continuation-item[data-heading-level="1"] .pdf-layout-block-content{font-size:15pt}.pdf-layout-continuation-item[data-heading-level="2"] .pdf-layout-block-content{font-size:12.5pt}.pdf-layout-continuation-item[data-heading-level="3"] .pdf-layout-block-content{font-size:11.5pt}
    .pdf-layout-list{break-inside:avoid;margin-bottom:10pt}.pdf-layout-list>.pdf-layout-continuation-item{margin-bottom:5pt;padding-left:1.4em}.pdf-layout-list .pdf-layout-block-content{text-indent:-1.4em}.pdf-layout-list .pi-math{text-indent:0}
    .pdf-layout-continuation-item[data-heading-level] .pi-math{font-weight:400}
    .pdf-layout-continuation-item[data-layout-role="code"] .pdf-layout-block-content{font-family:Consolas,"Cascadia Mono",monospace;font-size:9pt;line-height:1.5}.pdf-layout-continuation-item[data-layout-role="table"],.pdf-layout-continuation-item[data-layout-role="figure"]{margin-block:14pt;padding:10pt;border:1pt solid #e5e7eb;border-radius:5pt}.pdf-layout-continuation-item[data-layout-role="footnote"]{color:#475569;font-size:8.5pt;line-height:1.48}
    .pdf-document-table-scroll{max-width:100%;white-space:normal}.pdf-document-table{width:100%;border-collapse:collapse;font-size:.92em}.pdf-document-table th,.pdf-document-table td{padding:4pt 6pt;border-bottom:1pt solid #dfe4ec;text-align:left;vertical-align:top}.pdf-document-table th{font-weight:600}.pdf-document-table-caption{margin-bottom:7pt}.pdf-document-table-trailing{margin-top:7pt}
    [data-paper-role="title"]{break-after:avoid;margin-bottom:13pt}[data-paper-role="title"] .pdf-layout-block-content{margin:0;font-size:20pt;line-height:1.3;font-weight:650;letter-spacing:-.02em;overflow-wrap:anywhere}[data-paper-role="title"] .pi-math{font-weight:400}[data-paper-role="authors"]{break-after:avoid;font-size:10pt;line-height:1.65;color:#566171;margin-bottom:14pt}[data-paper-role="publication"]{font-size:8.5pt;line-height:1.6;color:#667085;padding:8pt 0;border-block:1pt solid #e5e8ee}
    @media(max-width:760px){body{padding:0 8px 28px}.pi-layout-toolbar{margin:0 -8px 12px;padding:9px 12px}.pi-layout-toolbar em{display:none}.pi-layout-actions button{padding:7px 10px}main{justify-content:start}.pdf-layout-page{max-width:none}}
    @media print{html,body{background:#fff}body{padding:0}.pi-layout-toolbar{display:none}main{display:block}.pdf-layout-page{width:var(--page-width);max-width:none;height:var(--page-height);margin:0;aspect-ratio:auto;box-shadow:none}.pdf-layout-page:last-child{break-after:auto}}
  </style>
</head>
<body>
  <header class="pi-layout-toolbar"><div><strong>原页对照翻译 PDF</strong><span>${resultStatus}${fallbackNote}</span></div><div class="pi-layout-actions"><em>原页完整保留，译文按阅读顺序排在其后；检查后可另存为 PDF。</em><button id="pi-layout-print" type="button">保存为 PDF…</button></div></header>
  <main>${content.join('\n')}</main>
</body>
</html>`;
  return {
    html,
    pageCount: pageNumbers.length,
    blockCount: blocks.length,
    complete,
  };
}
