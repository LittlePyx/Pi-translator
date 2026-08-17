import { describe, expect, it } from 'vitest';
import {
  assignedTranslationShortcut,
  shortcutKeyParts,
} from '../core/commands/translation-shortcut';

describe('translation shortcut status', () => {
  it('uses the shortcut actually assigned by the browser', () => {
    expect(assignedTranslationShortcut([
      { name: 'other', shortcut: 'Ctrl+Shift+Y' },
      { name: 'translate-selection', shortcut: 'Alt+Shift+T' },
    ])).toBe('Alt+Shift+T');
    expect(shortcutKeyParts('Alt+Shift+T')).toEqual(['Alt', 'Shift', 'T']);
  });

  it('reports a conflicting or unassigned command as missing', () => {
    expect(assignedTranslationShortcut([
      { name: 'translate-selection', shortcut: '' },
    ])).toBeUndefined();
    expect(assignedTranslationShortcut([])).toBeUndefined();
  });
});
