export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RegionRect extends RectLike {
  right: number;
  bottom: number;
}

export type RegionResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

export interface CanvasRegion {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface EncodedImageRegion {
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
}

const DEFAULT_MAX_EDGE = 2048;
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeRegion(
  start: Point,
  end: Point,
  bounds: RectLike,
): RegionRect {
  const boundsRight = bounds.left + Math.max(0, bounds.width);
  const boundsBottom = bounds.top + Math.max(0, bounds.height);
  const startX = clamp(start.x, bounds.left, boundsRight);
  const startY = clamp(start.y, bounds.top, boundsBottom);
  const endX = clamp(end.x, bounds.left, boundsRight);
  const endY = clamp(end.y, bounds.top, boundsBottom);
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const right = Math.max(startX, endX);
  const bottom = Math.max(startY, endY);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function isUsableRegion(region: Pick<RegionRect, 'width' | 'height'>, minimum = 18): boolean {
  return region.width >= minimum && region.height >= minimum;
}

function regionRect(left: number, top: number, right: number, bottom: number): RegionRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function moveRegion(
  region: RegionRect,
  delta: Point,
  bounds: RectLike,
): RegionRect {
  const boundsRight = bounds.left + Math.max(0, bounds.width);
  const boundsBottom = bounds.top + Math.max(0, bounds.height);
  const width = Math.min(region.width, Math.max(0, bounds.width));
  const height = Math.min(region.height, Math.max(0, bounds.height));
  const left = clamp(region.left + delta.x, bounds.left, boundsRight - width);
  const top = clamp(region.top + delta.y, bounds.top, boundsBottom - height);
  return regionRect(left, top, left + width, top + height);
}

export function resizeRegion(
  region: RegionRect,
  handle: RegionResizeHandle,
  point: Point,
  bounds: RectLike,
  minimum = 18,
): RegionRect {
  const boundsRight = bounds.left + Math.max(0, bounds.width);
  const boundsBottom = bounds.top + Math.max(0, bounds.height);
  const minimumWidth = Math.min(Math.max(0, minimum), Math.max(0, bounds.width));
  const minimumHeight = Math.min(Math.max(0, minimum), Math.max(0, bounds.height));
  let { left, top, right, bottom } = region;

  if (handle.includes('w')) {
    left = clamp(point.x, bounds.left, right - minimumWidth);
  } else {
    right = clamp(point.x, left + minimumWidth, boundsRight);
  }
  if (handle.includes('n')) {
    top = clamp(point.y, bounds.top, bottom - minimumHeight);
  } else {
    bottom = clamp(point.y, top + minimumHeight, boundsBottom);
  }

  return regionRect(left, top, right, bottom);
}

export function mapRegionToCanvas(
  region: RegionRect,
  pageBounds: RectLike,
  canvasWidth: number,
  canvasHeight: number,
): CanvasRegion {
  if (pageBounds.width <= 0 || pageBounds.height <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error('PDF 页面尚未完成渲染。');
  }
  const scaleX = canvasWidth / pageBounds.width;
  const scaleY = canvasHeight / pageBounds.height;
  const left = clamp(Math.floor((region.left - pageBounds.left) * scaleX), 0, canvasWidth);
  const top = clamp(Math.floor((region.top - pageBounds.top) * scaleY), 0, canvasHeight);
  const right = clamp(Math.ceil((region.right - pageBounds.left) * scaleX), left, canvasWidth);
  const bottom = clamp(Math.ceil((region.bottom - pageBounds.top) * scaleY), top, canvasHeight);
  return {
    sx: left,
    sy: top,
    sw: right - left,
    sh: bottom - top,
  };
}

export function scaledImageDimensions(
  width: number,
  height: number,
  maxEdge = DEFAULT_MAX_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法读取框选图像。'));
    }, { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取框选图像。')), { once: true });
    reader.readAsDataURL(blob);
  });
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('浏览器无法编码框选图像。')),
      mimeType,
      quality,
    );
  });
}

export async function captureCanvasRegion(
  source: HTMLCanvasElement,
  pageBounds: RectLike,
  region: RegionRect,
  options: { maxEdge?: number; maxBytes?: number } = {},
): Promise<EncodedImageRegion> {
  const mapped = mapRegionToCanvas(region, pageBounds, source.width, source.height);
  if (mapped.sw < 11 || mapped.sh < 11) throw new Error('框选范围太小，请重新框选。');
  const ratio = Math.max(mapped.sw / mapped.sh, mapped.sh / mapped.sw);
  if (ratio > 200) throw new Error('框选区域过于狭长，请扩大较短的一边。');

  const maxEdge = Math.max(256, options.maxEdge ?? DEFAULT_MAX_EDGE);
  const maxBytes = Math.max(64 * 1024, options.maxBytes ?? DEFAULT_MAX_BYTES);
  let dimensions = scaledImageDimensions(mapped.sw, mapped.sh, maxEdge);
  const output = document.createElement('canvas');
  const context = output.getContext('2d', { alpha: false });
  if (!context) throw new Error('浏览器无法创建框选图像。');

  const draw = (): void => {
    output.width = dimensions.width;
    output.height = dimensions.height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      source,
      mapped.sx,
      mapped.sy,
      mapped.sw,
      mapped.sh,
      0,
      0,
      output.width,
      output.height,
    );
  };

  draw();
  let mimeType: 'image/png' | 'image/jpeg' = 'image/png';
  let blob = await encodeCanvas(output, mimeType);
  if (blob.size > maxBytes) {
    mimeType = 'image/jpeg';
    for (const quality of [0.92, 0.84, 0.76]) {
      blob = await encodeCanvas(output, mimeType, quality);
      if (blob.size <= maxBytes) break;
    }
  }
  for (let attempt = 0; blob.size > maxBytes && attempt < 3; attempt += 1) {
    dimensions = {
      width: Math.max(11, Math.round(dimensions.width * 0.78)),
      height: Math.max(11, Math.round(dimensions.height * 0.78)),
    };
    draw();
    blob = await encodeCanvas(output, 'image/jpeg', 0.8);
    mimeType = 'image/jpeg';
  }
  if (blob.size > maxBytes) {
    throw new Error('框选图像仍然过大，请缩小框选范围后重试。');
  }
  return {
    dataUrl: await blobToDataUrl(blob),
    mimeType,
    width: output.width,
    height: output.height,
    bytes: blob.size,
  };
}
