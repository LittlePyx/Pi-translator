import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readLocalPdfLayout } from '../tests/support/local-pdf-layout';
import { pdfDocumentTranslationSourceRegions } from '../core/pdf/document-translation';
import { pdfDocumentTranslationSessionBlockSignature } from '../core/pdf/document-translation-session';

const root = 'output/pdf/paragraph-flow-2026-10-15';
await mkdir(root, { recursive: true });
const before = JSON.parse(await readFile('output/pdf/live-workflow-2026-10-15/prepared-source.json', 'utf8'));
const after = await readLocalPdfLayout('output/pdf/live-workflow-2026-10-15/source/conditional-neural-processes.pdf');
await writeFile(`${root}/source-before.json`, JSON.stringify(before, null, 2));
await writeFile(`${root}/source-after.json`, JSON.stringify(after, null, 2));
const claim = after.blocks.find(block => block.text.startsWith('1. A CNP is'))!;
const report: Record<string, unknown> = {
  evidence: 'Local PDF parsing only; no model calls or rewriting of historical translations.',
  beforeBlocks: before.blocks.length, afterBlocks: after.blocks.length,
  firstClaim: { ...claim, regions: pdfDocumentTranslationSourceRegions(claim) },
  listItems: after.blocks.filter(block => /^\d\. A CNP/u.test(block.text)).map(block => ({ id: block.id, text: block.text })),
  newSourceScopes: after.blocks.filter(block => !before.blocks.some((old: { pageNumber: number; text: string }) => old.pageNumber === block.pageNumber && old.text === block.text))
    .map(block => ({ id: block.id, text: block.text })),
  sourceEquationNumbers: after.blocks.flatMap(block => block.sourceEquations ?? []).map(equation => equation.number),
};
if (process.env.PI_PDF_REGRESSION_SOURCE) {
  const previous = JSON.parse(await readFile('output/pdf/reliability-audit-2026-10-15/hatnet-current-source.json', 'utf8'));
  const current = await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE);
  report.hatnet = { before: previous.blocks.length, after: current.blocks.length,
    changed: current.blocks.filter(block => !previous.blocks.some((old: { pageNumber: number; text: string }) => old.pageNumber === block.pageNumber && old.text === block.text))
      .map(block => ({ id: block.id, text: block.text })) };
}
await writeFile(`${root}/source-audit.json`, JSON.stringify(report, null, 2));
// A derived layout fixture only: preserve the original model checkpoint. The
// newly joined source scope has not received a new whole-sentence model reply.
const checkpoint = JSON.parse(await readFile('output/pdf/live-workflow-2026-10-15/final-artifacts/pdf-actual-export-review-r-fc727-ions-and-mathematical-fonts/proofread-checkpoint.json', 'utf8'));
const record = checkpoint.retained[0];
const saved = new Map<string, { signature: string; translatedText: string }>(record.blocks.map((block: { signature: string; translatedText: string }) => [block.signature, block]));
const occurrences = new Map<string, number>();
const signatures = after.blocks.map(block => {
  const key = `${block.pageNumber}\0${block.text}`;
  const occurrence = occurrences.get(key) ?? 0;
  occurrences.set(key, occurrence + 1);
  return pdfDocumentTranslationSessionBlockSignature(block.pageNumber, block.text, occurrence);
});
const fragments = ['P3B18', 'P3B19'].map(id => {
  const source = before.blocks.find((block: { id: string }) => block.id === id)!;
  return saved.get(pdfDocumentTranslationSessionBlockSignature(source.pageNumber, source.text, 0))!;
});
if (fragments.some(fragment => !fragment)) throw new Error('Missing historical CNP list reply.');
const blocks = signatures.flatMap((signature, index) => {
  const original = saved.get(signature);
  if (original) return [original];
  const source = after.blocks[index]!;
  if (source.id !== claim.id) {
    // The original checkpoint deliberately leaves references untranslated.
    if (before.blocks.some((old: {pageNumber: number; text: string}) => old.pageNumber === source.pageNumber && old.text === source.text)) return [];
    throw new Error(`Unexpected new source scope ${source.id}`);
  }
  return [{ signature, translatedText: `${fragments[0]!.translatedText}，${fragments[1]!.translatedText}` }];
});
await writeFile(`${root}/layout-replay-checkpoint.json`, JSON.stringify({
  evidence: 'Offline layout replay: historical real-model replies retained; only CNP item 1 joins its two historical target fragments with a comma. This is not a new whole-sentence model validation or a production cache migration.',
  joinedSource: claim.text,
  originalFragments: fragments,
  modelRequests: 0,
  retained: [{ ...record, documentSignatures: signatures, blocks }],
}, null, 2));
console.log(JSON.stringify(report, null, 2));
