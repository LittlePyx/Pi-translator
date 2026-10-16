import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfLeftBraceGlyphMetrics } from '../../core/pdf/tex-font-glyphs';
import {pdfNativeMathFontHints} from '../../core/pdf/math-font-evidence';
import { preparePdfDocumentTranslationPages, type PdfDocumentTranslationPageInput } from '../../core/pdf/document-translation';

/** Local-only optional acceptance. No paper bytes or model credentials are checked in. */
export async function readLocalPdfLayout(sourcePath: string) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(sourcePath)),
    standardFontDataUrl: `${path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/')}/` }).promise;
  const inputs: PdfDocumentTranslationPageInput[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const braceMetrics = await pdfLeftBraceGlyphMetrics(page, content, OPS);
      const mathFonts=await pdfNativeMathFontHints(page,content,OPS);
      inputs.push({ pageNumber, pageWidth: viewport.width, pageHeight: viewport.height,
        items: content.items.flatMap((item) => {
          if (!('str' in item) || !item.str.trim()) return [];
          const baseline = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          const height = Math.max(Math.abs(item.height), Math.hypot(item.transform[2], item.transform[3]));
          return [{ str: item.str, hasEOL: item.hasEOL, left: baseline[0], top: baseline[1] - height,
            ...(mathFonts.has(item)?{mathFont:mathFonts.get(item)!}:{}),
            width: Math.abs(item.width), height, descent: Math.max(0, -(content.styles[item.fontName]?.descent ?? 0)) * height,
            ...(braceMetrics.has(item) ? {leftBraceInkBounds:{top:baseline[1]-braceMetrics.get(item)!.ascent*height,
              bottom:baseline[1]+braceMetrics.get(item)!.descent*height}} : {}) }];
        }) });
    }
    return preparePdfDocumentTranslationPages(inputs);
  } finally { await pdf.destroy(); }
}
