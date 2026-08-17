import type { RuntimeMessage, RuntimeResponse } from '../messaging/messages';
import { cropVisibleTabSelection } from '../selection/viewport-capture';
import type { ViewportRect } from '../selection/types';
import type { ImageRegionTranslationCapture } from './selection-translator';

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export async function captureWebRegion(
  rect: ViewportRect,
  pageUrl: string,
  padding = 4,
): Promise<ImageRegionTranslationCapture | undefined> {
  const translatorRoot = document.getElementById('tex-selection-translator-root');
  const previousVisibility = translatorRoot?.style.visibility ?? '';
  if (translatorRoot) translatorRoot.style.visibility = 'hidden';
  await nextPaint();
  try {
    const response = await browser.runtime.sendMessage({
      type: 'CAPTURE_VISIBLE_TAB',
    } satisfies RuntimeMessage) as RuntimeResponse<{ imageDataUrl: string }>;
    if (!response.ok) return undefined;
    const crop = await cropVisibleTabSelection(response.data.imageDataUrl, rect, 2048, padding);
    if (!crop) return undefined;
    return {
      imageDataUrl: crop.dataUrl,
      imageWidth: crop.width,
      imageHeight: crop.height,
      rect,
      pageUrl,
      sourceLabel: document.title.trim() || location.hostname,
    };
  } finally {
    if (translatorRoot) translatorRoot.style.visibility = previousVisibility;
  }
}
