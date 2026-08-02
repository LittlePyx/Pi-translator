import { describe, expect, it } from 'vitest';
import { extractPdfRegionText } from '../core/pdf/region-text';

describe('PDF region text extraction', () => {
  it('orders reliable text-layer items by line and horizontal position', () => {
    const result = extractPdfRegionText([
      { text: 'paper.', rect: { left: 70, top: 24, right: 112, bottom: 36, width: 42, height: 12 } },
      { text: 'Academic', rect: { left: 10, top: 8, right: 62, bottom: 20, width: 52, height: 12 } },
      { text: 'translation', rect: { left: 68, top: 8, right: 126, bottom: 20, width: 58, height: 12 } },
      { text: 'improves', rect: { left: 10, top: 24, right: 60, bottom: 36, width: 50, height: 12 } },
    ], { left: 0, top: 0, right: 140, bottom: 44, width: 140, height: 44 });

    expect(result).toEqual({
      text: 'Academic translation\nimproves paper.',
      reliable: true,
      itemCount: 4,
    });
  });

  it('ignores fringe text and rejects missing or garbled text layers', () => {
    const region = { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 };
    expect(extractPdfRegionText([
      { text: 'Mostly outside', rect: { left: 90, top: 5, right: 190, bottom: 20, width: 100, height: 15 } },
    ], region)).toMatchObject({ text: '', reliable: false });
    expect(extractPdfRegionText([
      { text: '\uE001\uE002\uE003', rect: { left: 5, top: 5, right: 50, bottom: 20, width: 45, height: 15 } },
    ], region)).toMatchObject({ reliable: false });
  });
});
