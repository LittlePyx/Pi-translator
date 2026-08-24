import { describe, expect, it } from 'vitest';
import {
  hasPdfFileSignature,
  isLocalPdfFile,
  pdfOpenErrorMessage,
  validateLocalPdfFiles,
} from '../core/pdf/local-file';

describe('local PDF file handling', () => {
  it('accepts a PDF MIME type or filename and rejects unrelated files', () => {
    expect(isLocalPdfFile({ name: 'paper.bin', type: 'application/pdf' })).toBe(true);
    expect(isLocalPdfFile({ name: 'paper.bin', type: 'application/x-pdf' })).toBe(true);
    expect(isLocalPdfFile({ name: 'PAPER.PDF', type: '' })).toBe(true);
    expect(isLocalPdfFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });

  it('requires exactly one PDF', () => {
    expect(validateLocalPdfFiles([])).toMatchObject({ ok: false });
    expect(validateLocalPdfFiles([
      { name: 'one.pdf', type: 'application/pdf' },
      { name: 'two.pdf', type: 'application/pdf' },
    ])).toMatchObject({ ok: false, message: expect.stringContaining('一次只能') });
    expect(validateLocalPdfFiles([
      { name: 'paper.pdf', type: 'application/pdf' },
    ])).toMatchObject({ ok: true, file: { name: 'paper.pdf' } });
  });

  it('finds the PDF signature near the beginning of a local file', () => {
    expect(hasPdfFileSignature(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(hasPdfFileSignature(new TextEncoder().encode('\n\0%PDF-2.0'))).toBe(true);
    expect(hasPdfFileSignature(new TextEncoder().encode('not a pdf'))).toBe(false);
  });

  it('turns common parser failures into readable messages', () => {
    const invalid = new Error('Invalid PDF structure.');
    invalid.name = 'InvalidPDFException';
    expect(pdfOpenErrorMessage(invalid)).toContain('可能已损坏');
    expect(pdfOpenErrorMessage(new Error('Password required'))).toContain('密码保护');
  });
});
