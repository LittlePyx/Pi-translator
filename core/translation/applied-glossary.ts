import type { AppliedGlossaryTerm } from './types';

const MAX_APPLIED_GLOSSARY_TERMS = 8;

function normalizedText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function containsTerm(text: string, term: string): boolean {
  const normalizedValue = normalizedText(text);
  const normalizedTerm = normalizedText(term);
  if (!normalizedValue || !normalizedTerm) return false;
  const expression = escapeRegExp(normalizedTerm).replace(/ /gu, '\\s+');
  // Latin terms need word boundaries (so `attention` does not match
  // `inattentional`). CJK terminology is commonly embedded directly beside
  // other CJK characters, so applying the same boundary rule would hide valid
  // mappings such as `注意力` in `注意力层`.
  const startsWithWord = /^[\p{Script=Latin}\p{N}]/u.test(normalizedTerm);
  const endsWithWord = /[\p{Script=Latin}\p{N}]$/u.test(normalizedTerm);
  return new RegExp(
    `${startsWithWord ? '(?:^|[^\\p{L}\\p{N}])' : ''}${expression}${endsWithWord ? '(?=$|[^\\p{L}\\p{N}])' : ''}`,
    'u',
  ).test(normalizedValue);
}

/**
 * Reports only glossary mappings with observable evidence: the source term is
 * present in the input and the configured target is present in the completed
 * translation. This deliberately does not treat a term sent to the model as
 * proof that the model used it.
 */
export function findAppliedGlossaryTerms(
  originalText: string,
  translatedText: string,
  glossary: AppliedGlossaryTerm[],
  maximum = MAX_APPLIED_GLOSSARY_TERMS,
): AppliedGlossaryTerm[] {
  if (maximum <= 0) return [];
  const seenSources = new Set<string>();
  const applied: AppliedGlossaryTerm[] = [];
  for (const term of glossary) {
    const sourceKey = normalizedText(term.source);
    if (
      !sourceKey ||
      seenSources.has(sourceKey) ||
      !containsTerm(originalText, term.source) ||
      !containsTerm(translatedText, term.target)
    ) continue;
    seenSources.add(sourceKey);
    applied.push({ source: term.source.trim(), target: term.target.trim(), scope: term.scope });
    if (applied.length >= maximum) break;
  }
  return applied;
}
