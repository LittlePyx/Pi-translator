/** Local PDF labels, not model-generated numbering. Hints remain untrusted
 * document text and do not establish that a transcription is mathematically correct. */
export interface SourceEquation {
  id: string;
  number: string;
  rowHint: string;
  groupId?: string;
  /** Locally observed equality rows sharing this one printed label. */
  rowCount?: number;
}

export const SOURCE_EQUATION_ID = /^eq-p\d{1,5}-x\d{1,6}-y\d{1,6}$/u;
export const EQUATION_LABEL = /^\d{1,4}[a-z]?$/iu;

export function validSourceEquations(value: unknown): value is SourceEquation[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 64) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      !Object.keys(entry).every((key) => ['id', 'number', 'rowHint', 'groupId', 'rowCount'].includes(key)) ||
      typeof entry.id !== 'string' || !SOURCE_EQUATION_ID.test(entry.id) || ids.has(entry.id) ||
      typeof entry.number !== 'string' || !EQUATION_LABEL.test(entry.number) ||
      typeof entry.rowHint !== 'string' || entry.rowHint.length > 500 ||
      (entry.rowCount !== undefined && (!Number.isInteger(entry.rowCount) || entry.rowCount < 2 || entry.rowCount > 8)) ||
      (entry.groupId !== undefined && (typeof entry.groupId !== 'string' || !SOURCE_EQUATION_ID.test(entry.groupId)))) return false;
    ids.add(entry.id);
    return true;
  });
}
