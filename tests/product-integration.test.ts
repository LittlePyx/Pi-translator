import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {readGlossaryFile,writeGlossaryFile,planGlossaryImport} from '../core/translation/glossary-transfer';
import {formatGlossaryEntries,parseGlossaryText} from '../core/translation/glossary';
import {normalizeLibraryOrganization,mergeLibraryOrganization,updateLibraryOrganization,LIBRARY_ORGANIZATION_KEY} from '../core/translation/library-organization';
import {normalizePdfAreaNotes,mergePdfAreaNotes,mutatePdfAreaNote,PDF_AREA_NOTES_KEY,type PdfAreaNote} from '../core/pdf/area-note-repository';
import {exportDocumentLibraryBackup,previewDocumentLibraryBackup,importDocumentLibraryBackup} from '../core/translation/document-library-backup';
import {crossrefCitationMetadata,pageCitationMetadata} from '../core/content/citation-metadata';
import {buildResearchExport} from '../core/content/research-export';
import {listResearchExcerpts,type ResearchExcerpt} from '../core/content/research-excerpt-repository';
import {rotatePdfViewRect} from '../core/pdf/reader-view';

let data:Record<string,unknown>,writes:Record<string,unknown>[];
const documentId='a'.repeat(32);
const area:PdfAreaNote={id:'area-1',sourceTitle:'Exact paper',note:'人工区域笔记',anchor:{kind:'region',pageNumber:2,leftRatio:.2,topRatio:.3,widthRatio:.4,heightRatio:.1},createdAt:1,updatedAt:2};
beforeEach(()=>{data={};writes=[];vi.stubGlobal('browser',{storage:{local:{get:vi.fn(async(keys?:string|string[])=>{if(!keys)return structuredClone(data);return Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(key=>key in data).map(key=>[key,structuredClone(data[key])]))}),set:vi.fn(async(value:Record<string,unknown>)=>{writes.push(structuredClone(value));Object.assign(data,structuredClone(value))})}}})});
afterEach(()=>vi.unstubAllGlobals());

