import { describe, expect, it } from 'vitest';
import {
  inferOcrBlockKind,
  ocrLineRotationDegrees,
  orderAcademicOcrBlocks,
} from '../core/pdf/ocr-layout';
import type { CoordinateOcrBlock } from '../core/pdf/ocr-text-layer';

function block(
  id: string,
  left: number,
  top: number,
  width: number,
  height = 0.04,
): CoordinateOcrBlock {
  return {
    id,
    order: 0,
    text: id,
    confidence: 0.9,
    kind: 'text',
    box: { left, top, width, height },
  };
}

describe('academic OCR layout', () => {
  it('orders a spanning title, two columns, and a spanning footnote', () => {
    const ordered = orderAcademicOcrBlocks([
      block('right-2', 0.56, 0.4, 0.34),
      block('footnote', 0.1, 0.9, 0.8),
      block('left-2', 0.1, 0.4, 0.34),
      block('right-1', 0.56, 0.25, 0.34),
      block('title', 0.1, 0.08, 0.8),
      block('left-1', 0.1, 0.25, 0.34),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      'title',
      'left-1',
      'left-2',
      'right-1',
      'right-2',
      'footnote',
    ]);
    expect(ordered.map((item) => item.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps an ordinary single-column band in top-to-bottom order', () => {
    const ordered = orderAcademicOcrBlocks([
      block('second', 0.2, 0.3, 0.55),
      block('first', 0.2, 0.1, 0.55),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['first', 'second']);
  });

  it('classifies formula-like OCR conservatively and preserves prose', () => {
    expect(inferOcrBlockKind('x = A y + \\lambda R(x)')).toBe('formula');
    expect(inferOcrBlockKind('Single-pixel imaging reconstructs a scene.')).toBe('text');
    expect(inferOcrBlockKind('method | PSNR | SSIM')).toBe('table');
  });

  it('normalizes line rotation from the OCR polygon top edge', () => {
    expect(ocrLineRotationDegrees([0, 0, 100, 0, 100, 20, 0, 20])).toBeCloseTo(0);
    expect(ocrLineRotationDegrees([0, 0, 0, 100, 20, 100, 20, 0])).toBeCloseTo(90);
    expect(ocrLineRotationDegrees([100, 0, 0, 0, 0, 20, 100, 20])).toBeCloseTo(0);
  });
});
