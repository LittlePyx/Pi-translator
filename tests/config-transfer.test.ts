import { describe, expect, it } from 'vitest';
import {
  exportSettingsConfiguration,
  importSettingsConfiguration,
  importConfigurationReadingPreferences,
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
  it('round trips only explicit site preferences and UI language, ignoring extra secret fields', () => {
    const content=exportSettingsConfiguration(configuredSettings(),{
      sites:{'docs.example.org':{targetLanguage:'en',paused:true,apiKey:'do-not-export'} as never},uiLanguage:'en',
    });
    expect(JSON.parse(content).version).toBe(2);
    expect(content).not.toContain('do-not-export');
    expect(importConfigurationReadingPreferences(content)).toEqual({sites:{'docs.example.org':{targetLanguage:'en',paused:true}},uiLanguage:'en'});
    expect(importSettingsConfiguration(content,DEFAULT_SETTINGS).apiProfiles[0]?.model).toBe('example-model');
  });

  it('keeps version 1 compatible without applying injected reading preferences', () => {
    const data=JSON.parse(exportSettingsConfiguration(configuredSettings()));
    data.version=1;data.readingPreferences={sites:'invalid',uiLanguage:'invalid'};
    expect(importSettingsConfiguration(JSON.stringify(data),DEFAULT_SETTINGS).targetLanguage).toBe('zh-CN');
    expect(importConfigurationReadingPreferences(JSON.stringify(data))).toBeUndefined();
  });

  it.each([
    {sites:{'https://docs.example.org/path':{targetLanguage:'en',paused:false}},uiLanguage:'en'},
    {sites:{'docs.example.org':{targetLanguage:'invalid',paused:false}},uiLanguage:'en'},
    {sites:{'docs.example.org':{targetLanguage:'en',paused:'false'}},uiLanguage:'en'},
    {sites:{},uiLanguage:'invalid'},
  ])('rejects invalid v2 preferences before applying API configuration: %j', readingPreferences => {
    const data=JSON.parse(exportSettingsConfiguration(configuredSettings()));data.readingPreferences=readingPreferences;
    expect(()=>importSettingsConfiguration(JSON.stringify(data),DEFAULT_SETTINGS)).toThrow('偏好');
  });

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
