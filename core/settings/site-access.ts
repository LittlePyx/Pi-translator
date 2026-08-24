import type { ExtensionSettings, GeneralPageMode } from './schema';

export const ALL_GENERAL_PAGE_ORIGINS = ['http://*/*', 'https://*/*'] as const;

export function isOverleafProjectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'www.overleaf.com' &&
      parsed.pathname.startsWith('/project/')
    );
  } catch {
    return false;
  }
}

export function isInjectableWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function webPagePermissionPattern(url: string): string | undefined {
  if (!isInjectableWebUrl(url)) return undefined;
  return `${new URL(url).origin}/*`;
}

export function normalizeSiteEntry(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;

  const withoutWildcard = trimmed.replace(/^\*\./, '');
  try {
    const parsed = new URL(
      withoutWildcard.includes('://') ? withoutWildcard : `https://${withoutWildcard}`,
    );
    const hostname = parsed.hostname.replace(/^\*\./, '');
    if (!hostname || hostname.includes('*') || hostname.includes(' ')) return undefined;
    return hostname;
  } catch {
    return undefined;
  }
}

export function normalizeSiteAllowlist(values: Iterable<string>): string[] {
  return [
    ...new Set(
      [...values]
        .map(normalizeSiteEntry)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
}

export function siteAllowlistToMatchPatterns(siteAllowlist: Iterable<string>): string[] {
  return normalizeSiteAllowlist(siteAllowlist).flatMap((hostname) => {
    const hostPattern =
      hostname === 'localhost' || /^[\d.]+$/.test(hostname)
        ? hostname
        : `*.${hostname}`;
    return [`http://${hostPattern}/*`, `https://${hostPattern}/*`];
  });
}

export function getAutoInjectionPatterns(
  mode: GeneralPageMode,
  siteAllowlist: Iterable<string>,
): string[] {
  if (mode === 'all-sites') return [...ALL_GENERAL_PAGE_ORIGINS];
  if (mode === 'allowlist') return siteAllowlistToMatchPatterns(siteAllowlist);
  return [];
}

export function isGeneralPageAllowed(
  url: string,
  settings: Pick<ExtensionSettings, 'generalPageMode' | 'siteAllowlist'>,
): boolean {
  if (!isInjectableWebUrl(url) || isOverleafProjectUrl(url)) return false;
  if (settings.generalPageMode === 'off') return false;
  if (
    settings.generalPageMode === 'on-demand' ||
    settings.generalPageMode === 'all-sites'
  ) {
    return true;
  }

  const hostname = new URL(url).hostname.toLowerCase();
  return normalizeSiteAllowlist(settings.siteAllowlist).some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}
