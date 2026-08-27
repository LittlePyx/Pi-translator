import { describe, expect, it } from 'vitest';
import {
  classifyPdfDocumentTranslationSections,
  parsePdfDocumentPageRange,
  pdfDocumentTranslationSectionHeading,
} from '../core/pdf/document-translation-range';

describe('PDF document translation page ranges', () => {
  it('parses individual pages, ranges, Chinese separators, and duplicate pages', () => {
    expect(parsePdfDocumentPageRange('1-3， 3、5; 8–10', 12)).toEqual({
      ok: true,
      pages: [1, 2, 3, 5, 8, 9, 10],
      summary: '1–3、5、8–10',
    });
  });

  it('rejects empty, reversed, malformed, and out-of-document ranges', () => {
    expect(parsePdfDocumentPageRange('', 8)).toMatchObject({ ok: false });
    expect(parsePdfDocumentPageRange('6-3', 8)).toMatchObject({
      ok: false,
      message: expect.stringContaining('起始页'),
    });
    expect(parsePdfDocumentPageRange('1 to 3', 8)).toMatchObject({ ok: false });
    expect(parsePdfDocumentPageRange('1-9', 8)).toMatchObject({
      ok: false,
      message: expect.stringContaining('1–8'),
    });
  });
});

describe('PDF document translation section detection', () => {
  it('recognizes conservative numbered and multilingual section headings', () => {
    expect(pdfDocumentTranslationSectionHeading('8 References')).toBe('references');
    expect(pdfDocumentTranslationSectionHeading('BIBLIOGRAPHY')).toBe('references');
    expect(pdfDocumentTranslationSectionHeading('参考文献')).toBe('references');
    expect(pdfDocumentTranslationSectionHeading('Appendix A: Proofs')).toBe('appendix');
    expect(pdfDocumentTranslationSectionHeading('Supplementary Materials')).toBe('appendix');
    expect(pdfDocumentTranslationSectionHeading('附录二：实验结果')).toBe('appendix');
  });

  it('does not classify ordinary prose that merely mentions references or an appendix', () => {
    expect(pdfDocumentTranslationSectionHeading(
      'The appendix contains references to additional experiments.',
    )).toBeUndefined();
    expect(pdfDocumentTranslationSectionHeading('Related Work')).toBeUndefined();
  });

  it('tracks references and appendices independently when their order changes', () => {
    const blocks = [
      { text: 'Main paper body.' },
      { text: '7 References' },
      { text: '[1] A cited paper.' },
      { text: 'Appendix A: Proofs' },
      { text: 'Proof details.' },
      { text: 'Bibliography' },
      { text: 'An appendix bibliography entry.' },
    ];
    expect(classifyPdfDocumentTranslationSections(blocks)).toEqual([
      'body',
      'references',
      'references',
      'appendix',
      'appendix',
      'references',
      'references',
    ]);
  });
});
