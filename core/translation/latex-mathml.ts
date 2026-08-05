import katex from 'katex';

const NESTED_ROW_ENVIRONMENT_PATTERN =
  /\\begin\s*\{(?:cases|aligned|alignedat|array|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|gathered|split)\}/u;
const NESTED_TAG_PATTERN = /\\tag\s*\{([^{}]{1,40})\}/gu;
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

/**
 * KaTeX rejects `\tag` inside row environments such as `cases`. Vision models
 * still produce this form fairly often when transcribing numbered equations.
 * This normalization is used only for the rendered copy; the translation text
 * kept for copying/exporting remains untouched.
 */
function createCompatibleDisplayCopy(tex: string): string | undefined {
  if (!NESTED_ROW_ENVIRONMENT_PATTERN.test(tex) || !NESTED_TAG_PATTERN.test(tex)) {
    NESTED_TAG_PATTERN.lastIndex = 0;
    return undefined;
  }

  NESTED_TAG_PATTERN.lastIndex = 0;
  return tex.replace(NESTED_TAG_PATTERN, (_match, tag: string) =>
    `\\qquad\\text{(${tag.trim()})}`);
}

export function renderLatexMathMl(tex: string, displayMode: boolean): string | undefined {
  const cacheKey = `${displayMode ? 'display' : 'inline'}\u0000${tex}`;
  const cached = cachedMathMl(cacheKey);
  if (cached !== null) return cached;
  const exact = renderMathMl(tex, displayMode);
  if (exact || !displayMode) {
    cacheMathMl(cacheKey, exact);
    return exact;
  }

  const compatibleCopy = createCompatibleDisplayCopy(tex);
  const rendered = compatibleCopy ? renderMathMl(compatibleCopy, displayMode) : undefined;
  cacheMathMl(cacheKey, rendered);
  return rendered;
}
