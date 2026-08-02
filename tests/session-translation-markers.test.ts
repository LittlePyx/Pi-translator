import { describe, expect, it } from 'vitest';
import {
  buildTranslationMarkerMarkdown,
  findUniqueTextQuoteOffset,
  findUniqueTextQuoteRange,
  findUniqueNormalizedSegmentRange,
  mergeMarkerRects,
  markerTextStillMatches,
} from '../core/content/session-translation-markers';

describe('session translation marker text matching', () => {
  it('keeps a marker when only line wrapping whitespace changes', () => {
    expect(markerTextStillMatches(
      'A translated\nacademic sentence.',
      'A translated academic sentence.',
    )).toBe(true);
  });

  it('matches PDF Selection and Range text when only a hard-hyphen line break differs', () => {
    expect(markerTextStillMatches(
      'The method is scene-\ndependent and measurement-driven.',
      'The method is scene-dependent and measurement-driven.',
    )).toBe(true);
  });

  it('does not attach a marker to content that has changed', () => {
    expect(markerTextStillMatches(
      'The paper now contains revised results.',
      'The paper contains preliminary results.',
    )).toBe(false);
  });

  it('rejects an empty detached selection', () => {
    expect(markerTextStillMatches('   ', 'Source sentence')).toBe(false);
  });

  it('restores a repeated sentence only when its surrounding text is unique', () => {
    const text = 'First context. Shared sentence. Middle. Shared sentence. Final context.';
    expect(findUniqueTextQuoteOffset(
      text,
      'Shared sentence.',
      'First context. ',
      ' Middle.',
    )).toBe('First context. '.length);
    expect(findUniqueTextQuoteOffset(text, 'Shared sentence.', '', '')).toBeUndefined();
  });

  it('restores a PDF quote across whitespace, soft hyphen, and line-wrap changes', () => {
    const rawText = 'A robust reconstruc-\ntion method uses a \ufb01nite measurement budget.';
    expect(findUniqueTextQuoteRange(
      rawText,
      'A robust reconstruction method uses a finite measurement budget.',
      '',
      '',
    )).toEqual({ start: 0, end: rawText.length });
    expect(markerTextStillMatches(
      'A robust reconstruc\u00ad\ntion method.',
      'A robust reconstruction method.',
    )).toBe(true);
  });

  it('keeps repeated PDF quotes fail-closed when normalized context is not unique', () => {
    const text = [
      'Left column. Repeated result sentence. End left.',
      'Right column. Repeated\nresult sentence. End right.',
    ].join(' ');
    expect(findUniqueTextQuoteRange(
      text,
      'Repeated result sentence.',
      'Right column. ',
      ' End right.',
    )).toEqual({
      start: text.indexOf('Repeated\nresult'),
      end: text.indexOf('Repeated\nresult') + 'Repeated\nresult sentence.'.length,
    });
    expect(findUniqueTextQuoteRange(text, 'Repeated result sentence.', '', ''))
      .toBeUndefined();
  });

  it('merges duplicate and adjacent rectangles on the same visual line', () => {
    expect(mergeMarkerRects([
      { top: 10, right: 110, bottom: 30, left: 10 },
      { top: 10.5, right: 110, bottom: 30.5, left: 10 },
      { top: 10, right: 180, bottom: 30, left: 109 },
      { top: 34, right: 90, bottom: 54, left: 10 },
    ])).toEqual([
      { top: 10, right: 180, bottom: 30.5, left: 10 },
      { top: 34, right: 90, bottom: 54, left: 10 },
    ]);
  });

  it('does not merge a large PDF region with a text-line marker', () => {
    expect(mergeMarkerRects([
      { top: 10, right: 300, bottom: 210, left: 10 },
      { top: 24, right: 180, bottom: 44, left: 30 },
    ])).toHaveLength(2);
  });

  it('finds one sentence across PDF line wrapping but rejects ambiguous repeats', () => {
    expect(findUniqueNormalizedSegmentRange(
      'First important\nsentence. Second supporting sentence.',
      'First important sentence.',
    )).toEqual({ start: 0, end: 25 });
    expect(findUniqueNormalizedSegmentRange(
      'Repeated sentence. Repeated sentence.',
      'Repeated sentence.',
    )).toBeUndefined();
  });

  it('builds Markdown notes with safe webpage and PDF source metadata', () => {
    const markdown = buildTranslationMarkerMarkdown([{
      originalText: 'Original sentence.',
      translatedText: '译文。',
      sourceTitle: 'Paper page',
      sourceUrl: 'https://example.com/paper',
    }, {
      originalText: 'PDF sentence.',
      translatedText: 'PDF 译文。',
      sourceTitle: 'paper.pdf',
      pageNumber: 4,
    }]);
    expect(markdown).toContain('## Paper page');
    expect(markdown).toContain('> Original sentence.');
    expect(markdown).toContain('[查看来源](https://example.com/paper)');
    expect(markdown).toContain('## paper.pdf · 第 4 页');
  });
});
