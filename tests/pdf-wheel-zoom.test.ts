import { describe, expect, it } from 'vitest';
import { pdfWheelZoomDelta, pdfWheelZoomStepCount } from '../core/pdf/wheel-zoom';

describe('PDF wheel zoom', () => {
  it('only accepts Chromium Ctrl-modified wheel and pinch events', () => {
    expect(pdfWheelZoomDelta({ ctrlKey: false, deltaMode: 0, deltaY: -100 })).toBeUndefined();
    expect(pdfWheelZoomDelta({ ctrlKey: true, deltaMode: 0, deltaY: 0 })).toBeUndefined();
    expect(pdfWheelZoomDelta({ ctrlKey: true, deltaMode: 0, deltaY: Number.NaN }))
      .toBeUndefined();
    expect(pdfWheelZoomDelta({ ctrlKey: true, deltaMode: 0, deltaY: -100 })).toBe(-100);
  });

  it('normalizes line and page wheel deltas', () => {
    expect(pdfWheelZoomDelta({ ctrlKey: true, deltaMode: 1, deltaY: -3 })).toBe(-48);
    expect(pdfWheelZoomDelta({ ctrlKey: true, deltaMode: 2, deltaY: 1 })).toBe(100);
  });

  it('coalesces a gesture into a bounded number of redraw steps', () => {
    expect(pdfWheelZoomStepCount(0)).toBe(0);
    expect(pdfWheelZoomStepCount(-12)).toBe(1);
    expect(pdfWheelZoomStepCount(100)).toBe(1);
    expect(pdfWheelZoomStepCount(-120)).toBe(1);
    expect(pdfWheelZoomStepCount(-151)).toBe(2);
    expect(pdfWheelZoomStepCount(900)).toBe(3);
  });
});
