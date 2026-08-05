import type { RuntimeMessage, RuntimeResponse } from '../messaging/messages';
import type { SelectionSnapshot } from '../selection/types';
import { cropVisibleTabSelection } from '../selection/viewport-capture';
import { shouldUseVisionForRenderedFormula } from '../translation/formula-detection';
import type { ImageRegionTranslationCapture } from './selection-translator';

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Captures rendered mathematics only when selectable text has probably lost
 * its original TeX structure. Explicit TeX source remains on the faster text
 * path and keeps the existing placeholder validation.
 */
export async function captureRenderedFormula(
  snapshot: SelectionSnapshot,
  padding = 8,
): Promise<ImageRegionTranslationCapture | undefined> {
  if (
    !snapshot.rect ||
    !shouldUseVisionForRenderedFormula(snapshot.normalizedText)
  ) return undefined;

  const selection = window.getSelection();
  const ranges = selection
    ? Array.from(
        { length: selection.rangeCount },
        (_, index) => selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const translatorRoot = document.getElementById('tex-selection-translator-root');
  const previousRootVisibility = translatorRoot?.style.visibility ?? '';
  // Do not bake the browser's blue selection tint into the model input.
  selection?.removeAllRanges();
  if (translatorRoot) translatorRoot.style.visibility = 'hidden';
  await nextPaint();
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'CAPTURE_VISIBLE_TAB',
    } satisfies RuntimeMessage)) as RuntimeResponse<{ imageDataUrl: string }>;
    if (!response.ok) return undefined;
    const crop = await cropVisibleTabSelection(
      response.data.imageDataUrl,
      snapshot.rect,
      2048,
      padding,
    );
    if (!crop) return undefined;
    return {
      imageDataUrl: crop.dataUrl,
      imageWidth: crop.width,
      imageHeight: crop.height,
      recognizedTextHint: snapshot.normalizedText,
      rect: snapshot.rect,
      pageUrl: snapshot.pageUrl,
      sourceSelection: snapshot,
    };
  } finally {
    if (translatorRoot) translatorRoot.style.visibility = previousRootVisibility;
    if (selection && selection.rangeCount === 0) {
      for (const range of ranges) {
        if (range.commonAncestorContainer.isConnected) selection.addRange(range);
      }
    }
  }
}
