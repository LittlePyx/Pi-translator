import { TranslationError } from '../messaging/errors';
import type { TranslationWarning } from '../translation/types';
import type { ProtectedFragment, ProtectedLatex, RestoredLatex } from './types';

const HARD_PROTECTED_MACROS = new Set([
  'cite',
  'citep',
  'citet',
  'citeauthor',
  'citeyear',
  'ref',
  'eqref',
  'pageref',
  'autoref',
  'cref',
  'Cref',
  'label',
  'url',
  'includegraphics',
  'input',
  'include',
  'bibliography',
  'bibliographystyle',
]);

const TEXT_ARGUMENT_MACROS = new Set([
  'textbf',
  'textit',
  'texttt',
  'emph',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'caption',
  'title',
  'author',
  'footnote',
]);

const MATH_ENVIRONMENTS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'displaymath',
]);

interface ScanState {
  source: string;
  namespace: string;
  fragments: ProtectedFragment[];
  warnings: TranslationWarning[];
}

interface CommandToken {
  name: string;
  end: number;
}

interface BalancedGroup {
  end: number;
  contentStart: number;
  contentEnd: number;
}

function createNamespace(source: string): string {
  let namespace = 'TEX';
  while (source.includes(`⟦${namespace}_`)) {
    namespace += 'X';
  }
  return namespace;
}

function addFragment(state: ScanState, raw: string): string {
  const token = `⟦${state.namespace}_${String(state.fragments.length + 1).padStart(4, '0')}⟧`;
  state.fragments.push({ token, raw });
  return token;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function readCommand(source: string, start: number): CommandToken {
  let cursor = start + 1;
  if (cursor >= source.length) {
    return { name: '', end: cursor };
  }

  if (!/[A-Za-z@]/.test(source[cursor] ?? '')) {
    return { name: source[cursor] ?? '', end: cursor + 1 };
  }

  while (cursor < source.length && /[A-Za-z@]/.test(source[cursor] ?? '')) {
    cursor += 1;
  }
  if (source[cursor] === '*') {
    cursor += 1;
  }
  return { name: source.slice(start + 1, cursor), end: cursor };
}

function readBalancedGroup(
  source: string,
  start: number,
  open: '{' | '[',
  close: '}' | ']',
): BalancedGroup | undefined {
  if (source[start] !== open) {
    return undefined;
  }

  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === open && !isEscaped(source, cursor)) {
      depth += 1;
    } else if (character === close && !isEscaped(source, cursor)) {
      depth -= 1;
      if (depth === 0) {
        return {
          end: cursor + 1,
          contentStart: start + 1,
          contentEnd: cursor,
        };
      }
    }
  }
  return undefined;
}

function readFollowingGroups(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length) {
    const whitespaceStart = cursor;
    while (cursor < source.length && /\s/.test(source[cursor] ?? '')) {
      cursor += 1;
    }

    const character = source[cursor];
    if (character !== '{' && character !== '[') {
      return whitespaceStart;
    }

    const group = readBalancedGroup(
      source,
      cursor,
      character,
      character === '{' ? '}' : ']',
    );
    if (!group) {
      return source.length;
    }
    cursor = group.end;
  }
  return cursor;
}

function findUnescaped(source: string, needle: string, start: number): number {
  let cursor = source.indexOf(needle, start);
  while (cursor >= 0 && isEscaped(source, cursor)) {
    cursor = source.indexOf(needle, cursor + needle.length);
  }
  return cursor;
}

function protectMathDollar(state: ScanState, start: number): { text: string; end: number } {
  const delimiter = state.source.startsWith('$$', start) ? '$$' : '$';
  const close = findUnescaped(state.source, delimiter, start + delimiter.length);
  const end = close >= 0 ? close + delimiter.length : state.source.length;
  if (close < 0) {
    state.warnings.push({
      code: 'INCOMPLETE_LATEX_PROTECTED',
      message: 'An unclosed math fragment was protected conservatively.',
    });
  }
  return { text: addFragment(state, state.source.slice(start, end)), end };
}

function protectSlashMath(
  state: ScanState,
  start: number,
  opener: '\\(' | '\\[',
): { text: string; end: number } {
  const closer = opener === '\\(' ? '\\)' : '\\]';
  const close = state.source.indexOf(closer, start + opener.length);
  const end = close >= 0 ? close + closer.length : state.source.length;
  if (close < 0) {
    state.warnings.push({
      code: 'INCOMPLETE_LATEX_PROTECTED',
      message: 'An unclosed math fragment was protected conservatively.',
    });
  }
  return { text: addFragment(state, state.source.slice(start, end)), end };
}

function protectTextMacro(
  state: ScanState,
  start: number,
  command: CommandToken,
): { text: string; end: number } | undefined {
  let cursor = command.end;
  while (cursor < state.source.length && /\s/.test(state.source[cursor] ?? '')) {
    cursor += 1;
  }
  const group = readBalancedGroup(state.source, cursor, '{', '}');
  if (!group) {
    return undefined;
  }

  const prefix = state.source.slice(start, group.contentStart);
  const inner = scanRange(state, group.contentStart, group.contentEnd);
  const suffix = state.source.slice(group.contentEnd, group.end);
  return {
    text: `${addFragment(state, prefix)}${inner}${addFragment(state, suffix)}`,
    end: group.end,
  };
}

