import { describe, expect, it } from 'vitest';
import {
  buildPdfOutlineEntries,
  flattenPdfOutlineEntries,
  normalizePdfOutlineTitle,
  pdfOutlineEntryForPage,
  type PdfOutlineSourceItem,
} from '../core/pdf/outline';

function item(
  title: string,
  pageNumber: number | undefined,
  items: PdfOutlineSourceItem[] = [],
): PdfOutlineSourceItem {
  return { title, dest: pageNumber === undefined ? null : [pageNumber], items };
}

describe('PDF outline', () => {
  it('normalizes visible titles without accepting unbounded text', () => {
    expect(normalizePdfOutlineTitle('  Chapter\n  One  ')).toBe('Chapter One');
    expect(normalizePdfOutlineTitle('x'.repeat(400))).toHaveLength(240);
  });

  it('builds an internal hierarchy and drops external-only leaves', async () => {
    const source = [
      item('Introduction', 1),
      item('Methods', 3, [item('Experiment', 4)]),
      { title: 'External', dest: null, items: [] },
    ];
    const result = await buildPdfOutlineEntries(source, async (destination) => (
      Array.isArray(destination) && typeof destination[0] === 'number'
        ? destination[0]
        : undefined
    ));
    expect(result).toMatchObject({ count: 4, truncated: false });
    expect(flattenPdfOutlineEntries(result.entries).map((entry) => ({
      title: entry.title,
      depth: entry.depth,
      pageNumber: entry.pageNumber,
      initiallyExpanded: entry.initiallyExpanded,
    }))).toEqual([
      { title: 'Introduction', depth: 1, pageNumber: 1, initiallyExpanded: false },
      { title: 'Methods', depth: 1, pageNumber: 3, initiallyExpanded: true },
      { title: 'Experiment', depth: 2, pageNumber: 4, initiallyExpanded: false },
    ]);
  });

  it('selects the nearest preceding and deepest same-page section', async () => {
    const result = await buildPdfOutlineEntries([
      item('Chapter', 2, [item('Section', 2), item('Later', 5)]),
      item('Appendix', 9),
    ], async (destination) => Number((destination as unknown[])[0]));
    expect(pdfOutlineEntryForPage(result.entries, 1)).toBeUndefined();
    expect(pdfOutlineEntryForPage(result.entries, 2)?.title).toBe('Section');
    expect(pdfOutlineEntryForPage(result.entries, 7)?.title).toBe('Later');
    expect(pdfOutlineEntryForPage(result.entries, 9)?.title).toBe('Appendix');
  });

  it('caps adversarially large outlines', async () => {
    const result = await buildPdfOutlineEntries(
      Array.from({ length: 8 }, (_, index) => item(`Item ${index}`, index + 1)),
      async (destination) => Number((destination as unknown[])[0]),
      3,
    );
    expect(result).toMatchObject({ count: 3, truncated: true });
    expect(result.entries).toHaveLength(3);
  });
});
