import {describe,it,expect} from 'vitest';
import {readLocalPdfLayout} from './support/local-pdf-layout';
import {buildResearchReferenceIndex} from '../core/pdf/research-references';

describe.skipIf(!process.env.PI_FLOW_REGRESSION_SOURCE)('publisher normalizing-flow PDF layout',()=>{
  it('owns all twenty labels, keeps three real tables and removes plot-label regions from complete column prose',async()=>{
    const prepared=await readLocalPdfLayout(process.env.PI_FLOW_REGRESSION_SOURCE!);
    const blocks=prepared.blocks,rows=blocks.flatMap(b=>b.sourceEquations??[]);
    expect(rows.map(r=>r.number)).toEqual(Array.from({length:20},(_,i)=>String(i+1)));
    expect(new Set(rows.map(r=>r.id)).size).toBe(20);
    expect(blocks.filter(b=>b.kind==='table')).toHaveLength(3);
    expect(blocks.filter(b=>b.kind==='figure')).toHaveLength(4);
    const referenceIndex=buildResearchReferenceIndex(blocks);
    for(let number=1;number<=20;number++)expect(referenceIndex.has(`equation:${number}`)).toBe(true);
    for(let number=1;number<=4;number++)expect(referenceIndex.has(`figure:${number}`)).toBe(true);
    for(let number=1;number<=3;number++)expect(referenceIndex.has(`table:${number}`)).toBe(true);
    expect(blocks.some(b=>b.kind!=='figure'&&/q0\s+K=1\s+Planar/u.test(b.text))).toBe(false);
    expect(blocks.some(b=>b.text==='Radial')).toBe(false);
    const author=blocks.find(b=>b.text.startsWith('Danilo Jimenez'))!;
    expect(author.text).toContain('DANILOR@GOOGLE.COM');expect(author.text).toContain('SHAKIR@GOOGLE.COM');
    expect(author.text).not.toContain('tool for the understanding');
    expect(blocks.find(b=>b.text.startsWith('There has been a great deal'))!.text).toContain('a default tool for the understanding');
    expect(blocks.some(b=>b.text.startsWith('tion).'))).toBe(false);
    const reparam=blocks.find(b=>b.text.startsWith('• Reparameterization'))!;
    expect(reparam.text).toContain('function). For example');expect(reparam.sourceRegions?.some(r=>r.pageNumber===3)).toBe(true);
    const radial=blocks.find(b=>b.text.startsWith('As an alternative'))!;
    expect(radial.text).toContain('(10) and (14) in figure 1.');
    expect(radial.text).toContain('two successive transforma- tions.');
    for(const table of blocks.filter(b=>b.kind==='table'))expect(table.text).not.toMatch(/digits \(0 to 9\)|but with 30 latent variables/u);
    expect(blocks.some(b=>b.text.includes('handwritten digits (0 to 9)'))).toBe(true);
    expect(blocks.some(b=>b.text.includes('but with 30 latent variables')&&b.kind!=='table')).toBe(true);
    const continued=blocks.find(b=>b.text.startsWith('In figure 3(a)'))!;
    expect(continued.text).toContain('for four cases, which show distributions');
    expect(continued.text).toContain('typically-used posterior approximations.');
    expect(continued.text).not.toMatch(/K\s*=|PF PF|RF RF/u);
    expect(continued.sourceRegions).toHaveLength(2);
    const nice=blocks.find(b=>b.text.startsWith('The Non-linear Independent Components'))!;
    expect(nice.visualUnits?.flatMap(unit=>unit.equationNumbers)).toEqual(['16','17','18','19']);
    expect(nice.visualUnits!.length).toBeGreaterThan(1);
    expect(nice.visualUnits).toHaveLength(2);expect(nice.visualUnits!.some(unit=>/vec-\s*$/u.test(unit.text))).toBe(false);
    for(const number of ['15','20']){
      const owner=blocks.find(b=>b.sourceEquations?.some(r=>r.number===number))!;
      expect(owner.kind).toBe('formula');expect(owner.text).toContain(`(${number})`);
    }
    expect(rows.find(row=>row.number==='15')!.rowCount).toBe(4);
    expect(rows.find(row=>row.number==='20')!.rowCount).toBe(3);
  });
});
