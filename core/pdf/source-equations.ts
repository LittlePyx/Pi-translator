import type { PdfDocumentTranslationPageInput, PdfDocumentTranslationSourceRegion } from './document-translation';
import type { SourceEquation } from '../translation/source-equations';

/** Read only isolated right-hand labels in locally owned mathematical lines.
 * Paragraph references such as “Eq. (3)” must never become new equation rows. */
export function sourceEquationsForRegion(
  page: PdfDocumentTranslationPageInput, region: PdfDocumentTranslationSourceRegion,
  expected: readonly string[],
): SourceEquation[] {
  const a = region.sourceAnchor;
  const left = a.leftRatio * page.pageWidth, right = (a.leftRatio + a.widthRatio) * page.pageWidth;
  const top = a.topRatio * page.pageHeight, bottom = (a.topRatio + a.heightRatio) * page.pageHeight;
  const items = page.items.flatMap((item) => {
    if (![item.left, item.top, item.width, item.height].every((n) => typeof n === 'number' && Number.isFinite(n))) return [];
    const x = item.left!, y = item.top!, w = item.width!, h = item.height!;
    return x + w / 2 >= left && x + w / 2 <= right && y + h / 2 >= top && y + h / 2 <= bottom
      ? [{ text: item.str, x, y, w, h, baseline: y + h, braceInk: item.leftBraceInkBounds }] : [];
  });
  const rows = items.flatMap((label) => {
    const match = /^\s*\((\d{1,4}[a-z]?)\)\s*$/iu.exec(label.text);
    if (!match || !expected.includes(match[1]!) || label.x < left + (right - left) * .65) return [];
    const previous = items.filter((item) => item.x + item.w <= label.x && Math.abs(item.baseline - label.baseline) < label.h * .25)
      .sort((a, b) => b.x + b.w - a.x - a.w)[0];
    if (previous && /\b(?:Eq|Eqs|Equation|Equations|Fig|Figure)\.?\s*$/iu.test(previous.text)) return [];
    let sameRow = items.filter((item) => item !== label && item.x + item.w <= label.x + 1 &&
      Math.abs(item.baseline - label.baseline) <= Math.max(label.h, item.h) * .8);
    // A single label can sit centrally beside a two-line aligned equation.
    // Expand only around nearby equality rows, never to the whole paragraph.
    let rowCount: number | undefined;
    if (!sameRow.some((item) => /[=≈≤≥∈]/u.test(item.text))) {
      const equalRows = items.filter((item) => /[=≈≤≥]/u.test(item.text) && item.x < label.x &&
        Math.abs(item.baseline - label.baseline) <= label.h * 2.2);
      const uniqueAbove = equalRows.filter(row => /(?:^|[^=])=(?:[^=]|$)/u.test(row.text) && row.baseline < label.baseline);
      const oneBaseline = uniqueAbove.length > 0 && uniqueAbove.every(row =>
        Math.abs(row.baseline - uniqueAbove[0]!.baseline) < label.h * .8);
      const belowDisplay = oneBaseline && !equalRows.some(row => row.baseline > label.baseline) &&
        !items.some(item => item !== label && item.y > uniqueAbove[0]!.baseline && item.baseline < label.y && /[A-Za-z]{4,}/u.test(item.text));
      if (belowDisplay || equalRows.some((row) => row.baseline < label.baseline) && equalRows.some((row) => row.baseline > label.baseline)) {
        const baselines: number[] = [];
        for (const row of [...equalRows].sort((a, b) => a.baseline - b.baseline)) {
          if (!baselines.some((baseline) => Math.abs(baseline - row.baseline) < label.h * .8)) baselines.push(row.baseline);
        }
        const anotherLabel = items.some((item) => item !== label && /^\s*\(\d+[a-z]?\)\s*$/iu.test(item.text) &&
          Math.abs(item.x - label.x) < label.h * 2 && Math.abs(item.baseline - label.baseline) < label.h * 3);
        if (!anotherLabel && baselines.length >= 2 && baselines.length <= 8) rowCount = baselines.length;
        sameRow = items.filter((item) => item !== label && item.x + item.w <= label.x + 1 &&
          equalRows.some((row) => Math.abs(item.baseline - row.baseline) <= Math.max(label.h, item.h) * .8));
      }
    }
    // A labelled final summand may be below every equality row. Bind it only
    // through the adjacent mathematical display, stopping at prose or labels.
    let continuedDisplay=false;
    if (!sameRow.some(item=>/[=≈≤≥∈]/u.test(item.text)) &&
        sameRow.some(item=>/^[+−-]/u.test(item.text.trim())) &&
        sameRow.some(item=>/\bln\b|\blog\b|∑|∫/u.test(item.text))) {
      const column=items.filter(item=>item.x<label.x && item.baseline<=label.baseline+label.h*.8 &&
        item.baseline>=label.baseline-label.h*7);
      const barrier=Math.max(-Infinity,...column.filter(item=>/[A-Za-z]{4,}/u.test(item.text)||
        /^\s*\(\d+[a-z]?\)\s*$/iu.test(item.text)).map(item=>item.baseline));
      let display=column.filter(item=>item.baseline>barrier+label.h*.8);
      // A preceding unnumbered definition can share the display area while
      // the numbered equality chain starts farther left (e.g. z_K=... above
      // F(x)=...=...). Do not assign its row to the later number.
      const equalityRows=display.filter(item=>/[=≈≤≥]/u.test(item.text)).map(row=>({row,left:Math.min(...display.filter(item=>Math.abs(item.baseline-row.baseline)<label.h*.8).map(item=>item.x))}));
      const leftmost=Math.min(...equalityRows.map(item=>item.left));
      const chainStart=equalityRows.find(item=>item.left<=leftmost+label.h*.6)?.row.baseline;
      if(chainStart!==undefined)display=display.filter(item=>item.baseline>=chainStart-label.h*.8);
      if(display.some(item=>/[=≈≤≥]/u.test(item.text))){
        sameRow=display;continuedDisplay=true;
        const baselines:number[]=[];
        for(const item of display.filter(item=>/[=≈≤≥]/u.test(item.text)||Math.abs(item.baseline-label.baseline)<label.h*.8).sort((a,b)=>a.baseline-b.baseline)){
          if(!baselines.some(b=>Math.abs(b-item.baseline)<label.h*.8))baselines.push(item.baseline);
        }
        if(baselines.length>=2&&baselines.length<=8)rowCount=baselines.length;
      }
    }
    const hint = sameRow.sort((a, b) => continuedDisplay ? a.baseline-b.baseline || a.x-b.x : a.x-b.x).map((item) => item.text).join(' ').trim();
    if (!/[=≈≤≥∈]/u.test(hint) || (hint.match(/[A-Za-z]{3,}/gu)?.length ?? 0) > 6) return [];
    const id = `eq-p${page.pageNumber}-x${Math.round(label.x / page.pageWidth * 100000)}-y${Math.round(label.baseline / page.pageHeight * 100000)}`;
    return [{ id, number: match[1]!, rowHint: hint.slice(0, 500), label, ...(rowCount ? { rowCount } : {}) }];
  });
  // Tall left-brace pieces have separate PDF glyphs. Group only rows actually
  // enclosed by those pieces, not every formula in the surrounding paragraph.
  const braces = items.flatMap(item => {
    const ink = item.braceInk;
    if (ink && Number.isFinite(ink.top) && Number.isFinite(ink.bottom) && ink.bottom > ink.top &&
        ink.bottom - ink.top <= item.h * 4) return [{...item,y:ink.top,baseline:ink.bottom,h:ink.bottom-ink.top}];
    return /^[{⎧⎨⎩⎪]+$/u.test(item.text.trim()) ? [item] : [];
  });
  const groups = new Map<string, string>();
  for (const brace of braces) {
    const column = braces.filter((item) => !item.braceInk && Math.abs(item.x - brace.x) < Math.max(3, brace.w));
    const connected = brace.braceInk ? [brace] : column.filter((item) => Math.abs(item.y - brace.y) < Math.max(70, brace.h * 2));
    const y1 = Math.min(...connected.map((b) => b.y)), y2 = Math.max(...connected.map((b) => b.baseline));
    const owned = rows.filter((row) => row.label.x > brace.x && row.label.baseline >= y1 && row.label.y <= y2);
    if (owned.length > 1) for (const row of owned) groups.set(row.id, owned[0]!.id);
  }
  return rows.map(({ label: _label, ...row }) => ({ ...row, ...(groups.has(row.id) ? { groupId: groups.get(row.id)! } : {}) }));
}
