import { describe, expect, it } from 'vitest';
import {
  buildPdfSearchPageIndex,
  buildPdfSearchSnippet,
  findPdfSearchMatches,
  normalizePdfSearchText,
} from '../core/pdf/search';

describe('PDF search indexing', () => {
  it('normalizes case, width, and repeated whitespace', () => {
    expect(normalizePdfSearchText('  ＰＤＦ\n  Search  ')).toBe('pdf search');
  });

  it('joins Latin word items while keeping adjacent CJK text searchable', () => {
    const english = buildPdfSearchPageIndex(1, [
      { str: 'Progressive' },
      { str: 'indexing', topRatio: 0.42 },
    ]);
    const chinese = buildPdfSearchPageIndex(2, [
      { str: '全文' },
      { str: '搜索', topRatio: 0.3 },
    ]);
    expect(english.text).toBe('progressive indexing');
    expect(chinese.text).toBe('全文搜索');
    expect(findPdfSearchMatches([english, chinese], 'INDEXING')).toMatchObject([{
      pageNumber: 1,
      itemIndexes: [1],
      topRatio: 0.42,
    }]);
    expect(findPdfSearchMatches([english, chinese], '全文搜索')).toMatchObject([{
      pageNumber: 2,
      itemIndexes: [0, 1],
      itemParts: [
        { itemIndex: 0, startOffset: 0, endOffset: 2 },
        { itemIndex: 1, startOffset: 0, endOffset: 2 },
      ],
    }]);
  });

  it('returns ordered matches with every overlapping text item for highlighting', () => {
    const second = buildPdfSearchPageIndex(2, [
      { str: 'Search' },
      { str: 'inside' },
      { str: 'this PDF.' },
    ]);
    const first = buildPdfSearchPageIndex(1, [
      { str: 'This PDF supports search.' },
      { str: 'Search again.', hasEOL: true, topRatio: 0.75 },
    ]);
    const matches = findPdfSearchMatches([second, first], 'search');
    expect(matches.map(({ pageNumber, itemIndexes }) => ({ pageNumber, itemIndexes }))).toEqual([
      { pageNumber: 1, itemIndexes: [0] },
      { pageNumber: 1, itemIndexes: [1] },
      { pageNumber: 2, itemIndexes: [0] },
    ]);
    expect(buildPdfSearchSnippet(first, matches[0]!)).toEqual({
      before: 'This PDF supports ',
      match: 'search',
      after: '. Search again.',
    });
  });

  it('preserves visible casing and clips long result context', () => {
    const page = buildPdfSearchPageIndex(7, [{
      str: 'A long academic introduction places the distinctive Needle beside supporting context.',
    }]);
    const [match] = findPdfSearchMatches([page], 'needle');
    expect(buildPdfSearchSnippet(page, match!, 12)).toEqual({
      before: '…distinctive ',
      match: 'Needle',
      after: ' beside supp…',
    });
  });

  it('returns no matches for blank queries or pages without text and respects the limit', () => {
    const page = buildPdfSearchPageIndex(1, [{ str: 'term term term' }]);
    expect(findPdfSearchMatches([page], '   ')).toEqual([]);
    expect(findPdfSearchMatches([buildPdfSearchPageIndex(2, [])], 'term')).toEqual([]);
    expect(findPdfSearchMatches([page], 'term', 2)).toHaveLength(2);
  });
});
