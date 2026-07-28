import { describe, expect, it } from 'vitest';
import {
  exportSettingsConfiguration,
  importSettingsConfiguration,
} from '../core/settings/config-transfer';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../core/settings/schema';

function configuredSettings(): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    onboardingCompleted: true,
    apiProfiles: [
      {
        id: 'private-profile-id',
        name: '论文翻译',
        apiBaseUrl: 'https://api.example.com/v1',
        model: 'example-model',
      },
    ],
    activeApiProfileId: 'private-profile-id',
    apiBaseUrl: 'https://api.example.com/v1',
    model: 'example-model',
    siteAllowlist: ['docs.example.org'],
    academicGlossary: [{ source: 'attention', target: '注意力' }],
  };
}

describe('safe settings transfer', () => {
  it('exports preferences without API keys or internal profile ids', () => {
    const exported = exportSettingsConfiguration(configuredSettings());
    const parsed = JSON.parse(exported) as Record<string, unknown>;

    expect(parsed.containsApiKeys).toBe(false);
    expect(exported).not.toContain('private-profile-id');
    expect(exported).not.toMatch(/"apiKey"\s*:/i);
    expect(exported).toContain('docs.example.org');
    expect(exported).toContain('attention');
  });

  it('ignores injected key fields, regenerates ids, and requires keys to be re-entered', () => {
    const source = JSON.parse(exportSettingsConfiguration(configuredSettings())) as {
      settings: { apiProfiles: Array<Record<string, unknown>> };
    };
    source.settings.apiProfiles[0]!.apiKey = 'provider-key-should-never-be-imported';
    source.settings.apiProfiles[0]!.id = 'injected-id';

    const imported = importSettingsConfiguration(JSON.stringify(source), DEFAULT_SETTINGS);

    expect(imported.apiProfiles[0]?.id).not.toBe('injected-id');
    expect(imported.apiProfiles[0]).not.toHaveProperty('apiKey');
    expect(imported.apiKeyStorage).toBe('session');
    expect(imported.onboardingCompleted).toBe(true);
  });

  it('rejects unrelated or incomplete files', () => {
    expect(() => importSettingsConfiguration('{}', DEFAULT_SETTINGS)).toThrow();
    expect(() => importSettingsConfiguration(JSON.stringify({
      format: 'pi-translator-settings',
      version: 1,
      settings: { apiProfiles: [] },
    }), DEFAULT_SETTINGS)).toThrow();
  });
});
