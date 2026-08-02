export const DEFAULT_PDF_REGION_SHORTCUT_KEY = 'r';

export type PdfRegionShortcutMode = 'single' | 'continuous';

export interface PdfRegionShortcutEvent {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function normalizePdfRegionShortcutKey(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_PDF_REGION_SHORTCUT_KEY;
  const normalized = value.trim().toLowerCase();
  return /^[a-z]$/.test(normalized)
    ? normalized
    : DEFAULT_PDF_REGION_SHORTCUT_KEY;
}

export function resolvePdfRegionShortcut(
  event: PdfRegionShortcutEvent,
  enabled: boolean,
  configuredKey: string,
): PdfRegionShortcutMode | undefined {
  if (
    !enabled ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.key.toLowerCase() !== normalizePdfRegionShortcutKey(configuredKey)
  ) return undefined;
  return event.shiftKey ? 'continuous' : 'single';
}
