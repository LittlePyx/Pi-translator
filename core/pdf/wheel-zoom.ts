export interface PdfWheelZoomEvent {
  ctrlKey: boolean;
  deltaMode: number;
  deltaY: number;
}

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_DELTA_PIXELS = 16;
const PAGE_DELTA_PIXELS = 100;
const PIXELS_PER_ZOOM_STEP = 100;
const MAX_ZOOM_STEPS_PER_GESTURE = 3;

/**
 * Chromium exposes both Ctrl + wheel and trackpad pinch as Ctrl-modified wheel
 * events. Normalize their different delta modes before the viewer batches them.
 */
export function pdfWheelZoomDelta(event: PdfWheelZoomEvent): number | undefined {
  if (!event.ctrlKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) {
    return undefined;
  }
  if (event.deltaMode === DOM_DELTA_LINE) return event.deltaY * LINE_DELTA_PIXELS;
  if (event.deltaMode === DOM_DELTA_PAGE) return event.deltaY * PAGE_DELTA_PIXELS;
  return event.deltaY;
}

export function pdfWheelZoomStepCount(accumulatedDelta: number): number {
  if (!Number.isFinite(accumulatedDelta) || accumulatedDelta === 0) return 0;
  return Math.min(
    MAX_ZOOM_STEPS_PER_GESTURE,
    Math.max(1, Math.round(Math.abs(accumulatedDelta) / PIXELS_PER_ZOOM_STEP)),
  );
}
