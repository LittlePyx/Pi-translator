import { extractDelimitedFormulae, normalizeFormula, normalizeVisionLatexText,
  repairCommonVisionLatex, structuralIssues } from './formula-output-validation';
import { hasUnregisteredMath, sameTemplateMath, templateMathSpans } from './formula-template';
import { SOURCE_EQUATION_ID, EQUATION_LABEL } from './source-equations';
import { registerPlainSourceIdentifiers } from './formula-identifier-recovery';

/** Each distinct expression is transcribed once. Templates refer to it, never by index.
 * A renderable transcription is NOT a claim of semantic/pixel correctness.
 */
export interface FormulaEntry {
  id: string;
  latex: string;
  display: boolean;
  review?: string;
  sourceEquationId?: string;
  /** Set by the local PDF row resolver, never accepted from provider JSON. */
  equationNumber?: string;
  equationGroupId?: string;
}
export interface FormulaDocument {
  version: 1;
  sourceTemplate: string;
  translationTemplate: string;
  formulas: FormulaEntry[];
  issues: string[];
}
const ID = /^m[1-9]\d{0,2}$/u;
const REF = /\{\{(m[1-9]\d{0,2})\}\}/gu;
const MAX_TEXT = 16_000;
const MAX_FORMULAS = 96;
const MAX_TOTAL = 32_000;
const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const references = (text: string) => [...text.matchAll(REF)].map((match) => match[1]!);
const mathIssues = (latex: string): string[] => [
  ...structuralIssues(latex),
  ...(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(latex) ? ['公式中混入正文'] : []),
];

/** Shape-only allowlist for storage. All rendering decisions are revalidated. */
export function isFormulaDocument(value: unknown): value is FormulaDocument {
  const doc = recordOf(value);
  if (!doc || doc.version !== 1 || !Object.keys(doc).every((key) =>
    ['version', 'sourceTemplate', 'translationTemplate', 'formulas', 'issues'].includes(key))) return false;
  if (![doc.sourceTemplate, doc.translationTemplate].every((text) =>
    typeof text === 'string' && text.length <= MAX_TEXT) ||
    !Array.isArray(doc.formulas) || doc.formulas.length > MAX_FORMULAS ||
    !Array.isArray(doc.issues) || doc.issues.length > MAX_FORMULAS ||
    !doc.issues.every((issue) => typeof issue === 'string' && issue.length <= 1000)) return false;
  const ids = new Set<string>();
  for (const value of doc.formulas) {
    const entry = recordOf(value);
    if (!entry || !Object.keys(entry).every((key) => ['id', 'latex', 'display', 'review', 'sourceEquationId', 'equationNumber', 'equationGroupId'].includes(key)) ||
      typeof entry.id !== 'string' || !ID.test(entry.id) || ids.has(entry.id) ||
      typeof entry.latex !== 'string' || entry.latex.length > 2048 || typeof entry.display !== 'boolean' ||
      (entry.review !== undefined && (typeof entry.review !== 'string' || entry.review.length > 1000)) ||
      (entry.sourceEquationId !== undefined && (typeof entry.sourceEquationId !== 'string' || !SOURCE_EQUATION_ID.test(entry.sourceEquationId))) ||
      (entry.equationNumber !== undefined && (!entry.sourceEquationId || !entry.display || typeof entry.equationNumber !== 'string' || !EQUATION_LABEL.test(entry.equationNumber))) ||
      (entry.equationGroupId !== undefined && (!entry.equationNumber || typeof entry.equationGroupId !== 'string' || !SOURCE_EQUATION_ID.test(entry.equationGroupId)))) return false;
    ids.add(entry.id);
  }
  return JSON.stringify(doc).length <= MAX_TOTAL;
}

export function formulaDocumentIssues(doc: FormulaDocument): string[] {
  return [...new Set([...doc.issues, ...(hasUnregisteredMath(doc.translationTemplate.replace(REF,''))?['正文中存在未登记或破损的数学内容，请对照原文']:[]), ...doc.formulas.flatMap((entry) => {
    const review = formulaEntryReview(doc, entry);
    return review ? [`${entry.id}: ${review}`] : [];
  })])];
}

function formulaEntryReview(doc: FormulaDocument, entry: FormulaEntry): string | undefined {
  // Old retained documents used this exact flag for any repeated reference.
  // Recompute only that count-only flag; never clear uncertainty/math errors.
  if (entry.review && entry.review !== '原文或译文中的编号缺失或重复') return entry.review;
  const sourceCount = references(doc.sourceTemplate).filter((id) => id === entry.id).length;
  const translatedCount = references(doc.translationTemplate).filter((id) => id === entry.id).length;
  if (!sourceCount || sourceCount !== translatedCount) return '原文或译文中的编号缺失或重复';
  return mathIssues(entry.latex).join('；') || undefined;
}

