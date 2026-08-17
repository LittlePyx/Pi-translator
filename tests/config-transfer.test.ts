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
    visionApiProfileId: 'private-profile-id',
    visionModel: 'example-vision-model',
    apiBaseUrl: 'https://api.example.com/v1',
    model: 'example-model',
    siteAllowlist: ['docs.example.org'],
    academicGlossary: [{ source: 'attention', target: '注意力' }],
    pdfRegionShortcutKey: 'q',
    autoRenderLatex: false,
    sidebarMode: 'browser',
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
    expect(exported).toContain('example-vision-model');
    expect(exported).toContain('pdfRegionShortcutKey');
    expect(exported).toContain('autoRenderLatex');
    expect(exported).toContain('sidebarMode');
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
    expect(imported.visionApiProfileId).toBe(imported.apiProfiles[0]?.id);
    expect(imported.visionModel).toBe('example-vision-model');
    expect(imported.apiKeyStorage).toBe('session');
    expect(imported.pdfRegionShortcutKey).toBe('q');
    expect(imported.autoRenderLatex).toBe(false);
    expect(imported.sidebarMode).toBe('browser');
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
