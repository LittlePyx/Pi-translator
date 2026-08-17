import { describe, expect, it } from 'vitest';
import { normalizedSpeechLanguage, selectLocalSpeechVoice } from '../ui/local-speech';

describe('local speech voice selection', () => {
  const voices = [
    { name: 'Online English', lang: 'en-US', localService: false },
    { name: 'Local Chinese', lang: 'zh-CN', localService: true },
    { name: 'Local English', lang: 'en-GB', localService: true },
  ];

  it('never selects a network-backed voice', () => {
    expect(normalizedSpeechLanguage('English')).toBe('en-US');
    expect(normalizedSpeechLanguage('zh')).toBe('zh-CN');
    expect(selectLocalSpeechVoice(voices, 'en-US')?.name).toBe('Local English');
    expect(selectLocalSpeechVoice(voices, 'zh-CN')?.name).toBe('Local Chinese');
    expect(selectLocalSpeechVoice([
      { name: 'Online only', lang: 'en-US', localService: false },
    ], 'en-US')).toBeUndefined();
  });
});
