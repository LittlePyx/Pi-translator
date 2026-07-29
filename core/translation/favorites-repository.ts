import type { TranslateResult, TranslationFavorite } from './types';
import { assertSafeFavoriteText } from './image-output-safety';

const FAVORITES_KEY = 'translationFavorites';
export const MAX_TRANSLATION_FAVORITES = 100;

function validFavorites(value: unknown): TranslationFavorite[] {
  return Array.isArray(value)
    ? value.filter((item): item is TranslationFavorite =>
        Boolean(
          item &&
            typeof item === 'object' &&
            'favoriteId' in item &&
            typeof item.favoriteId === 'string' &&
            'originalText' in item &&
            typeof item.originalText === 'string' &&
            'translatedText' in item &&
            typeof item.translatedText === 'string',
        ),
      )
    : [];
}

async function readFavorites(): Promise<TranslationFavorite[]> {
  const stored = await browser.storage.local.get(FAVORITES_KEY);
  return validFavorites(stored[FAVORITES_KEY]);
}

export async function getTranslationFavorites(query = ''): Promise<TranslationFavorite[]> {
  const favorites = await readFavorites();
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return favorites;
  return favorites.filter((favorite) =>
    [favorite.originalText, favorite.translatedText, favorite.sourceHost]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalized)),
  );
}

export async function addTranslationFavorite(
  result: TranslateResult,
): Promise<TranslationFavorite[]> {
  assertSafeFavoriteText(result);
  const favorites = await readFavorites();
  const duplicate = favorites.find(
    (item) =>
      item.originalText === result.originalText &&
      item.translatedText === result.translatedText &&
      item.targetLanguage === result.targetLanguage,
  );
  if (duplicate) {
    return [duplicate, ...favorites.filter((item) => item.favoriteId !== duplicate.favoriteId)];
  }
  const favorite: TranslationFavorite = {
    ...result,
    favoriteId: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  const next = [favorite, ...favorites].slice(0, MAX_TRANSLATION_FAVORITES);
  await browser.storage.local.set({ [FAVORITES_KEY]: next });
  return next;
}

export async function deleteTranslationFavorite(
  favoriteId: string,
): Promise<TranslationFavorite[]> {
  const next = (await readFavorites()).filter((item) => item.favoriteId !== favoriteId);
  await browser.storage.local.set({ [FAVORITES_KEY]: next });
  return next;
}
