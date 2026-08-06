import katex from 'katex';
import { containsLatexRowStructure } from './latex-structure';

const NESTED_TAG_PATTERN = /\\tag\s*\{([^{}]{1,40})\}/gu;
const OVERESCAPED_COMMAND_PATTERN = /(^|[^\\])(\\{2,})([A-Za-z]{2,}\*?)/gu;
const PSEUDO_FONT_COMMAND_PATTERN =
  /(^|[^A-Za-z\\])(mathbb|mathbf|mathrm|mathcal|mathsf|mathtt|mathit|boldsymbol)([A-Za-z])(?=[^A-Za-z]|$)/gu;
const MATHML_CACHE_LIMIT = 256;
const mathMlCache = new Map<string, string | null>();

function cachedMathMl(key: string): string | undefined | null {
  if (!mathMlCache.has(key)) return null;
  const cached = mathMlCache.get(key) ?? null;
  mathMlCache.delete(key);
  mathMlCache.set(key, cached);
  return cached ?? undefined;
}

function cacheMathMl(key: string, html: string | undefined): void {
  mathMlCache.set(key, html ?? null);
  if (mathMlCache.size <= MATHML_CACHE_LIMIT) return;
  const oldest = mathMlCache.keys().next().value as string | undefined;
  if (oldest !== undefined) mathMlCache.delete(oldest);
}

function renderMathMl(tex: string, displayMode: boolean): string | undefined {
  try {
    return katex.renderToString(tex, {
      displayMode,
      output: 'mathml',
      throwOnError: true,
      strict: 'ignore',
      trust: false,
    });
  } catch {
    return undefined;
  }
}

function unwrapOverescapedMathDelimiter(tex: string): string {
  const trimmed = tex.trim();
  const wrapped = /^(\\{2,})([[(])([\s\S]*)(\\{2,})([\])])$/u.exec(trimmed);
  if (wrapped) {
    const [, openerSlashes, opener, body, closerSlashes, closer] = wrapped;
    const matchingBrackets = (opener === '[' && closer === ']') ||
      (opener === '(' && closer === ')');
    if (matchingBrackets && openerSlashes?.length === closerSlashes?.length) {
      return body?.trim() ?? '';
    }
  }
  return tex;
}

/**
 * Repairs only the rendered copy of a math segment. Two backslashes before a
 * multi-letter command are a common vision/JSON double-escaping artefact. A
 * real row separator followed by a TeX command has three backslashes (`\\` +
 * `\command`), so exactly two can be collapsed without changing aligned/cases
 * row breaks. Bare `mathbbQ`-style pseudo commands are repaired here, inside an
 * already delimited math segment, and never in ordinary prose.
 */
function createCompatibleMathCopy(tex: string, displayMode: boolean): string | undefined {
  let compatible = unwrapOverescapedMathDelimiter(tex);
  const hasRowEnvironment = containsLatexRowStructure(compatible);
  compatible = compatible.replace(
    OVERESCAPED_COMMAND_PATTERN,
    (match, prefix: string, slashes: string, command: string) => {
      if (hasRowEnvironment && slashes.length !== 2) return match;
      return `${prefix}\\${command}`;
    },
  );
  compatible = compatible.replace(
    PSEUDO_FONT_COMMAND_PATTERN,
    (_match, prefix: string, command: string, value: string) =>
      `${prefix}\\${command}{${value}}`,
  );

  if (!hasRowEnvironment) {
    compatible = compatible.replace(/\\{2,}\s*$/u, '').trim();
  }

  if (
    displayMode &&
    containsLatexRowStructure(compatible) &&
    NESTED_TAG_PATTERN.test(compatible)
  ) {
    NESTED_TAG_PATTERN.lastIndex = 0;
    compatible = compatible.replace(NESTED_TAG_PATTERN, (_match, tag: string) =>
      `\\qquad\\text{(${tag.trim()})}`);
  }
  NESTED_TAG_PATTERN.lastIndex = 0;
  return compatible === tex ? undefined : compatible;
}

export function renderLatexMathMl(tex: string, displayMode: boolean): string | undefined {
  const cacheKey = `${displayMode ? 'display' : 'inline'}\u0000${tex}`;
  const cached = cachedMathMl(cacheKey);
  if (cached !== null) return cached;
  const exact = renderMathMl(tex, displayMode);
  if (exact) {
    cacheMathMl(cacheKey, exact);
    return exact;
  }
  const compatibleCopy = createCompatibleMathCopy(tex, displayMode);
  const compatible = compatibleCopy
    ? renderMathMl(compatibleCopy, displayMode)
    : undefined;
  if (compatible) {
    cacheMathMl(cacheKey, compatible);
    return compatible;
  }
  cacheMathMl(cacheKey, undefined);
  return undefined;
}
