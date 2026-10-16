import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {readLocalPdfLayout} from '../tests/support/local-pdf-layout';
import {pdfDocumentTranslationHeadingLevel} from '../core/pdf/document-translation';

const root = 'output/pdf/heading-hierarchy-2026-10-15';
await mkdir(root, {recursive: true});
const corpora = [{name: 'CNP', source: 'output/pdf/live-workflow-2026-10-15/source/conditional-neural-processes.pdf',
  baseline: 'output/pdf/paragraph-flow-2026-10-15/source-after.json'},
...(process.env.PI_PDF_REGRESSION_SOURCE ? [{name: 'HATNet', source: process.env.PI_PDF_REGRESSION_SOURCE,
  baseline: 'output/pdf/reliability-audit-2026-10-15/hatnet-current-source.json'}] : [])];
const reports = [];
for (const corpus of corpora) {
  const current = await readLocalPdfLayout(corpus.source);
  const prior = JSON.parse(await readFile(corpus.baseline, 'utf8'));
  const unchanged = JSON.stringify(current.blocks) === JSON.stringify(prior.blocks);
  if (!unchanged) throw new Error(`Unexpected source segmentation change: ${corpus.name}`);
  reports.push({name: corpus.name, blocks: current.blocks.length, sourceUnchanged: unchanged,
    headings: current.blocks.flatMap(block => {
      const level = pdfDocumentTranslationHeadingLevel(block);
      return level ? [{id: block.id, page: block.pageNumber, text: block.text, level}] : [];
    }),
    numberedProse: current.blocks.filter(block => /^\d\. A CNP/u.test(block.text))
      .map(block => ({id: block.id, text: block.text, heading: pdfDocumentTranslationHeadingLevel(block) ?? null})),
  });
}
await writeFile(`${root}/source-hierarchy.json`, JSON.stringify({
  evidence: 'Local parsing and display metadata only. No model requests or historical record changes.', corpora: reports,
}, null, 2));
console.log(reports.map(report => ({name: report.name, blocks: report.blocks, headings: report.headings.length,
  sourceUnchanged: report.sourceUnchanged, numberedProseUntouched: report.numberedProse.every(item => item.heading === null)})));
