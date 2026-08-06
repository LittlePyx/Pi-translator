import { describe, expect, it } from 'vitest';
import { resolveNativePdfTranslationProvider } from '../core/pdf/native-translation-profile';
import type { ExtensionSettings } from '../core/settings/schema';

const settings = {
  apiProfiles: [
    {
      id: 'text-api',
      name: 'DeepSeek text',
      apiBaseUrl: 'https://text.example/v1',
      model: 'text-model',
    },
    {
      id: 'vision-api',
      name: 'Qwen vision',
      apiBaseUrl: 'https://vision.example/v1',
      model: 'vision-profile-model',
    },
  ],
  activeApiProfileId: 'text-api',
  visionApiProfileId: 'vision-api',
  visionModel: 'vision-selection-model',
} satisfies Pick<
  ExtensionSettings,
  'apiProfiles' | 'activeApiProfileId' | 'visionApiProfileId' | 'visionModel'
>;

describe('native PDF translation provider selection', () => {
  it('uses the configured vision provider for a formula-like selection with a stored key', () => {
    expect(resolveNativePdfTranslationProvider(
      settings,
      String.raw`Q^{\Pi^*}=\arg\min_{P\in\mathcal{P}(V,\Omega)} KL(P\Vert Q)`,
      true,
    )).toEqual({
      profileId: 'vision-api',
      profileName: 'Qwen vision',
      apiBaseUrl: 'https://vision.example/v1',
      model: 'vision-selection-model',
      role: 'vision',
    });
  });

  it('recognizes rendered Unicode math copied by the native Edge PDF text layer', () => {
    expect(resolveNativePdfTranslationProvider(
      settings,
      'QΠ* = arg min P ∈ P(V, Ω) { KL(P ∥ Q) := Eₚ[log dP/dQ] }',
      true,
    )).toMatchObject({
      profileId: 'vision-api',
      model: 'vision-selection-model',
      role: 'vision',
    });
  });

  it('keeps ordinary prose on the active text provider', () => {
    expect(resolveNativePdfTranslationProvider(
      settings,
      'The proposed method improves reconstruction quality on three datasets.',
      true,
    )).toMatchObject({
      profileId: 'text-api',
      model: 'text-model',
      role: 'text',
    });
  });

  it('keeps formula-like text on the active provider when the vision key is unavailable', () => {
    expect(resolveNativePdfTranslationProvider(
      settings,
      String.raw`\int_\Omega p(x)\,dx=1`,
      false,
    )).toMatchObject({
      profileId: 'text-api',
      model: 'text-model',
      role: 'text',
    });
  });

  it('falls back to the profile model when the separate vision model is blank', () => {
    expect(resolveNativePdfTranslationProvider(
      { ...settings, visionModel: '   ' },
      String.raw`\int_\Omega p(x)\,dx=1`,
      true,
    )).toMatchObject({
      profileId: 'vision-api',
      model: 'vision-profile-model',
      role: 'vision',
    });
  });

  it('tolerates a stale active profile id by using the first saved profile', () => {
    expect(resolveNativePdfTranslationProvider(
      {
        ...settings,
        activeApiProfileId: 'removed-profile',
        visionApiProfileId: '',
      },
      'Plain prose.',
      false,
    )).toMatchObject({
      profileId: 'text-api',
      role: 'text',
    });
  });
});
