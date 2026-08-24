import { describe, expect, it } from 'vitest';
import {
  pdfDestinationTopCoordinate,
  safePdfExternalUrl,
  safePdfLinkAnnotation,
  safePdfLinkAnnotations,
} from '../core/pdf/link-annotations';

const LINK_TYPE = 2;

function link(data: Record<string, unknown>) {
  return {
    annotationType: LINK_TYPE,
    id: 'link-1',
    rect: [10, 20, 110, 40],
    ...data,
  };
}

describe('Pi PDF safe link annotations', () => {
  it('allows credential-free HTTP links and resolves relative links only for online PDFs', () => {
    expect(safePdfExternalUrl('/paper/2', 'https://example.com/files/source.pdf'))
      .toBe('https://example.com/paper/2');
    expect(safePdfExternalUrl('/paper/2', 'file:///private/source.pdf')).toBeUndefined();
    expect(safePdfExternalUrl('https://user:secret@example.com/paper')).toBeUndefined();
  });

  it('rejects script, data, file, attachment, and unsupported named actions', () => {
    expect(safePdfLinkAnnotation(link({ unsafeUrl: 'javascript:alert(1)' }), LINK_TYPE))
      .toBeUndefined();
    expect(safePdfLinkAnnotation(link({ url: 'data:text/html,unsafe' }), LINK_TYPE))
      .toBeUndefined();
    expect(safePdfLinkAnnotation(link({ url: 'file:///private/paper.pdf' }), LINK_TYPE))
      .toBeUndefined();
    expect(safePdfLinkAnnotation(link({ attachment: { filename: 'payload.exe' } }), LINK_TYPE))
      .toBeUndefined();
    expect(safePdfLinkAnnotation(link({
      url: 'http://payload.exe/',
      unsafeUrl: 'payload.exe',
    }), LINK_TYPE)).toBeUndefined();
    expect(safePdfLinkAnnotation(link({ action: 'GoBack' }), LINK_TYPE)).toBeUndefined();
  });

  it('keeps internal destinations and safe page actions while rejecting malformed rectangles', () => {
    expect(safePdfLinkAnnotation(link({ dest: 'methods' }), LINK_TYPE)?.action)
      .toEqual({ kind: 'destination', destination: 'methods' });
    expect(safePdfLinkAnnotation(link({ action: 'NextPage' }), LINK_TYPE)?.action)
      .toEqual({ kind: 'named', action: 'NextPage' });
    expect(safePdfLinkAnnotation({ ...link({ dest: 'methods' }), rect: [0, 0, 0, 20] }, LINK_TYPE))
      .toBeUndefined();
  });

  it('bounds pathological pages and extracts supported destination top coordinates', () => {
    const annotations = Array.from({ length: 520 }, (_, index) => link({
      id: `link-${index}`,
      dest: [index, { name: 'Fit' }],
    }));
    expect(safePdfLinkAnnotations(annotations, LINK_TYPE)).toHaveLength(500);
    expect(pdfDestinationTopCoordinate([0, { name: 'XYZ' }, 10, 640, null])).toBe(640);
    expect(pdfDestinationTopCoordinate([0, { name: 'FitH' }, 700])).toBe(700);
    expect(pdfDestinationTopCoordinate([0, { name: 'FitR' }, 10, 20, 30, 740])).toBe(740);
    expect(pdfDestinationTopCoordinate([0, { name: 'Fit' }])).toBeUndefined();
  });
});
