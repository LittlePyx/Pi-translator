import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfDocumentTranslationSourceRegion } from './document-translation';
import { captureCanvasRegion, normalizeRegion, mapRegionToCanvas } from './region-capture';

/** Stitch only owned regions, in reading order, including page-boundary math.
 * Print intent works in hidden/offscreen documents without animation frames. */
export async function capturePdfVisualRegions(pdf: PDFDocumentProxy,
  regions: readonly PdfDocumentTranslationSourceRegion[], options: { maxEdge?: number; maxBytes?: number } = {}) {
  if (!regions.length || regions.length > 32) throw new Error('这个段落没有可靠的视觉定位。');
  const startedAt = performance.now();
  let pageRenderMs = 0;
  const crops: HTMLCanvasElement[] = [];
  const combined = document.createElement('canvas');
  let totalPixels = 0;
  try {
    for (const { pageNumber, sourceAnchor: a } of regions) {
      if (![a.leftRatio, a.topRatio, a.widthRatio, a.heightRatio].every(Number.isFinite) ||
          a.widthRatio <= 0 || a.heightRatio <= 0) throw new Error('原文区域无效。');
      const renderStartedAt = performance.now();
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.4, Math.max(1, 1800 / Math.max(base.width, base.height, 1))) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      try {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('无法生成原文图像。');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
        pageRenderMs += performance.now() - renderStartedAt;
        const bounds = { left: 0, top: 0, width: base.width, height: base.height };
        const region = normalizeRegion({ x: a.leftRatio * base.width, y: a.topRatio * base.height },
          { x: (a.leftRatio + a.widthRatio) * base.width, y: (a.topRatio + a.heightRatio) * base.height }, bounds);
        const rect = mapRegionToCanvas(region, bounds, canvas.width, canvas.height);
        totalPixels += rect.sw * rect.sh;
        if (!rect.sw || !rect.sh || totalPixels > 24_000_000) throw new Error('原文区域过大或无效。');
        const crop = document.createElement('canvas'); crops.push(crop);
        crop.width = rect.sw; crop.height = rect.sh;
        const cropContext = crop.getContext('2d');
        if (!cropContext) throw new Error('无法生成原文裁剪。');
        cropContext.drawImage(canvas, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
      } finally { canvas.width = 0; canvas.height = 0; }
    }
    combined.width = Math.max(...crops.map((crop) => crop.width));
    combined.height = crops.reduce((height, crop) => height + crop.height, 0) + (crops.length - 1) * 12;
    if (combined.width * combined.height > 32_000_000) throw new Error('合并原文区域过大。');
    const ctx = combined.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('无法合并原文区域。');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, combined.width, combined.height);
    let y = 0;
    for (const crop of crops) { ctx.drawImage(crop, 0, y); y += crop.height + 12; }
    const bounds = { left: 0, top: 0, width: combined.width, height: combined.height };
    const capture = await captureCanvasRegion(combined, bounds,
      normalizeRegion({ x: 0, y: 0 }, { x: combined.width, y: combined.height }, bounds), options);
    const captureMs = Math.max(0, performance.now() - startedAt);
    return { imageDataUrl: capture.dataUrl, imageWidth: capture.width, imageHeight: capture.height,
      captureMs, pageRenderMs, cropEncodeMs: Math.max(0, captureMs - pageRenderMs) };
  } finally {
    combined.width = 0; combined.height = 0;
    for (const crop of crops) { crop.width = 0; crop.height = 0; }
  }
}
