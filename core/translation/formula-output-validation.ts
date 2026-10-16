import type { ProviderImageTranslationResult } from './types';
import { containsLatexRowStructure } from './latex-structure';
import { isLikelyTargetLanguage } from '../language/target-language';

export interface FormulaValidationResult {
  valid: boolean;
  issues: string[];
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

export function normalizeFormula(value: string): string {
  const normalized = value
    .replaceAll(/\s+/gu, ' ')
    .replaceAll(/\s*([=+\-*/^_{}()[\],;:<>])\s*/gu, '$1')
    .trim();
  if (/\\(?:text|mbox|hbox|verb)\b/u.test(normalized)) return normalized;
  // TeX ignores ordinary math whitespace, but a separator after a control
  // word can be essential: "\\alpha b" must not become "\\alphab".
  return normalized.replace(/\s+/gu, (space, offset: number) =>
    /\\[A-Za-z]+$/u.test(normalized.slice(0, offset)) && /[A-Za-z]/u.test(normalized[offset + space.length] ?? '') ? ' ' : '');
}

export function extractDelimitedFormulae(text: string): {
  formulae: string[];
  snippets: string[];
  balanced: boolean;
} {
  const formulae: string[] = [];
  const snippets: string[] = [];
  let balanced = true;
  for (let index = 0; index < text.length;) {
    if (text.startsWith('\\[', index) || text.startsWith('\\(', index)) {
      const opener = text.slice(index, index + 2);
      const closer = opener === '\\[' ? '\\]' : '\\)';
      const end = text.indexOf(closer, index + 2);
      if (end < 0) {
        balanced = false;
        break;
      }
      formulae.push(text.slice(index + 2, end));
      snippets.push(text.slice(index, end + 2));
      index = end + 2;
      continue;
    }
    if (text[index] === '$' && !isEscaped(text, index)) {
      const double = text[index + 1] === '$';
      const delimiter = double ? '$$' : '$';
      let end = index + delimiter.length;
      while (end < text.length) {
        const found = text.indexOf(delimiter, end);
        if (found < 0) {
          end = -1;
          break;
        }
        if (!isEscaped(text, found)) {
          end = found;
          break;
        }
        end = found + delimiter.length;
      }
      if (end < 0) {
        balanced = false;
        break;
      }
      formulae.push(text.slice(index + delimiter.length, end));
      snippets.push(text.slice(index, end + delimiter.length));
      index = end + delimiter.length;
      continue;
    }
    index += 1;
  }
  return { formulae, snippets, balanced };
}

function appendRecognizedFormulaSnippets(text: string, snippets: string[]): string {
  return snippets.reduce((output, snippet) => {
    const display = snippet.startsWith('\\[') || snippet.startsWith('$$');
    return `${output}${display ? '\n' : ' '}${snippet}`;
  }, text.trimEnd());
}

/** Keep prose only when formula boundaries and the output language are clear.
 * No inferred TeX or positional formula substitution is used in this fallback.
 */
export function extractFormulaReviewProse(text: string, targetLanguage: string): string | undefined {
  const parsed = extractDelimitedFormulae(text);
  if (!parsed.balanced || parsed.formulae.some((formula) => (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(formula)
  ))) return undefined;
  let prose = text;
  for (const snippet of parsed.snippets) prose = prose.replace(snippet, '〔公式见原文〕');
  const languageSample = prose.replaceAll('〔公式见原文〕', '').trim();
  // Unmarked/unterminated math cannot be separated from prose reliably. In
  // particular, never present a plain-text equation as validated translation.
  if (/[\\$\p{Sm}\p{Script=Greek}_^{}]|```/u.test(languageSample) ||
      (languageSample.match(/\p{L}/gu)?.length ?? 0) < 12 ||
      !hasFormulaTranslationProse(languageSample, targetLanguage)) return undefined;
  return prose.trim() || undefined;
}

/** Recovery-only language evidence. Do not use the passive-selection language
 * filter here: academic translations legitimately retain names and symbols.
 * This establishes that a draft contains prose, not that it is correct.
 */
export function hasFormulaTranslationProse(text: string, targetLanguage: string): boolean {
  let sample = text.replace(/https?:\/\/\S+/gu, '')
    .replace(/\[(?:无法辨认|公式待核对)\]|〔公式见原文〕/gu, '');
  const math = extractDelimitedFormulae(sample);
  for (const [index, snippet] of math.snippets.entries()) {
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(math.formulae[index]!)) {
      sample = sample.replace(snippet, ' ');
    }
  }
  sample = sample.replace(/\\[A-Za-z]+/gu, ' ');
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  if (targetLanguage === 'zh-CN' || targetLanguage === 'zh') {
    const han = sample.match(/\p{Script=Han}/gu)?.length ?? 0;
    const phrases = sample.match(/\p{Script=Han}{4,}/gu)?.length ?? 0;
    return han >= 12 && (phrases >= 2 || /\p{Script=Han}{12,}/u.test(sample)) &&
      !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sample) &&
      han / Math.max(1, letters) >= .25;
  }
  if (targetLanguage === 'ja') {
    const kana = sample.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
    const japanese = sample.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
    return kana >= 4 && japanese >= 12 && japanese / Math.max(1, letters) >= .25;
  }
  return isLikelyTargetLanguage(sample, targetLanguage);
}

/** A deliberately small spelling comparison, not symbolic/algebraic equivalence. */
function simpleFormulaSpelling(value: string): string | undefined {
  let text = value.replace(/\\tag\s*\{[^{}]+\}/gu, '').replace(/\s*\(\d+[a-z]?\)\s*$/iu, '');
  for (let pass = 0; pass < 4; pass += 1) {
    text = text.replace(/\\(?:mathrm|mathbf|mathit|operatorname)\*?\s*\{([^{}]+)\}/gu, '$1');
  }
  text = text
    .replace(/\\(?:left|right)\b/gu, '')
    .replace(/\\(?:ast|star)\b|[∗⋆]/gu, '*')
    .replace(/\\(?:,|!|;|:| )/gu, '')
    .replace(/([_^])\{([A-Za-z0-9])\}/gu, '$1$2')
    .replace(/[−–]/gu, '-')
    .replace(/\s+/gu, '')
    .replace(/[,.]$/u, '');
  // Unknown TeX constructs, grouping and prose cannot be safely equated.
  return text.includes('=') && !/[\\{}]/u.test(text) ? text : undefined;
}

function samePlainFormulaLine(line: string, formula: string): boolean {
  const expected = simpleFormulaSpelling(formula);
  const sourceTag = /\\tag\s*\{([^{}]+)\}/u.exec(formula)?.[1];
  const lineTag = /\((\d+[a-z]?)\)\s*$/iu.exec(line)?.[1];
  return Boolean(expected && expected === simpleFormulaSpelling(line) &&
    !(lineTag && sourceTag && lineTag !== sourceTag));
}

function removeAdjacentPlainFormulaCopies(text: string): string {
  const lines = text.split('\n');
  const removed = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = extractDelimitedFormulae(lines[index]!.trim());
    if (parsed.snippets.length !== 1 || parsed.snippets[0] !== lines[index]!.trim()) continue;
    for (const direction of [-1, 1]) {
      let neighbor = index + direction;
      while (neighbor >= 0 && neighbor < lines.length && !lines[neighbor]!.trim()) neighbor += direction;
      if (neighbor < 0 || neighbor >= lines.length) continue;
      if (samePlainFormulaLine(lines[neighbor]!, parsed.formulae[0]!)) removed.add(neighbor);
    }
  }
  return lines.filter((_line, index) => !removed.has(index)).join('\n');
}

function isSafeTrailingDisplayFormulaOmission(
  recognizedText: string,
  translatedText: string,
  formulae: string[],
  snippets: string[],
): boolean {
  if (formulae.length !== 1 || snippets.length !== 1) return false;
  const [formula] = formulae;
  const [snippet] = snippets;
  if (!formula || !snippet || !(snippet.startsWith('\\[') || snippet.startsWith('$$'))) {
    return false;
  }
  const trimmedSource = recognizedText.trimEnd();
  const snippetIndex = trimmedSource.lastIndexOf(snippet);
  if (snippetIndex < 0 || snippetIndex + snippet.length !== trimmedSource.length) return false;
  const before = trimmedSource.slice(0, snippetIndex);
  if (before && !/\n[\t ]*$/u.test(before)) return false;

  // Do not append a second copy when the provider rendered the formula as
  // plain characters but forgot only the TeX delimiters.
  const compactFormula = normalizeFormula(formula).replaceAll(/\s+/gu, '');
  const compactTranslation = normalizeFormula(translatedText).replaceAll(/\s+/gu, '');
  return compactFormula.length >= 2 && !compactTranslation.includes(compactFormula) &&
    !/[=≈≠≤≥_^]/u.test(translatedText);
}

function replaceDelimitedFormulae(text: string, replacements: string[]): string | undefined {
  let output = '';
  let cursor = 0;
  let replacementIndex = 0;
  for (let index = 0; index < text.length;) {
    let opener: string | undefined;
    let closer: string | undefined;
    if (text.startsWith('\\[', index) || text.startsWith('\\(', index)) {
      opener = text.slice(index, index + 2);
      closer = opener === '\\[' ? '\\]' : '\\)';
    } else if (text[index] === '$' && !isEscaped(text, index)) {
      opener = text[index + 1] === '$' ? '$$' : '$';
      closer = opener;
    }
    if (!opener || !closer) {
      index += 1;
      continue;
    }
    let end = index + opener.length;
    while (end < text.length) {
      const found = text.indexOf(closer, end);
      if (found < 0) return undefined;
      if (!isEscaped(text, found)) {
        end = found;
        break;
      }
      end = found + closer.length;
    }
    const replacement = replacements[replacementIndex];
    if (replacement === undefined) return undefined;
    output += text.slice(cursor, index + opener.length);
    output += replacement.trim();
    output += closer;
    replacementIndex += 1;
    index = end + closer.length;
    cursor = index;
  }
  if (replacementIndex !== replacements.length) return undefined;
  return output + text.slice(cursor);
}

export function structuralIssues(formula: string): string[] {
  const issues: string[] = [];
  if (!formula.trim()) return ['公式内容为空'];
  if (/```|`/u.test(formula)) issues.push('公式包含 Markdown 标记');
  if (/(^|[^\\])\$(?:\$)?|\\\(|\\\)|\\\[|\\\]/u.test(formula)) {
    issues.push('formulaLatex 不应包含公式分隔符');
  }

  const stack: string[] = [];
  const pairs: Record<string, string> = { '}': '{', ']': '[', ')': '(' };
  for (let index = 0; index < formula.length; index += 1) {
    const character = formula[index] ?? '';
    if (isEscaped(formula, index)) continue;
    if (character === '{' || character === '[' || character === '(') {
      stack.push(character);
    } else if (character in pairs) {
      if (stack.at(-1) !== pairs[character]) {
        issues.push(`公式中的 ${character} 没有匹配`);
        break;
      }
      stack.pop();
    }
  }
  if (stack.length) issues.push(`公式中的 ${stack.at(-1)} 没有闭合`);

  const environments: string[] = [];
  for (const match of formula.matchAll(/\\(begin|end)\s*\{([^{}]+)\}/gu)) {
    const [, kind, name] = match;
    if (kind === 'begin') environments.push(name ?? '');
    else if (environments.pop() !== name) {
      issues.push(`LaTeX 环境 ${name ?? ''} 没有正确配对`);
      break;
    }
  }
  if (environments.length) issues.push(`LaTeX 环境 ${environments.at(-1)} 没有结束`);

  const leftCount = formula.match(/\\left(?:\s|\\|[()[\]{}|.])/gu)?.length ?? 0;
  const rightCount = formula.match(/\\right(?:\s|\\|[()[\]{}|.])/gu)?.length ?? 0;
  if (leftCount !== rightCount) issues.push('\\left 与 \\right 数量不一致');
  if (/(?:\^|_)\s*$/u.test(formula)) issues.push('公式以上标或下标操作符结尾');
  if (/\\\s*$/u.test(formula)) issues.push('公式以未完成的 LaTeX 命令结尾');
  return issues;
}

function sameFormulae(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((formula, index) => (
    normalizeFormula(formula) === normalizeFormula(right[index] ?? '')
  ));
}

const GREEK_COMMAND_NAME = '(?:Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi|Omicron|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega)';

const KNOWN_VISION_COMMAND = new RegExp(
  `^(?:${GREEK_COMMAND_NAME}|begin|end|frac|dfrac|tfrac|sqrt|sum|prod|coprod|int|iint|iiint|oint|lim|limsup|liminf|arg|min|max|sup|inf|log|ln|exp|sin|cos|tan|cot|sec|csc|det|gcd|Pr|operatorname|mathop|mathrm|mathbf|mathbb|mathcal|mathsf|mathtt|mathit|boldsymbol|text|textbf|textit|textstyle|displaystyle|scriptstyle|scriptscriptstyle|tag|left|right|middle|big|Big|bigg|Bigg|cdot|times|pm|mp|le|leq|ge|geq|neq|approx|sim|simeq|equiv|propto|in|notin|ni|subset|subseteq|supset|supseteq|cup|cap|setminus|forall|exists|nabla|partial|infty|ell|hbar|hat|widehat|bar|overline|underline|tilde|widetilde|vec|dot|ddot|overbrace|underbrace|overset|underset|stackrel|langle|rangle|lVert|rVert|vert|Vert|mid|quad|qquad)\\*?$`,
  'u',
);

/**
 * Some vision providers apply JSON escaping twice, so a command that should
 * reach us as `\mathbb` arrives as `\\mathbb`. Only repair this form inside a
 * known formula body. In row-bearing structures, two slashes before a named
 * command can be reduced, while three (`\\` plus `\command`) and bare row
 * separators remain untouched.
 */
function repairOverescapedVisionCommands(formula: string): string {
  const hasRowStructure = containsLatexRowStructure(formula);
  const commandRuns = [...formula.matchAll(/(?<!\\)(\\{2,})([A-Za-z@]{2,}\*?)/gu)];
  const hasExtraEscapeLayer = commandRuns.some((match) => (
    match[1]?.length === 2 && KNOWN_VISION_COMMAND.test(match[2] ?? '')
  ));
  const normalizedRows = hasRowStructure && hasExtraEscapeLayer
    ? formula.replace(
        /(?<!\\)\\{4,}/gu,
        (slashes) => '\\'.repeat(Math.ceil(slashes.length / 2)),
      )
    : formula;
  return normalizedRows
    .replace(
      /(?<!\\)(\\{2,})([A-Za-z@]{2,}\*?)/gu,
      (match: string, slashes: string, command: string) => {
        if (
          hasRowStructure &&
          (slashes.length !== 2 || !KNOWN_VISION_COMMAND.test(command))
        ) return match;
        return `\\${command}`;
      },
    )
    // A trailing row break is not meaningful outside a multiline environment.
    // Vision models commonly produce it by escaping the closing `$` as `\\$`.
    .replace(/(?<!\\)\\{2,}(?=\s*$)/u, '');
}

/**
 * Normalize paired display delimiters only when the whole pair is visible.
 * This intentionally does not rewrite standalone `\\[4pt]`, which is a valid
 * optional-spacing form after a LaTeX row break.
 */
function repairOverescapedVisionDelimiters(text: string): string {
  return text
    // Some providers wrap a display delimiter in an additional dollar pair.
    // Consume both outer dollars together; removing only the trailing dollar
    // leaves an unmatched opener and makes otherwise valid LaTeX fail review.
    .replace(
      /(?<!\\)\$(\\{2,})\[([\s\S]*?)(?<!\\)(\\{2,})\]\$(?!\$)/gu,
      (_match, _opener: string, body: string, _closer: string) => `\\[${body}\\]`,
    )
    .replace(
      /(?<!\\)\$(\\{2,})\(([\s\S]*?)(?<!\\)(\\{2,})\)\$(?!\$)/gu,
      (_match, _opener: string, body: string, _closer: string) => `\\(${body}\\)`,
    )
    .replace(
      /(?<!\\)(\\{2,})\[([\s\S]*?)(?<!\\)(\\{2,})\](?!\\)(?:\$(?!\$))?/gu,
      (_match, _opener: string, body: string, _closer: string) => `\\[${body}\\]`,
    )
    .replace(
      /(?<!\\)(\\{2,})\(([\s\S]*?)(?<!\\)(\\{2,})\)(?!\\)(?:\$(?!\$))?/gu,
      (_match, _opener: string, body: string, _closer: string) => `\\(${body}\\)`,
    );
}

function repairVisionFontCommand(
  formula: string,
  command: 'mathbb' | 'mathbf' | 'mathrm' | 'mathcal' | 'mathsf' | 'mathtt' | 'mathit' | 'boldsymbol',
): string {
  const escaped = new RegExp(`\\\\${command}\\s*(?:\\{\\s*([^{}]+?)\\s*\\}|([A-Za-z]))`, 'gu');
  const bare = new RegExp(`(^|[^A-Za-z0-9\\\\])${command}\\s*(?:\\{\\s*([^{}]+?)\\s*\\}|([A-Za-z]))`, 'gu');
  return formula
    .replace(escaped, (_match, group: string, letter: string) => (
      `\\${command}{${(group ?? letter).trim()}}`
    ))
    .replace(bare, (_match, prefix: string, group: string, letter: string) => (
      `${prefix}\\${command}{${(group ?? letter).trim()}}`
    ));
}

function repairVisionRomanDifferential(formula: string): string {
  return formula
    .replace(/\\mathrm\s*\{\s*d\s*\}/gu, '\\mathrm{d}')
    .replace(/\\mathrm\s+d(?![A-Za-z])/gu, '\\mathrm{d}')
    .replace(/(^|[^A-Za-z0-9\\])mathrm\s*\{\s*d\s*\}/gu, '$1\\mathrm{d}')
    .replace(/(^|[^A-Za-z0-9\\])mathrm\s+d(?![A-Za-z])/gu, '$1\\mathrm{d}');
}

function repairVisionOptimizationOperator(formula: string): string {
  const operatorBody = String.raw`arg\s*(?:\\,\s*)?(min|max)`;
  const wrappedOperator = String.raw`\\(?:operatorname\*?|mathrm|text)\s*\{\s*${operatorBody}\s*\}`;
  // KaTeX accepts both the compact `\argmin` command and the split
  // `\arg\min` spelling. Vision models emit both forms.
  const commandOperator = String.raw`\\arg\s*\\?(min|max)(?![A-Za-z])`;
  const mathopRomanOperator = String.raw`\\mathop\s*\{\s*\\rm\s+${operatorBody}\s*\}`;
  const mathopWrappedOperator = String.raw`\\mathop\s*\{\s*\\(?:operatorname\*?|mathrm|text)\s*\{\s*${operatorBody}\s*\}\s*\}`;
  const legacyRomanOperator = String.raw`\{\s*\\rm\s+${operatorBody}\s*\}`;
  const operatorPatterns = [
    mathopRomanOperator,
    mathopWrappedOperator,
    wrappedOperator,
    commandOperator,
    legacyRomanOperator,
  ];
  const mathAtom = String.raw`(?:[A-Za-z]|\\(?:boldsymbol|mathbf|mathbb|mathcal|mathrm)\s*\{[^{}]+\})`;
  const atomScripts = String.raw`(?:\s*[_^]\s*(?:\{[^{}]+\}|[A-Za-z0-9]|\\[A-Za-z]+))*`;
  const domain = String.raw`${mathAtom}${atomScripts}\s*(?:\\in|∈)\s*${mathAtom}${atomScripts}(?:\s*\([^()]*\))?`;
  const objectiveBrace = String.raw`(?=\s*(?:\\(?:left|bigl|Bigl|biggl|Biggl|big|Big|bigg|Bigg)\s*)?(?:\\\{|\{))`;
  const canonical = (kind: string, lowerLimit?: string): string =>
    `\\operatorname*{arg\\,${kind}}${lowerLimit ? `_{${lowerLimit.trim()}}` : ''}`;

  const canonicalOperator = operatorPatterns.reduce(
    (value, pattern) => value.replace(
      new RegExp(`${pattern}(?=\\s*_)`, 'gu'),
      (_match, kind: string) => canonical(kind),
    ),
    formula,
  )
    .replace(
      /(^|[^A-Za-z0-9\\])arg\s*(min|max)(?=\s*_)/gu,
      (_match, prefix: string, kind: string) =>
        `${prefix}${canonical(kind)}`,
    );

  // OCR occasionally drops only the `_ { ... }` around an optimization
  // domain. Repair the narrow, high-confidence shape where a membership
  // condition is immediately followed by the objective's visible left brace.
  return operatorPatterns.reduce(
    (value, pattern) => value.replace(
      new RegExp(`${pattern}(?!\\s*[_^])\\s*(${domain})${objectiveBrace}`, 'gu'),
      (_match, kind: string, lowerLimit: string) => canonical(kind, lowerLimit),
    ),
    canonicalOperator,
  )
    .replace(
      new RegExp(`(^|[^A-Za-z0-9\\\\])arg\\s*(min|max)\\s+(?![_^])(${domain})${objectiveBrace}`, 'gu'),
      (_match, prefix: string, kind: string, lowerLimit: string) =>
        `${prefix}${canonical(kind, lowerLimit)}`,
    );
}

/** Repairs a small set of deterministic pseudo-TeX forms emitted by OCR. */
export function repairCommonVisionLatex(formula: string): string {
  const escaped = repairOverescapedVisionCommands(formula)
    .replace(/\\textbb\s*(?:\{([^{}]+)\}|([A-Za-z]))/gu, (_match, group: string, letter: string) =>
      `\\mathbb{${group ?? letter}}`)
    .replace(new RegExp(`\\\\text\\s*\\{\\s*(${GREEK_COMMAND_NAME})\\s*\\}`, 'gu'), '\\$1')
    .replace(new RegExp(`\\\\text(${GREEK_COMMAND_NAME})(?![A-Za-z])`, 'gu'), '\\$1');
  const fontCommands = [
    'mathbb',
    'mathbf',
    'mathrm',
    'mathcal',
    'mathsf',
    'mathtt',
    'mathit',
    'boldsymbol',
  ] as const;
  const repairedFonts = fontCommands.reduce(
    (value, command) => repairVisionFontCommand(value, command),
    escaped,
  );
  return repairVisionOptimizationOperator(
    repairVisionRomanDifferential(repairedFonts),
  );
}

const VISIBLE_EQUATION_NUMBER = '[A-Za-z]?\\d+(?:[.-]\\d+)*[A-Za-z]?';
const TRAILING_EQUATION_NUMBER = String.raw`[\t ]*(?:\r?\n[\t ]*)?[\(（][\t ]*(${VISIBLE_EQUATION_NUMBER})[\t ]*[\)）]`;

function formulaWithVisibleTag(formula: string, tag: string): string | undefined {
  const normalizedTag = tag.trim();
  const existingTag = /\\tag\s*\{\s*(?:\(\s*)?([^(){}]+?)(?:\s*\))?\s*\}/u.exec(formula)?.[1]
    ?.trim();
  if (!existingTag) return `${formula.trim()}\\tag{${normalizedTag}}`;
  return existingTag === normalizedTag ? formula.trim() : undefined;
}

/** Promotes only formulae that occupy their complete logical line. */
function promoteStandaloneVisionFormulae(text: string): string {
  const promote = (
    match: string,
    prefix: string,
    formula: string,
    tag: string | undefined,
  ): string => {
    const body = tag ? formulaWithVisibleTag(formula, tag) : formula.trim();
    if (!body) return match;
    return `${prefix}\\[${body}\\]`;
  };
  return text
    .replace(
      new RegExp(String.raw`(^|\r?\n)[\t ]*\$\$([^\r\n]+?)\$\$(?:${TRAILING_EQUATION_NUMBER})?[\t ]*(?=\r?\n|$)`, 'gu'),
      (match, prefix: string, formula: string, tag: string | undefined) =>
        promote(match, prefix, formula, tag),
    )
    .replace(
      new RegExp(String.raw`(^|\r?\n)[\t ]*\$(?!\$)([^$\r\n]+?)\$(?:${TRAILING_EQUATION_NUMBER})?[\t ]*(?=\r?\n|$)`, 'gu'),
      (match, prefix: string, formula: string, tag: string | undefined) =>
        promote(match, prefix, formula, tag),
    )
    .replace(
      new RegExp(String.raw`(^|\r?\n)[\t ]*\\\(([^\r\n]+?)\\\)(?:${TRAILING_EQUATION_NUMBER})?[\t ]*(?=\r?\n|$)`, 'gu'),
      (match, prefix: string, formula: string, tag: string | undefined) =>
        promote(match, prefix, formula, tag),
    );
}

function attachVisibleEquationNumbers(text: string): string {
  return text.replace(
    new RegExp(String.raw`\\\[([\s\S]*?)\\\]${TRAILING_EQUATION_NUMBER}`, 'gu'),
    (match, formula: string, tag: string) => {
      const tagged = formulaWithVisibleTag(formula, tag);
      return tagged ? `\\[${tagged}\\]` : match;
    },
  );
}

/**
 * Repairs only delimited mathematical regions in a mixed OCR/translation
 * passage. Plain prose and path-like backslashes outside those regions remain
 * byte-for-byte unchanged, so this is also safe for legacy cached results.
 */
export function normalizeVisionLatexText(text: string): string {
  const delimited = repairOverescapedVisionDelimiters(text);
  const numbered = attachVisibleEquationNumbers(
    promoteStandaloneVisionFormulae(delimited),
  );
  const parsed = extractDelimitedFormulae(numbered);
  if (!parsed.balanced || !parsed.formulae.length) return numbered;
  return removeAdjacentPlainFormulaCopies(
    replaceDelimitedFormulae(numbered, parsed.formulae.map(repairCommonVisionLatex)) ?? numbered,
  );
}

function repairImageFormulaResult(
  result: ProviderImageTranslationResult,
): ProviderImageTranslationResult {
  return {
    ...result,
    recognizedText: normalizeVisionLatexText(result.recognizedText),
    translatedText: normalizeVisionLatexText(result.translatedText),
    formulaLatex: result.formulaLatex.map(repairCommonVisionLatex),
  };
}

/**
 * Legacy compatibility: reconcile only equivalent spellings or a narrowly
 * unambiguous trailing omission. Equal counts never establish correspondence
 * and cannot justify changing a sign, variable, font, or formula order.
 */
function reconcileAffiliationMarkers(result: ProviderImageTranslationResult): ProviderImageTranslationResult {
  if (!/\b(?:University|School|Department|Institute|College|Laboratory|Faculty)\b/iu.test(result.recognizedText)) return result;
  const source = extractDelimitedFormulae(result.recognizedText), translated = extractDelimitedFormulae(result.translatedText);
  if (!source.balanced || !translated.balanced || !source.formulae.length || translated.formulae.length) return result;
  const superscripts = [...'⁰¹²³⁴⁵⁶⁷⁸⁹'];
  const markers = source.formulae.map(latex => {
    const match = /^\s*\{\}\s*\^\s*(?:\{(\d{1,3})\}|(\d))\s*$/u.exec(latex);
    return match ? [...(match[1] ?? match[2]!)].map(digit => superscripts[Number(digit)]).join('') : undefined;
  });
  const targetMarkers = [...result.translatedText.matchAll(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+|(?<![\p{L}\d])\d{1,3}(?=\s*\p{Script=Han})/gu)];
  const normalized = targetMarkers.map(match => /^\d+$/u.test(match[0]) ? [...match[0]].map(digit => superscripts[Number(digit)]).join('') : match[0]);
  if (markers.some(marker => !marker) || markers.join('|') !== normalized.join('|')) return result;
  if (result.formulaLatex.some(latex => !source.formulae.some(entry => normalizeFormula(entry) === normalizeFormula(latex)))) return result;
  let recognizedText = result.recognizedText;
  source.snippets.forEach((snippet, index) => {recognizedText = recognizedText.replace(snippet, markers[index]!)});
  let translatedText = result.translatedText;
  for (let index = targetMarkers.length - 1; index >= 0; index--) {
    const match = targetMarkers[index]!;
    translatedText = translatedText.slice(0, match.index) + normalized[index] + translatedText.slice(match.index! + match[0].length);
  }
  return {...result, recognizedText, translatedText, formulaLatex: []};
}

/** Conference ordinal superscripts are prose, with the same ordinal in Chinese. */
function reconcilePublicationOrdinal(result: ProviderImageTranslationResult): ProviderImageTranslationResult {
  if (!/^Proceedings of\b/iu.test(result.recognizedText) || !/\bConference\b/u.test(result.recognizedText)) return result;
  const source = extractDelimitedFormulae(result.recognizedText);
  const target = extractDelimitedFormulae(result.translatedText);
  if (!source.balanced || !target.balanced || !source.formulae.length || target.formulae.length) return result;
  const ordinals = source.formulae.map(latex => /^(\d{1,4})\s*\^\s*\{(st|nd|rd|th)\}$/u.exec(latex.trim()));
  if (ordinals.some(value => !value) || result.formulaLatex.some(latex => !source.formulae.some(entry => normalizeFormula(entry) === normalizeFormula(latex)))) return result;
  const translated = [...result.translatedText.matchAll(/第\s*(\d{1,4})\s*届/gu)].map(match => match[1]);
  if (translated.join('|') !== ordinals.map(value => value![1]).join('|')) return result;
  let recognizedText = result.recognizedText;
  source.snippets.forEach((snippet,index) => {recognizedText = recognizedText.replace(snippet, `${ordinals[index]![1]}${ordinals[index]![2]}`)});
  return {...result, recognizedText, formulaLatex: []};
}

/** A figure caption may spell an upright percentage label as ordinary text.
 * Recover only the exact ASCII label, equality and numeric percentage; never
 * infer expressions, mathematical fonts, or a different value. */
function reconcilePlainPercentageLabels(result: ProviderImageTranslationResult): ProviderImageTranslationResult {
  let recognizedText = result.recognizedText;
  const target = extractDelimitedFormulae(result.translatedText);
  if (!target.balanced) return result;
  for (const latex of new Set(result.formulaLatex)) {
    const match = /^\\mathrm\{([A-Z]{2,4})\}\s*=\s*(\d{1,3}(?:\.\d{1,4})?)\s*\\%$/u.exec(latex.trim());
    if (!match || Number(match[2]) > 100) continue;
    const source = extractDelimitedFormulae(recognizedText);
    if (!source.balanced) continue;
    const protectedRanges: {start:number;end:number}[] = [];
    let cursor = 0;
    for (const snippet of source.snippets) {
      const start = recognizedText.indexOf(snippet, cursor);
      protectedRanges.push({start,end:start+snippet.length});cursor=start+snippet.length;
    }
    for (const entry of recognizedText.matchAll(/(?:https?:\/\/|www\.)\S+|`[^`]*`/gu)) protectedRanges.push({start:entry.index!,end:entry.index!+entry[0].length});
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\\\$^_{}])${match[1]}\\s*=\\s*${match[2]!.replace('.', '\\.')}\\s*%(?![\\p{L}\\p{N}])`, 'gu');
    const plain = [...recognizedText.matchAll(pattern)].filter(entry=>!protectedRanges.some(range=>entry.index!>=range.start&&entry.index!<range.end));
    const same = (value:string) => normalizeFormula(value)===normalizeFormula(latex);
    if (!plain.length || plain.length + source.formulae.filter(same).length !== target.formulae.filter(same).length) continue;
    for (const entry of plain.reverse()) recognizedText=recognizedText.slice(0,entry.index)+`$${latex}$`+recognizedText.slice(entry.index!+entry[0].length);
  }
  return {...result,recognizedText};
}

export function reconcileImageFormulaResult(
  result: ProviderImageTranslationResult,
): ProviderImageTranslationResult {
  const repaired = reconcilePlainPercentageLabels(reconcilePublicationOrdinal(reconcileAffiliationMarkers(repairImageFormulaResult(result))));
  const recognized = extractDelimitedFormulae(repaired.recognizedText);
  const translated = extractDelimitedFormulae(repaired.translatedText);
  const recognizedFormulaeAreSafe = (
    recognized.balanced &&
    recognized.formulae.length > 0 &&
    recognized.formulae.every((formula) => structuralIssues(formula).length === 0)
  );
  if (recognizedFormulaeAreSafe && recognized.formulae.length === 1 &&
    translated.balanced && translated.formulae.length === 0) {
    const lines = repaired.translatedText.split('\n');
    const matches = lines.flatMap((line, index) => (
      samePlainFormulaLine(line, recognized.formulae[0]!) ? [index] : []
    ));
    if (matches.length === 1) {
      lines[matches[0]!] = recognized.snippets[0]!;
      return { ...repaired, translatedText: lines.join('\n'), formulaLatex: recognized.formulae };
    }
  }
  if (
    recognizedFormulaeAreSafe &&
    translated.balanced &&
    translated.formulae.length === 0 &&
    isSafeTrailingDisplayFormulaOmission(
      repaired.recognizedText,
      repaired.translatedText,
      recognized.formulae,
      recognized.snippets,
    )
  ) {
    return {
      ...repaired,
      translatedText: appendRecognizedFormulaSnippets(
        repaired.translatedText,
        recognized.snippets,
      ),
      formulaLatex: recognized.formulae.map((formula) => formula.trim()),
    };
  }
  if (
    !recognized.balanced ||
    !translated.balanced ||
    recognized.formulae.length !== translated.formulae.length ||
    recognized.formulae.some((formula) => structuralIssues(formula).length > 0) ||
    !sameFormulae(recognized.formulae, translated.formulae)
  ) {
    return repaired;
  }
  const translatedText = replaceDelimitedFormulae(repaired.translatedText, recognized.formulae);
  if (translatedText === undefined) return repaired;
  return {
    ...repaired,
    translatedText,
    formulaLatex: recognized.formulae.map((formula) => formula.trim()),
  };
}

export function validateImageFormulaResult(
  result: ProviderImageTranslationResult,
): FormulaValidationResult {
  const issues: string[] = [];
  const recognized = extractDelimitedFormulae(result.recognizedText);
  const translated = extractDelimitedFormulae(result.translatedText);
  if (!recognized.balanced) issues.push('识别原文中的公式分隔符没有闭合');
  if (!translated.balanced) issues.push('译文中的公式分隔符没有闭合');

  for (const formula of result.formulaLatex) {
    issues.push(...structuralIssues(formula));
  }
  if (!sameFormulae(recognized.formulae, translated.formulae)) {
    issues.push('识别原文与译文中的公式不一致');
  }
  const listed = result.formulaLatex.map(normalizeFormula);
  const embedded = recognized.formulae.map(normalizeFormula);
  if (!sameFormulae(listed, embedded)) {
    issues.push('formulaLatex 与识别原文中的公式不一致');
  }

  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
  };
}

/** Keep only translated natural labels when the model repeats known diagram
 * math despite the source-only contract. Never touch caption math, unknown
 * expressions or saved/user-corrected targets. Raw replies remain auditable. */
export function keepImageFigureMathInOriginal(result:ProviderImageTranslationResult,captionHint?:string):ProviderImageTranslationResult{
  const hint=captionHint?.trim(),captionAt=hint?result.recognizedText.indexOf(hint):-1;
  if(hint&&/^Figure\s+\d+[.:]/iu.test(hint)&&captionAt>0){
    const prefix=result.recognizedText.slice(0,captionAt).trim(),suffix=result.recognizedText.slice(captionAt+hint.length).trim();
    // A model may place the explicit (a)/(b)/(c) panel labels before a caption
    // copied exactly from the native PDF. Retain all those labels, in their
    // diagram field, instead of interpreting their OCR math as caption math.
    if(prefix.length<=1200&&/^\([a-z]\)\s/u.test(prefix)&&!/[\n.!?]/u.test(prefix)&&/^\[Diagram Labels\]:/u.test(suffix)){
      result={...result,recognizedText:`${hint}\n\n[Diagram Labels]: ${prefix}; ${suffix.slice('[Diagram Labels]:'.length).trim()}`};
    }
  }
  const boundary=/\n\s*\n/u.exec(result.recognizedText),label=/\n\s*图内标签\s*[:：]/u.exec(result.translatedText);
  if(!boundary||!label)return result;
  const caption=result.recognizedText.slice(0,boundary.index),diagram=result.recognizedText.slice(boundary.index+boundary[0].length).trim();
  if(!/^Figure\s+\d+[.:]/iu.test(caption)||!/^\[Diagram Labels\]:/iu.test(diagram))return result;
  const text=result.translatedText.slice(label.index+label[0].length),math=extractDelimitedFormulae(text),original=extractDelimitedFormulae(diagram);
  if(!math.balanced||!original.balanced||!math.formulae.length)return result;
  if((text.match(/(?<!\\)\$(?:\\.|[^$])*(?<!\\)\$/gu)?.length??0)!==math.formulae.length)return result;
  const counts=(values:string[],value:string)=>values.filter(f=>normalizeFormula(f)===normalizeFormula(value)).length;
  if(math.formulae.some(f=>counts(math.formulae,f)>counts(original.formulae,f)))return result;
  const labels=text.replace(/(?<!\\)\$(?:\\.|[^$])*(?<!\\)\$/gu,'').replace(/[ \t]+/gu,' ').trim();
  // A display or other delimiter is not a natural-language label; leave it for
  // the strict validator instead of deleting an ambiguous mathematical block.
  if(extractDelimitedFormulae(labels).formulae.length)return result;
  return{...result,translatedText:result.translatedText.slice(0,label.index+label[0].length)+labels};
}

/** Diagram-only mathematics stays in the original pixels: a second OCR-based
 * transcription could silently change its font. Caption math stays editable. */
export function validateImageFigureResult(result: ProviderImageTranslationResult): FormulaValidationResult {
  const boundary = /\n\s*\n/u.exec(result.recognizedText);
  const caption = boundary ? result.recognizedText.slice(0, boundary.index) : '';
  const diagram = boundary ? result.recognizedText.slice(boundary.index + boundary[0].length).trim() : '';
  if (!/^Figure\s+\d+[.:]/iu.test(caption) ||
      !/^(?:\[(?:Diagram|Figure)\s+Labels\]|(?:[a-z]\s+)?Data\s*:|(?:Diagram\s+)?Labels\s*:|图内(?:标签|文字)\s*[:：])/iu.test(diagram)) {
    return validateImageFormulaResult(result);
  }
  const source = extractDelimitedFormulae(result.recognizedText);
  const target = extractDelimitedFormulae(result.translatedText);
  const captionMath = extractDelimitedFormulae(caption);
  const issues: string[] = [];
  if (!source.balanced) issues.push('识别原文中的公式分隔符没有闭合');
  if (!target.balanced) issues.push('译文中的公式分隔符没有闭合');
  const count = (values: string[], formula: string) => values.filter(value => normalizeFormula(value) === normalizeFormula(formula)).length;
  for (const formula of captionMath.formulae) {
    if (count(target.formulae, formula) < count(captionMath.formulae, formula)) issues.push('图注中的公式在译文中缺失或被改写');
  }
  for (const formula of target.formulae) {
    issues.push(...structuralIssues(formula));
    if (count(target.formulae, formula) > count(source.formulae, formula)) issues.push('图形译文中的公式无法与识别原文可靠对应');
    if (count(target.formulae, formula) > count(captionMath.formulae, formula)) issues.push('图内数学标签应保留在原图中，不能在图注译文中重新转写，以免改变符号字体');
  }
  return { valid: !issues.length, issues: [...new Set(issues)] };
}
