import { describe, expect, it } from 'vitest';
import { documentIdentity } from '../core/document/document-identity';

describe('document identity', () => {
  it('ignores fragments and common tracking parameters', () => {
    const first = documentIdentity({
      pageUrl: 'https://example.com/paper?id=7&utm_source=test#section-2',
    });
    const second = documentIdentity({
      pageUrl: 'https://example.com/paper?id=7#section-3',
    });
    expect(first.documentId).toBe(second.documentId);
  });

  it('uses a PDF document id across reader URLs', () => {
    const sourceLocation = {
      documentId: 'stable-pdf',
      pageNumber: 2,
      leftRatio: 0.1,
      topRatio: 0.2,
      widthRatio: 0.3,
      heightRatio: 0.1,
    };
    expect(documentIdentity({ pageUrl: 'edge://pdf', sourceLocation }).documentId)
      .toBe(documentIdentity({ pageUrl: 'chrome-extension://reader/pdf.html', sourceLocation }).documentId);
    expect(documentIdentity({
      pageUrl: 'file:///private-paper.pdf',
      sourceLabel: 'private-paper.pdf',
      sourceLocation,
    }).label).toBe('PDF 文档');
  });

  it('keeps an explicit local document identity across later page navigation', () => {
    expect(documentIdentity({
      pageUrl: 'https://new.example/another-page',
      documentId: 'doc-original-page',
    }).documentId).toBe('doc-original-page');
  });
});
