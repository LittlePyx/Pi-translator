import { describe, expect, it } from 'vitest';
import {
  normalizePdfReadingState,
  pdfReadingStateId,
} from '../core/pdf/reading-state';

describe('Pi PDF reading state', () => {
  it('normalizes page, zoom, and sidebar state into safe bounds', () => {
    expect(normalizePdfReadingState({
      pageNumber: 4.7,
      pageRatio: 1.4,
      zoomLevel: 9,
      fitWidth: true,
      sidebarExpanded: true,
      updatedAt: 123,
    })).toEqual({
      pageNumber: 5,
      pageRatio: 1,
      zoomLevel: 3,
      fitWidth: true,
      sidebarExpanded: true,
      updatedAt: 123,
    });
    expect(normalizePdfReadingState({ pageNumber: '4' })).toBeUndefined();
  });

  it('uses a stable hash instead of storing a PDF URL or filename as the key', async () => {
    const identity = 'https://example.com/private-paper.pdf';
    const first = await pdfReadingStateId(identity);
    expect(first).toBe(await pdfReadingStateId(identity));
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(first).not.toContain('private-paper');
  });
});
