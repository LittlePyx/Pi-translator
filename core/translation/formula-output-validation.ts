import type { ProviderImageTranslationResult } from './types';

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

function normalizeFormula(value: string): string {
  return value
    .replaceAll(/\s+/gu, ' ')
    .replaceAll(/\s*([=+\-*/^_{}()[\],;:<>])\s*/gu, '$1')
    .trim();
}

function extractDelimitedFormulae(text: string): {
  formulae: string[];
  balanced: boolean;
} {
  const formulae: string[] = [];
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
      index = end + delimiter.length;
      continue;
    }
    index += 1;
  }
  return { formulae, balanced };
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

function structuralIssues(formula: string): string[] {
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

/**
 * The OCR text is the source of truth for formula bodies. Vision models often
 * preserve the meaning while changing harmless LaTeX spelling in the
 * translation or the metadata list. When the formula count and recognized
 * structure are reliable, restore the exact recognized bodies locally instead
 * of paying for a second image request.
 */
export function reconcileImageFormulaResult(
  result: ProviderImageTranslationResult,
): ProviderImageTranslationResult {
  const recognized = extractDelimitedFormulae(result.recognizedText);
  const translated = extractDelimitedFormulae(result.translatedText);
  if (
    !recognized.balanced ||
    !translated.balanced ||
    recognized.formulae.length !== translated.formulae.length ||
    recognized.formulae.some((formula) => structuralIssues(formula).length > 0)
  ) {
    return result;
  }
  const translatedText = replaceDelimitedFormulae(result.translatedText, recognized.formulae);
  if (translatedText === undefined) return result;
  return {
    ...result,
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
