import { describe, expect, it } from 'vitest';
import { resolvePdfFormulaCaptureRegion } from '../core/pdf/formula-capture-region';

const page = { left: 0, top: 0, width: 612, height: 792 };
const selection = { left: 158, top: 220, right: 370, bottom: 256, width: 212, height: 36 };

describe('PDF display-formula capture geometry', () => {
  it('includes a detached equation number only when the pointer swept across it', () => {
    const gesture = { left: 154, top: 228, right: 504, bottom: 246, width: 350, height: 18 };
    expect(resolvePdfFormulaCaptureRegion(selection, gesture, page)).toEqual({
      left: 154,
      top: 220,
      right: 504,
      bottom: 256,
      width: 350,
      height: 36,
    });
  });

  it('does not infer or append unselected same-row content', () => {
    expect(resolvePdfFormulaCaptureRegion(selection, undefined, page)).toEqual(selection);
  });

  it('preserves the Range bounds when the gesture is unusable', () => {
    const empty = { left: 20, top: 20, right: 20, bottom: 20, width: 0, height: 0 };
    expect(resolvePdfFormulaCaptureRegion(selection, empty, page)).toEqual(selection);
  });

  it('clamps an explicit gesture to the PDF page', () => {
    const gesture = { left: -40, top: -20, right: 700, bottom: 820, width: 740, height: 840 };
    expect(resolvePdfFormulaCaptureRegion(selection, gesture, page)).toEqual({
      left: 0,
      top: 0,
      right: 612,
      bottom: 792,
      width: 612,
      height: 792,
    });
  });
});
