const ROW_ENVIRONMENT_NAMES = [
  'align',
  'aligned',
  'alignedat',
  'alignat',
  'array',
  'Bmatrix',
  'bmatrix',
  'cases',
  'eqnarray',
  'flalign',
  'gather',
  'gathered',
  'matrix',
  'multline',
  'pmatrix',
  'smallmatrix',
  'split',
  'subarray',
  'Vmatrix',
  'vmatrix',
] as const;

const escapedEnvironmentNames = ROW_ENVIRONMENT_NAMES
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  .join('|');

/**
 * Matches LaTeX structures in which `\\` is a semantic row separator. Keep
 * this shared so canonicalization, tag extraction, rendering and copy/export
 * never disagree about whether a pair of backslashes may be meaningful.
 */
export const LATEX_ROW_STRUCTURE_PATTERN = new RegExp(
  `\\\\begin\\s*\\{(?:${escapedEnvironmentNames})\\*?\\}|\\\\substack\\s*\\{`,
  'u',
);

export function containsLatexRowStructure(tex: string): boolean {
  return LATEX_ROW_STRUCTURE_PATTERN.test(tex);
}