function protectMathEnvironment(
  state: ScanState,
  start: number,
  command: CommandToken,
): { text: string; end: number } | undefined {
  if (command.name !== 'begin') {
    return undefined;
  }
  let cursor = command.end;
  while (cursor < state.source.length && /\s/.test(state.source[cursor] ?? '')) {
    cursor += 1;
  }
  const envGroup = readBalancedGroup(state.source, cursor, '{', '}');
  if (!envGroup) {
    return undefined;
  }
  const environment = state.source.slice(envGroup.contentStart, envGroup.contentEnd);
  if (!MATH_ENVIRONMENTS.has(environment)) {
    return undefined;
  }

  const endToken = `\\end{${environment}}`;
  const close = state.source.indexOf(endToken, envGroup.end);
  const end = close >= 0 ? close + endToken.length : state.source.length;
  if (close < 0) {
    state.warnings.push({
      code: 'INCOMPLETE_LATEX_PROTECTED',
      message: `The ${environment} environment was not closed inside the selection.`,
    });
  }
  return { text: addFragment(state, state.source.slice(start, end)), end };
}

function protectCommand(
  state: ScanState,
  start: number,
): { text: string; end: number } {
  const command = readCommand(state.source, start);

  const mathEnvironment = protectMathEnvironment(state, start, command);
  if (mathEnvironment) {
    return mathEnvironment;
  }

  if (TEXT_ARGUMENT_MACROS.has(command.name)) {
    const textMacro = protectTextMacro(state, start, command);
    if (textMacro) {
      return textMacro;
    }
  }

  const end = readFollowingGroups(state.source, command.end);
  const protectedEnd = Math.max(end, command.end);
  if (!HARD_PROTECTED_MACROS.has(command.name) && command.name.length > 1) {
    state.warnings.push({
      code: 'UNKNOWN_MACRO_PROTECTED',
      message: `Unknown macro \\${command.name} was protected conservatively.`,
    });
  }
  return {
    text: addFragment(state, state.source.slice(start, protectedEnd)),
    end: protectedEnd,
  };
}

function scanRange(state: ScanState, start: number, end: number): string {
  let cursor = start;
  let output = '';

  while (cursor < end) {
    const character = state.source[cursor];
    if (character === '%' && !isEscaped(state.source, cursor)) {
      const newline = state.source.indexOf('\n', cursor);
      const commentEnd = newline >= 0 && newline < end ? newline : end;
      output += addFragment(state, state.source.slice(cursor, commentEnd));
      cursor = commentEnd;
      continue;
    }

    if (character === '$' && !isEscaped(state.source, cursor)) {
      const math = protectMathDollar(state, cursor);
      output += math.text;
      cursor = Math.min(math.end, end);
      continue;
    }

    if (state.source.startsWith('\\(', cursor) || state.source.startsWith('\\[', cursor)) {
      const opener = state.source.slice(cursor, cursor + 2) as '\\(' | '\\[';
      const math = protectSlashMath(state, cursor, opener);
      output += math.text;
      cursor = Math.min(math.end, end);
      continue;
    }

    if (character === '\\') {
      const command = protectCommand(state, cursor);
      output += command.text;
      cursor = Math.min(command.end, end);
      continue;
    }

    output += character;
    cursor += 1;
  }
  return output;
}

export function protectLatex(sourceText: string): ProtectedLatex {
  const state: ScanState = {
    source: sourceText,
    namespace: createNamespace(sourceText),
    fragments: [],
    warnings: [],
  };

  return {
    sourceText,
    protectedText: scanRange(state, 0, sourceText.length),
    fragments: state.fragments,
    warnings: state.warnings,
  };
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  let cursor = 0;
  while ((cursor = text.indexOf(token, cursor)) >= 0) {
    count += 1;
    cursor += token.length;
  }
  return count;
}

function braceDelta(value: string): number {
  let delta = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (isEscaped(value, index)) continue;
    if (value[index] === '{') delta += 1;
    if (value[index] === '}') delta -= 1;
  }
  return delta;
}

function isStructureSensitive(raw: string): boolean {
  return braceDelta(raw) !== 0 || /\\(?:begin|end)\s*\{/.test(raw);
}

export function restoreLatex(
  translatedText: string,
  protectedLatex: ProtectedLatex,
): RestoredLatex {
  let previousStructuralIndex = -1;
  for (const fragment of protectedLatex.fragments) {
    if (countOccurrences(translatedText, fragment.token) !== 1) {
      throw new TranslationError(
        'LATEX_VALIDATION_FAILED',
        `Protected LaTeX token ${fragment.token} was changed by the provider.`,
      );
    }
    const currentIndex = translatedText.indexOf(fragment.token);
    if (isStructureSensitive(fragment.raw) && currentIndex < previousStructuralIndex) {
      throw new TranslationError(
        'LATEX_VALIDATION_FAILED',
        'Structural LaTeX tokens were reordered by the provider.',
      );
    }
    if (isStructureSensitive(fragment.raw)) {
      previousStructuralIndex = currentIndex;
    }
  }

  let restored = translatedText;
  for (const fragment of protectedLatex.fragments) {
    restored = restored.replace(fragment.token, fragment.raw);
  }

  return { text: restored, warnings: protectedLatex.warnings };
}
