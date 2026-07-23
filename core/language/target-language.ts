const LATIN_LANGUAGE_WORDS: Record<string, ReadonlySet<string>> = {
  en: new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'be',
    'for',
    'from',
    'in',
    'is',
    'it',
    'of',
    'on',
    'that',
    'the',
    'this',
    'to',
    'was',
    'with',
  ]),
  de: new Set([
    'aber',
    'das',
    'der',
    'die',
    'ein',
    'eine',
    'für',
    'im',
    'in',
    'ist',
    'mit',
    'nicht',
    'und',
    'von',
    'zu',
  ]),
  fr: new Set([
    'au',
    'aux',
    'avec',
    'ce',
    'cette',
    'dans',
    'de',
    'des',
    'du',
    'en',
    'est',
    'et',
    'la',
    'le',
    'les',
    'pour',
    'une',
    'un',
  ]),
};

function countCharacters(text: string, pattern: RegExp): number {
  let count = 0;
  for (const character of text) {
    if (pattern.test(character)) count += 1;
  }
  return count;
}

function isLikelyChinese(text: string): boolean {
  const letters = countCharacters(text, /\p{L}/u);
  if (letters < 3) return false;
  const han = countCharacters(text, /\p{Script=Han}/u);
  const kana = countCharacters(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/u);
  return kana === 0 && han / letters >= 0.8;
}

function isLikelyJapanese(text: string): boolean {
  const letters = countCharacters(text, /\p{L}/u);
  if (letters < 3) return false;
  const han = countCharacters(text, /\p{Script=Han}/u);
  const kana = countCharacters(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/u);
  return kana >= 2 && (han + kana) / letters >= 0.8;
}

function scoreLatinLanguage(text: string, language: 'en' | 'de' | 'fr'): number {
  const words = text.toLocaleLowerCase().match(/\p{Script=Latin}+/gu) ?? [];
  const vocabulary = LATIN_LANGUAGE_WORDS[language];
  let score = words.reduce(
    (total, word) => total + (vocabulary?.has(word) ? 1 : 0),
    0,
  );
  if (language === 'de' && /[äöüß]/iu.test(text)) score += 2;
  if (language === 'fr' && /[àâçéèêëîïôœùûüÿ]/iu.test(text)) score += 2;
  return score;
}

function isLikelyLatinLanguage(
  text: string,
  targetLanguage: 'en' | 'de' | 'fr',
): boolean {
  const words = text.match(/\p{Script=Latin}+/gu) ?? [];
  if (words.length < 4) return false;

  const scores = {
    en: scoreLatinLanguage(text, 'en'),
    de: scoreLatinLanguage(text, 'de'),
    fr: scoreLatinLanguage(text, 'fr'),
  };
  const targetScore = scores[targetLanguage];
  const otherScore = Math.max(
    ...Object.entries(scores)
      .filter(([language]) => language !== targetLanguage)
      .map(([, score]) => score),
  );
  return targetScore >= 2 && targetScore >= otherScore + 1;
}

export function isLikelyTargetLanguage(
  text: string,
  targetLanguage: string,
): boolean {
  if (targetLanguage === 'zh-CN' || targetLanguage === 'zh') {
    return isLikelyChinese(text);
  }
  if (targetLanguage === 'ja') return isLikelyJapanese(text);
  if (
    targetLanguage === 'en' ||
    targetLanguage === 'de' ||
    targetLanguage === 'fr'
  ) {
    return isLikelyLatinLanguage(text, targetLanguage);
  }
  return false;
}
