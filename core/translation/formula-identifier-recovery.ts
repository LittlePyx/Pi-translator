import type {FormulaDocument} from './formula-document';
import {templateMathSpans} from './formula-template';
import {normalizeFormula} from './formula-output-validation';

const greek: Record<string, string> = {alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ϵ', varepsilon:'ε',
  theta:'θ', vartheta:'ϑ', lambda:'λ', mu:'μ', nu:'ν', xi:'ξ', pi:'π', varpi:'ϖ', rho:'ρ', varrho:'ϱ',
  sigma:'σ', tau:'τ', phi:'ϕ', varphi:'φ', chi:'χ', psi:'ψ', omega:'ω'};
function plainIdentifier(latex: string): string | undefined {
  const value = normalizeFormula(latex);
  // A/I and lower-case words can be ordinary prose. Font wrappers, scripts,
  // dimensions and compound expressions require explicit mathematical source.
  if (/^[B-HJ-Zb-hj-z]$|^[a-z][A-Z]$|^[αβγδεϵθϑλμνξπϖρϱστφϕχψω]$/u.test(value)) return value;
  const command = /^\\([a-z]+)$/u.exec(value);
  return command ? greek[command[1]!] : undefined;
}

/** A provider may leave bare identifiers in recognized prose but use math or
 * registry references in the translation. Recover only exact, bounded symbols
 * with an equal number of source/target occurrences. Never match by position,
 * remove uncertainty, or equate different fonts/subscripts. */
export function registerPlainSourceIdentifiers(doc: FormulaDocument, nextId: () => string): void {
  const spans = templateMathSpans(doc.translationTemplate);
  const candidates = new Map<string, string>();
  for (const entry of doc.formulas) {
    const identifier = !entry.display && plainIdentifier(entry.latex);
    if (identifier) candidates.set(identifier, entry.latex);
  }
  for (const span of spans) {
    const identifier = !span.display && plainIdentifier(span.latex);
    if (identifier) candidates.set(identifier, span.latex);
  }
  // A bare N-pixel/pN-pixel quantity or a Greek parameter definition is also
  // explicit source evidence when the provider leaves BOTH templates plain.
  for (const match of doc.sourceTemplate.matchAll(/(?<![\p{L}\p{N}])([B-HJ-Z]|[a-z][A-Z])(?=-pixel\b)|(?<![\p{L}\p{N}])([αβγδεϵθϑλμνξπϖρϱστφϕχψω])(?![\p{L}\p{N}])/gu)) {
    const identifier = match[1] ?? match[2]!;
    if (match[2] && !/^\s*(?:=|∈|≈|≤|≥|(?:is|denotes|represents|controls)\b)/u.test(doc.sourceTemplate.slice(match.index! + match[0].length)) &&
      !/\b(?:factor|parameter|coefficient)\s*$/iu.test(doc.sourceTemplate.slice(Math.max(0,match.index!-35),match.index))) continue;
    if (!candidates.has(identifier)) candidates.set(identifier, identifier);
  }
  const plainMatches = (text: string, identifier: string) => {
    const protectedText = [...text.matchAll(/(?:https?:\/\/|www\.)\S+|`[^`]*`/gu)];
    const math = templateMathSpans(text);
    return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}\\\\$^_{}])${identifier}(?![\\p{L}\\p{N}$^_{}])`, 'gu'))]
      .filter(match => !protectedText.some(protectedMatch => match.index! >= protectedMatch.index! && match.index! < protectedMatch.index! + protectedMatch[0].length) &&
        !math.some(span => match.index! >= span.start && match.index! < span.end));
  };
  const refs = (text: string, id: string) => text.split(`{{${id}}}`).length - 1;
  for (const [identifier, latex] of candidates) {
    if (/^[a-z]$/u.test(identifier)) {
      // A lowercase letter needs independent mathematical source evidence:
      // another registered expression, or an explicit count such as n inputs.
      const token = new RegExp(`(?<![A-Za-z])${identifier}(?![A-Za-z])`, 'u');
      const compound = doc.formulas.some(entry => entry.latex !== latex && token.test(entry.latex) &&
        /[=:_^{}]|\\(?:to|in|sim)\b/u.test(entry.latex) && refs(doc.sourceTemplate, entry.id) > 0);
      const count = new RegExp(`(?<![\\p{L}\\p{N}])${identifier}\\s+(?:inputs|outputs|observations|targets|predictions|classes|points|samples|elements)\\b`, 'u').test(doc.sourceTemplate);
      if (!compound && !count) continue;
    }
    const entries = doc.formulas.filter(entry => plainIdentifier(entry.latex) === identifier);
    if (entries.length > 1 || entries.some(entry => entry.review || entry.display || entry.sourceEquationId)) continue;
    const existing = entries[0];
    const sourceCount = existing ? refs(doc.sourceTemplate, existing.id) : 0;
    const targetMatches = plainMatches(doc.translationTemplate, identifier);
    const targetCount = (existing ? refs(doc.translationTemplate, existing.id) : 0) + targetMatches.length +
      spans.filter(span => !span.display && plainIdentifier(span.latex) === identifier).length;
    const matches = plainMatches(doc.sourceTemplate, identifier);
    if (!(matches.length + targetMatches.length) || sourceCount + matches.length !== targetCount || doc.formulas.length >= 96) continue;
    const entry = existing ?? {id: nextId(), latex, display: false};
    if (!existing) doc.formulas.push(entry);
    for (const match of matches.reverse()) doc.sourceTemplate = doc.sourceTemplate.slice(0, match.index) +
      `{{${entry.id}}}` + doc.sourceTemplate.slice(match.index! + match[0].length);
    for (const match of targetMatches.reverse()) doc.translationTemplate = doc.translationTemplate.slice(0, match.index) +
      `{{${entry.id}}}` + doc.translationTemplate.slice(match.index! + match[0].length);
  }
}
