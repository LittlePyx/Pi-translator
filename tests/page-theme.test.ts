import { describe, expect, it } from 'vitest';
import { themeFromBackgroundColor } from '../core/theme/page-theme';

describe('page theme detection', () => {
  it('classifies dark and light RGB backgrounds', () => {
    expect(themeFromBackgroundColor('rgb(15, 23, 42)')).toBe('dark');
    expect(themeFromBackgroundColor('rgb(255, 255, 255)')).toBe('light');
  });

  it('composites translucent backgrounds over white', () => {
    expect(themeFromBackgroundColor('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(themeFromBackgroundColor('rgba(0, 0, 0, 0.95)')).toBe('dark');
    expect(themeFromBackgroundColor('rgba(0, 0, 0, 0.1)')).toBe('light');
  });

  it('ignores unrecognized color formats', () => {
    expect(themeFromBackgroundColor('transparent')).toBeUndefined();
    expect(themeFromBackgroundColor('var(--page-background)')).toBeUndefined();
  });
});
