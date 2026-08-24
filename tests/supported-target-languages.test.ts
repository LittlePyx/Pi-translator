import { describe, expect, it } from 'vitest';

import {
  isSupportedTargetLanguage,
  SUPPORTED_TARGET_LANGUAGES,
  supportedTargetLanguageLabel,
} from '../core/language/supported-target-languages';

describe('supported target languages', () => {
  it('keeps the compact side-panel choices explicit and stable', () => {
    expect(SUPPORTED_TARGET_LANGUAGES.map((language) => language.value)).toEqual([
      'zh-CN',
      'en',
      'ja',
      'de',
      'fr',
    ]);
    expect(supportedTargetLanguageLabel('zh-CN')).toBe('中文');
    expect(supportedTargetLanguageLabel('en')).toBe('英文');
  });

  it('rejects arbitrary imported language values in the compact control', () => {
    expect(isSupportedTargetLanguage('de')).toBe(true);
    expect(isSupportedTargetLanguage('xx')).toBe(false);
    expect(isSupportedTargetLanguage(undefined)).toBe(false);
  });
});
