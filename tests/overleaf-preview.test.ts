import { describe, expect, it } from 'vitest';
import { resolveOverleafPdfPreview } from '../core/pdf/overleaf-preview';

describe('Overleaf PDF preview discovery', () => {
  it('prefers the visible preview frame over a hidden download link', () => {
    expect(resolveOverleafPdfPreview([
      {
        url: '/project/demo/output/output.pdf?download=true',
        kind: 'download',
        visible: false,
        label: 'Download PDF',
      },
      {
        url: '/project/demo/output/output.pdf?compileGroup=standard',
        kind: 'frame',
        visible: true,
      },
    ], 'https://www.overleaf.com/project/demo')).toEqual({
      detected: true,
      sourceUrl: 'https://www.overleaf.com/project/demo/output/output.pdf?compileGroup=standard',
    });
  });

  it('reports a blob preview without returning an unusable source URL', () => {
    expect(resolveOverleafPdfPreview([{
      url: 'blob:https://www.overleaf.com/preview.pdf',
      kind: 'frame',
      visible: true,
    }], 'https://www.overleaf.com/project/demo')).toEqual({ detected: true });
  });

  it('recovers a source URL encoded in Edge native viewer frames', () => {
    const source = 'https://www.overleaf.com/project/demo/output/output.pdf?page=4';
    expect(resolveOverleafPdfPreview([{
      url: `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?file=${encodeURIComponent(source)}`,
      kind: 'frame',
      visible: true,
    }], 'https://www.overleaf.com/project/demo')).toEqual({
      detected: true,
      sourceUrl: source,
    });
  });

  it('ignores unrelated project links', () => {
    expect(resolveOverleafPdfPreview([{
      url: '/project/demo/settings',
      kind: 'download',
      visible: true,
      label: 'Project settings',
    }], 'https://www.overleaf.com/project/demo')).toEqual({ detected: false });
  });
});
