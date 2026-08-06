import {
  normalizeVisionLatexText,
  repairCommonVisionLatex,
} from '../core/translation/formula-output-validation';

function restoreEscapedClosingDollars(text: string): string {
  return text.replace(
    /(^|[^\\])\$([\s\S]*?)\\\$(?=$|[\s,.;:，。；：、!?！？)）\]}])/gu,
    (_match, prefix: string, body: string) => `${prefix}$${body}$`,
  );
}

/**
 * Returns editable LaTeX rather than the JSON-style escaped form occasionally
 * returned by vision providers. Genuine `\\` row separators are preserved.
 */
export function normalizeFormulaLatexForClipboard(text: string): string {
  return repairCommonVisionLatex(
    restoreEscapedClosingDollars(text),
  );
}

/** Normalizes LaTeX escapes in a translated passage without touching plain prose. */
export function normalizeLatexForClipboard(text: string): string {
  return normalizeVisionLatexText(text);
}
