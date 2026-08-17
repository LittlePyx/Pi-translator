import type { LexicalLookup, TranslateRequest } from './types';

export const LEXICAL_LOOKUP_MAX_CHARACTERS = 64;
export const LEXICAL_LOOKUP_MAX_WORDS = 6;

const STRONG_PUNCTUATION = /[,，:：;；.!?。！？]/u;
const LATEX_SYNTAX = /(?:\\[A-Za-z@]+|\$|⟦|⟧|[_^{}])/u;
const LETTER = /\p{L}/u;

/**
 * Keeps dictionary-style output limited to selections that look like a word
 * or short phrase. The provider may still omit lookup metadata, in which case
 * the normal translation result remains usable.
 */
export function isLexicalLookupCandidate(
  request: Pick<TranslateRequest, 'text' | 'contentMode' | 'revision'>,
): boolean {
  if (request.revision || request.contentMode === 'latex') return false;
  const text = request.text.trim();
  if (!text || /\r|\n/u.test(text) || STRONG_PUNCTUATION.test(text)) return false;
  if (LATEX_SYNTAX.test(text) || !LETTER.test(text)) return false;

  const characters = [...text].length;
  if (characters > LEXICAL_LOOKUP_MAX_CHARACTERS) return false;

  const words = text.split(/\s+/u).filter(Boolean);
  return words.length <= LEXICAL_LOOKUP_MAX_WORDS;
}

function compactLookupText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const compact = value.trim().replace(/\s+/gu, ' ').slice(0, maximum);
  return compact || undefined;
}

export function sanitizeLexicalLookup(value: unknown): LexicalLookup | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const pronunciation = compactLookupText(record.pronunciation, 80);
  const partOfSpeech = compactLookupText(record.partOfSpeech, 48);
  const senses = Array.isArray(record.senses)
    ? record.senses.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const sense = item as Record<string, unknown>;
        const meaning = compactLookupText(sense.meaning, 240);
        if (!meaning) return [];
        const sensePartOfSpeech = compactLookupText(sense.partOfSpeech, 48);
        return [{
          meaning,
          ...(sensePartOfSpeech ? { partOfSpeech: sensePartOfSpeech } : {}),
        }];
      }).filter((sense, index, all) => (
        all.findIndex((candidate) => (
          candidate.meaning.toLocaleLowerCase() === sense.meaning.toLocaleLowerCase()
        )) === index
      )).slice(0, 3)
    : [];
  if (!pronunciation && !partOfSpeech && !senses.length) return undefined;
  return {
    ...(pronunciation ? { pronunciation } : {}),
    ...(partOfSpeech ? { partOfSpeech } : {}),
    senses,
  };
}
