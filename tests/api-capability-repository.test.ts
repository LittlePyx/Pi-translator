import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiModelCapabilityKey,
  getApiModelCapabilities,
  updateApiModelCapabilities,
} from '../core/translation/api-capability-repository';

const storage: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('API model capability memory', () => {
  it('normalizes the complete Base URL while preserving model identity', () => {
    expect(apiModelCapabilityKey('https://API.EXAMPLE.com/v1/', ' Model-A ')).toBe(
      apiModelCapabilityKey('https://api.example.com/v1', 'Model-A'),
    );
    expect(apiModelCapabilityKey('https://api.example.com/v1', 'Model-A')).not.toBe(
      apiModelCapabilityKey('https://api.example.com/another-path', 'Model-A'),
    );
    expect(apiModelCapabilityKey('https://api.example.com/v1', 'Model-A')).not.toBe(
      apiModelCapabilityKey('https://api.example.com/v1', 'model-a'),
    );
    expect(apiModelCapabilityKey('https://other.example.com/v1', 'model-a')).not.toBe(
      apiModelCapabilityKey('https://api.example.com/v1', 'model-a'),
    );
  });

  it('merges concurrent capability observations without losing fields', async () => {
    await Promise.all([
      updateApiModelCapabilities('https://api.example.com/v1', 'model-a', { textStreaming: false }),
      updateApiModelCapabilities('https://api.example.com/v1', 'model-a', { imageStreaming: true }),
      updateApiModelCapabilities('https://api.example.com/v1', 'model-a', { responseFormatJson: false }),
      updateApiModelCapabilities('https://api.example.com/v1', 'model-a', { vision: true }),
    ]);

    await expect(getApiModelCapabilities('https://api.example.com/v1/', 'model-a')).resolves.toEqual({
      textStreaming: false,
      imageStreaming: true,
      responseFormatJson: false,
      vision: true,
    });
    expect(JSON.stringify(storage)).not.toContain('api-key');
  });

  it('ignores expired and incompatible stored records', async () => {
    const key = apiModelCapabilityKey('https://api.example.com/v1', 'model-a');
    storage.apiModelCapabilities = {
      version: 2,
      entries: [{ key, textStreaming: false, updatedAt: 1, expiresAt: Date.now() - 1 }],
    };
    await expect(getApiModelCapabilities('https://api.example.com/v1', 'model-a')).resolves.toEqual({});

    storage.apiModelCapabilities = {
      version: 999,
      entries: [{ key, textStreaming: false, updatedAt: Date.now(), expiresAt: Date.now() + 10_000 }],
    };
    await expect(getApiModelCapabilities('https://api.example.com/v1', 'model-a')).resolves.toEqual({});
  });
});
