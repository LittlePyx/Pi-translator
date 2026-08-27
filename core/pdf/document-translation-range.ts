import type { PdfDocumentTranslationBlock } from './document-translation';

export type PdfDocumentTranslationSection = 'body' | 'references' | 'appendix';

export type PdfDocumentPageRangeResult =
  | { ok: true; pages: number[]; summary: string }
  | { ok: false; message: string };

const REFERENCE_HEADINGS = new Set([
  'bibliography',
  'references',
  '参考文献',
  '参考资料',
]);
const APPENDIX_HEADING = /^(?:appendices|appendix(?:\s+[a-z0-9]+)?(?:\s*[:：.-]\s*.*)?|supplement(?:ary)?\s+(?:information|material|materials)|附录(?:\s*[a-z0-9一二三四五六七八九十]+)?(?:\s*[:：.-]\s*.*)?)$/iu;
const SECTION_PREFIX = /^(?:(?:chapter|section)\s+)?(?:\d+(?:\.\d+){0,5}|[ivxlcdm]+)\.?\s+/iu;

function normalizedHeading(value: string): string {
  const text = value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text || text.length > 140 || text.includes('\t')) return '';
  return text
    .replace(SECTION_PREFIX, '')
    .replace(/^[\s:：.。-]+|[\s:：.。-]+$/gu, '')
    .toLocaleLowerCase('en-US');
}

export function pdfDocumentTranslationSectionHeading(
  text: string,
): Exclude<PdfDocumentTranslationSection, 'body'> | undefined {
  const normalized = normalizedHeading(text);
  if (!normalized) return undefined;
  if (REFERENCE_HEADINGS.has(normalized)) return 'references';
  if (APPENDIX_HEADING.test(normalized)) return 'appendix';
  return undefined;
}

export function classifyPdfDocumentTranslationSections(
  blocks: readonly Pick<PdfDocumentTranslationBlock, 'text'>[],
): PdfDocumentTranslationSection[] {
  let current: PdfDocumentTranslationSection = 'body';
  return blocks.map((block) => {
    current = pdfDocumentTranslationSectionHeading(block.text) ?? current;
    return current;
  });
}

function rangeSummary(pages: readonly number[]): string {
  const ranges: string[] = [];
  let start = pages[0]!;
  let previous = start;
  for (const page of pages.slice(1)) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${start}–${previous}`);
    start = page;
    previous = page;
  }
  ranges.push(start === previous ? String(start) : `${start}–${previous}`);
  return ranges.join('、');
}

export function parsePdfDocumentPageRange(
  value: string,
  totalPages: number,
): PdfDocumentPageRangeResult {
  const maximum = Math.max(0, Math.floor(totalPages));
  if (!maximum) return { ok: false, message: '当前 PDF 没有可选择的页面。' };
  const normalized = value
    .normalize('NFKC')
    .replace(/[，、；;]/gu, ',')
    .replace(/[—–−]/gu, '-')
    .trim();
  if (!normalized) {
    return { ok: false, message: `请输入 1–${maximum} 页中的页码。` };
  }
  const pages = new Set<number>();
  for (const rawPart of normalized.split(',')) {
    const part = rawPart.trim();
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/u.exec(part);
    if (!match) {
      return { ok: false, message: '页码格式不正确，请输入如 1-6, 9, 12-15。' };
    }
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < 1 || start > maximum || end > maximum) {
      return { ok: false, message: `页码必须在 1–${maximum} 之间。` };
    }
    if (start > end) {
      return { ok: false, message: `页码范围 ${start}-${end} 的起始页不能大于结束页。` };
    }
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  const ordered = [...pages].sort((left, right) => left - right);
  if (!ordered.length) {
    return { ok: false, message: `请输入 1–${maximum} 页中的页码。` };
  }
  return { ok: true, pages: ordered, summary: rangeSummary(ordered) };
}
