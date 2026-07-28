import { describe, expect, it } from 'vitest';
import {
  apiEndpoint,
  apiOriginPattern,
  normalizeApiBaseUrl,
} from '../core/settings/api-access';

describe('API access settings', () => {
  it('normalizes a compatible API base URL and derives endpoints', () => {
    expect(normalizeApiBaseUrl('https://example.com/v1/')).toBe('https://example.com/v1');
    expect(apiEndpoint('https://example.com/v1/', 'models')).toBe('https://example.com/v1/models');
    expect(apiOriginPattern('https://example.com/v1')).toBe('https://example.com/*');
  });

  it('allows local HTTP endpoints but rejects insecure remote APIs', () => {
    expect(normalizeApiBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(() => normalizeApiBaseUrl('http://example.com/v1')).toThrow(/HTTPS/);
  });
});
