import { describe, expect, it } from 'vitest';
import { groupPdfDocumentTranslationVisualObjects, pdfDocumentTranslationBlocks, preparePdfDocumentTranslationPages,
  type PdfDocumentTranslationBlock } from '../core/pdf/document-translation';

const block = (text: string, index: number, kind?: PdfDocumentTranslationBlock['kind']): PdfDocumentTranslationBlock => ({
  id: `P1B${index + 1}`, pageNumber: 1, blockIndex: index, text, ...(kind ? { kind } : {}),
  sourceAnchor: { leftRatio: .5, topRatio: .2 + index * .025, widthRatio: .38, heightRatio: .015 },
});
const table = () => [block('Table 3. Performance at SR = 25%.', 0),
  block('Method\tPSNR\tSSIM', 1, 'table'), block('Baseline\t32.15\t0.9140', 2, 'table')];

describe('PDF table semantic boundaries', () => {
  it('never assigns the first table rows to the following table caption',()=>{
    const items=[{str:'Table 2. First comparison.',left:305,top:80,width:238,height:9,hasEOL:false}];
    for(const [top,values]of [[104,'0.1 0.2 0.3'],[122,'0.4 0.5 0.6'],[172,'0.7 0.8 0.9'],[190,'1.1 1.2 1.3']]as const)
      ['Method',...values.split(' ')].forEach((str,column)=>items.push({str,left:305+column*62,top,width:35,height:9,hasEOL:false}));
    items.push({str:'Table 3. Second comparison.',left:305,top:148,width:238,height:9,hasEOL:false});
    const blocks=preparePdfDocumentTranslationPages([{pageNumber:1,pageWidth:612,pageHeight:792,items}]).blocks;
    const first=blocks.find(value=>value.text.startsWith('Table 2.'))!,second=blocks.find(value=>value.text.startsWith('Table 3.'))!;
    expect(first.kind).toBe('table');expect(second.kind).toBe('table');expect(first.text).toContain('0.1');expect(second.text).not.toContain('0.1');
  });
  it('keeps a bottom-captioned numeric table intact before joining the following prose', () => {
    const rows=[['Method','5-way Acc','20-way Acc','Runtime'],['MANN','82.8%','94.9%','O(nm)'],
      ['MN','98.1%','98.9%','O(nm)'],['CNP','95.3%','98.5%','O(n+m)']];
    const items=rows.flatMap((row,r)=>row.map((str,c)=>({str,left:305+c*62,top:80+r*18,width:55,height:9,hasEOL:false})));
    items.push({str:'Table 2. Accuracy and runtime comparison.',left:305,top:166,width:238,height:9,hasEOL:false},
      {str:'The representations are then concatenated together.',left:305,top:195,width:238,height:10,hasEOL:false});
    const blocks=preparePdfDocumentTranslationPages([{pageNumber:1,pageWidth:612,pageHeight:792,items}]).blocks;
    const table=blocks.find(value=>value.text.startsWith('Table 2.'))!;
    expect(table.kind).toBe('table');expect(table.text).toContain('95.3%');expect(table.text).toContain('Runtime');
    expect(table.text).not.toContain('representations');
    expect(blocks.find(value=>value.text.includes('representations'))!.text).toBe('The representations are then concatenated together.');
  });
  it.each(['5. Conclusion', '6. Results', '5.3. Ablation', 'IV. Discussion', 'Conclusion', 'Acknowledgments'])(
    'stops before the short section heading %s', (heading) => {
      const output = groupPdfDocumentTranslationVisualObjects([
        ...table(), block(heading, 3), block('Towards real-world cameras, we propose an efficient approach.', 4),
      ]);
      expect(output.map((entry) => entry.kind ?? 'text')).toEqual(['table', 'text', 'text']);
      expect(output[1]!.text).toBe(heading);
      expect(output[0]!.text).not.toContain(heading);
      const bounds = output[0]!.sourceAnchor!;
      expect(bounds.topRatio + bounds.heightRatio).toBeLessThan(output[1]!.sourceAnchor!.topRatio);
    },
  );

  it('does not merge successive captioned tables, including on a second grouping pass', () => {
    const input = [...table(), block('Table 4. Full-size sampling at SR = 10%.', 3),
      block('Method\tDGUNet\tHATNet', 4, 'table'), block('Full-size\t31.65\t32.26', 5, 'table')];
    const output = groupPdfDocumentTranslationVisualObjects(input);
    expect(output).toHaveLength(2);
    expect(output[0]!.text).not.toContain('Table 4.');
    expect(output[1]!.text).toMatch(/^Table 4\./u);
    expect(groupPdfDocumentTranslationVisualObjects(output)).toEqual(output);
  });

  it('does not let uncaptained table rows absorb an already grouped captioned table', () => {
    const output = groupPdfDocumentTranslationVisualObjects([
      block('Method\tPSNR\tSSIM', 0, 'table'), block('Baseline\t32.15\t0.9140', 1, 'table'),
      block('Table 4. Performance.\nMethod\tPSNR\nOurs\t32.26', 2, 'table'),
    ]);
    expect(output).toHaveLength(2);
    expect(output[0]!.text).not.toContain('Table 4.');
  });

  it('keeps numeric data rows and compact column headers within the table', () => {
    const output = groupPdfDocumentTranslationVisualObjects([
      ...table(), block('Method', 3), block('1 Baseline 32.15 0.9140', 4),
    ]);
    expect(output).toHaveLength(1);
    expect(output[0]!.text).toContain('1 Baseline 32.15 0.9140');
    expect(output[0]!.text).toContain('\nMethod\n');
  });

  it('keeps whole-table padding out of neighboring prose and headings', () => {
    const before = block('The comparison uses the same settings.', -1);
    before.sourceAnchor!.heightRatio = .024;
    const after = block('5. Conclusion', 3);
    after.sourceAnchor!.topRatio = .266;
    const output = groupPdfDocumentTranslationVisualObjects([before, ...table(), after]);
    const anchor = output.find((entry) => entry.kind === 'table')!.sourceAnchor!;
    expect(anchor.topRatio).toBeGreaterThanOrEqual(.199);
    expect(anchor.topRatio + anchor.heightRatio).toBeLessThanOrEqual(.266);
  });

  it('starts a new caption before paragraph joining can attach it to preceding cells', () => {
    const items = [
      'GPU memory (G) 3.02 10.74',
      'Inference time (s) 0.38 0.55',
      'Table 4. Comparison between block-based sampling and full-size',
      'sampling of Kronecker SPI at SR= 10%.',
    ].map((str, index) => ({ str, left: 305, top: 200 + index * 12, width: 240, height: 9, hasEOL: true }));
    const output = pdfDocumentTranslationBlocks(1, items, { width: 612, height: 792 });
    const caption = output.find((entry) => entry.text.includes('Table 4.'))!;
    expect(caption.text).toMatch(/^Table 4\./u);
    expect(caption.text).toContain('sampling of Kronecker SPI');
    expect(caption.text).not.toContain('GPU memory');
    expect(caption.sourceAnchor!.topRatio * 792).toBeGreaterThan(221);
  });
});
