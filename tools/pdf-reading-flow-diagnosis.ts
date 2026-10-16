import { readLocalPdfLayout } from '../tests/support/local-pdf-layout';

const source = process.argv.find((arg) => /\.pdf$/iu.test(arg));
if (!source) throw new Error('Provide a local PDF path');
const prepared = await readLocalPdfLayout(source);
const target = prepared.blocks.find((block) => block.text.includes('Illumination-Varying Results'));
if (!target) throw new Error('Target paragraph not found');
console.log(JSON.stringify(prepared.blocks.filter((block) => block.pageNumber === target.pageNumber)
  .map(({ id, text, kind, sourceAnchor, sourceRegions }) => ({ id, kind, text, sourceAnchor, sourceRegions })), null, 2));
