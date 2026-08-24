import type { RuntimeMessage, RuntimeResponse } from '../messaging/messages';
import { cropVisibleTabSelection } from '../selection/viewport-capture';
import type { ViewportRect } from '../selection/types';
import type { ImageRegionTranslationCapture } from './selection-translator';

export type WebRegionCaptureErrorKind = 'permission' | 'capture' | 'crop';

export class WebRegionCaptureError extends Error {
  constructor(
    readonly kind: WebRegionCaptureErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'WebRegionCaptureError';
  }
}

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export async function captureWebRegion(
  rect: ViewportRect,
  pageUrl: string,
  padding = 4,
): Promise<ImageRegionTranslationCapture> {
  const translatorRoot = document.getElementById('tex-selection-translator-root');
  const previousVisibility = translatorRoot?.style.visibility ?? '';
  if (translatorRoot) translatorRoot.style.visibility = 'hidden';
  await nextPaint();
  try {
    const response = await browser.runtime.sendMessage({
      type: 'CAPTURE_VISIBLE_TAB',
    } satisfies RuntimeMessage) as RuntimeResponse<{ imageDataUrl: string }> | undefined;
    if (!response?.ok) {
      const detail = response?.error.message ?? '';
      const permissionFailure = /activeTab|permission|not been invoked|cannot access/i.test(detail);
      throw new WebRegionCaptureError(
        permissionFailure ? 'permission' : 'capture',
        permissionFailure
          ? '当前网页尚未获得截图权限。请从 Pi Translator 浏览器侧栏重新点击“框选网页”，并允许访问当前站点。'
          : 'Edge 没有返回当前网页截图，请保持该标签页在前台后重新框选。',
      );
    }
    let crop: Awaited<ReturnType<typeof cropVisibleTabSelection>>;
    try {
      crop = await cropVisibleTabSelection(response.data.imageDataUrl, rect, 2048, padding);
    } catch {
      throw new WebRegionCaptureError(
        'crop',
        '网页截图已获取，但选区图像处理失败。请缩小选框后重试。',
      );
    }
    if (!crop) {
      throw new WebRegionCaptureError(
        'crop',
        '网页截图已获取，但框选范围无效。请调整为更大的区域后重试。',
      );
    }
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
