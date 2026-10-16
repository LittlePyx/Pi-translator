import {describe,it,expect} from 'vitest';
import {buildResearchReferenceIndex,researchReferenceMatches,type ResearchReferenceBlock as Block} from '../core/pdf/research-references';
const equation:Block={id:'equation',pageNumber:2,text:'energy',sourceEquations:[{id:'eq-p2-x90-y200',number:'15',rowHint:'E = mc2'}]};
describe('source-derived research references',()=>{
  it('links explicit references to unique source equation, figure, table and section identities',()=>{
    const blocks:Block[]=[equation,{id:'figure',pageNumber:3,kind:'figure',text:'Figure 2. The result.'},{id:'table',pageNumber:4,kind:'table',text:'Table 1: Results'},{id:'section',pageNumber:5,text:'3.1 Method',headingLevel:2}];
    const index=buildResearchReferenceIndex(blocks),text='参见式（15）所示、图 2、表 1，以及 Section 3.1. Eq. (15) agrees. 详见第 3.1 节。';
    const found=researchReferenceMatches(text,index);
    expect(found.map(m=>m.target.blockId)).toEqual(['equation','figure','table','section','equation','section']);
    expect(found.map(m=>text.slice(m.start,m.end).trim())).toEqual(['式（15）','图 2','表 1','Section 3.1','Eq. (15)','第 3.1 节']);
    expect(blocks[0]).toEqual(equation);
  });
  it('does not guess ambiguous ownership, excluded targets, references in prose, or untyped headings',()=>{
    expect(buildResearchReferenceIndex([equation,{...equation,id:'other'}]).size).toBe(0);
    const index=buildResearchReferenceIndex([{...equation,included:false},{id:'body',text:'Figure 3 is discussed here.',pageNumber:1},{id:'body2',text:'3 Method',pageNumber:1}]);
    expect(index.size).toBe(0);
    expect(buildResearchReferenceIndex([{id:'fig',kind:'table',pageNumber:1,text:'Figure 3. Example.'}]).size).toBe(0);
  });
  it('keeps numeric citations, unknown targets, ranges, code identifiers and partial labels as plain text',()=>{
    const index=buildResearchReferenceIndex([equation]);
    for(const text of ['(15) [15]','Eq. (16)','Eqs. (15)–(17)','Equations (15) and (16)','Eq15foo','file_Eq15','公式 15、16'])expect(researchReferenceMatches(text,index),text).toEqual([]);
  });
  it('can read verified saved equation identities without inferring a figure from translation',()=>{
    const saved:Block={id:'saved',pageNumber:2,text:'',formulaDocument:{version:1,sourceTemplate:'{{m1}}',translationTemplate:'{{m1}}',issues:[],formulas:[{id:'m1',latex:'E=mc^2',display:true,sourceEquationId:'eq-p2-x90-y200',equationNumber:'15'}]}};
    expect(researchReferenceMatches('公式（15）',buildResearchReferenceIndex([saved]))).toHaveLength(1);
    saved.formulaDocument!.formulas[0]!.review='无法确认';expect(buildResearchReferenceIndex([saved]).size).toBe(0);
  });
});
