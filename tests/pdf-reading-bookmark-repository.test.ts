import { describe, expect, it } from 'vitest';
import {
  MAX_PDF_BOOKMARK_DOCUMENTS,
  normalizePdfReadingBookmark,
  normalizePdfReadingBookmarkState,
  retainPdfReadingBookmarkStates,
  type PdfReadingBookmarkState,
} from '../core/pdf/reading-bookmark-repository';

function bookmark(pageNumber: number, updatedAt = pageNumber) {
  return {
    id: `bookmark-${pageNumber}-${updatedAt}`,
    pageNumber,
    label: `第 ${pageNumber} 页`,
    note: '',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('Pi PDF reading bookmarks', () => {
  it('normalizes editable fields without retaining unrelated document data', () => {
    const normalized = normalizePdfReadingBookmark({
      ...bookmark(2.4),
      label: `  核心  结论 ${'长'.repeat(80)}  `,
      note: `第一行\r\n第二行 ${'注'.repeat(300)}`,
      filename: 'private-paper.pdf',
      url: 'https://example.com/private-paper.pdf',
      text: 'private PDF text',
    });

    expect(normalized?.pageNumber).toBe(2);
    expect(normalized?.label).toMatch(/^核心 结论/);
    expect(normalized?.label.length).toBeLessThanOrEqual(60);
    expect(normalized?.note).toContain('第一行\n第二行');
    expect(normalized?.note.length).toBeLessThanOrEqual(240);
    expect(normalized).not.toHaveProperty('filename');
    expect(normalized).not.toHaveProperty('url');
    expect(normalized).not.toHaveProperty('text');
  });

  it('keeps the latest bookmark for a page, limits records, and sorts by page', () => {
    const state = normalizePdfReadingBookmarkState({
      bookmarks: [
        bookmark(3, 1),
        { ...bookmark(3, 2), label: '更新后的第三页' },
        ...Array.from({ length: 55 }, (_, index) => bookmark(index + 10, index + 10)),
      ],
      updatedAt: 100,
    });

    expect(state?.bookmarks).toHaveLength(50);
    expect(state?.bookmarks.map((item) => item.pageNumber))
      .toEqual([...state!.bookmarks].map((item) => item.pageNumber).sort((a, b) => a - b));
    expect(state?.bookmarks.some((item) => item.pageNumber === 3)).toBe(false);
    expect(state?.bookmarks.at(-1)?.pageNumber).toBe(64);
  });

  it('retains only the 30 most recently used anonymous document records', () => {
    const states = Object.fromEntries(Array.from({ length: 35 }, (_, index) => [
      `anonymous-${index}`,
      { bookmarks: [bookmark(index + 1)], updatedAt: index } satisfies PdfReadingBookmarkState,
    ]));
    const retained = retainPdfReadingBookmarkStates(states);

    expect(Object.keys(retained)).toHaveLength(MAX_PDF_BOOKMARK_DOCUMENTS);
    expect(retained['anonymous-0']).toBeUndefined();
    expect(retained['anonymous-34']).toBeDefined();
  });
});
