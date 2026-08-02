import katex from 'katex';

const NESTED_ROW_ENVIRONMENT_PATTERN =
  /\\begin\s*\{(?:cases|aligned|alignedat|array|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|gathered|split)\}/u;
const NESTED_TAG_PATTERN = /\\tag\s*\{([^{}]{1,40})\}/gu;

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
  const exact = renderMathMl(tex, displayMode);
  if (exact || !displayMode) {
    return exact;
  }

  const compatibleCopy = createCompatibleDisplayCopy(tex);
  return compatibleCopy ? renderMathMl(compatibleCopy, displayMode) : undefined;
}
