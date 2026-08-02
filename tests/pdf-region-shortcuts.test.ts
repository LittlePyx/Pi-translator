import { describe, expect, it } from 'vitest';
import {
  normalizePdfRegionShortcutKey,
  resolvePdfRegionShortcut,
  type PdfRegionShortcutEvent,
} from '../core/pdf/region-shortcuts';

function keyEvent(overrides: Partial<PdfRegionShortcutEvent> = {}): PdfRegionShortcutEvent {
  return {
    key: 'r',
    repeat: false,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('Pi PDF region shortcuts', () => {
  it('normalizes a single English letter and falls back safely', () => {
    expect(normalizePdfRegionShortcutKey(' Q ')).toBe('q');
    expect(normalizePdfRegionShortcutKey('Shift+R')).toBe('r');
    expect(normalizePdfRegionShortcutKey('中')).toBe('r');
  });

  it('uses the configured key for one-shot and Shift plus the key for continuous mode', () => {
    expect(resolvePdfRegionShortcut(keyEvent(), true, 'r')).toBe('single');
    expect(resolvePdfRegionShortcut(keyEvent({ shiftKey: true }), true, 'R'))
      .toBe('continuous');
    expect(resolvePdfRegionShortcut(keyEvent({ key: 'q' }), true, 'r')).toBeUndefined();
  });

  it('ignores disabled, modified, repeated, and composition events', () => {
    expect(resolvePdfRegionShortcut(keyEvent(), false, 'r')).toBeUndefined();
    expect(resolvePdfRegionShortcut(keyEvent({ ctrlKey: true }), true, 'r')).toBeUndefined();
    expect(resolvePdfRegionShortcut(keyEvent({ altKey: true }), true, 'r')).toBeUndefined();
    expect(resolvePdfRegionShortcut(keyEvent({ metaKey: true }), true, 'r')).toBeUndefined();
    expect(resolvePdfRegionShortcut(keyEvent({ repeat: true }), true, 'r')).toBeUndefined();
    expect(resolvePdfRegionShortcut(keyEvent({ isComposing: true }), true, 'r')).toBeUndefined();
  });
});