describe('integrated research features use exact saved content (offline)',()=>{
  it('round trips quoted CSV/TSV and delimiter-bearing terms through the actual settings editor',()=>{
    const rows=readGlossaryFile('"a,b","甲,乙"\n"x=y","a=>b"',',');expect(rows).toEqual([{source:'a,b',target:'甲,乙'},{source:'x=y',target:'a=>b'}]);
    expect(readGlossaryFile(writeGlossaryFile(rows),'\t')).toEqual(rows);expect(parseGlossaryText(formatGlossaryEntries(rows))).toEqual({entries:rows,errors:[]});
  });
  it('rejects duplicate, malformed, oversized and extra-column imports without truncation',()=>{
    for(const value of ['A,one\na,two','a,b,c','"a,b','a,','a,b"'])expect(()=>readGlossaryFile(value,',')).toThrow();
    expect(()=>readGlossaryFile('a,b\n'.repeat(101),',')).toThrow();expect(()=>readGlossaryFile('a'.repeat(100001),',')).toThrow();expect(writes).toEqual([]);
  });
  it('keeps local terminology on conflict and rejects aggregate overflow',()=>{
    const current=[{source:'Domain',target:'人工用词'}],plan=planGlossaryImport(current,[{source:'domain',target:'模型候选'},{source:'new',target:'新增'}]);
    expect(plan.rows.map(row=>row.status)).toEqual(['conflict','added']);expect(plan.entries[0]).toEqual(current[0]);
    expect(()=>planGlossaryImport(Array.from({length:100},(_,i)=>({source:`term-${i}`,target:'词'})),[{source:'extra',target:'超出'}])).toThrow('100');
  });
  it('validates tag quota, rejects conflicting equal versions, and preserves newer local metadata',()=>{
    const local={tags:{note:{tags:['课题 A'],updatedAt:10}},views:{}};
    expect(mergeLibraryOrganization(local,{tags:{note:{tags:[],updatedAt:2}},views:{}})).toEqual(local);
    expect(()=>mergeLibraryOrganization(local,{tags:{note:{tags:['不同'],updatedAt:10}},views:{}})).toThrow('冲突');
    expect(()=>normalizeLibraryOrganization({tags:{note:{tags:Array.from({length:13},(_,i)=>String(i)),updatedAt:1}},views:{}})).toThrow();
  });
  it('refuses a stale cross-window tag edit without touching any stored work',async()=>{
    data[LIBRARY_ORGANIZATION_KEY]={tags:{note:{tags:['新'],updatedAt:9}},views:{}};const before=structuredClone(data);
    await expect(updateLibraryOrganization('tags','note',{tags:['旧窗口'],updatedAt:10},{tags:['旧'],updatedAt:1})).rejects.toThrow('其他窗口');expect(data).toEqual(before);expect(writes).toEqual([]);
  });
  it('does not mistake __proto__ tag identities for object prototypes',()=>{
    const input=JSON.parse('{"tags":{"__proto__":{"tags":["safe"],"updatedAt":1}},"views":{}}');
    const result=normalizeLibraryOrganization(input);expect(Object.keys(result.tags)).toEqual(['__proto__']);expect(Object.getPrototypeOf(result.tags)).toBe(Object.prototype);
  });
  it('keeps normalized area coordinates across all rotations and rejects changed source anchors',()=>{
    for(const rotation of [0,90,180,270]){const rect=rotatePdfViewRect(rotatePdfViewRect(area.anchor,rotation),-rotation);for(const key of ['leftRatio','topRatio','widthRatio','heightRatio'] as const)expect(rect[key]).toBeCloseTo(area.anchor[key],8)}
    const value={[documentId]:{notes:[area],updatedAt:2}};expect(normalizePdfAreaNotes(value)).toEqual(value);
    expect(()=>mergePdfAreaNotes(value,{[documentId]:{notes:[{...area,anchor:{...area.anchor,pageNumber:3},updatedAt:3}],updatedAt:3}})).toThrow('来源冲突');
    expect(()=>mergePdfAreaNotes(value,{[documentId]:{notes:[{...area,note:'外部较新记录不能覆盖人工笔记',updatedAt:99}],updatedAt:99}})).toThrow('冲突');
    expect(()=>normalizePdfAreaNotes({[documentId]:{notes:[{...area,anchor:{...area.anchor,widthRatio:2}}],updatedAt:3}})).toThrow();
  });
  it('does not overwrite or delete a changed area note',async()=>{
    data[PDF_AREA_NOTES_KEY]={[documentId]:{notes:[{...area,note:'较新的人工内容',updatedAt:9}],updatedAt:9}};const before=structuredClone(data);
    await expect(mutatePdfAreaNote(documentId,undefined,area)).rejects.toThrow('其他窗口');expect(data).toEqual(before);expect(writes).toEqual([]);
  });
  it('exports legacy version 4 when no new fields exist, and version 8 only when needed',async()=>{
    expect(JSON.parse(await exportDocumentLibraryBackup()).version).toBe(4);
    data[LIBRARY_ORGANIZATION_KEY]={tags:{note:{tags:['课题 A'],updatedAt:2}},views:{}};
    data[PDF_AREA_NOTES_KEY]={[documentId]:{notes:[area],updatedAt:2}};
    const backup=JSON.parse(await exportDocumentLibraryBackup());expect(backup.version).toBe(8);expect(backup.areaNotes).toEqual(data[PDF_AREA_NOTES_KEY]);
    expect(backup.libraryOrganization).toEqual(data[LIBRARY_ORGANIZATION_KEY]);expect(writes).toEqual([]);
  });
  it('previews advanced backup without writes and restores tags, views and area notes in the existing one-write commit',async()=>{
    data[LIBRARY_ORGANIZATION_KEY]={tags:{note:{tags:['课题 A'],updatedAt:2}},views:{view:{name:'课题笔记',query:'evidence',kind:'excerpt',tag:'课题 A',updatedAt:2}}};data[PDF_AREA_NOTES_KEY]={[documentId]:{notes:[area],updatedAt:2}};
    const expected=structuredClone(data),backup=await exportDocumentLibraryBackup();data={};const preview=await previewDocumentLibraryBackup(backup);expect(preview.organizationItems).toBe(2);expect(preview.areaNotes).toBe(1);expect(data).toEqual({});expect(writes).toEqual([]);
    await importDocumentLibraryBackup(backup,preview.token);expect(data[LIBRARY_ORGANIZATION_KEY]).toEqual(expected[LIBRARY_ORGANIZATION_KEY]);expect(data[PDF_AREA_NOTES_KEY]).toEqual(expected[PDF_AREA_NOTES_KEY]);expect(writes).toHaveLength(1);
  });
  it('blocks stale metadata preview and a falsely labelled legacy backup before all writes',async()=>{
    const backup=JSON.parse(await exportDocumentLibraryBackup());backup.version=8;backup.areaNotes={[documentId]:{notes:[area],updatedAt:2}};const text=JSON.stringify(backup),preview=await previewDocumentLibraryBackup(text);
    data[LIBRARY_ORGANIZATION_KEY]={tags:{note:{tags:['其他窗口'],updatedAt:9}},views:{}};
    await expect(importDocumentLibraryBackup(text,preview.token)).rejects.toThrow('已变化');expect(writes).toEqual([]);
    backup.version=7;await expect(previewDocumentLibraryBackup(JSON.stringify(backup))).rejects.toThrow('版本 8');expect(writes).toEqual([]);
  });
  it('imports a legacy backup without resetting advanced local notes or tags',async()=>{
    const legacy=await exportDocumentLibraryBackup();data[LIBRARY_ORGANIZATION_KEY]={tags:{note:{tags:['人工标签'],updatedAt:3}},views:{}};data[PDF_AREA_NOTES_KEY]={[documentId]:{notes:[area],updatedAt:2}};const expected=structuredClone(data);
    const preview=await previewDocumentLibraryBackup(legacy);await importDocumentLibraryBackup(legacy,preview.token);expect(data[PDF_AREA_NOTES_KEY]).toEqual(expected[PDF_AREA_NOTES_KEY]);expect(data[LIBRARY_ORGANIZATION_KEY]).toEqual(expected[LIBRARY_ORGANIZATION_KEY]);
  });
  it('presents region-only notes as region records without inventing source text or translations',async()=>{
    data[PDF_AREA_NOTES_KEY]={[documentId]:{notes:[area],updatedAt:2}};const records=await listResearchExcerpts();expect(records).toHaveLength(1);expect(records[0]!.content.originalText).toBe('');expect(records[0]!.content.translatedText).toBeUndefined();expect(records[0]!.content.note).toBe(area.note);expect(()=>buildResearchExport(records,'anki')).toThrow('短词');
  });
  it('exports actual contextual words, skips long notes explicitly, and preserves formulas in Markdown',()=>{
    const word:ResearchExcerpt={id:'word',markerId:'word',kind:'web',updatedAt:2,content:{sourceTitle:'Exact source',originalText:'evidence',translatedText:'证据',note:'我的笔记'},item:{markerId:'word',pageUrl:'https://example.org/paper',anchor:{sourceText:'evidence',prefix:'The ',suffix:' is clear.'},content:{sourceTitle:'Exact source',originalText:'evidence',translatedText:'证据'},createdAt:1,updatedAt:2}};
    const long={...word,id:'long',content:{...word.content,originalText:'This is a full sentence with an exact equation $x_i=2$.',translatedText:'保留 $x_i=2$。'}};
    const exported=buildResearchExport([word,long],'anki');expect(exported.included).toBe(1);expect(exported.excluded).toBe(1);expect(exported.text).toContain('"The evidence is clear."');expect(exported.text).toContain('https://example.org/paper');
    const basic=buildResearchExport([{...word,content:{...word.content,note:'"quoted"\n<script>test</script> [sound:test.mp3]'}}],'anki-basic');expect(basic.text).toContain('#notetype:Basic\n#columns:Front\tBack');expect(basic.text).toContain('#html:true');expect(basic.text).toContain('Context fragment: The evidence is clear.');expect(basic.text).toContain('&quot;quoted&quot;<br>&lt;script&gt;test&lt;/script&gt; &#91;sound:test.mp3&#93;');expect(basic.text).not.toContain('<script>');expect(basic.text).toContain('<a href=""https://example.org/paper"">');expect(basic.included).toBe(1);
    expect(buildResearchExport([{...word,item:{...word.item,anchor:{sourceText:'evidence',prefix:'pre',suffix:'based'}}}],'anki').text).toContain('"preevidencebased"');
    const markdown=buildResearchExport([word,long],'obsidian');expect(markdown.text).toContain('type: research-excerpts');expect(markdown.text).toContain('$x_i=2$');expect(markdown.text.match(/# Pi Translator 标记笔记/gu)).toHaveLength(1);expect(writes).toEqual([]);
  });
  it('accepts only the requested Crossref DOI and actual publication year, leaving unknown authors blank',()=>{
    expect(()=>crossrefCitationMetadata({message:{DOI:'10.1234/other'}},'10.1234/paper')).toThrow('不符');expect(()=>crossrefCitationMetadata({message:{}},'bad')).toThrow();
    expect(crossrefCitationMetadata({message:{DOI:'10.1234/paper',title:['Exact title'],created:{'date-parts':[[2026]]},author:[{}]}},'10.1234/paper')).toEqual({title:'Exact title',doi:'10.1234/paper'});
    expect(crossrefCitationMetadata({message:{DOI:'10.1234/paper',published:{'date-parts':[[2024,3]]},author:[{family:'Doe',given:'Jane'}]}},'10.1234/paper')).toEqual({doi:'10.1234/paper',year:'2024',authors:'Doe, Jane'});
  });
});