function registerTemplateMath(doc: FormulaDocument): void {
  // A known reference may be redundantly wrapped in math delimiters. Its
  // registered expression and display mode already define the rendering.
  for (const field of ['sourceTemplate', 'translationTemplate'] as const) {
    for (const span of templateMathSpans(doc[field]).reverse()) {
      const ref = /^\{\{(m[1-9]\d{0,2})\}\}$/u.exec(span.latex.trim());
      const entry = ref && doc.formulas.find(formula=>formula.id===ref[1]);
      if (entry && entry.display===span.display) doc[field]=doc[field].slice(0,span.start)+`{{${entry.id}}}`+doc[field].slice(span.end);
    }
  }
  const nextId = () => {
    for (let n = 1; n <= 999; n += 1) if (!doc.formulas.some((entry) => entry.id === `m${n}`) &&
      ![...references(doc.sourceTemplate), ...references(doc.translationTemplate)].includes(`m${n}`)) return `m${n}`;
    throw new Error('No free formula ID');
  };
  for (const field of ['sourceTemplate', 'translationTemplate'] as const) {
    if (field === 'translationTemplate') registerPlainSourceIdentifiers(doc, nextId);
    const template = doc[field];
    const spans = templateMathSpans(template);
    let cursor = 0;
    let output = '';
    for (const span of spans) {
      let entry = field === 'translationTemplate' ? doc.formulas.find((candidate) =>
        sameTemplateMath(candidate.latex, span.latex) &&
        references(doc.sourceTemplate).filter((id) => id === candidate.id).length >
        references(output + template.slice(cursor)).filter((id) => id === candidate.id).length) : undefined;
      if (!entry) {
        entry = { id: nextId(), latex: span.latex, display: span.display,
          ...(field === 'translationTemplate' ? { review: '未登记的数学内容无法与识别原文可靠对应' } : {}) };
        doc.formulas.push(entry);
      }
      output += template.slice(cursor, span.start) + `{{${entry.id}}}`;
      cursor = span.end;
    }
    doc[field] = output + template.slice(cursor);
  }
}

/** Called only for an explicitly declared refs-v1 provider contract. */
export function parseFormulaDocument(record: Record<string, unknown>): FormulaDocument {
  if (typeof record.recognizedText !== 'string' || typeof record.translation !== 'string' ||
    record.recognizedText.length > MAX_TEXT || record.translation.length > MAX_TEXT ||
    !Array.isArray(record.formulas) || record.formulas.length > MAX_FORMULAS) throw new Error('Invalid formula registry');
  const doc: FormulaDocument = { version: 1, sourceTemplate: record.recognizedText.trim(),
    translationTemplate: record.translation.trim(), formulas: [], issues: [] };
  for (const value of record.formulas) {
    const entry = recordOf(value);
    if (!entry || typeof entry.id !== 'string' || !ID.test(entry.id) ||
      typeof entry.latex !== 'string' || entry.latex.length > 2048 || typeof entry.display !== 'boolean') {
      doc.issues.push('公式登记项格式不完整'); continue;
    }
    const duplicate = doc.formulas.find((candidate) => candidate.id === entry.id);
    if (duplicate) { duplicate.review = '公式编号重复，无法确定对应内容'; continue; }
    const latex = repairCommonVisionLatex(entry.latex.trim());
    const reasons = mathIssues(latex);
    if (entry.uncertain === true || (typeof entry.uncertain === 'string' && entry.uncertain.trim())) {
      reasons.push('模型标记为无法确认');
    }
    if (entry.sourceEquationId !== undefined && (typeof entry.sourceEquationId !== 'string' || !SOURCE_EQUATION_ID.test(entry.sourceEquationId))) {
      reasons.push('原文公式行标识无效');
    }
    doc.formulas.push({ id: entry.id, latex, display: entry.display,
      ...(typeof entry.sourceEquationId === 'string' && SOURCE_EQUATION_ID.test(entry.sourceEquationId) ? { sourceEquationId: entry.sourceEquationId } : {}),
      ...(reasons.length ? { review: reasons.join('；').slice(0, 1000) } : {}) });
  }
  registerTemplateMath(doc);
  const sourceRefs = references(doc.sourceTemplate);
  const translatedRefs = references(doc.translationTemplate);
  for (const id of new Set([...sourceRefs, ...translatedRefs])) {
    if (!doc.formulas.some((entry) => entry.id === id)) {
      doc.formulas.push({ id, latex: '', display: false, review: '编号未登记公式' });
    }
  }
  for (const template of [doc.sourceTemplate, doc.translationTemplate]) {
    const prose = template.replace(REF, '');
    if (hasUnregisteredMath(prose)) doc.issues.push('正文中存在未登记或破损的数学内容，请对照原文');
  }
  if (Array.isArray(record.uncertainSpans) && record.uncertainSpans.some((span) => typeof span === 'string' && span.trim())) {
    doc.issues.push('模型报告局部内容不确定，请对照原文');
  }
  doc.issues = [...new Set(doc.issues)];
  if (!isFormulaDocument(doc)) throw new Error('Formula registry exceeds limits');
  return doc;
}

export type FormulaDocumentPart = { text: string } | { formula: FormulaEntry; occurrenceId: string };

