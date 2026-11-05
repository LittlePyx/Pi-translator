import {describe,it,expect} from 'vitest';
import {buildCitationExport,type CitationExportFields} from '../core/content/citation-export';
const fields:CitationExportFields={title:'A source & its {evidence}',authors:'Doe, Jane\n研究小组',year:'2026',doi:'https://doi.org/10.1234/source_1',url:'https://example.org/paper'};
describe('confirmed citation exports',()=>{
  it('exports known fields and multiple literal authors with stable distinct BibTeX keys',()=>{
    const text=buildCitationExport(fields,'bibtex');
    expect(text).toContain('title = {A source \\& its \\{evidence\\}}');expect(text).toContain('author = {{Doe, Jane} and {研究小组}}');expect(text).toContain('doi = {10.1234/source\\_1}');
    expect(text).toBe(buildCitationExport({...fields},'bibtex'));expect(text.split('\n')[0]).not.toBe(buildCitationExport({...fields,title:'Another source'},'bibtex').split('\n')[0]);
  });
  it('uses one RIS record, normalized lines and no invented authors or year',()=>{
    const text=buildCitationExport({...fields,authors:'',year:'',title:'Known\nTI  - still title'},'ris');
    expect(text).toContain('TI  - Known TI - still title\r\n');expect(text).not.toContain('\r\nAU  -');expect(text).not.toContain('\r\nPY  -');expect(text.match(/^TY  - /gm)).toHaveLength(1);expect(text.match(/^ER  - /gm)).toHaveLength(1);
  });
  it.each([{year:'20x6'},{doi:'not-doi'},{url:'javascript:alert(1)'},{authors:'Name\u0000Other'},{authors:Array(31).fill('Author').join('\n')},{title:''}])('rejects invalid metadata without changing the input: %j',patch=>{
    const draft={...fields,...patch},before={...draft};expect(()=>buildCitationExport(draft,'ris')).toThrow();expect(draft).toEqual(before);
  });
});
