export interface DocumentTranslationExportBlock {
  sourceText: string;
  translatedText?: string;
  pageNumber?: number;
}

export interface DocumentTranslationExport {
  translationText: string;
  translationMarkdown: string;
  bilingualMarkdown: string;
  printableHtml: string;
  blockCount: number;
  totalBlockCount: number;
  missingBlockCount: number;
  unavailablePageCount: number;
  pageCount: number;
  complete: boolean;
}

export type DocumentTranslationExportFormat =
  | 'translation-markdown'
  | 'bilingual-markdown'
  | 'printable-html';

export type DocumentTranslationExportKind = 'webpage' | 'pdf';

export interface DocumentTranslationDownload {
  content: string;
  filename: string;
  mimeType: string;
}

export interface DocumentTranslationExportOptions {
  unavailablePageCount?: number;
}

function cleanExportText(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

function markdownBlockquote(value: string): string {
  return value.split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function partialResultDescription(
  completed: number,
  total: number,
  unavailablePages: number,
): string {
  const pageNote = unavailablePages ? `，另有 ${unavailablePages} 页尚未识别` : '';
  return `已完成 ${completed}/${total} 段${pageNote}；未完成内容未包含在此文件中`;
}

function partialMarkdownNotice(
  completed: number,
  total: number,
  unavailablePages: number,
): string {
  return `> Pi Translator 部分结果：${partialResultDescription(completed, total, unavailablePages)}。`;
}

function buildPrintableHtml(
  blocks: readonly { sourceText: string; translatedText: string; pageNumber?: number }[],
  completed: number,
  total: number,
  unavailablePages: number,
): string {
  const complete = total > 0 && completed === total && unavailablePages === 0;
  const content: string[] = [];
  let previousPage: number | undefined;
  for (const block of blocks) {
    if (block.pageNumber !== undefined && block.pageNumber !== previousPage) {
      content.push(`<h2>第 ${block.pageNumber} 页</h2>`);
      previousPage = block.pageNumber;
    }
    content.push(`<section class="pair"><div class="source">${escapeHtml(block.sourceText)}</div><div class="translation">${escapeHtml(block.translatedText)}</div></section>`);
  }
  const status = complete
    ? `完整结果 · ${completed} 段`
    : `部分结果 · ${partialResultDescription(completed, total, unavailablePages)}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Pi Translator 双语译文</title>
  <style>
    :root{font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif;color:#263247;background:#fff}
    *{box-sizing:border-box}body{max-width:860px;margin:0 auto;padding:48px 42px 72px;background:#fff}
    header{margin-bottom:34px;padding-bottom:18px;border-bottom:1px solid #dfe4ec}
    h1{margin:0;color:#302d85;font-size:26px;letter-spacing:-.02em}header p{margin:8px 0 0;color:${complete ? '#667085' : '#9a6416'};font-size:13px}
    h2{margin:34px 0 12px;color:#6764cc;font-size:14px}.pair{break-inside:avoid;margin:0 0 24px;padding:0 0 0 15px;border-left:2px solid #716de0}
    .source,.translation{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.72}.source{color:#667085;font-size:13px}.translation{margin-top:7px;color:#1f2937;font-size:15px}
    footer{margin-top:42px;padding-top:14px;border-top:1px solid #e5e8ee;color:#8a94a3;font-size:11px}
    @media(max-width:600px){body{padding:28px 20px 48px}.pair{padding-left:11px}}
    @media print{body{max-width:none;padding:0}header{margin-bottom:24px}.pair{break-inside:avoid}footer{color:#6b7280}}
  </style>
</head>
<body>
  <header><h1>Pi Translator 双语译文</h1><p>${status}</p></header>
  <main>${content.join('\n')}</main>
  <footer>由 Pi Translator 在本机生成 · 文件不包含网页地址或 PDF 来源</footer>
</body>
</html>`;
}

/** Builds copy-ready text from completed blocks without changing formulas or code. */
export function buildDocumentTranslationExport(
  blocks: readonly DocumentTranslationExportBlock[],
  options: DocumentTranslationExportOptions = {},
): DocumentTranslationExport {
  const normalized = blocks.flatMap((block) => {
    const sourceText = cleanExportText(block.sourceText);
    if (!sourceText) return [];
    const translatedText = cleanExportText(block.translatedText ?? '');
    return [{
      sourceText,
      ...(translatedText ? { translatedText } : {}),
      ...(Number.isSafeInteger(block.pageNumber) && (block.pageNumber ?? 0) > 0
        ? { pageNumber: block.pageNumber }
        : {}),
    }];
  });
  const completed = normalized.flatMap((block) => block.translatedText
    ? [{ ...block, translatedText: block.translatedText }]
    : []);
  const totalBlockCount = normalized.length;
  const missingBlockCount = Math.max(0, totalBlockCount - completed.length);
  const unavailablePageCount = Number.isSafeInteger(options.unavailablePageCount)
    ? Math.max(0, options.unavailablePageCount ?? 0)
    : 0;
  const complete = totalBlockCount > 0 && missingBlockCount === 0 && unavailablePageCount === 0;
  const pages = new Set(completed.flatMap((block) => (
    block.pageNumber === undefined ? [] : [block.pageNumber]
  )));
  const bilingualParts: string[] = [];
  const translationParts: string[] = [];
  let previousPage: number | undefined;
  for (const block of completed) {
    if (block.pageNumber !== undefined && block.pageNumber !== previousPage) {
      bilingualParts.push(`## 第 ${block.pageNumber} 页`);
      translationParts.push(`## 第 ${block.pageNumber} 页`);
      previousPage = block.pageNumber;
    }
    translationParts.push(block.translatedText);
    bilingualParts.push(`${block.sourceText}\n\n${markdownBlockquote(block.translatedText)}`);
  }
  if (!complete && completed.length && totalBlockCount) {
    const notice = partialMarkdownNotice(
      completed.length,
      totalBlockCount,
      unavailablePageCount,
    );
    translationParts.unshift(notice);
    bilingualParts.unshift(notice);
  }
  return {
    translationText: completed.map((block) => block.translatedText).join('\n\n'),
    translationMarkdown: translationParts.join('\n\n'),
    bilingualMarkdown: bilingualParts.join('\n\n'),
    printableHtml: buildPrintableHtml(
      completed,
      completed.length,
      totalBlockCount,
      unavailablePageCount,
    ),
    blockCount: completed.length,
    totalBlockCount,
    missingBlockCount,
    unavailablePageCount,
    pageCount: pages.size,
    complete,
  };
}

export function documentTranslationDownload(
  result: DocumentTranslationExport,
  format: DocumentTranslationExportFormat,
  kind: DocumentTranslationExportKind,
): DocumentTranslationDownload {
  if (!result.blockCount) throw new Error('当前还没有可导出的已完成译文。');
  const prefix = `pi-translator-${kind}`;
  if (format === 'translation-markdown') {
    return {
      content: result.translationMarkdown,
      filename: `${prefix}-translation.md`,
      mimeType: 'text/markdown;charset=utf-8',
    };
  }
  if (format === 'bilingual-markdown') {
    return {
      content: result.bilingualMarkdown,
      filename: `${prefix}-bilingual.md`,
      mimeType: 'text/markdown;charset=utf-8',
    };
  }
  return {
    content: result.printableHtml,
    filename: `${prefix}-bilingual.html`,
    mimeType: 'text/html;charset=utf-8',
  };
}

export function triggerDocumentTranslationDownload(
  download: DocumentTranslationDownload,
): void {
  const markdownBom = download.filename.endsWith('.md') ? '\uFEFF' : '';
  const url = URL.createObjectURL(new Blob([markdownBom, download.content], {
    type: download.mimeType,
  }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