/** A candidate label is plain review text, never accepted/rendered mathematics. */
export function formulaReviewLabel(entry: FormulaEntry): string {
  if (entry.equationNumber) return `〔公式 (${entry.equationNumber}) 待核对〕`;
  const greek: Record<string, string> = {alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
    theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω'};
  const command = /^\\([a-z]+)$/u.exec(entry.latex.trim());
  const candidate = command ? greek[command[1]!] : /^[A-Za-z]{1,3}$|^[αβγδεθλμπσφω]$/u.test(entry.latex.trim()) ? entry.latex.trim() : undefined;
  return candidate ? `〔${candidate}·待核对〕` : `〔公式 ${entry.id.slice(1)}·待核对〕`;
}

export function formulaDocumentParts(doc: FormulaDocument, source = false): FormulaDocumentPart[] {
  const template = source ? doc.sourceTemplate : doc.translationTemplate;
  const parts: FormulaDocumentPart[] = [];
  const occurrences = new Map<string, number>();
  let cursor = 0;
  for (const match of template.matchAll(REF)) {
    if (match.index! > cursor) parts.push({ text: template.slice(cursor, match.index) });
    const entry = doc.formulas.find((entry) => entry.id === match[1]);
    const formula = entry ?? { id: match[1]!, latex: '', display: false, review: '未登记公式' };
    const review = formulaEntryReview(doc, formula);
    const occurrence = (occurrences.get(formula.id) ?? 0) + 1;
    occurrences.set(formula.id, occurrence);
    const { review: _oldReview, ...clean } = formula;
    parts.push({ formula: review ? { ...formula, review } : clean, occurrenceId: `${formula.id}:${occurrence}` });
    cursor = match.index! + match[0].length;
  }
  if (cursor < template.length) parts.push({ text: template.slice(cursor) });
  return parts;
}

export function formulaDocumentText(doc: FormulaDocument, source = false): string {
  return formulaDocumentParts(doc, source).map((part) => {
    if ('text' in part) return part.text;
    const entry = part.formula;
    if (entry.review) return formulaReviewLabel(entry);
    const latex = entry.equationNumber ? `${entry.latex}\\tag{${entry.equationNumber}}` : entry.latex;
    return entry.display ? `\n\\[${latex}\\]\n` : `$${latex}$`;
  }).join('');
}

/** PDF retention needs the reference order, not another copy of source prose. */
export function compactFormulaDocument(doc: FormulaDocument): FormulaDocument {
  return { ...doc, sourceTemplate: references(doc.sourceTemplate).map((id) => `{{${id}}}`).join(' ') };
}

/** Legacy compatibility: keep exact individual matches, never substitute by
 * count/order. Ambiguous or damaged delimiters fall back to the opaque draft.
 */
export function recoverLegacyFormulaDocument(source: string, translation: string): FormulaDocument | undefined {
  // Reuse the registry's exact template matching, including bounded bare
  // identifiers. Repeated occurrences share an identity; count alone is never
  // enough to equate expressions, fonts or scripts.
  if (source.length <= MAX_TEXT && translation.length <= MAX_TEXT) {
    try {
      const candidate = parseFormulaDocument({recognizedText: normalizeVisionLatexText(source),
        translation: normalizeVisionLatexText(translation), formulas: []});
      if (candidate.formulas.length && !formulaDocumentIssues(candidate).length) return candidate;
    } catch {
      // Optional recovery can exceed registry limits. Keep the original reply
      // available to the strict legacy path/draft policy instead of losing it.
    }
  }
  const recognized = extractDelimitedFormulae(normalizeVisionLatexText(source));
  const normalized = normalizeVisionLatexText(translation);
  const translated = extractDelimitedFormulae(normalized);
  if (!recognized.balanced || !translated.balanced || !translated.formulae.length) return undefined;
  const available = recognized.formulae.map(normalizeFormula);
  const formulas: FormulaEntry[] = [];
  let translationTemplate = normalized;
  let sourceTemplate = normalizeVisionLatexText(source);
  let accepted = 0;
  for (const [index, latex] of translated.formulae.entries()) {
    const id = `m${index + 1}`;
    const sourceIndex = available.indexOf(normalizeFormula(latex));
    const reasons = mathIssues(latex);
    if (sourceIndex < 0) reasons.push('无法与识别原文中的公式可靠对应');
    if (!reasons.length) {
      available[sourceIndex] = ''; accepted += 1;
      sourceTemplate = sourceTemplate.replace(recognized.snippets[sourceIndex]!, `{{${id}}}`);
    }
    const snippet = translated.snippets[index]!;
    translationTemplate = translationTemplate.replace(snippet, `{{${id}}}`);
    formulas.push({ id, latex, display: snippet.startsWith('\\[') || snippet.startsWith('$$'),
      ...(reasons.length ? { review: reasons.join('；') } : {}) });
  }
  if (!accepted) return undefined;
  const issues = available.some(Boolean) ? ['部分原文公式未能对应，已展开完整原文供核对'] : [];
  const doc: FormulaDocument = { version: 1, sourceTemplate, translationTemplate, formulas, issues };
  return isFormulaDocument(doc) ? doc : undefined;
}
