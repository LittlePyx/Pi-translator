const PAUSED_SITE_HOSTS_KEY = 'pausedSiteHosts';

export function siteHostFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function normalizePausedSiteHosts(values: Iterable<unknown>): string[] {
  return [
    ...new Set(
      [...values]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

export async function getPausedSiteHosts(): Promise<string[]> {
  const stored = await browser.storage.session.get(PAUSED_SITE_HOSTS_KEY);
  const value = stored[PAUSED_SITE_HOSTS_KEY];
  return Array.isArray(value) ? normalizePausedSiteHosts(value) : [];
}

export function isSiteHostPaused(
  hostname: string,
  pausedSiteHosts: Iterable<string>,
): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalizePausedSiteHosts(pausedSiteHosts).includes(normalized);
}

export async function setSitePaused(
  url: string,
  paused: boolean,
): Promise<string | undefined> {
  const hostname = siteHostFromUrl(url);
  if (!hostname) return undefined;
  const hosts = new Set(await getPausedSiteHosts());
  if (paused) hosts.add(hostname);
  else hosts.delete(hostname);
  await browser.storage.session.set({
    [PAUSED_SITE_HOSTS_KEY]: normalizePausedSiteHosts(hosts),
  });
  return hostname;
}
