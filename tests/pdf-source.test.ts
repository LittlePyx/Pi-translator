import { describe, expect, it } from 'vitest';
import {
  edgePdfSourceUrl,
  isEdgePdfSidePanelTab,
  isSamePdfDocumentLocationChange,
  isEdgeNativePdfContext,
  isEdgeNativePdfViewerUrl,
  isExtensionPdfReaderUrl,
  isLikelyPdfUrl,
  parsePdfSourceUrl,
  parseRemotePdfUrl,
  pdfDocumentIdentity,
  pdfFilename,
  pdfInitialPage,
  pdfPermissionPattern,
  pdfSidePanelOpenTarget,
  resolvePdfContextTab,
  shouldOpenEdgePdfSidePanelImmediately,
} from '../core/pdf/source';

describe('PDF source helpers', () => {
  it('identifies the extension PDF reader across Edge URL presentation variants', () => {
    const reader = 'chrome-extension://pi-translator/pdf.html';
    expect(isExtensionPdfReaderUrl(reader, reader)).toBe(true);
    expect(isExtensionPdfReaderUrl(
      'extension://pi-translator/pdf.html?url=https%3A%2F%2Fexample.com%2Fpaper.pdf',
      reader,
    )).toBe(true);
    expect(isExtensionPdfReaderUrl(
      'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/edge_pdf/index.html',
      reader,
    )).toBe(false);
    expect(isExtensionPdfReaderUrl('https://example.com/pdf.html', reader)).toBe(false);
  });

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

  it('distinguishes PDF page and hash changes from a same-URL reload', () => {
    expect(isSamePdfDocumentLocationChange(
      'https://example.com/paper.pdf#page=2',
      2,
      'https://example.com/paper.pdf#page=3',
    )).toBe(true);
    expect(isSamePdfDocumentLocationChange(
      'https://example.com/paper.pdf#page=2',
      2,
      'https://example.com/paper.pdf#page=2',
    )).toBe(false);
    expect(isSamePdfDocumentLocationChange(
      'https://example.com/paper.pdf',
      undefined,
      'https://example.com/paper.pdf#nameddest=methods',
    )).toBe(true);
    expect(isSamePdfDocumentLocationChange(
      'https://example.com/paper.pdf#page=2',
      2,
      'https://example.com/other.pdf#page=3',
    )).toBe(false);
  });

  it('recognizes the protected Edge PDF viewer', () => {
    expect(isEdgeNativePdfViewerUrl(viewer)).toBe(true);
    expect(isEdgeNativePdfViewerUrl('edge://pdf-viewer/index.html')).toBe(true);
    expect(isEdgeNativePdfContext({ pageUrl: viewer })).toBe(true);
    expect(isEdgeNativePdfContext({ tabUrl: 'https://example.com/paper.pdf' })).toBe(true);
    expect(isEdgeNativePdfContext({ tabUrl: 'https://example.com/article' })).toBe(false);
  });

  it('pre-enables the side panel only for Edge PDF tabs, never Pi PDF or webpages', () => {
    const piReader = 'chrome-extension://pi-translator/pdf.html';
    expect(isEdgePdfSidePanelTab(viewer, piReader)).toBe(true);
    expect(isEdgePdfSidePanelTab('edge://pdf-viewer/index.html', piReader)).toBe(true);
    expect(isEdgePdfSidePanelTab('https://example.com/paper.pdf', piReader)).toBe(true);
    expect(isEdgePdfSidePanelTab(
      'extension://pi-translator/pdf.html?url=https%3A%2F%2Fexample.com%2Fpaper.pdf',
      piReader,
    )).toBe(false);
    expect(isEdgePdfSidePanelTab('https://example.com/article', piReader)).toBe(false);
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

  it('chooses a synchronous side-panel target before resolving opaque PDF tabs', () => {
    expect(pdfSidePanelOpenTarget({ id: 12, windowId: 3 })).toEqual({ tabId: 12 });
    expect(pdfSidePanelOpenTarget({ id: -1, windowId: 3 })).toEqual({ windowId: 3 });
    expect(pdfSidePanelOpenTarget({ id: -1, windowId: -1 })).toEqual({ windowId: -2 });
    expect(pdfSidePanelOpenTarget(undefined, 99)).toEqual({ windowId: 99 });
  });

  it('resolves the correct PDF tab by document identity instead of guessing a window', () => {
    const candidates = [
      { id: 2, windowId: 10, url: 'https://example.com/other.pdf' },
      { id: 3, windowId: 11, url: 'https://example.com/paper.pdf#page=8' },
    ];
    expect(resolvePdfContextTab(candidates, {
      pageUrl: `${viewer}?file=${encodeURIComponent('https://example.com/paper.pdf#page=2')}`,
    })?.id).toBe(3);
    expect(resolvePdfContextTab(candidates, { pageUrl: viewer })).toBeUndefined();
    expect(resolvePdfContextTab([candidates[0]!], { pageUrl: viewer })?.id).toBe(2);
  });

  it('falls back to one opaque native viewer when Edge hides the source URL', () => {
    const sourceContext = {
      pageUrl: `${viewer}?file=${encodeURIComponent('https://example.com/paper.pdf')}`,
    };
    expect(resolvePdfContextTab([
      { id: 7, windowId: 3, url: 'edge://pdf-viewer/index.html' },
    ], sourceContext)?.id).toBe(7);

    expect(resolvePdfContextTab([
      { id: 7, windowId: 3, url: 'edge://pdf-viewer/index.html' },
      { id: 8, windowId: 4, url: viewer },
    ], sourceContext)).toBeUndefined();
  });

  it('resolves the only active candidate when host access hides its URL', () => {
    const sourceContext = {
      pageUrl: `${viewer}?file=${encodeURIComponent('https://private.example/paper.pdf')}`,
    };
    expect(resolvePdfContextTab([
      { id: 17, windowId: 5 },
    ], sourceContext)?.id).toBe(17);
    expect(resolvePdfContextTab([
      { id: 17, windowId: 5 },
      { id: 18, windowId: 6 },
    ], sourceContext)).toBeUndefined();
    expect(resolvePdfContextTab([
      { id: 19, windowId: 5 },
    ], { pageUrl: viewer })?.id).toBe(19);
  });

  it('never falls back to a different identifiable PDF document', () => {
    expect(resolvePdfContextTab([
      { id: 9, windowId: 3, url: 'https://example.com/other.pdf' },
    ], {
      pageUrl: `${viewer}?file=${encodeURIComponent('https://example.com/paper.pdf')}`,
    })).toBeUndefined();
  });
});
