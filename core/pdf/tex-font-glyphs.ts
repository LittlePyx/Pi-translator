import type { PDFPageProxy, TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';

interface Glyph { originalCharCode: number; unicode: string; width: number; isInFont: boolean }
interface Font { name: string; missingFile: boolean }
interface Operators { setFont: number; showText: number; save: number; restore: number; setGState: number }
export interface LeftBraceMetrics { ascent: number; descent: number }

/** CMEX10 Type1 slot 0x28 is braceleftBigg, not an ASCII parenthesis.
 * The original code and advance must both match the font's published AFM.
 * https://www-archive.mozilla.org/projects/mathml/fonts/encoding/cmex
 * https://mirrors.ctan.org/fonts/cm/afm/cmex10.afm (B 144 -2959 661 39)
 */
function leftBraceMetrics(font: Font, glyph: Glyph): LeftBraceMetrics | undefined {
  if (!/^(?:[A-Z]{6}\+)?CMEX10$/iu.test(font.name) || font.missingFile || !glyph.isInFont ||
      glyph.originalCharCode !== 0x28 || glyph.unicode !== '(' || Math.abs(glyph.width - 806) > 1) return;
  return { ascent: .039, descent: 2.959 };
}

/** Recover only a verified single glyph. A Unicode character alone cannot
 * distinguish two different source slots, so ambiguous advances stay unknown.
 * No font bytes are retained, no PDF text or model mathematics is rewritten.
 */
export async function pdfLeftBraceGlyphMetrics(
  page: PDFPageProxy, content: TextContent, ops: Operators,
): Promise<Map<TextItem, LeftBraceMetrics>> {
  const result = new Map<TextItem, LeftBraceMetrics>();
  const candidates = content.items.filter((item): item is TextItem => 'str' in item && item.str === '(' &&
    Math.abs(item.transform[1]) < .001 && Math.abs(item.transform[2]) < .001 && item.transform[0] > 0 && item.transform[3] > 0 &&
    (content.styles[item.fontName]?.ascent ?? 1) < .1 && (content.styles[item.fontName]?.descent ?? 0) < -.5);
  if (!candidates.length) return result;
  try {
    const operatorList = await page.getOperatorList();
    const names = new Set(candidates.map(item => item.fontName));
    const glyphs = new Map<string, Glyph[]>();
    let currentFont = '';
    const stack: string[] = [];
    for (let index = 0; index < operatorList.fnArray.length; index++) {
      const fn = operatorList.fnArray[index], args = operatorList.argsArray[index];
      if (fn === ops.save) stack.push(currentFont);
      if (fn === ops.restore) currentFont = stack.pop() ?? '';
      if (fn === ops.setFont) currentFont = args[0];
      if (fn === ops.setGState) for (const state of args[0]) if (state[0] === 'Font') currentFont = state[1][0];
      if (fn !== ops.showText || !names.has(currentFont)) continue;
      for (const glyph of args[0]) if (glyph && glyph.unicode === '(') {
        const list = glyphs.get(currentFont) ?? [];
        if (!list.some(entry => entry.originalCharCode === glyph.originalCharCode && entry.width === glyph.width)) list.push(glyph);
        glyphs.set(currentFont, list);
      }
    }
    for (const item of candidates) {
      const width = item.width * 1000 / item.transform[0];
      const matches = (glyphs.get(item.fontName) ?? []).filter(glyph => Math.abs(glyph.width - width) <= 1);
      if (matches.length !== 1) continue;
      const font = page.commonObjs.get(item.fontName) as Font;
      const metrics = font && leftBraceMetrics(font, matches[0]!);
      if (metrics) result.set(item, metrics);
    }
  } catch {
    // Missing/unsupported font evidence cannot justify adding punctuation.
  }
  return result;
}
