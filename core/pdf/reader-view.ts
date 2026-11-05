export type PdfViewRotation = 0 | 90 | 180 | 270;
export interface PdfViewRect { leftRatio: number; topRatio: number; widthRatio: number; heightRatio: number }

/** Coordinates remain relative to the PDF's original displayed orientation. */
export function rotatePdfViewRect(rect: PdfViewRect, rotation: number): PdfViewRect {
  const {leftRatio:x, topRatio:y, widthRatio:w, heightRatio:h} = rect;
  switch ((rotation % 360 + 360) % 360) {
    case 90: return {leftRatio:1-y-h, topRatio:x, widthRatio:h, heightRatio:w};
    case 180: return {leftRatio:1-x-w, topRatio:1-y-h, widthRatio:w, heightRatio:h};
    case 270: return {leftRatio:y, topRatio:1-x-w, widthRatio:h, heightRatio:w};
    default: return {...rect};
  }
}
