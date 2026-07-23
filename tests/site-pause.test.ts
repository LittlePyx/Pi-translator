import { describe, expect, it } from 'vitest';
import {
  isSiteHostPaused,
  normalizePausedSiteHosts,
  siteHostFromUrl,
} from '../core/settings/site-pause';

describe('temporary site pause', () => {
  it('extracts supported page hosts', () => {
    expect(siteHostFromUrl('https://WWW.Overleaf.com/project/abc')).toBe(
      'www.overleaf.com',
    );
    expect(siteHostFromUrl('edge://extensions')).toBeUndefined();
  });

  it('normalizes and matches exact hosts', () => {
    const hosts = normalizePausedSiteHosts([' Example.com ', 'example.com']);
    expect(hosts).toEqual(['example.com']);
    expect(isSiteHostPaused('EXAMPLE.COM', hosts)).toBe(true);
    expect(isSiteHostPaused('docs.example.com', hosts)).toBe(false);
  });
});
