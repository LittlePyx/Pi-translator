import { describe, expect, it } from 'vitest';
import {
  getAutoInjectionPatterns,
  isGeneralPageAllowed,
  isInjectableWebUrl,
  isOverleafProjectUrl,
  normalizeSiteAllowlist,
  siteAllowlistToMatchPatterns,
  VISIBLE_TAB_CAPTURE_PERMISSION,
} from '../core/settings/site-access';

describe('general page access', () => {
  it('normalizes URLs, wildcard domains, duplicates, and invalid entries', () => {
    expect(
      normalizeSiteAllowlist([
        'https://Arxiv.org/abs/123',
        '*.arxiv.org',
        'wikipedia.org',
        'not a host',
        '',
      ]),
    ).toEqual(['arxiv.org', 'wikipedia.org']);
  });

  it('creates HTTP and HTTPS match patterns for an allowlist', () => {
    expect(siteAllowlistToMatchPatterns(['arxiv.org'])).toEqual([
      'http://*.arxiv.org/*',
      'https://*.arxiv.org/*',
    ]);
  });

  it('uses broad patterns only for all-sites automatic mode', () => {
    expect(getAutoInjectionPatterns('on-demand', [])).toEqual([]);
    expect(getAutoInjectionPatterns('all-sites', [])).toEqual([
      'http://*/*',
      'https://*/*',
    ]);
  });

  it('keeps the optional capture capability separate from automatic injection', () => {
    expect(VISIBLE_TAB_CAPTURE_PERMISSION).toBe('<all_urls>');
    expect(getAutoInjectionPatterns('all-sites', []))
      .not.toContain(VISIBLE_TAB_CAPTURE_PERMISSION);
  });

  it('distinguishes Overleaf projects from general injectable pages', () => {
    expect(isOverleafProjectUrl('https://www.overleaf.com/project/abc')).toBe(true);
    expect(isInjectableWebUrl('https://example.com/article')).toBe(true);
    expect(isInjectableWebUrl('edge://extensions')).toBe(false);
  });

  it('matches allowlisted domains and subdomains', () => {
    const settings = {
      generalPageMode: 'allowlist' as const,
      siteAllowlist: ['arxiv.org'],
    };
    expect(isGeneralPageAllowed('https://arxiv.org/abs/123', settings)).toBe(true);
    expect(isGeneralPageAllowed('https://export.arxiv.org/', settings)).toBe(true);
    expect(isGeneralPageAllowed('https://example.com/', settings)).toBe(false);
  });
});
