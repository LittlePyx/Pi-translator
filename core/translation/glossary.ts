import type { GlossaryEntry } from './types';

export const MAX_GLOSSARY_ENTRIES = 100;
export const MAX_GLOSSARY_TERM_LENGTH = 120;

export interface GlossaryParseResult {
  entries: GlossaryEntry[];
  errors: string[];
}

function splitGlossaryLine(
  line: string,
): { source: string; target: string } | undefined {
  const separators = ['=>', '\t', '='];
  for (const separator of separators) {
    const index = line.indexOf(separator);
    if (index < 0) continue;
    const source = line.slice(0, index).trim();
    const target = line.slice(index + separator.length).trim();
    if (source && target) return { source, target };
  }
  return undefined;
}

export function normalizeGlossaryEntries(
  values: Iterable<GlossaryEntry>,
): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const source = value.source.trim();
    const target = value.target.trim();
    const key = source.toLocaleLowerCase();
    if (
      !source ||
      !target ||
      source.length > MAX_GLOSSARY_TERM_LENGTH ||
      target.length > MAX_GLOSSARY_TERM_LENGTH ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    entries.push({ source, target });
    if (entries.length >= MAX_GLOSSARY_ENTRIES) break;
  }
  return entries;
}

export function parseGlossaryText(value: string): GlossaryParseResult {
  const entries: GlossaryEntry[] = [];
  const errors: string[] = [];

  for (const [index, rawLine] of value.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const pair = splitGlossaryLine(line);
    if (!pair) {
      errors.push(`第 ${index + 1} 行格式不正确，应使用“原词 = 译词”。`);
      continue;
    }
    if (
      pair.source.length > MAX_GLOSSARY_TERM_LENGTH ||
      pair.target.length > MAX_GLOSSARY_TERM_LENGTH
    ) {
      errors.push(`第 ${index + 1} 行术语过长。`);
      continue;
    }
    entries.push(pair);
  }

  if (entries.length > MAX_GLOSSARY_ENTRIES) {
    errors.push(`术语表最多支持 ${MAX_GLOSSARY_ENTRIES} 条。`);
  }

  return {
    entries: normalizeGlossaryEntries(entries),
    errors,
  };
}

export function formatGlossaryEntries(entries: Iterable<GlossaryEntry>): string {
  return normalizeGlossaryEntries(entries)
    .map(({ source, target }) => `${source} = ${target}`)
    .join('\n');
}
