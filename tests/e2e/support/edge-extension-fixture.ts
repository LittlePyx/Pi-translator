import {
  expect,
  test,
  chromium,
  type BrowserContext,
  type JSHandle,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const EDGE_EXECUTABLE =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const OVERLEAF_FIXTURE_URL =
  'https://www.overleaf.com/project/pi-translator-e2e';
export const ARTICLE_FIXTURE_URL =
  'https://www.overleaf.com/pi-translator-bilingual-article-e2e';
export const LONG_ARTICLE_FIXTURE_URL =
  'https://www.overleaf.com/pi-translator-long-bilingual-article-e2e';
export const MEDIAWIKI_MATH_FIXTURE_URL =
  'https://www.overleaf.com/pi-translator-mediawiki-math-e2e';

export let context: BrowserContext;
export let page: Page;
let userDataDirectory: string;
export let extensionId: string;
export const visionRequests: Array<Record<string, unknown>> = [];
export const textRequests: Array<Record<string, unknown>> = [];

export interface EdgeE2EMockControl {
  echoVisionPayloadOnce: boolean;
  failNextRevisionRequest: boolean;
  bilingualFailuresRemaining: number;
  failBilingualFormulaPreservation: boolean;
  returnBilingualRetranslationOnce: boolean;
  bilingualArticleRevision: number;
  returnRevisedVisionResultOnce: boolean;
  returnPendingVisionReviewOnce: boolean;
  failNextRecoveryRequestAfterPartial: boolean;
  partialRecoveryRequestIndex: number;
  releasePartialRecoveryFailure: (() => void) | undefined;
  partialRecoveryFailureGate: Promise<void>;
  holdNextBilingualRequest: boolean;
  bilingualRequestStarted: (() => void) | undefined;
  releaseHeldBilingualRequest: (() => void) | undefined;
  heldBilingualRequestGate: Promise<void>;
  holdNextInteractiveRequest: boolean;
  interactiveRequestStarted: (() => void) | undefined;
  releaseHeldInteractiveRequest: (() => void) | undefined;
  heldInteractiveRequestGate: Promise<void>;
  holdNextVisionRequest: boolean;
  releaseHeldVisionRequest: (() => void) | undefined;
  heldVisionRequestGate: Promise<void>;
  holdNextDocumentBatchRequest: boolean;
  releaseHeldDocumentBatchRequest: (() => void) | undefined;
  heldDocumentBatchRequestGate: Promise<void>;
  omitNextDocumentBatchItem: boolean;
}

export const mockControl: EdgeE2EMockControl = {
  echoVisionPayloadOnce: false,
  failNextRevisionRequest: false,
  bilingualFailuresRemaining: 0,
  failBilingualFormulaPreservation: false,
  returnBilingualRetranslationOnce: false,
  bilingualArticleRevision: 0,
  returnRevisedVisionResultOnce: false,
  returnPendingVisionReviewOnce: false,
  failNextRecoveryRequestAfterPartial: false,
  partialRecoveryRequestIndex: 0,
  releasePartialRecoveryFailure: undefined,
  partialRecoveryFailureGate: Promise.resolve(),
  holdNextBilingualRequest: false,
  bilingualRequestStarted: undefined,
  releaseHeldBilingualRequest: undefined,
  heldBilingualRequestGate: Promise.resolve(),
  holdNextInteractiveRequest: false,
  interactiveRequestStarted: undefined,
  releaseHeldInteractiveRequest: undefined,
  heldInteractiveRequestGate: Promise.resolve(),
  holdNextVisionRequest: false,
  releaseHeldVisionRequest: undefined,
  heldVisionRequestGate: Promise.resolve(),
  holdNextDocumentBatchRequest: false,
  releaseHeldDocumentBatchRequest: undefined,
  heldDocumentBatchRequestGate: Promise.resolve(),
  omitNextDocumentBatchItem: false,
};

function resetMockControl(): void {
  mockControl.releasePartialRecoveryFailure?.();
  mockControl.releaseHeldBilingualRequest?.();
  mockControl.releaseHeldInteractiveRequest?.();
  mockControl.releaseHeldVisionRequest?.();
  mockControl.releaseHeldDocumentBatchRequest?.();
  Object.assign(mockControl, {
    echoVisionPayloadOnce: false,
    failNextRevisionRequest: false,
    bilingualFailuresRemaining: 0,
    failBilingualFormulaPreservation: false,
    returnBilingualRetranslationOnce: false,
    bilingualArticleRevision: 0,
    returnRevisedVisionResultOnce: false,
    returnPendingVisionReviewOnce: false,
    failNextRecoveryRequestAfterPartial: false,
    partialRecoveryRequestIndex: 0,
    releasePartialRecoveryFailure: undefined,
    partialRecoveryFailureGate: Promise.resolve(),
    holdNextBilingualRequest: false,
    bilingualRequestStarted: undefined,
    releaseHeldBilingualRequest: undefined,
    heldBilingualRequestGate: Promise.resolve(),
    holdNextInteractiveRequest: false,
    interactiveRequestStarted: undefined,
    releaseHeldInteractiveRequest: undefined,
    heldInteractiveRequestGate: Promise.resolve(),
    holdNextVisionRequest: false,
    releaseHeldVisionRequest: undefined,
    heldVisionRequestGate: Promise.resolve(),
    holdNextDocumentBatchRequest: false,
    releaseHeldDocumentBatchRequest: undefined,
    heldDocumentBatchRequestGate: Promise.resolve(),
    omitNextDocumentBatchItem: false,
  } satisfies EdgeE2EMockControl);
}

export interface TestChromeStorageArea {
  get(key: string): Promise<Record<string, Record<string, unknown>>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface TestChromeApi {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: TestChromeStorageArea;
    session: Pick<TestChromeStorageArea, 'set' | 'remove'>;
  };
}

export function createTextPdf(text: string): Buffer {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function createMultilineTextPdf(
  lines: string[],
  options: { fontSize?: number; lineStep?: number } = {},
): Buffer {
  const fontSize = options.fontSize ?? 18;
  const lineStep = options.lineStep ?? 24;
  const commands = lines.map((line, index) => {
    const escaped = line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `${index ? `0 -${lineStep} Td\n` : ''}(${escaped}) Tj`;
  }).join('\n');
  const stream = `BT\n/F1 ${fontSize} Tf\n72 720 Td\n${commands}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export async function createFileDataTransfer(
  targetPage: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
): Promise<JSHandle<DataTransfer>> {
  return targetPage.evaluateHandle((payloads) => {
    const transfer = new DataTransfer();
    for (const payload of payloads) {
      const binary = atob(payload.base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], payload.name, {
        type: payload.mimeType,
        lastModified: 1_780_000_000_000,
      }));
    }
    return transfer;
  }, files.map((file) => ({
    name: file.name,
    mimeType: file.mimeType,
    base64: file.buffer.toString('base64'),
  })));
}

export function createTwoColumnTextPdf(
  leftLines: string[],
  rightLines: string[],
  spanningLines: Array<{ text: string; x: number; y: number }> = [],
): Buffer {
  const command = (text: string, x: number, y: number) => {
    const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `BT\n/F1 11 Tf\n${x} ${y} Td\n(${escaped}) Tj\nET`;
  };
  const stream = [
    ...leftLines.map((line, index) => command(line, 54, 700 - index * 22)),
    ...spanningLines.map((line) => command(line.text, line.x, line.y)),
    ...rightLines.map((line, index) => command(line, 330, 700 - index * 22)),
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function createTableTextPdf(rows: string[][]): Buffer {
  const columnEdges = [64, 224, 384, 548];
  const tableTop = 716;
  const rowHeight = 38;
  const command = (text: string, x: number, y: number) => {
    const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `BT\n/F1 12 Tf\n${x} ${y} Td\n(${escaped}) Tj\nET`;
  };
  const grid = [
    'q',
    '0.65 w',
    ...Array.from({ length: rows.length + 1 }, (_, index) => {
      const y = tableTop - index * rowHeight;
      return `${columnEdges[0]} ${y} m ${columnEdges.at(-1)} ${y} l S`;
    }),
    ...columnEdges.map((x) => (
      `${x} ${tableTop} m ${x} ${tableTop - rows.length * rowHeight} l S`
    )),
    'Q',
  ];
  const cells = rows.flatMap((row, rowIndex) => row.map((text, columnIndex) => command(
    text,
    columnEdges[columnIndex]! + 10,
    tableTop - rowIndex * rowHeight - 24,
  )));
  const stream = [...grid, ...cells].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function createCaptionedTableAndTextPdf(
  caption: string,
  rows: string[][],
  bodyText: string,
): Buffer {
  const columnEdges = [64, 224, 384, 548];
  const tableTop = 690;
  const rowHeight = 38;
  const command = (text: string, x: number, y: number, fontSize = 12) => {
    const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `BT\n/F1 ${fontSize} Tf\n${x} ${y} Td\n(${escaped}) Tj\nET`;
  };
  const grid = [
    'q',
    '0.65 w',
    ...Array.from({ length: rows.length + 1 }, (_, index) => {
      const y = tableTop - index * rowHeight;
      return `${columnEdges[0]} ${y} m ${columnEdges.at(-1)} ${y} l S`;
    }),
    ...columnEdges.map((x) => (
      `${x} ${tableTop} m ${x} ${tableTop - rows.length * rowHeight} l S`
    )),
    'Q',
  ];
  const cells = rows.flatMap((row, rowIndex) => row.map((text, columnIndex) => command(
    text,
    columnEdges[columnIndex]! + 10,
    tableTop - rowIndex * rowHeight - 24,
  )));
  const stream = [
    command(caption, 64, 724, 11),
    ...grid,
    ...cells,
    command(bodyText, 64, tableTop - rows.length * rowHeight - 52, 12),
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function createTwoPageTextPdf(firstText: string, secondText: string): Buffer {
  const content = (text: string) => {
    const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    return `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  };
  const firstStream = content(firstText);
  const secondStream = content(secondText);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(firstStream)} >>\nstream\n${firstStream}\nendstream`,
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function createMultiPageTextPdf(
  pages: Array<{ text: string; width?: number; height?: number }>,
): Buffer {
  const pageCount = pages.length;
  const fontObject = 3 + pageCount;
  const firstContentObject = fontObject + 1;
  const pageObjects = pages.map((page, index) => {
    const width = page.width ?? 612;
    const height = page.height ?? 792;
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`;
  });
  const streams = pages.map((page) => {
    const escaped = page.text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
    const stream = `BT\n/F1 18 Tf\n72 ${(page.height ?? 792) - 72} Td\n(${escaped}) Tj\nET`;
    return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  const kids = pages.map((_, index) => `${3 + index} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    ...pageObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function createOutlinedPdf(): Buffer {
  const pages = Array.from({ length: 6 }, (_, index) => ({
    text: `Outlined document page ${index + 1}.`,
  }));
  const pageCount = pages.length;
  const fontObject = 3 + pageCount;
  const firstContentObject = fontObject + 1;
  const outlineRootObject = firstContentObject + pageCount;
  const introductionObject = outlineRootObject + 1;
  const methodsObject = outlineRootObject + 2;
  const experimentObject = outlineRootObject + 3;
  const conclusionObject = outlineRootObject + 4;
  const pageObjects = pages.map((_, index) => (
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`
  ));
  const streams = pages.map((page) => {
    const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${page.text}) Tj\nET`;
    return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  const kids = pages.map((_, index) => `${3 + index} 0 R`).join(' ');
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineRootObject} 0 R /PageMode /UseOutlines >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    ...pageObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams,
    `<< /Type /Outlines /First ${introductionObject} 0 R /Last ${conclusionObject} 0 R /Count 4 >>`,
    `<< /Title (Introduction) /Parent ${outlineRootObject} 0 R /Next ${methodsObject} 0 R /Dest [3 0 R /Fit] >>`,
    `<< /Title (Methods) /Parent ${outlineRootObject} 0 R /Prev ${introductionObject} 0 R /Next ${conclusionObject} 0 R /First ${experimentObject} 0 R /Last ${experimentObject} 0 R /Count 1 /Dest [5 0 R /Fit] >>`,
    `<< /Title (Detailed experiment and supplementary evaluation results) /Parent ${methodsObject} 0 R /Dest [6 0 R /Fit] >>`,
    `<< /Title (Conclusion) /Parent ${outlineRootObject} 0 R /Prev ${methodsObject} 0 R /Dest [8 0 R /Fit] >>`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function createLinkedPdf(): Buffer {
  const pageCount = 4;
  const fontObject = 3 + pageCount;
  const firstContentObject = fontObject + 1;
  const firstAnnotationObject = firstContentObject + pageCount;
  const pageTexts = [
    [
      'Jump to the final page',
      'Open the external paper reference',
      'Unsafe script link',
      'Unsafe launch action',
      'Go to the next page',
    ],
    ['Linked document page two'],
    ['Linked document page three'],
    ['Return to the first page'],
  ];
  const pageObjects = pageTexts.map((_, index) => {
    const annotations = index === 0
      ? ` /Annots [${firstAnnotationObject} 0 R ${firstAnnotationObject + 1} 0 R ${firstAnnotationObject + 2} 0 R ${firstAnnotationObject + 3} 0 R ${firstAnnotationObject + 4} 0 R]`
      : index === 3
        ? ` /Annots [${firstAnnotationObject + 5} 0 R]`
        : '';
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${firstContentObject + index} 0 R${annotations} >>`;
  });
  const streams = pageTexts.map((lines) => {
    const operations = lines.map((line, index) => {
      const escaped = line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
      return `${index ? '0 -40 Td\n' : ''}(${escaped}) Tj`;
    }).join('\n');
    const stream = `BT\n/F1 16 Tf\n72 720 Td\n${operations}\nET`;
    return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  const kids = pageTexts.map((_, index) => `${3 + index} 0 R`).join(' ');
  const externalUrl = 'https://www.overleaf.com/pi-pdf-external-reference';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    ...pageObjects,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams,
    '<< /Type /Annot /Subtype /Link /Rect [68 704 280 730] /Border [0 0 0] /Dest [6 0 R /Fit] >>',
    `<< /Type /Annot /Subtype /Link /Rect [68 664 340 690] /Border [0 0 0] /A << /S /URI /URI (${externalUrl}) >> >>`,
    '<< /Type /Annot /Subtype /Link /Rect [68 624 280 650] /Border [0 0 0] /A << /S /JavaScript /JS (app.alert\\(\'unsafe\'\\)) >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [68 584 280 610] /Border [0 0 0] /A << /S /Launch /F (payload.exe) >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [68 544 240 570] /Border [0 0 0] /A << /S /Named /N /NextPage >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [68 704 280 730] /Border [0 0 0] /Dest [3 0 R /Fit] >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

export function createRasterPdf(): Buffer {
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const dark = ((x < width / 2) !== (y < height / 2));
      pixels[offset] = dark ? 45 : 220;
      pixels[offset + 1] = dark ? 66 : 228;
      pixels[offset + 2] = dark ? 96 : 239;
    }
  }
  const compressed = deflateSync(pixels);
  const pageContent = Buffer.from('q\n400 0 0 400 100 250 cm\n/Scan Do\nQ');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${pageContent.length} >>\nstream\n`),
      pageContent,
      Buffer.from('\nendstream'),
    ]),
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const serialized = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(serialized);
    length += serialized.length;
  });
  const xrefOffset = length;
  const xref = Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );
  chunks.push(xref);
  return Buffer.concat(chunks);
}

export async function selectSourceText(): Promise<void> {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  const source = page.locator('#source');
  const box = await source.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''))
    .not.toBe('');
}

export async function clearBrowserSelection(): Promise<void> {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
}

export async function closeVisibleTranslationSurfaceForCleanup(): Promise<void> {
  await page.locator('#tex-selection-translator-root .surface-close').evaluateAll((buttons) => {
    const visibleButton = buttons.find(
      (button) => (button as HTMLElement).getClientRects().length > 0,
    );
    (visibleButton as HTMLButtonElement | undefined)?.click();
  });
}

export async function selectElementText(selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) throw new Error(`Missing selection target: ${targetSelector}`);
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, selector);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? ''))
    .not.toBe('');
}

export async function waitForVisibleBoundingBox(
  locator: Locator,
  description: string,
): Promise<NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>> {
  let resolved: Awaited<ReturnType<Locator['boundingBox']>> = null;
  await expect.poll(async () => {
    const candidate = await locator.boundingBox().catch(() => null);
    if (candidate && candidate.width > 0 && candidate.height > 0) resolved = candidate;
    return resolved !== null;
  }, { message: `Expected a visible bounding box for ${description}.` }).toBe(true);
  if (!resolved) throw new Error(`Expected a visible bounding box for ${description}.`);
  return resolved;
}

export async function replaceStoredApiKeys(keys: Record<string, string>): Promise<void> {
  const extensionPage = await context.newPage();
  try {
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extensionPage.evaluate(async (nextKeys) => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      await Promise.all([
        extensionChrome.storage.session.set({ apiKeysByProfile: nextKeys }),
        extensionChrome.storage.local.set({ apiKeysByProfile: {} }),
        extensionChrome.storage.session.remove(['apiKey', 'deepseekApiKey']),
        extensionChrome.storage.local.remove(['apiKey', 'deepseekApiKey']),
      ]);
    }, keys);
  } finally {
    await extensionPage.close();
  }
}

export async function setStoredSidebarMode(mode: 'floating' | 'browser'): Promise<void> {
  const extensionPage = await context.newPage();
  try {
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extensionPage.evaluate(async (nextMode) => {
      const extensionChrome = (
        globalThis as typeof globalThis & { chrome: TestChromeApi }
      ).chrome;
      const stored = await extensionChrome.storage.local.get('extensionSettings');
      await extensionChrome.storage.local.set({
        extensionSettings: {
          ...(stored.extensionSettings ?? {}),
          sidebarMode: nextMode,
        },
      });
    }, mode);
  } finally {
    await extensionPage.close();
  }
}

export function installEdgeExtensionHooks(): void {
  test.beforeAll(async () => {
    resetMockControl();
    textRequests.length = 0;
    visionRequests.length = 0;
  userDataDirectory = await mkdtemp(path.join(tmpdir(), 'pi-translator-e2e-'));
  const extensionPath = path.resolve('.output/edge-mv3');
  context = await chromium.launchPersistentContext(userDataDirectory, {
    executablePath: EDGE_EXECUTABLE,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  extensionId = new URL(serviceWorker.url()).host;

  const bootstrapPages = context.pages();
  const bootstrapPage = bootstrapPages[0] ?? await context.newPage();
  await bootstrapPage.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(bootstrapPage.locator('#api-profile option')).not.toHaveCount(0);
  const onboarding = bootstrapPage.locator('#onboarding-dialog');
  if (await onboarding.isVisible()) {
    await bootstrapPage.locator('#onboarding-skip').click();
  }
  await bootstrapPage.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & { chrome: TestChromeApi }
    ).chrome;
    const stored = await extensionChrome.storage.local.get('extensionSettings');
    await extensionChrome.storage.local.set({
      extensionSettings: {
        ...(stored.extensionSettings ?? {}),
        apiProfiles: [{
          id: 'default',
          name: 'E2E API',
          apiBaseUrl: 'https://www.overleaf.com/pi-translator-e2e-api',
          model: 'e2e-model',
        }, {
          id: 'vision-e2e',
          name: 'E2E Vision API',
          apiBaseUrl: 'https://www.overleaf.com/pi-translator-e2e-vision',
          model: 'e2e-vision-model',
        }],
        activeApiProfileId: 'default',
        visionApiProfileId: 'vision-e2e',
        visionModel: 'e2e-vision-model',
        apiBaseUrl: 'https://www.overleaf.com/pi-translator-e2e-api',
        model: 'e2e-model',
        onboardingCompleted: true,
      },
    });
    await extensionChrome.storage.session.set({
      apiKeysByProfile: { default: 'e2e-key', 'vision-e2e': 'e2e-vision-key' },
    });
  });
  await Promise.all(
    context.pages()
      .filter((tab) => tab !== bootstrapPage)
      .map((tab) => tab.close()),
  );
  page = await context.newPage();
  await bootstrapPage.close();
  await context.route('https://www.overleaf.com/pi-translator-e2e-api/**', async (route) => {
    if (route.request().method() === 'GET' && route.request().url().endsWith('/models')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'e2e-model' }, { id: 'e2e-model-fast' }] }),
      });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const imageMessageContent = (body.messages as Array<{
      content?: string | Array<{ type?: string; text?: string }>;
    }> | undefined)?.find((message) => Array.isArray(message.content) &&
      message.content.some((item) => item.type === 'image_url'))?.content;
    const imagePrompt = Array.isArray(imageMessageContent)
      ? imageMessageContent.find((item) => item.type === 'text')?.text ?? ''
      : '';
    const isVisionProbe = imagePrompt.includes('Read the four black characters');
    const isImageTranslation = Array.isArray(imageMessageContent) && !isVisionProbe;
    const serializedBody = JSON.stringify(body);
    const userMessageContent = (body.messages as Array<{
      role?: string;
      content?: string | Array<{ type?: string; text?: string }>;
    }> | undefined)?.find((message) => message.role === 'user' &&
      typeof message.content === 'string')?.content;
    let requestedText = '';
    let requiredPlaceholderTokens: string[] = [];
    let requestedSegments: Array<{ id: string; text: string }> = [];
    if (typeof userMessageContent === 'string') {
      try {
        const payload = JSON.parse(userMessageContent) as {
          text?: unknown;
          requiredPlaceholderTokens?: unknown;
          segments?: unknown;
        };
        if (typeof payload.text === 'string') requestedText = payload.text;
        if (
          Array.isArray(payload.requiredPlaceholderTokens) &&
          payload.requiredPlaceholderTokens.every((token) => typeof token === 'string')
        ) requiredPlaceholderTokens = payload.requiredPlaceholderTokens;
        if (
          Array.isArray(payload.segments) &&
          payload.segments.every((segment) => (
            segment &&
            typeof segment === 'object' &&
            typeof (segment as { id?: unknown }).id === 'string' &&
            typeof (segment as { text?: unknown }).text === 'string'
          ))
        ) requestedSegments = payload.segments as Array<{ id: string; text: string }>;
      } catch {
        requestedText = userMessageContent;
      }
    }
    const isMultiSentenceSelection = requestedText.includes('First important sentence');
    const isBrowserLongSelection = requestedText.includes(
      'A long browser side panel result should keep its reading position.',
    );
    const isDenseMetadataSelection = requestedText.includes('Dense metadata');
    const isGlobalTermSelection = requestedText.includes('benefits every reader');
    const isGlossaryReviewSelection = requestedText.includes('should remain stable');
    const isLexicalLookupSelection = requestedText.includes('continuity');
    const isBilingualFormulaParagraph = requestedText.includes('npm run build:edge');
    const isMediaWikiFormulaParagraph = requestedText.includes(
      'MediaWiki keeps accessible MathML beside a visible fallback image',
    );
    const isBilingualRetranslation = mockControl.returnBilingualRetranslationOnce && requestedText.includes(
      'Bilingual reading should preserve the original article',
    );
    const isDocumentTermSelection = requestedText.includes('The adaptive sensing policy') ||
      requestedText.includes('This adaptive sensing method');
    const isPdfOptimizerFallback = requestedText.includes('Optimizer fallback fixture');
    const isTranslationRevision = serializedBody.includes('translationRevisionPreference');
    const isPartialRecoverySelection = requestedText.includes(
      'A recovery request may already contain a partial translation.',
    );
    if (!isVisionProbe && !isImageTranslation) textRequests.push(body);
    if (isBilingualRetranslation) mockControl.returnBilingualRetranslationOnce = false;
    if (
      mockControl.holdNextBilingualRequest &&
      (
        requestedText.includes('A practical guide to reliable bilingual reading') ||
        requestedText.includes('Bilingual reading should preserve the original article') ||
        requestedText.includes('A held dynamically loaded paragraph') ||
        requestedText.includes('Overflow article paragraph')
      )
    ) {
      mockControl.holdNextBilingualRequest = false;
      mockControl.bilingualRequestStarted?.();
      mockControl.bilingualRequestStarted = undefined;
      await mockControl.heldBilingualRequestGate;
    }
    if (
      mockControl.holdNextInteractiveRequest &&
      requestedText.includes('Bilingual reading should preserve the original article')
    ) {
      mockControl.holdNextInteractiveRequest = false;
      mockControl.interactiveRequestStarted?.();
      mockControl.interactiveRequestStarted = undefined;
      await mockControl.heldInteractiveRequestGate;
    }
    if (
      mockControl.holdNextDocumentBatchRequest &&
      requestedSegments.length > 0 &&
      requestedSegments.every((segment) => /^(?:B\d+|P\d+B\d+)$/u.test(segment.id))
    ) {
      mockControl.holdNextDocumentBatchRequest = false;
      await mockControl.heldDocumentBatchRequestGate;
    }
    if (isPartialRecoverySelection && mockControl.failNextRecoveryRequestAfterPartial) {
      mockControl.partialRecoveryRequestIndex += 1;
      if (mockControl.partialRecoveryRequestIndex === 1) {
        const content = JSON.stringify({
          translation: '已收到的部分译文。',
          detectedLanguage: 'en',
          warnings: [],
          segments: [],
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content } }] }),
        });
        return;
      }
      await mockControl.partialRecoveryFailureGate;
      mockControl.failNextRecoveryRequestAfterPartial = false;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            message: 'Synthetic authentication failure after partial output.',
            type: 'authentication_error',
          },
        }),
      });
      return;
    }
    if (isTranslationRevision && mockControl.failNextRevisionRequest) {
      mockControl.failNextRevisionRequest = false;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'Synthetic revision failure.', type: 'invalid_request_error' },
        }),
      });
      return;
    }
    if (
      mockControl.bilingualFailuresRemaining > 0 &&
      serializedBody.includes('reliable bilingual reading')
    ) {
      mockControl.bilingualFailuresRemaining -= 1;
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'Synthetic bilingual rate limit.', type: 'rate_limit_error' },
        }),
      });
      return;
    }
    const returnedDocumentSegments = requestedSegments.map((segment) => ({
      id: segment.id,
      translation: segment.text.includes('npm run build:edge')
        ? mockControl.failBilingualFormulaPreservation
          ? '修改扩展后请重新构建，并核对评分函数。'
          : `修改扩展后请运行 \`npm run build:edge\`，并保留公式 ${segment.text.match(/⟦[^⟧]+⟧/gu)?.join(' ') ?? ''}。`
        : segment.text.includes('MediaWiki keeps accessible MathML')
          ? `MediaWiki 会保留公式 ${segment.text.match(/⟦[^⟧]+⟧/gu)?.join(' ') ?? ''}。`
          : segment.text.includes('Layout export density paragraph')
            ? '这是用于验证原页对照译文分页的完整学术段落，内容应保持清晰、连续，并在空间不足时移动到下一张对应译文页。'.repeat(20)
          : '批量生成的学术译文。',
    }));
    if (mockControl.omitNextDocumentBatchItem && returnedDocumentSegments.length > 1) {
      mockControl.omitNextDocumentBatchItem = false;
      returnedDocumentSegments.pop();
    }
    const isDocumentBatchRequest = requestedSegments.length > 0 && requestedSegments.every(
      (segment) => /^(?:B\d+|P\d+B\d+)$/u.test(segment.id),
    );
    const documentBatchResponse = isDocumentBatchRequest
      ? {
          translation: `批量译文 ${requestedText.match(/⟦[^⟧]+⟧/gu)?.join(' ') ?? ''}`.trim(),
          detectedLanguage: 'en',
          warnings: [],
          segments: returnedDocumentSegments,
        }
      : undefined;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isVisionProbe ? 'K7M2' : JSON.stringify(isImageTranslation ? {
              translation: '自动识别并翻译的图像区域。',
              recognizedText: 'Automatically recognized image text.',
              uncertainSpans: [],
            } : documentBatchResponse ? documentBatchResponse
            : isTranslationRevision ? {
              translation: '经用户调整后，更忠实地保留原文限定条件。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isPdfOptimizerFallback ? {
              translation: String.raw`优化目标为 \[Q^{\Pi^*}=\operatorname{argmin}P\in P(V,\Omega)\left\{KL(P\Vert Q)\right\},\tag{12}\]`,
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isDenseMetadataSelection ? {
              translation: String.raw`密集元信息在窄屏中保持清晰，\[\operatorname{ELBO}(\theta,\phi)=\mathbb{E}_{q_\phi(z\mid x)}[\log p_\theta(x,z)-\log q_\phi(z\mid x)]+\lambda\sum_{i=1}^{n}\lVert x_i-\hat{x}_i\rVert_2^2+\gamma\prod_{j=1}^{m}\frac{p_\theta(y_j\mid z)}{q_\phi(z\mid x_j)}+\eta\sum_{k=1}^{r}\left\lVert A_kx-b_k\right\rVert_F^2\tag{12}\] 也可切换。`,
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isBrowserLongSelection ? {
              translation: [
                '浏览器侧栏中的长译文会保留当前阅读位置；即使内容包含多个较长段落，用户也可以在结果顶部与底部之间快速移动，而不会影响原网页中的阅读上下文。阅读过程中可以继续核对原文、辨认段落边界，并在需要时复制已经完成的内容，侧栏不会因为一次轻微滚动就擅自跳回末尾。',
                String.raw`视图切换时仍会保持公式 \(E=mc^2\) 及其周围文字的相对位置；全文、逐句对照和公式源码均使用同一份已完成结果，不会再次调用翻译接口。即使数学渲染改变了段落高度，阅读位置也会根据当前结果重新校准，使公式之前和之后的说明仍然处于相近的视野范围内。`,
                '从较早的历史译文返回后，侧栏会恢复这条长译文上次停留的位置；新的网页划词结果则从译文开头开始显示，让连续阅读、比较和复制保持清楚而连贯。只有确实超出一屏的结果才显示紧凑的阅读导航，较短的单句与词语翻译仍保持原本简洁的操作区。',
              ].join('\n\n'),
              detectedLanguage: 'en',
              warnings: [],
              segments: [{
                id: 'C1S1',
                translation: '浏览器侧栏中的长译文会保留当前阅读位置；即使内容包含多个较长段落，用户也可以在结果顶部与底部之间快速移动，而不会影响原网页中的阅读上下文。阅读过程中可以继续核对原文、辨认段落边界，并在需要时复制已经完成的内容，侧栏不会因为一次轻微滚动就擅自跳回末尾。',
              }, {
                id: 'C1S2',
                translation: String.raw`视图切换时仍会保持公式 \(E=mc^2\) 及其周围文字的相对位置；全文、逐句对照和公式源码均使用同一份已完成结果，不会再次调用翻译接口。即使数学渲染改变了段落高度，阅读位置也会根据当前结果重新校准，使公式之前和之后的说明仍然处于相近的视野范围内。`,
              }, {
                id: 'C1S3',
                translation: '从较早的历史译文返回后，侧栏会恢复这条长译文上次停留的位置；新的网页划词结果则从译文开头开始显示，让连续阅读、比较和复制保持清楚而连贯。只有确实超出一屏的结果才显示紧凑的阅读导航，较短的单句与词语翻译仍保持原本简洁的操作区。',
              }],
            } : isMultiSentenceSelection ? {
              translation: '第一句重要译文。第二句补充译文。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [{
                id: 'C1S1',
                translation: '第一句重要译文。',
              }, {
                id: 'C1S2',
                translation: '第二句补充译文。',
              }],
            } : isGlobalTermSelection ? {
              translation: '一致的学术翻译能够提升研究论文的可读性。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isGlossaryReviewSelection ? {
              translation: '这种技术表达应保持稳定。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isLexicalLookupSelection ? {
              translation: '连续性',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
              lookup: {
                pronunciation: '/ˌkɒntɪˈnjuːəti/',
                partOfSpeech: 'noun',
                senses: [
                  { partOfSpeech: 'noun', meaning: '连续性' },
                  { partOfSpeech: 'noun', meaning: '连贯性' },
                ],
              },
            } : isBilingualRetranslation ? {
              translation: '重新翻译后的段落只替换当前译文。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isBilingualFormulaParagraph ? {
              translation: mockControl.failBilingualFormulaPreservation
                ? '修改扩展后请重新构建，并核对评分函数。'
                : `修改扩展后请运行 \`npm run build:edge\`，同时保留评分函数 ${requiredPlaceholderTokens[0] ?? ''} 及其上下文。`,
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isMediaWikiFormulaParagraph ? {
              translation: `MediaWiki 会把可访问公式 ${requiredPlaceholderTokens[0] ?? ''} 与可见回退图像放在一起。`,
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
            } : isDocumentTermSelection ? {
              translation: '自适应感知策略在该文档中保持稳定，并在具有层级约束的多阶段重建任务中持续保持一致的技术术语与推理边界。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [],
              termCandidates: [{
                source: 'adaptive sensing',
                target: '自适应感知',
              }],
            } : {
              translation: '一致的学术翻译能够提升研究论文的可读性。',
              detectedLanguage: 'en',
              warnings: [],
              segments: [{
                id: 'C1S1',
                translation: '一致的学术翻译能够提升研究论文的可读性。',
              }],
            }),
          },
        }],
      }),
    });
  });
  await context.route('https://www.overleaf.com/pi-translator-e2e-vision/**', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    visionRequests.push(body);
    if (mockControl.holdNextVisionRequest) {
      mockControl.holdNextVisionRequest = false;
      await mockControl.heldVisionRequestGate;
    }
    const requestImage = (body.messages as Array<{
      content?: Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
    }> | undefined)?.[0]?.content?.find((item) => item.type === 'image_url')?.image_url?.url;
    const imagePrompt = (body.messages as Array<{
      content?: Array<{ type?: string; text?: string }>;
    }> | undefined)?.[0]?.content?.find((item) => item.type === 'text')?.text ?? '';
    const isEnergyFormula = imagePrompt.includes('Energy E = mc^2') ||
      imagePrompt.includes('E=mc^2') ||
      imagePrompt.includes('E = mc^2');
    const isEscapedFormula = imagePrompt.includes('Escaped distribution');
    const isRenderedFormula = imagePrompt.includes('∑ᵢ xᵢ²');
    const isFigureObject = imagePrompt.includes('当前图片是论文中的一张完整图表或插图');
    const isTableObject = imagePrompt.includes('当前图片是论文中的一张完整表格');
    const formulaLatex = isEscapedFormula
      ? String.raw`\\mathbb{Q}_\\Omega\\`
      : isEnergyFormula
      ? 'E=mc^2'
      : isRenderedFormula
        ? '\\sum_i x_i^2 \\ge 0'
        : undefined;
    const shouldEcho = mockControl.echoVisionPayloadOnce;
    mockControl.echoVisionPayloadOnce = false;
    const shouldReturnRevisedRecognition = mockControl.returnRevisedVisionResultOnce;
    mockControl.returnRevisedVisionResultOnce = false;
    const shouldReturnPendingReview = mockControl.returnPendingVisionReviewOnce;
    mockControl.returnPendingVisionReviewOnce = false;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              translation: isEscapedFormula
                ? String.raw`退出分布 $\\mathbb{Q}_\\Omega\\$ 与目标匹配，另有 $mathbbQ_\\Omega$。`
                : isEnergyFormula
                ? '能量关系式 $E=mc^2$ 保持不变。'
                : isRenderedFormula
                  ? '该量满足 $\\sum_i x_i^2 \\ge 0$。'
                  : isFigureObject
                    ? String.raw`图 2：所提出的 ISTA-Net 框架示意图。具体而言，ISTA-Net 由多个阶段组成，每个阶段对应一次 ISTA 迭代；前向变换 $F(k)$ 和后向变换 $\widetilde{F}(k)$ 均可学习，并满足 $\widetilde{F}(k) \circ F(k) = I$。`
                  : isTableObject
                    ? '表 1：Set11 上的平均 PSNR 对比。\n\n| 模型 | PSNR | 时间 |\n| --- | ---: | ---: |\n| ISTA-Net | 31.53 | 0.039 s |\n| ISTA-Net+ | 32.57 | 0.047 s |'
                  : shouldReturnRevisedRecognition
                    ? '重新识别后修正的学术翻译结果。'
                  : '图像区域的学术翻译结果。',
              recognizedText: shouldEcho
                ? requestImage
                : isEscapedFormula
                  ? String.raw`Escaped distribution $\\mathbb{Q}_\\Omega\\$ is invariant, plus $mathbbQ_\\Omega$.`
                  : isEnergyFormula
                  ? 'Energy $E=mc^2$ is invariant.'
                  : isRenderedFormula
                    ? 'The quantity $\\sum_i x_i^2 \\ge 0$ is nonnegative.'
                    : isFigureObject
                      ? String.raw`Figure 2. Illustration of the proposed ISTA-Net framework. The forward transform $F(k)$ and backward transform $\widetilde{F}(k)$ are learnable and satisfy $\widetilde{F}(k) \circ F(k) = I$.`
                    : isTableObject
                      ? 'Table 1. Average PSNR comparison on Set11.\n\n| Model | PSNR | Time |\n| --- | ---: | ---: |\n| ISTA-Net | 31.53 | 0.039 s |\n| ISTA-Net+ | 32.57 | 0.047 s |'
                    : shouldReturnRevisedRecognition
                      ? 'Re-recognized academic source text.'
                      : 'Scanned academic source text.',
              formulaLatex: formulaLatex ? [formulaLatex] : [],
              uncertainSpans: shouldReturnPendingReview
                ? ['The formula subscript is not fully legible.']
                : [],
            }),
          },
        }],
      }),
    });
  });
  await page.route(ARTICLE_FIXTURE_URL, async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html>
          <head><title>Pi Translator Bilingual Article</title></head>
          <body style="margin:0;font:18px/1.7 Georgia,serif;color:#1f2937;background:#fff">
            <nav style="padding:18px 32px;background:#f3f4f6"><p id="article-navigation">Documentation links and related navigation should never be translated as article prose.</p></nav>
            <main style="max-width:760px;margin:0 auto;padding:48px 28px 120px">
              <article>
                <h1 id="article-title">A practical guide to reliable bilingual reading</h1>
                <p id="article-intro">Bilingual reading should preserve the original article while placing a clear translation directly below each readable paragraph.</p>
                <p id="article-intro-repeat">Bilingual reading should preserve the original article while placing a clear translation directly below each readable paragraph.</p>
                <p id="article-method">${mockControl.bilingualArticleRevision
                  ? 'The updated translator should restore unchanged paragraphs and translate only the article content that actually changed.'
                  : 'The translator should process nearby paragraphs first, remain responsive during long articles, and let the reader pause without losing completed work.'}</p>
                <pre id="article-code"><code>const result = await translateAllParagraphs(article);</code></pre>
                <p id="article-inline-code">Run <code>npm run build:edge</code> after changing the extension, while keeping the score <span class="math notranslate nohighlight"><span class="MathJax_Preview">legacy preview x 2</span><span class="MathJax">duplicated rendered x 2</span><script type="math/tex">f(x)=x^2</script></span> and its surrounding explanation readable.</p>
                <form><p id="article-form-help">Payment and account form instructions must not be collected as article content.</p><input type="password" value="private-value" /></form>
                <div style="height:1500px" aria-hidden="true"></div>
                <p id="article-later">The full article task should translate this later paragraph without requiring the reader to scroll through the entire page.</p>
                <blockquote id="article-summary">The finished bilingual view must be removable in one action so the webpage returns to its untouched original structure. <svg class="equation-graphic" role="img" aria-label="rendered equation without TeX source" width="126" height="30" viewBox="0 0 126 30" style="display:inline-block;vertical-align:middle"><text x="5" y="21" font-size="18">g(x)=x³+1</text></svg></blockquote>
                ${mockControl.bilingualArticleRevision
                  ? '<p id="article-new">A newly published paragraph should be translated after the reader refreshes the same article.</p>'
                  : ''}
              </article>
            </main>
          </body>
        </html>`,
    });
  });
  await page.route(LONG_ARTICLE_FIXTURE_URL, async (route) => {
    const paragraphs = Array.from({ length: 520 }, (_, index) => {
      const number = String(index + 1).padStart(4, '0');
      const sectionHeading = index % 120 === 0 && index > 0;
      const tagName = sectionHeading ? 'h2' : 'p';
      const text = sectionHeading
        ? `Long article section ${number} introduces the next part of this complete translation fixture.`
        : `Long article paragraph ${number} contains enough natural-language prose to verify complete translation beyond the former limit.`;
      return `<${tagName} id="long-paragraph-${number}">${text}</${tagName}>`;
    }).join('');
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html>
          <head><title>Pi Translator Long Bilingual Article</title></head>
          <body style="margin:0;font:17px/1.6 Georgia,serif;color:#1f2937;background:#fff">
            <main style="max-width:760px;margin:0 auto;padding:40px 28px 100px">
              <article>${paragraphs}</article>
            </main>
          </body>
        </html>`,
    });
  });
  await page.route(MEDIAWIKI_MATH_FIXTURE_URL, async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html>
          <head><title>MediaWiki formula compatibility</title></head>
          <body style="margin:0;font:18px/1.7 Georgia,serif;color:#1f2937;background:#fff">
            <main style="max-width:760px;margin:0 auto;padding:48px 28px 120px">
              <article>
                <h1>Accessible mathematics in a reference article</h1>
                <p>The surrounding explanation should remain readable before the mathematical example.</p>
                <p id="mediawiki-inline">MediaWiki keeps accessible MathML beside a visible fallback image
                  <span class="mwe-math-element mwe-math-element-inline" typeof="mw:Extension/math" data-mw='{"name":"math","attrs":{},"body":{"extsrc":"f(x)=x^2"}}'>
                    <span class="mwe-math-mathml-inline mwe-math-mathml-a11y" style="display:none">
                      <math class="mathjax_ignore" alttext="{\\displaystyle f(x)=x^{2}}">
                        <semantics><mrow><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">{\\displaystyle f(x)=x^{2}}</annotation></semantics>
                      </math>
                    </span>
                    <img class="mwe-math-fallback-image-inline" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='24'%3E%3Ctext x='2' y='18'%3Ef(x)=x%C2%B2%3C/text%3E%3C/svg%3E" alt="{\\displaystyle f(x)=x^{2}}" aria-hidden="true" />
                  </span>
                  without requiring a second visual-recognition action.</p>
                <p>The final paragraph verifies that ordinary prose continues after the formula.</p>
              </article>
            </main>
          </body>
        </html>`,
    });
  });
  await page.route(OVERLEAF_FIXTURE_URL, async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html>
          <head><title>Pi Translator E2E Paper</title></head>
          <body style="font: 18px sans-serif; padding: 80px">
            <p id="source">A consistent academic translation improves the readability of research papers.</p>
            <p id="global-term-source">A consistent academic translation benefits every reader.</p>
            <p id="term-review-source">A technical term should remain stable.</p>
            <p id="lookup-source">continuity</p>
            <p id="multi-source">First important sentence. Second supporting sentence.</p>
            <p id="browser-history-source">A browser side panel keeps recent translations easy to revisit.</p>
            <p id="browser-long-source">A long browser side panel result should keep its reading position. Einstein's energy relation may appear as a rendered formula while the view changes. Returning from an older translation should restore the previous place.</p>
            <p id="term-source">The adaptive sensing policy is stable in this document.</p>
            <p id="term-followup">This adaptive sensing method remains consistent.</p>
            <p id="recovery-source">A configured API should resume this selected translation automatically.</p>
            <p id="partial-recovery-source">A recovery request may already contain a partial translation.</p>
            <p id="math-source">The objective
              <span class="katex" data-tex="\\mathcal{L}=\\sum_i(x_i-y_i)^2">ℒ = Σᵢ(xᵢ − yᵢ)²</span>
              is minimized during training.
            </p>
            <p id="rendered-only-math">The quantity ∑ᵢ xᵢ² ≥ 0 is nonnegative.</p>
            <div id="visual-region" aria-label="Synthetic chart without DOM text" style="width: 360px; height: 140px; border: 1px solid #94a3b8; background: linear-gradient(135deg, #dbeafe 0 33%, #818cf8 33% 66%, #1e3a8a 66%);"></div>
            <div style="margin-top: 48px">
              <pre><code id="code-source">const translated = items.map((item) =&gt; translate(item));</code></pre>
              <p id="mixed-code-source">Run <code>npm run build:edge</code> after updating the extension source.</p>
              <div class="cm-editor"><div class="cm-content">
                <p id="overleaf-editor-prose">Natural-language prose inside the Overleaf editor remains translatable.</p>
                <p id="latex-structure">\\begin{equation} E = mc^2 \\end{equation}</p>
              </div></div>
              <div class="xterm"><span id="terminal-source">The development server is waiting for another command.</span></div>
            </div>
            <input id="payment" type="text" autocomplete="cc-number" value="4111 1111 1111 1111" />
            <button id="blank" type="button">Clear selection</button>
          </body>
        </html>`,
    });
  });
  await page.goto(OVERLEAF_FIXTURE_URL);
});

test.afterAll(async () => {
  await context?.close();
  if (userDataDirectory) {
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

test.afterEach(resetMockControl);
}

export { expect, test };
