import { browser } from 'wxt/browser';

const STORAGE_KEY = 'sidebarObstructionHintDismissedHostsV1';
const MAX_DISMISSED_HOSTS = 200;

export function normalizeSidebarObstructionHintHosts(values: Iterable<unknown>): string[] {
  return [
    ...new Set(
      [...values]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort().slice(-MAX_DISMISSED_HOSTS);
}

async function dismissedHosts(): Promise<string[]> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return Array.isArray(value) ? normalizeSidebarObstructionHintHosts(value) : [];
}

export async function isSidebarObstructionHintDismissed(hostname: string): Promise<boolean> {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  return (await dismissedHosts()).includes(normalized);
}

export async function dismissSidebarObstructionHint(hostname: string): Promise<void> {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return;
  const hosts = new Set(await dismissedHosts());
  hosts.add(normalized);
  await browser.storage.local.set({
    [STORAGE_KEY]: normalizeSidebarObstructionHintHosts(hosts),
  });
}
