import { describe, expect, it } from 'vitest';
import {
  detectPdfTwoColumnLayout,
  isPdfTableLikeSelection,
  resolvePdfTextSelectionSnap,
  type PdfSelectionTextItem,
} from '../core/pdf/text-selection-snap';

function item(text: string, left: number, top: number, width = 180): PdfSelectionTextItem {
  return { text, left, top, right: left + width, bottom: top + 16 };
}

describe('Pi PDF smart text selection', () => {
  it('snaps a short drag to a complete word', () => {
    expect(resolvePdfTextSelectionSnap(
      [item('Single-pixel imaging', 50, 100)],
      {
        startIndex: 0,
        startOffset: 2,
        endIndex: 0,
        endOffset: 8,
        pageWidth: 600,
        pageHeight: 800,
      },
    )).toMatchObject({
      startIndex: 0,
      startOffset: 0,
      endIndex: 0,
      endOffset: 12,
      mode: 'word',
    });
  });

  it('expands a multi-line drag to sentence boundaries', () => {
    const items = [
      item('Previous sentence.', 50, 80),
      item('The first half of a selected', 50, 100),
      item('sentence continues here. Next sentence.', 50, 120),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 1,
      startOffset: 5,
      endIndex: 2,
      endOffset: 10,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(snapped).toMatchObject({
      startIndex: 1,
      startOffset: 0,
      endIndex: 2,
      endOffset: 'sentence continues here.'.length,
      mode: 'sentence',
    });
  });

  it('does not mistake a visual line ending for the end of a sentence', () => {
    const items = [
      item('This method reconstructs a scene from measurements', 50, 100),
      item('and remains stable under noise. Next sentence.', 50, 120),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 5,
      endIndex: 0,
      endOffset: items[0]!.text.length,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(snapped).toMatchObject({
      startIndex: 0,
      startOffset: 0,
      endIndex: 1,
      endOffset: 'and remains stable under noise.'.length,
      mode: 'sentence',
    });
  });

  it('closes the final sentence when a paragraph drag ends on its last visual line', () => {
    const items = [
      item('The paragraph begins with a complete first sentence.', 50, 100),
      item('Its final sentence crosses the visual line', 50, 120),
      item('and reaches the actual paragraph ending.', 50, 140),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 4,
      endIndex: 2,
      endOffset: 12,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(snapped).toMatchObject({
      startIndex: 0,
      startOffset: 0,
      endIndex: 2,
      endOffset: items[2]!.text.length,
      mode: 'sentence',
    });
  });

  it('keeps an explicit sentence-ending stop instead of swallowing the next sentence', () => {
    const text = 'First selected sentence. Second sentence must stay separate.';
    const firstEnd = 'First selected sentence.'.length;
    const snapped = resolvePdfTextSelectionSnap([item(text, 50, 100)], {
      startIndex: 0,
      startOffset: 2,
      endIndex: 0,
      endOffset: firstEnd,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(snapped).toMatchObject({
      startIndex: 0,
      startOffset: 0,
      endIndex: 0,
      endOffset: firstEnd,
      mode: 'sentence',
    });
  });

  it('uses a dead zone before including the next complete sentence', () => {
    const first = 'First selected sentence.';
    const second = 'Second sentence should join after a clear drag.';
    const text = `${first} ${second} Third sentence.`;
    const barelyEntered = resolvePdfTextSelectionSnap([item(text, 50, 100)], {
      startIndex: 0,
      startOffset: 2,
      endIndex: 0,
      endOffset: first.length + 5,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(barelyEntered?.endOffset).toBe(first.length);

    const clearlyEntered = resolvePdfTextSelectionSnap([item(text, 50, 100)], {
      startIndex: 0,
      startOffset: 2,
      endIndex: 0,
      endOffset: first.length + 28,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(clearlyEntered?.endOffset).toBe(first.length + 1 + second.length);
  });

  it('snaps to a paragraph only when the raw selection already covers nearly all of it', () => {
    const items = [
      item('Previous paragraph ends.', 50, 60),
      item('The target paragraph starts here.', 50, 100),
      item('It contains another complete sentence.', 50, 120),
      item('Its final sentence finishes here.', 50, 140),
      item('The next paragraph begins.', 50, 180),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 1,
      startOffset: 2,
      endIndex: 3,
      endOffset: items[3]!.text.length - 2,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(snapped).toMatchObject({
      startIndex: 1,
      startOffset: 0,
      endIndex: 3,
      endOffset: items[3]!.text.length,
      mode: 'paragraph',
    });
  });

  it('never expands a punctuation-free partial selection to the whole page', () => {
    const items = Array.from({ length: 9 }, (_, index) => (
      item(`line ${index + 1} contains academic text without a terminal mark`, 50, 80 + index * 20)
    ));
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 3,
      startOffset: 5,
      endIndex: 4,
      endOffset: 24,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(snapped?.startIndex).toBe(3);
    expect(snapped?.endIndex).toBe(4);
  });

  it('does not expand a left-column selection into the right column', () => {
    const items = [
      item('Left one.', 40, 100),
      item('Left two continues.', 40, 120),
      item('Left three.', 40, 140),
      item('Right one.', 350, 100),
      item('Right two.', 350, 120),
      item('Right three.', 350, 140),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 1,
      endIndex: 4,
      endOffset: 5,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(snapped?.endIndex).toBeLessThan(3);
    expect(snapped).toMatchObject({ startColumn: 'left', crossColumn: 'constrained' });
  });

  it('detects the actual central gutter from text geometry', () => {
    const items = [
      item('Left one.', 35, 100),
      item('Left two.', 35, 120),
      item('Left three.', 35, 140),
      item('Right one.', 360, 100),
      item('Right two.', 360, 120),
      item('Right three.', 360, 140),
    ];
    expect(detectPdfTwoColumnLayout(items, 620, 800)).toMatchObject({
      gutterLeft: 215,
      gutterRight: 360,
      leftItemCount: 3,
      rightItemCount: 3,
    });
  });

  it('preserves an intentional cross-column drag without reordering it', () => {
    const items = [
      item('Left one.', 40, 100),
      item('Left two.', 40, 120),
      item('Left three.', 40, 140),
      item('Right one.', 350, 100),
      item('Right two.', 350, 120),
      item('Right three.', 350, 140),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 1,
      endIndex: 4,
      endOffset: 5,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 80,
      gestureEndX: 390,
    });
    expect(snapped).toMatchObject({
      startIndex: 0,
      endIndex: 4,
      startColumn: 'left',
      crossColumn: 'explicit',
      mode: 'word',
    });
  });

  it('keeps continuous-sidebar selections in their starting column', () => {
    const items = [
      item('Left one.', 40, 100),
      item('Left two.', 40, 120),
      item('Left three.', 40, 140),
      item('Right one.', 350, 100),
      item('Right two.', 350, 120),
      item('Right three.', 350, 140),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 1,
      endIndex: 4,
      endOffset: 5,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 80,
      gestureEndX: 390,
      allowExplicitCrossColumn: false,
    });
    expect(snapped?.endIndex).toBeLessThan(3);
    expect(snapped).toMatchObject({ startColumn: 'left', crossColumn: 'constrained' });
  });

  it('uses the pointer origin when a right-column drag crosses backward in DOM order', () => {
    const items = [
      item('Left one.', 40, 100),
      item('Left two.', 40, 120),
      item('Left three.', 40, 140),
      item('Right one.', 350, 100),
      item('Right two.', 350, 120),
      item('Right three.', 350, 140),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 4,
      endIndex: 4,
      endOffset: 5,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 390,
      gestureEndX: 300,
    });
    expect(snapped?.startIndex).toBeGreaterThanOrEqual(3);
    expect(snapped).toMatchObject({ startColumn: 'right', crossColumn: 'constrained' });
  });

  it('retains a spanning formula that the drag actually passes through', () => {
    const items = [
      item('Left one.', 40, 100),
      item('Left two.', 40, 120),
      item('Left three.', 40, 140),
      item('E = integral from zero to infinity of p(x) dx.', 120, 166, 370),
      item('Right one.', 350, 100),
      item('Right two.', 350, 120),
      item('Right three.', 350, 140),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 0,
      endIndex: 4,
      endOffset: 6,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 80,
      gestureStartY: 108,
      gestureEndX: 285,
      gestureEndY: 174,
    });
    expect(snapped).toMatchObject({
      endIndex: 3,
      startColumn: 'left',
      crossColumn: 'constrained',
      retainedSpanningContent: true,
      mode: 'word',
    });
  });

  it('does not pull in a spanning title outside the vertical drag path', () => {
    const items = [
      item('Left one.', 40, 100),
      item('Left two.', 40, 120),
      item('Left three.', 40, 140),
      item('A full-width paper title', 120, 36, 370),
      item('Right one.', 350, 100),
      item('Right two.', 350, 120),
      item('Right three.', 350, 140),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 0,
      endIndex: 4,
      endOffset: 6,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 80,
      gestureStartY: 108,
      gestureEndX: 285,
      gestureEndY: 142,
    });
    expect(snapped?.endIndex).toBe(2);
    expect(snapped).not.toHaveProperty('retainedSpanningContent');
  });

  it('does not bridge across an opposite-column DOM block to retain distant spanning text', () => {
    const items = [
      item('Left one.', 40, 100),
      item('Left two.', 40, 120),
      item('Left three.', 40, 140),
      item('Right one.', 350, 100),
      item('Right two.', 350, 120),
      item('Right three.', 350, 140),
      item('Full-width equation after both columns.', 120, 166, 370),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 0,
      startOffset: 0,
      endIndex: 6,
      endOffset: items[6]!.text.length,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 80,
      gestureStartY: 108,
      gestureEndX: 285,
      gestureEndY: 174,
    });
    expect(snapped?.endIndex).toBe(2);
    expect(snapped).not.toHaveProperty('retainedSpanningContent');
  });

  it('keeps a three-column table selection raw and marks its reading order as uncertain', () => {
    const items = [
      item('Method', 50, 100, 72),
      item('Accuracy', 235, 100, 74),
      item('Latency', 420, 100, 64),
      item('Baseline', 50, 124, 70),
      item('91.2%', 235, 124, 48),
      item('42 ms', 420, 124, 52),
      item('Pi model', 50, 148, 68),
      item('94.8%', 235, 148, 48),
      item('31 ms', 420, 148, 52),
    ];
    const input = {
      startIndex: 0,
      startOffset: 0,
      endIndex: 8,
      endOffset: items[8]!.text.length,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 55,
      gestureStartY: 108,
      gestureEndX: 475,
      gestureEndY: 156,
    };
    expect(isPdfTableLikeSelection(items, input)).toBe(true);
    expect(resolvePdfTextSelectionSnap(items, input)).toMatchObject({
      startIndex: 0,
      endIndex: 8,
      mode: 'word',
      tableLike: true,
    });
  });

  it('recognizes a compact numeric two-column table without flagging ordinary two-column prose', () => {
    const table = [
      item('Epoch', 90, 100, 54), item('Loss', 350, 100, 42),
      item('1', 90, 124, 12), item('0.42', 350, 124, 36),
      item('2', 90, 148, 12), item('0.31', 350, 148, 36),
    ];
    const tableInput = {
      startIndex: 0,
      startOffset: 0,
      endIndex: 5,
      endOffset: table[5]!.text.length,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 92,
      gestureStartY: 108,
      gestureEndX: 385,
      gestureEndY: 156,
    };
    expect(isPdfTableLikeSelection(table, tableInput)).toBe(true);

    const prose = [
      item('Left column sentence one.', 40, 100),
      item('Right column sentence one.', 350, 100),
      item('Left column sentence two.', 40, 124),
      item('Right column sentence two.', 350, 124),
      item('Left column sentence three.', 40, 148),
      item('Right column sentence three.', 350, 148),
    ];
    expect(isPdfTableLikeSelection(prose, { ...tableInput, endIndex: 5 })).toBe(false);
  });

  it('does not treat a single horizontally aligned line as a table', () => {
    const items = [
      item('Metric', 50, 100, 52),
      item('Value', 235, 100, 48),
      item('Unit', 420, 100, 36),
      item('Following prose is outside the drag.', 50, 180),
    ];
    expect(isPdfTableLikeSelection(items, {
      startIndex: 0,
      startOffset: 0,
      endIndex: 3,
      endOffset: 8,
      pageWidth: 600,
      pageHeight: 800,
      gestureStartX: 55,
      gestureStartY: 108,
      gestureEndX: 455,
      gestureEndY: 108,
    })).toBe(false);
  });

  it('keeps body sentence expansion away from headers and footers', () => {
    const items = [
      item('Journal header.', 50, 10),
      item('Body sentence starts', 50, 100),
      item('and finishes here.', 50, 120),
      item('Page 1', 50, 780),
    ];
    const snapped = resolvePdfTextSelectionSnap(items, {
      startIndex: 1,
      startOffset: 2,
      endIndex: 2,
      endOffset: 5,
      pageWidth: 600,
      pageHeight: 800,
    });
    expect(snapped?.startIndex).toBe(1);
    expect(snapped?.endIndex).toBe(2);
  });
});
