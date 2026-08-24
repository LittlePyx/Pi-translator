import { describe, expect, it } from 'vitest';

import { shouldSuggestBrowserSidebar } from '../core/content/sidebar-obstruction';
import { normalizeSidebarObstructionHintHosts } from '../core/settings/sidebar-obstruction-hint';

describe('browser sidebar obstruction suggestion', () => {
  it('suggests switching when the floating sidebar occupies at least thirty percent', () => {
    expect(shouldSuggestBrowserSidebar({
      viewportWidth: 1_280,
      insetLeft: 0,
      insetRight: 0,
      sidebarWidth: 390,
      meaningfulContentCovered: false,
    })).toBe(true);
  });

  it('uses covered page content for moderately wide sidebars', () => {
    expect(shouldSuggestBrowserSidebar({
      viewportWidth: 1_440,
      insetLeft: 0,
      insetRight: 0,
      sidebarWidth: 390,
      meaningfulContentCovered: true,
    })).toBe(true);
    expect(shouldSuggestBrowserSidebar({
      viewportWidth: 1_440,
      insetLeft: 0,
      insetRight: 0,
      sidebarWidth: 390,
      meaningfulContentCovered: false,
    })).toBe(false);
  });

  it('stays quiet on narrow viewports and after the sidebar is narrowed', () => {
    expect(shouldSuggestBrowserSidebar({
      viewportWidth: 760,
      insetLeft: 0,
      insetRight: 0,
      sidebarWidth: 390,
      meaningfulContentCovered: true,
    })).toBe(false);
    expect(shouldSuggestBrowserSidebar({
      viewportWidth: 1_280,
      insetLeft: 0,
      insetRight: 0,
      sidebarWidth: 340,
      meaningfulContentCovered: true,
    })).toBe(false);
  });

  it('normalizes and deduplicates dismissed site hosts', () => {
    expect(normalizeSidebarObstructionHintHosts([
      'Example.COM',
      ' example.com ',
      '',
      undefined,
      'papers.example.org',
    ])).toEqual(['example.com', 'papers.example.org']);
  });
});
