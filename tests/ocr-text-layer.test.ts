import { describe, expect, it } from 'vitest';
import {
  selectableOcrBlocks,
  validateCoordinateOcrPage,
} from '../core/pdf/ocr-text-layer';

describe('coordinate OCR text-layer boundary', () => {
  const valid = {
    pageNumber: 2,
    coordinateSystem: 'normalized-page',
    blocks: [
      {
        id: 'formula-1',
        order: 1,
        text: '$E = mc^2$',
        confidence: 0.9,
        kind: 'formula',
        box: { left: 0.2, top: 0.3, width: 0.3, height: 0.05 },
      },
      {
        id: 'text-1',
        order: 0,
        text: 'A reliable OCR paragraph.',
        confidence: 0.97,
        kind: 'text',
        box: { left: 0.1, top: 0.1, width: 0.8, height: 0.08 },
      },
    ],
  };

  it('accepts normalized blocks and preserves explicit reading order', () => {
    const result = validateCoordinateOcrPage(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.blocks.map((block) => block.id)).toEqual(['text-1', 'formula-1']);
  });

  it('rejects missing coordinate declarations and out-of-page boxes', () => {
    expect(validateCoordinateOcrPage({ ...valid, coordinateSystem: 'pixels' }).ok).toBe(false);
    const invalidBox = structuredClone(valid);
    invalidBox.blocks[0]!.box = { left: 0.9, top: 0.3, width: 0.3, height: 0.05 };
    expect(validateCoordinateOcrPage(invalidBox)).toEqual({
      ok: false,
      reason: '第 1 个 OCR 坐标越界。',
    });
  });

  it('rejects duplicate reading order and unsafe text volume', () => {
    const duplicate = structuredClone(valid);
    duplicate.blocks[1]!.order = 1;
    expect(validateCoordinateOcrPage(duplicate).ok).toBe(false);
    const oversized = structuredClone(valid);
    oversized.blocks[0]!.text = 'x'.repeat(4_001);
    expect(validateCoordinateOcrPage(oversized).ok).toBe(false);
  });

  it('excludes low-confidence and table blocks from selectable overlays', () => {
    const result = validateCoordinateOcrPage({
      ...valid,
      blocks: [
        ...valid.blocks,
        {
          id: 'uncertain',
          order: 2,
          text: 'uncertain text',
          confidence: 0.5,
          kind: 'text',
          box: { left: 0.1, top: 0.5, width: 0.3, height: 0.05 },
        },
        {
          id: 'table-1',
          order: 3,
          text: 'table cells',
          confidence: 0.99,
          kind: 'table',
          box: { left: 0.1, top: 0.6, width: 0.8, height: 0.2 },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(selectableOcrBlocks(result.page).map((block) => block.id)).toEqual([
      'text-1',
      'formula-1',
    ]);
  });
});
