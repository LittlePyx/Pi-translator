import { describe, expect, it, vi } from 'vitest';
import {
  invalidateTranslationStateForApiKeyChange,
  isApiKeyStorageChange,
} from '../core/translation/credential-change';

describe('translation state invalidation after API key changes', () => {
  it.each(['local', 'session'])('invalidates state for %s API key changes', async (areaName) => {
    const abortActiveRequests = vi.fn();
    const clearCheckpoints = vi.fn(async () => undefined);

    await expect(invalidateTranslationStateForApiKeyChange(
      areaName,
      { apiKeysByProfile: { oldValue: {}, newValue: { default: 'redacted' } } },
      abortActiveRequests,
      clearCheckpoints,
    )).resolves.toBe(true);

    expect(abortActiveRequests).toHaveBeenCalledOnce();
    expect(clearCheckpoints).toHaveBeenCalledOnce();
  });

  it('ignores unrelated storage changes and storage areas', async () => {
    expect(isApiKeyStorageChange('local', { extensionSettings: {} })).toBe(false);
    expect(isApiKeyStorageChange('sync', { apiKeysByProfile: {} })).toBe(false);

    const abortActiveRequests = vi.fn();
    const clearCheckpoints = vi.fn(async () => undefined);
    await expect(invalidateTranslationStateForApiKeyChange(
      'local',
      { extensionSettings: {} },
      abortActiveRequests,
      clearCheckpoints,
    )).resolves.toBe(false);
    expect(abortActiveRequests).not.toHaveBeenCalled();
    expect(clearCheckpoints).not.toHaveBeenCalled();
  });
});
