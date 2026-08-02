import type { ViewportRect } from './types';

export interface ImageCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export function mapViewportRectToImage(
  rect: ViewportRect,
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
  padding = 8,
): ImageCropRect | undefined {
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) return undefined;
  const scaleX = imageWidth / viewportWidth;
  const scaleY = imageHeight / viewportHeight;
  const left = Math.max(0, Math.floor((rect.left - padding) * scaleX));
  const top = Math.max(0, Math.floor((rect.top - padding) * scaleY));
  const right = Math.min(imageWidth, Math.ceil((rect.right + padding) * scaleX));
  const bottom = Math.min(imageHeight, Math.ceil((rect.bottom + padding) * scaleY));
  if (right - left < 11 || bottom - top < 11) return undefined;
  return { sx: left, sy: top, sw: right - left, sh: bottom - top };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('无法读取网页选区截图。')), {
      once: true,
    });
    image.src = dataUrl;
  });
}

export async function cropVisibleTabSelection(
  dataUrl: string,
  rect: ViewportRect,
  maxEdge = 2048,
  padding = 8,
): Promise<{ dataUrl: string; width: number; height: number } | undefined> {
  const image = await loadImage(dataUrl);
  const crop = mapViewportRectToImage(
    rect,
    innerWidth,
    innerHeight,
    image.naturalWidth,
    image.naturalHeight,
    padding,
  );
  if (!crop) return undefined;
  const scale = Math.min(1, maxEdge / Math.max(crop.sw, crop.sh));
  const width = Math.max(11, Math.round(crop.sw * scale));
  const height = Math.max(11, Math.round(crop.sh * scale));
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d', { alpha: false });
  if (!context) return undefined;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    0,
    0,
    width,
    height,
  );
  return { dataUrl: output.toDataURL('image/png'), width, height };
}
