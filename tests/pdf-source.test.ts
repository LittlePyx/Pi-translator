import { describe, expect, it } from 'vitest';
import {
  edgePdfSourceUrl,
  isEdgeNativePdfContext,
  isEdgeNativePdfViewerUrl,
  isLikelyPdfUrl,
  parsePdfSourceUrl,
  parseRemotePdfUrl,
  pdfDocumentIdentity,
  pdfFilename,
  pdfInitialPage,
  pdfPermissionPattern,
  shouldOpenEdgePdfSidePanelImmediately,
} from '../core/pdf/source';

describe('PDF source helpers', () => {
  it('accepts only remote HTTP sources', () => {
    expect(parseRemotePdfUrl('https://example.com/paper.pdf')?.hostname).toBe('example.com');
    expect(parseRemotePdfUrl('file:///private/paper.pdf')).toBeUndefined();
    expect(parseRemotePdfUrl('chrome-extension://viewer/paper.pdf')).toBeUndefined();
  });

  it('allows local file URLs only for the PDF reader handoff', () => {
    expect(parsePdfSourceUrl('file:///C:/papers/main.pdf')?.protocol).toBe('file:');
    expect(parseRemotePdfUrl('file:///C:/papers/main.pdf')).toBeUndefined();
    expect(pdfPermissionPattern('file:///C:/papers/main.pdf')).toBe('file:///*');
    expect(pdfFilename('file:///C:/papers/My%20Paper.pdf')).toBe('My Paper.pdf');
  });

  it('recognizes direct and parameterized PDF links', () => {
    expect(isLikelyPdfUrl('https://example.com/paper.pdf?download=1')).toBe(true);
    expect(isLikelyPdfUrl('https://example.com/view?file=paper.pdf')).toBe(true);
    expect(isLikelyPdfUrl('https://example.com/article')).toBe(false);
  });

  it('creates a narrow host permission and readable filename', () => {
    const source = 'https://papers.example.org/read?file=My%20Paper.pdf';
    expect(pdfPermissionPattern(source)).toBe('https://papers.example.org/*');
    expect(pdfFilename(source)).toBe('My Paper.pdf');
  });

  it('recovers a best-effort page number without treating it as document identity', () => {
    expect(pdfInitialPage('https://example.com/paper.pdf#page=7&zoom=125')).toBe(7);
    expect(pdfInitialPage('https://example.com/paper.pdf?p=3')).toBe(3);
    expect(pdfInitialPage('https://example.com/paper.pdf#12')).toBe(12);
    expect(pdfDocumentIdentity('https://example.com/paper.pdf#page=2'))
      .toBe(pdfDocumentIdentity('https://example.com/paper.pdf#page=9'));
    expect(pdfDocumentIdentity('https://example.com/download?id=paper#page=2'))
      .toBe(pdfDocumentIdentity('https://example.com/download?id=paper#page=9'));
  });
});

describe('Edge native PDF context', () => {
  const viewer =
    'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/edge_pdf/index.html';

  it('recognizes the protected Edge PDF viewer', () => {
    expect(isEdgeNativePdfViewerUrl(viewer)).toBe(true);
    expect(isEdgeNativePdfViewerUrl('edge://pdf-viewer/index.html')).toBe(true);
    expect(isEdgeNativePdfContext({ pageUrl: viewer })).toBe(true);
    expect(isEdgeNativePdfContext({ tabUrl: 'https://example.com/paper.pdf' })).toBe(true);
    expect(isEdgeNativePdfContext({ tabUrl: 'https://example.com/article' })).toBe(false);
  });

  it('recovers remote and local source URLs from the viewer context', () => {
    expect(edgePdfSourceUrl({
      tabUrl: 'https://example.com/paper.pdf',
      pageUrl: viewer,
    })).toBe('https://example.com/paper.pdf');
    expect(edgePdfSourceUrl({
      pageUrl: `${viewer}?file=${encodeURIComponent('https://example.com/paper.pdf')}`,
    })).toBe('https://example.com/paper.pdf');
    expect(edgePdfSourceUrl({ tabUrl: 'file:///C:/papers/paper.pdf' }))
      .toBe('file:///C:/papers/paper.pdf');
    const sourceWithPage = 'https://example.com/paper.pdf#page=6';
    const encodedViewer = `${viewer}?file=${encodeURIComponent(sourceWithPage)}`;
    expect(edgePdfSourceUrl({ pageUrl: encodedViewer })).toBe(sourceWithPage);
    expect(pdfInitialPage(encodedViewer)).toBe(6);
  });

  it('opens the current window immediately for Edge viewer events with invalid IDs', () => {
    expect(shouldOpenEdgePdfSidePanelImmediately({ pageUrl: viewer }, -1, -1)).toBe(true);
    expect(shouldOpenEdgePdfSidePanelImmediately({ pageUrl: viewer }, 12, 3)).toBe(false);
    expect(shouldOpenEdgePdfSidePanelImmediately({ tabUrl: 'https://example.com/article' }, -1, -1))
      .toBe(false);
  });
});
