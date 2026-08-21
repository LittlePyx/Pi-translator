import type { SelectionSnapshot } from './types';

export type PassiveTranslationSurface = 'general' | 'overleaf' | 'pdf';

const PROGRAMMING_LINE = /^(?:(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*:[^=]+)?\s*=|(?:(?:public|private|protected|static|abstract|final)\s+)+(?:(?:class|interface|enum)\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$<>[\], ?]*\s+[A-Za-z_$][\w$]*\s*(?:[=(;{]))|(?:class|interface|enum|type|def)\s+[A-Za-z_$][\w$]*|(?:if|for|while|switch|catch)\s*\(|(?:return|throw|yield|await|new)\s+\S|(?:import|export)\s+(?:[\w*{},]+\s+from\s+|['"]|default\s+)|(?:package|namespace|using)\s+[\w.]+|(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b)/iu;
const COMMAND_LINE = /^(?:(?:[$>#]\s+)?(?:npm|pnpm|yarn|bun|git|docker|docker-compose|kubectl|pip|python|node|deno|cargo|rustc|go|java|javac|mvn|gradle|dotnet|powershell|pwsh|bash|zsh)\s+[-\w./])/iu;
const STACK_TRACE_LINE = /^(?:(?:[A-Za-z_$][\w.$]*(?:Error|Exception))\b|at\s+(?:new\s+)?[\w$.<>]+\s*\([^()\n]+:\d+(?::\d+)?\)|File\s+["'][^"']+["'],\s+line\s+\d+)/u;
const COMMENT_LINE = /^(?:\/\/|\/\*|\*\/|\*\s|#\s|--\s|%\s)/u;
const LATEX_STRUCTURAL_COMMAND = /\\(?:begin|end|documentclass|usepackage|newcommand|renewcommand|section|subsection|subsubsection|paragraph|label|ref|eqref|cite|bibliography|bibliographystyle|includegraphics|input|include)\*?(?:\s*\[[^\]]*\])?(?:\s*\{[^{}]*\})?/gu;

function nonEmptyLines(value: string): string[] {
  return value.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
}

function occurrences(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function sentenceLikeWordCount(value: string): number {
  return occurrences(value, /\p{L}[\p{L}\p{M}'’-]{1,}/gu);
}

/**
 * Conservative content-only detection for passive selection affordances. It
 * intentionally requires strong syntax evidence: false negatives merely keep
 * the existing Pi button, while false positives could hide a useful action.
 */
export function isLikelySourceCode(value: string): boolean {
  const text = value.trim();
  if (text.length < 4) return false;
  const lines = nonEmptyLines(text);
  if (!lines.length) return false;

  if (/^```[\s\S]*```$/u.test(text) || /^~~~[\s\S]*~~~$/u.test(text)) return true;
  if (/^(?:[A-Za-z]:\\|\/(?:[\w.-]+\/)+)[^\s]+$/u.test(text)) return true;

  const jsonPairs = occurrences(text, /["'][^"'\n]{1,80}["']\s*:/gu);
  if (jsonPairs >= 2 || (jsonPairs >= 1 && /^[\s]*[\[{][\s\S]*[\]}][\s]*$/u.test(text))) {
    return true;
  }
  if (/<[A-Za-z][\w:-]*(?:\s+[^<>]*?)?>[\s\S]*<\/[A-Za-z][\w:-]*\s*>/u.test(text)) {
    return true;
  }
  if (/[^{}\n]+\{(?:[^{}]*[\w-]+\s*:\s*[^{};]+;?){2,}[^{}]*\}/u.test(text)) {
    return true;
  }

  const strongLines = lines.filter((line) => (
    PROGRAMMING_LINE.test(line) ||
    COMMAND_LINE.test(line) ||
    STACK_TRACE_LINE.test(line) ||
    COMMENT_LINE.test(line) ||
    /^(?:\}|\])\)?;?$/u.test(line)
  )).length;
  if (strongLines >= 2 || (strongLines === 1 && lines.length === 1)) return true;

  const syntaxLines = lines.filter((line) => (
    /(?:=>|===|!==|&&|\|\||\+\+|--|::|:=|\+=|-=|\*=|\?\.)/u.test(line) ||
    /[{};]\s*$/u.test(line) ||
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^;\n]*\);?$/u.test(line)
  )).length;
  if (lines.length >= 2 && syntaxLines >= 2) return true;

  const operatorCount = occurrences(text, /(?:=>|===|!==|&&|\|\||\+\+|--|::|:=|\+=|-=|\*=|\?\.)/gu);
  const delimiterCount = occurrences(text, /[{}\[\]();]/gu);
  const codeIdentifiers = occurrences(text, /\b(?:[A-Za-z_$][\w$]*_[A-Za-z_$][\w$]*|[a-z]+[A-Z][A-Za-z\d$]*|[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\b/gu);
  const wordCount = sentenceLikeWordCount(text);
  if (/\\[A-Za-z@]+/u.test(text) && wordCount >= 5 && /[.!?。！？]\s*$/u.test(text)) {
    return false;
  }
  return (
    text.length <= 500 &&
    wordCount <= 18 &&
    delimiterCount >= 3 &&
    operatorCount + codeIdentifiers >= 2
  );
}

export function isLikelyLatexStructure(value: string): boolean {
  const text = value.trim();
  if (!text.includes('\\')) return false;
  const commands = text.match(LATEX_STRUCTURAL_COMMAND) ?? [];
  if (!commands.length) return false;
  const prose = text
    .replace(LATEX_STRUCTURAL_COMMAND, ' ')
    .replace(/\\[A-Za-z@]+\*?/gu, ' ')
    .replace(/[{}$^_&#%~\d]+/gu, ' ');
  const proseWords = sentenceLikeWordCount(prose);
  return commands.length >= 2 ? proseWords < 5 : proseWords < 3;
}

export function shouldSuppressPassiveSelectionTranslation(
  snapshot: Pick<SelectionSnapshot, 'normalizedText' | 'passiveSelectionEnvironment'>,
  surface: PassiveTranslationSurface,
): boolean {
  if (surface === 'pdf') return false;
  if (snapshot.passiveSelectionEnvironment === 'terminal') return true;
  if (surface === 'general' && snapshot.passiveSelectionEnvironment === 'code') return true;
  if (isLikelySourceCode(snapshot.normalizedText)) return true;
  return surface === 'overleaf' && isLikelyLatexStructure(snapshot.normalizedText);
}
