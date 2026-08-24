import { describe, expect, it } from 'vitest';
import {
  featureDiscoveryFeatureForTranslation,
  featureDiscoveryModel,
  featureDiscoverySceneForPage,
  type FeatureDiscoveryProgress,
} from '../core/settings/feature-discovery';

const readerUrl = 'chrome-extension://pi-translator/pdf.html';

describe('feature discovery scenes', () => {
  it('distinguishes ordinary webpages, Overleaf, native PDFs, and Pi PDF', () => {
    expect(featureDiscoverySceneForPage({
      url: 'https://example.com/article',
      pdfReaderUrl: readerUrl,
    })).toBe('web');
    expect(featureDiscoverySceneForPage({
      url: 'https://www.overleaf.com/project/abc123',
      pdfReaderUrl: readerUrl,
    })).toBe('overleaf');
    expect(featureDiscoverySceneForPage({
      url: 'https://example.com/paper.pdf',
      pdfContext: 'native',
      pdfReaderUrl: readerUrl,
    })).toBe('pdf');
    expect(featureDiscoverySceneForPage({
      url: `${readerUrl}?url=https%3A%2F%2Fexample.com%2Fpaper.pdf`,
      pdfReaderUrl: readerUrl,
    })).toBe('pdf');
    expect(featureDiscoverySceneForPage({
      url: 'edge://settings/',
      pdfReaderUrl: readerUrl,
    })).toBeUndefined();
  });

  it('keeps a detected Overleaf PDF in the Overleaf guide', () => {
    expect(featureDiscoverySceneForPage({
      url: 'https://www.overleaf.com/project/abc123',
      pdfContext: 'overleaf',
      pdfReaderUrl: readerUrl,
    })).toBe('overleaf');
  });
});

describe('feature discovery presentation', () => {
  it('shows only unfinished, undismissed contextual guidance by default', () => {
    const progress: FeatureDiscoveryProgress = {
      completed: { 'web-selection': true },
      dismissed: {},
    };
    const model = featureDiscoveryModel('web', progress);
    expect(model.shouldShow).toBe(true);
    expect(model.completedCount).toBe(1);
    expect(model.steps.map(({ id, completed }) => ({ id, completed }))).toEqual([
      { id: 'web-selection', completed: true },
      { id: 'web-sidebar', completed: false },
      { id: 'web-region', completed: false },
    ]);
  });

  it('automatically collapses completed guidance and allows an explicit review', () => {
    const progress: FeatureDiscoveryProgress = {
      completed: {
        'pdf-reader': true,
        'pdf-selection': true,
        'pdf-region': true,
      },
      dismissed: {},
    };
    expect(featureDiscoveryModel('pdf', progress).shouldShow).toBe(false);
    expect(featureDiscoveryModel('pdf', progress, true).shouldShow).toBe(true);
  });

  it('honors a per-scene dismissal without hiding guidance elsewhere', () => {
    const progress: FeatureDiscoveryProgress = {
      completed: {},
      dismissed: { web: true },
    };
    expect(featureDiscoveryModel('web', progress).shouldShow).toBe(false);
    expect(featureDiscoveryModel('overleaf', progress).shouldShow).toBe(true);
  });
});

describe('feature discovery completion classification', () => {
  it('classifies completed text and image translations by document surface', () => {
    expect(featureDiscoveryFeatureForTranslation({
      pageUrl: 'https://example.com/article',
      kind: 'text',
      pdfReaderUrl: readerUrl,
    })).toBe('web-selection');
    expect(featureDiscoveryFeatureForTranslation({
      pageUrl: 'https://example.com/article',
      kind: 'image',
      pdfReaderUrl: readerUrl,
    })).toBe('web-region');
    expect(featureDiscoveryFeatureForTranslation({
      pageUrl: 'https://www.overleaf.com/project/abc123',
      kind: 'text',
      pdfReaderUrl: readerUrl,
    })).toBe('overleaf-selection');
    expect(featureDiscoveryFeatureForTranslation({
      pageUrl: 'https://example.com/paper.pdf',
      kind: 'image',
      sourceLocation: { pageNumber: 2 },
      pdfReaderUrl: readerUrl,
    })).toBe('pdf-region');
  });
});
