export interface LocalPdfFileDescriptor {
  name: string;
  type?: string;
}

export type LocalPdfFileValidation<T extends LocalPdfFileDescriptor> =
  | { ok: true; file: T }
  | { ok: false; message: string };

export function isLocalPdfFile(file: LocalPdfFileDescriptor): boolean {
  return ['application/pdf', 'application/x-pdf'].includes(file.type?.toLowerCase() ?? '') ||
    file.name.toLowerCase().endsWith('.pdf');
}

export function validateLocalPdfFiles<T extends LocalPdfFileDescriptor>(
  files: readonly T[],
): LocalPdfFileValidation<T> {
  if (files.length === 0) {
    return { ok: false, message: '拖放内容中没有可读取的 PDF 文件。' };
  }
  if (files.length > 1) {
    return { ok: false, message: '一次只能打开一份 PDF，请只拖入一个文件。' };
  }
  const file = files[0]!;
  if (!isLocalPdfFile(file)) {
    return { ok: false, message: `“${file.name || '这个文件'}”不是 PDF 文件。` };
  }
  return { ok: true, file };
}

export function hasPdfFileSignature(bytes: Uint8Array): boolean {
  const maximumOffset = Math.min(bytes.length - 5, 1024);
  for (let index = 0; index <= maximumOffset; index += 1) {
    if (
      bytes[index] === 0x25 &&
      bytes[index + 1] === 0x50 &&
      bytes[index + 2] === 0x44 &&
      bytes[index + 3] === 0x46 &&
      bytes[index + 4] === 0x2d
    ) return true;
  }
  return false;
}

export function pdfOpenErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '无法打开 PDF：文件可能已损坏。';
  const signature = `${error.name} ${error.message}`.toLowerCase();
  if (/password|encrypted/u.test(signature)) {
    return '无法打开 PDF：这个文件受密码保护，暂时无法读取。';
  }
  if (
    /invalidpdf|invalid pdf|missing pdf|pdf structure|format error|bad xref|unexpected eof/u
      .test(signature)
  ) {
    return '无法打开 PDF：文件可能已损坏，或并不是有效的 PDF。';
  }
  return error.message.trim()
    ? `无法打开 PDF：${error.message}`
    : '无法打开 PDF：文件可能已损坏。';
}
