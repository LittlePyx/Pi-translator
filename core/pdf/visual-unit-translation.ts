import { compactFormulaDocument, formulaDocumentText, recoverLegacyFormulaDocument, isFormulaDocument,
  type FormulaDocument } from '../translation/formula-document';
import type { PdfBackgroundTranslationOutcome } from './background-document-translation';
import type { PdfDocumentVisualUnit } from './document-translation';

export function pdfVisualUnitContext(units: readonly PdfDocumentVisualUnit[], index: number, context = ''): string {
  return [context, '以下相邻内容仅供理解上下文，不得重复翻译；只输出本次图像内的内容。',
    index ? `前文：${units[index - 1]!.text.slice(-300)}` : '',
    units[index + 1] ? `后文：${units[index + 1]!.text.slice(0, 300)}` : ''].filter(Boolean).join('\n');
}

/** Each request may restart its registry at m1. Remap IDs before displaying
 * one continuous reading block; never join ambiguous math by array position. */
export function combinePdfVisualOutcomes(blockId: string, outcomes: readonly PdfBackgroundTranslationOutcome[]): PdfBackgroundTranslationOutcome {
  if (outcomes.length === 1) return { ...outcomes[0]!, blockId };
  const doc: FormulaDocument = { version: 1, sourceTemplate: '', translationTemplate: '', formulas: [], issues: [] };
  let opaqueReferences = false;
  for (const outcome of outcomes) {
    const source = outcome.formulaDocument ?? (!outcome.formulaReviewDraft && outcome.visualProcessed
      ? recoverLegacyFormulaDocument(outcome.translatedText, outcome.translatedText) : undefined);
    if (!source) {
      opaqueReferences ||= /\{\{m[1-9]\d{0,2}\}\}/u.test(outcome.translatedText);
      // Keep opaque candidates as plain text, not newly trusted math.
      doc.translationTemplate += `${outcome.translatedText} `;
      continue;
    }
    const ids = new Map(source.formulas.map((entry, index) => [entry.id, `m${doc.formulas.length + index + 1}`]));
    const remap = (text: string) => text.replace(/\{\{(m[1-9]\d{0,2})\}\}/gu, (ref, id: string) => ids.has(id) ? `{{${ids.get(id)}}}` : ref);
    doc.sourceTemplate += `${remap(source.sourceTemplate)} `;
    doc.translationTemplate += `${remap(source.translationTemplate)} `;
    doc.formulas.push(...source.formulas.map((entry) => ({ ...entry, id: ids.get(entry.id)! })));
    doc.issues.push(...source.issues);
  }
  const reasons = outcomes.flatMap((outcome, index) =>
    outcome.formulaReviewMessage || outcome.visualFallbackMessage
      ? [`区域 ${index + 1}：${outcome.formulaReviewMessage ?? outcome.visualFallbackMessage}`] : []);
  // A neighboring safe registry cannot turn an opaque draft/source fallback
  // into trusted math. Render the combined candidate literally in that case.
  const hasDraft = outcomes.some(outcome => outcome.formulaReviewDraft || outcome.visualFallbackMessage);
  const valid = !opaqueReferences && !hasDraft && isFormulaDocument(doc);
  if (!valid && !hasDraft) reasons.push(opaqueReferences ? '未登记的内部引用无法安全合并，请对照原文' : '合并结果超过公式登记限制，请对照原文');
  if (outcomes.every(outcome => outcome.visualFallbackMessage)) return {
    blockId, translatedText: outcomes.map(outcome => outcome.translatedText).join(' '), visualProcessed: false,
    visualFallbackMessage: reasons.join('；').slice(0, 1800),
  };
  return { blockId, translatedText: valid ? formulaDocumentText(doc) : outcomes.map((o) => o.translatedText).join(' '),
    ...(valid ? { formulaDocument: compactFormulaDocument(doc) } : { formulaReviewDraft: true as const }),
    visualProcessed: valid && outcomes.every((outcome) => outcome.visualProcessed),
    ...(reasons.length ? { formulaReviewMessage: reasons.join('；').slice(0, 1800) } : {}) };
}

export function pdfEquationCoverageIssues(expected: readonly string[] | undefined, text: string): string[] {
  if (!expected) return [];
  const numbers = [...text.matchAll(/\\tag\*?\s*\{(\d{1,4}[a-z]?)\}|(?:^|\n)\s*\((\d{1,4}[a-z]?)\)\s*(?=$|\n)/gimu)]
    .map((match) => match[1] ?? match[2]!);
  const missing = expected.filter((number) => !numbers.includes(number));
  const duplicate = [...new Set(numbers.filter((number, i) => numbers.indexOf(number) !== i))];
  const extra = numbers.filter((number) => !expected.includes(number));
  return [missing.length ? `未对应原文公式编号：${missing.join('、')}` : '',
    duplicate.length ? `公式编号重复：${duplicate.join('、')}` : '',
    extra.length ? `出现原文区域之外的公式编号：${extra.join('、')}` : ''].filter(Boolean);
}
