import type { RectLike, RegionRect } from './region-capture';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validRegion(value: RegionRect | undefined): value is RegionRect {
  return Boolean(
    value &&
    value.width > 0 &&
    value.height > 0 &&
    [value.left, value.top, value.right, value.bottom, value.width, value.height]
      .every(Number.isFinite)
  );
}

/**
 * Resolves the PDF formula screenshot to geometry the user explicitly swept.
 *
 * PDF text layers can omit a detached equation number or a second baseline
 * from the DOM Range even when the pointer was visibly dragged across it. The
 * completed pointer gesture is therefore allowed to extend the Range bounds,
 * but automatic text-layer neighbours are not. This preserves the user's
 * intent without capturing unselected same-row prose.
 */
export function resolvePdfFormulaCaptureRegion(
  selection: RegionRect,
  explicitGesture: RegionRect | undefined,
  page: RectLike,
): RegionRect {
  if (!validRegion(selection) || !validRegion(explicitGesture)) return selection;
  if (page.width <= 0 || page.height <= 0) return selection;

  const pageRight = page.left + page.width;
  const pageBottom = page.top + page.height;
  const left = clamp(Math.min(selection.left, explicitGesture.left), page.left, pageRight);
  const top = clamp(Math.min(selection.top, explicitGesture.top), page.top, pageBottom);
  const right = clamp(Math.max(selection.right, explicitGesture.right), left, pageRight);
  const bottom = clamp(Math.max(selection.bottom, explicitGesture.bottom), top, pageBottom);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
