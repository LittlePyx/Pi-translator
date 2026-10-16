import { describe, expect, it } from 'vitest';
import { bindPdfEquationNumbers } from '../core/pdf/equation-binding';
import { compactFormulaDocument, formulaDocumentIssues, formulaDocumentText, isFormulaDocument, parseFormulaDocument } from '../core/translation/formula-document';
import { pdfBackgroundVisualOutcome } from '../core/pdf/background-document-translation';
import { sourceEquationsForRegion } from '../core/pdf/source-equations';
import { validSourceEquations, type SourceEquation } from '../core/translation/source-equations';
import { readLocalPdfLayout } from './support/local-pdf-layout';

const sources: SourceEquation[] = [1, 2, 3, 4].map((n) => ({ id: `eq-p2-x45002-y${n}000`, number: String(n),
  rowHint: `x_${n}=y`, ...(n >= 3 ? { groupId: 'eq-p2-x45002-y3000' } : {}) }));
const makeDoc = () => parseFormulaDocument({ formulas: sources.map((source, i) => ({
  id: `m${i + 1}`, latex: `x_${i + 1}=y`, display: true, sourceEquationId: source.id,
})), recognizedText: '{{m1}} {{m2}} {{m3}} {{m4}}', translation: '得到以下线性系统和优化更新：{{m1}} {{m2}} {{m3}} {{m4}}' });

describe('PDF source-owned equation numbers', () => {
  const combinedRows = () => parseFormulaDocument({ formulas: [{ id: 'm1', display: true,
    sourceEquationId: sources[2]!.id, latex: String.raw`\left\{\begin{aligned}x_3&=y\\x_4&=y\end{aligned}\right.` }],
    recognizedText: '{{m1}}', translation: '更新：{{m1}}' });
  it('splits independently numbered rows by unique local identities, preserving a shared brace', () => {
    const doc = combinedRows();
    const bound = bindPdfEquationNumbers(doc, [...sources].reverse());
    expect(bound.issues).toEqual([]);
    expect(bound.formulas.map((entry) => entry.equationNumber)).toEqual(['3', '4']);
    expect(bound.formulas.map((entry) => entry.equationGroupId)).toEqual([sources[2]!.groupId, sources[2]!.groupId]);
    expect(bound.formulas.map((entry) => entry.latex)).toEqual(['x_3=y', 'x_4=y']);
    expect(isFormulaDocument(compactFormulaDocument(bound))).toBe(true);
    expect(formulaDocumentIssues(bound)).toEqual([]);
    expect(doc.formulas).toHaveLength(1);
  });
  it.each(['missing-row', 'duplicate-row', 'unknown-row', 'uncertain', 'repeated-reference', 'already-claimed'])(
    'refuses to invent independent row bindings: %s', (mode) => {
      const doc = combinedRows();
      if (mode === 'missing-row') doc.formulas[0]!.latex = String.raw`\begin{aligned}x_3=y\\q=z\end{aligned}`;
      if (mode === 'duplicate-row') doc.formulas[0]!.latex = String.raw`\begin{aligned}x_3=y\\x_3=y\end{aligned}`;
      if (mode === 'unknown-row') doc.formulas[0]!.latex = String.raw`\begin{aligned}x_3=y\\q_4=y\end{aligned}`;
      if (mode === 'uncertain') doc.formulas[0]!.review = '待核对';
      if (mode === 'repeated-reference') doc.translationTemplate += '{{m1}}';
      if (mode === 'already-claimed') doc.formulas.push({ id: 'm2', latex: 'x_4=y', display: true, sourceEquationId: sources[3]!.id });
      const bound = bindPdfEquationNumbers(doc, sources);
      expect(bound.formulas[0]!.equationNumber).toBeUndefined();
      expect(bound.issues.join()).toContain('无法可靠逐行对应');
    });
  it('splits bold variable rows by local identity without dropping their mathematical typography', () => {
    const doc = combinedRows();
    doc.formulas[0]!.latex = String.raw`\begin{cases}\boldsymbol{x}_3=y\\\mathbf{x}_4=y\end{cases}`;
    const bound = bindPdfEquationNumbers(doc, sources);
    expect(bound.formulas.map(entry => entry.equationNumber)).toEqual(['3','4']);
    expect(bound.formulas.map(entry => entry.latex)).toEqual([String.raw`\boldsymbol{x}_3=y`, String.raw`\mathbf{x}_4=y`]);
    expect(formulaDocumentIssues(bound)).toEqual([]);
    const uncertain = structuredClone(doc); uncertain.formulas[0]!.review = '模型标记为无法确认';
    expect(bindPdfEquationNumbers(uncertain, sources).formulas[0]!.equationNumber).toBeUndefined();
  });
  it('does not split a multirow formula that genuinely shares label 15', () => {
    const doc = combinedRows(); doc.formulas[0]!.sourceEquationId = 'eq-p5-x45000-y30000';
    const bound = bindPdfEquationNumbers(doc, [{ id: 'eq-p5-x45000-y30000', number: '15', rowHint: 'x = y', rowCount: 2 }]);
    expect(bound.formulas).toHaveLength(1);
    expect(bound.formulas[0]!.equationNumber).toBe('15');
  });
  it('recovers adjacent independent rows when the PDF text layer lost the visible brace identity', () => {
    const rows: SourceEquation[] = [
      {id:'eq-p3-x86468-y83890',number:'10',rowHint:'Z k = X k − 1 + ρ Φ ( Y − Φ X ) Ψ'},
      {id:'eq-p3-x86468-y85777',number:'11',rowHint:'X k = D ( θ,k ) ( Z k )'},
    ];
    const doc = parseFormulaDocument({formulas:[{id:'m1',display:true,sourceEquationId:rows[0]!.id,
      latex:String.raw`\begin{cases}\mathbf{Z}_k=\mathbf{X}_{k-1}+\rho\Phi(Y-\Phi X)\Psi\\\mathbf{X}_k=\mathcal{D}_{(\theta,k)}(\mathbf{Z}_k)\end{cases}`}],recognizedText:'{{m1}}',translation:'更新为：{{m1}}'});
    const bound=bindPdfEquationNumbers(doc,rows);
    expect(bound.formulas.map(entry=>entry.equationNumber)).toEqual(['10','11']);
    expect(bound.formulas[0]!.equationGroupId).toBe(rows[0]!.id);
    expect(rows.every(row=>!row.groupId)).toBe(true);
    const distant=structuredClone(rows);distant[1]!.id='eq-p3-x86468-y95777';
    expect(bindPdfEquationNumbers(doc,distant).formulas).toHaveLength(1);
    const intervening: SourceEquation = {id:'eq-p3-x86468-y84800',number:'12',rowHint:'E h = softmax E l = softmax',rowCount:2};
    expect(bindPdfEquationNumbers(doc,[...rows,intervening]).formulas).toHaveLength(1);
    const foreign=structuredClone(doc);foreign.formulas[0]!.sourceEquationId='eq-p9-x123-y456';
    expect(bindPdfEquationNumbers(foreign,rows).formulas[0]!.equationNumber).toBeUndefined();
  });
  it('uses a unique legacy tag as an anchor for a grouped response without source IDs', () => {
    const doc=combinedRows();delete doc.formulas[0]!.sourceEquationId;doc.formulas[0]!.latex+=String.raw`\tag{3}`;
    expect(bindPdfEquationNumbers(doc,sources).formulas.map(entry=>entry.equationNumber)).toEqual(['3','4']);
  });
  const sharedSource: SourceEquation[] = [{ id: 'eq-p5-x45000-y30000', number: '15', rowHint: 'Eh = softmax El = softmax', rowCount: 2 }];
  const splitRows = () => parseFormulaDocument({ formulas: [
    { id: 'm1', latex: 'E^h=Q^h', display: true, sourceEquationId: sharedSource[0]!.id },
    { id: 'm2', latex: 'E^l=Q^l', display: true, sourceEquationId: sharedSource[0]!.id },
  ], recognizedText: '{{m1}}\n{{m2}}', translation: '{{m1}}\n{{m2}}' });

  it('joins two adjacent rows with one locally verified printed label, preserving both formulas', () => {
    const doc = splitRows(); doc.formulas.reverse();
    const bound = bindPdfEquationNumbers(doc, sharedSource);
    expect(bound.issues).toEqual([]);
    expect(bound.formulas).toHaveLength(1);
    expect(bound.formulas[0]!.latex).toBe(String.raw`\begin{gathered}E^h=Q^h\\E^l=Q^l\end{gathered}`);
    expect(formulaDocumentText(bound).match(/tag\{15\}/gu)).toHaveLength(1);
    expect(isFormulaDocument(compactFormulaDocument(bound))).toBe(true);
    expect(formulaDocumentIssues(bound)).toEqual([]);
    expect(doc.formulas).toHaveLength(2);
  });
  it('flags a final summand bound alone to a locally verified multirow equation, without changing saved LaTeX',()=>{
    const doc=splitRows();doc.formulas.pop();doc.sourceTemplate='{{m1}}';doc.translationTemplate='{{m1}}';
    const bound=bindPdfEquationNumbers(doc,sharedSource);
    expect(bound.issues.join()).toContain('多行推导未完整合组');expect(bound.formulas[0]!.latex).toBe(doc.formulas[0]!.latex);expect(doc.formulas[0]!.sourceEquationId).toBe(sharedSource[0]!.id);
  });

  it.each(['single-row', 'duplicate', 'duplicate-punctuation', 'reordered', 'prose-between', 'uncertain', 'repeated', 'wrong-tag'])(
    'does not merge ambiguous shared label claims: %s', (mode) => {
      const doc = splitRows(); const source = structuredClone(sharedSource);
      if (mode === 'single-row') delete source[0]!.rowCount;
      if (mode === 'duplicate') doc.formulas[1]!.latex = doc.formulas[0]!.latex;
      if (mode === 'duplicate-punctuation') doc.formulas[1]!.latex = `${doc.formulas[0]!.latex},`;
      if (mode === 'reordered') doc.translationTemplate = '{{m2}} {{m1}}';
      if (mode === 'prose-between') doc.translationTemplate = '{{m1}} another paragraph {{m2}}';
      if (mode === 'uncertain') doc.formulas[1]!.review = '模型标记为无法确认';
      if (mode === 'repeated') doc.translationTemplate += ' {{m1}}';
      if (mode === 'wrong-tag') doc.formulas[1]!.latex += String.raw`\tag{16}`;
      const bound = bindPdfEquationNumbers(doc, source);
      expect(bound.formulas).toHaveLength(2);
      expect(bound.formulas.every((entry) => !entry.equationNumber)).toBe(true);
      expect(bound.issues.join()).toContain('冲突');
    });
  it('restores all four labels with no model tags and never changes the math', () => {
    const doc = makeDoc(), bound = bindPdfEquationNumbers(doc, sources);
    expect(doc.formulas.every((entry) => !entry.equationNumber)).toBe(true);
    expect(bound.formulas.map((entry) => entry.equationNumber)).toEqual(['1', '2', '3', '4']);
    expect(bound.formulas.map((entry) => entry.latex)).toEqual(doc.formulas.map((entry) => entry.latex));
    expect(bound.formulas.slice(2).map((entry) => entry.equationGroupId)).toEqual([sources[2]!.id, sources[2]!.id]);
    const outcome = pdfBackgroundVisualOutcome({ id: 'p', text: 'x=y (1) x=y (2) x=y (3) x=y (4)',
      containsFormula: true, visualPurpose: 'formula', equationNumbers: ['1', '2', '3', '4'], sourceEquations: sources }, { formulaDocument: doc }, 'zh-CN');
    expect(outcome.formulaReviewMessage).toBeUndefined();
    expect(outcome.translatedText.match(/\\tag\{/gu)).toHaveLength(4);
  });
  it('binds by identity after formula-array reordering, not by position', () => {
    const doc = makeDoc(); doc.formulas.reverse();
    const bound = bindPdfEquationNumbers(doc, sources);
    expect(bound.formulas.map((entry) => entry.equationNumber)).toEqual(['4', '3', '2', '1']);
    expect(formulaDocumentText(bound)).toMatch(/tag\{1\}[\s\S]*tag\{2\}[\s\S]*tag\{3\}[\s\S]*tag\{4\}/u);
  });
  it('does not assign missing identities just because formula and label counts match', () => {
    const doc = makeDoc(); doc.formulas.forEach((entry) => delete entry.sourceEquationId);
    expect(bindPdfEquationNumbers(doc, sources).formulas.every((entry) => !entry.equationNumber)).toBe(true);
  });
  it('rejects duplicate, foreign, non-display, repeated-reference and conflicting tag claims', () => {
    const doc = makeDoc();
    doc.formulas[1]!.sourceEquationId = sources[0]!.id;
    doc.formulas[2]!.sourceEquationId = 'eq-p9-x123-y456';
    doc.formulas[3]!.latex += String.raw`\tag{99}`;
    const bound = bindPdfEquationNumbers(doc, sources);
    expect(bound.formulas.every((entry) => !entry.equationNumber)).toBe(true);
    expect(bound.issues.join()).toContain('冲突');
    expect(bound.issues.join()).toContain('无法对应');
    expect(bindPdfEquationNumbers(bound, sources)).toEqual(bound);
    const repeated = makeDoc(); repeated.translationTemplate += ' {{m1}}'; repeated.formulas[1]!.display = false;
    const rejected = bindPdfEquationNumbers(repeated, sources);
    expect(rejected.formulas.slice(0, 2).every((entry) => !entry.equationNumber)).toBe(true);
  });
  it('migrates a unique legacy tag into metadata without displaying it twice', () => {
    const doc = makeDoc();
    delete doc.formulas[0]!.sourceEquationId;
    doc.formulas[0]!.latex += String.raw`\tag{1}`;
    const bound = bindPdfEquationNumbers(doc, sources);
    expect(bound.formulas[0]!.latex).toBe('x_1=y');
    expect(formulaDocumentText(bound).match(/tag\{1\}/gu)).toHaveLength(1);
  });
  it('never clears uncertainty or fixes superscript/subscript differences while restoring a number', () => {
    const doc = makeDoc(); doc.formulas[0]!.latex = 'W^h'; doc.formulas[0]!.review = '模型标记为无法确认';
    const bound = bindPdfEquationNumbers(doc, sources);
    expect(bound.formulas[0]).toMatchObject({ latex: 'W^h', equationNumber: '1', review: '模型标记为无法确认' });
    expect(formulaDocumentIssues(bound).join()).toContain('无法确认');
    expect(formulaDocumentText(bound)).toContain('公式 (1)');
    const outcome = pdfBackgroundVisualOutcome({ id: 'p', text: 'x=y', containsFormula: true, visualPurpose: 'formula',
      equationNumbers: ['1', '2', '3', '4'], sourceEquations: sources }, { formulaDocument: doc }, 'zh-CN');
    expect(outcome.formulaReviewMessage).toContain('无法确认');
    expect(outcome.formulaReviewMessage).not.toContain('未对应原文公式编号');
  });
  it('stores only compact references and verified labels; ignores provider-invented number fields', () => {
    const bound = bindPdfEquationNumbers(makeDoc(), sources);
    const retained = compactFormulaDocument(bound);
    expect(isFormulaDocument(JSON.parse(JSON.stringify(retained)))).toBe(true);
    expect(retained.sourceTemplate).toBe('{{m1}} {{m2}} {{m3}} {{m4}}');
    expect(JSON.stringify(retained)).not.toContain('rowHint');
    const forged = parseFormulaDocument({ formulas: [{ id: 'm1', latex: 'x=y', display: true, equationNumber: '999' }],
      recognizedText: '{{m1}}', translation: '{{m1}}' });
    expect(forged.formulas[0]!.equationNumber).toBeUndefined();
    expect(validSourceEquations([{ ...sources[0], rowHint: 'x'.repeat(501) }])).toBe(false);
    expect(validSourceEquations([sources[0], sources[0]])).toBe(false);
  });
  it('does not interpret a paragraph citation or an out-of-scope label as an equation row', () => {
    const input = { pageNumber: 1, pageWidth: 600, pageHeight: 800, items: [
      { str: 'See Eq.', left: 50, top: 100, width: 300, height: 10 },
      { str: '(3)', left: 450, top: 100, width: 20, height: 10 },
      { str: 'x=y', left: 200, top: 400, width: 100, height: 10 },
      { str: '(4)', left: 450, top: 400, width: 20, height: 10 },
    ] };
    expect(sourceEquationsForRegion(input, { pageNumber: 1, sourceAnchor: { leftRatio: 0, topRatio: 0, widthRatio: .8, heightRatio: .3 } }, ['3', '4'])).toEqual([]);
  });
  it('keeps two complete brace glyphs in distinct groups even when their ink is close',()=>{
    const items=[100,155].map(top=>({str:'(',left:100,top,width:8,height:10,leftBraceInkBounds:{top:top+10,bottom:top+40}}));
    const rows=[110,122,165,177].flatMap((top,i)=>[
      {str:`x_${i+1}=y`,left:125,top,width:80,height:10},
      {str:`(${i+1})`,left:450,top,width:20,height:10},
    ]);
    const source=sourceEquationsForRegion({pageNumber:1,pageWidth:600,pageHeight:800,items:[...items,...rows]},
      {pageNumber:1,sourceAnchor:{leftRatio:0,topRatio:0,widthRatio:1,heightRatio:1}},['1','2','3','4']);
    expect(source.map(row=>row.groupId)).toEqual([source[0]!.id,source[0]!.id,source[2]!.id,source[2]!.id]);
  });
  it('binds a numbered final summand to adjacent display equalities, but stops at prose and other labels',()=>{
    const region={pageNumber:1,sourceAnchor:{leftRatio:0,topRatio:0,widthRatio:1,heightRatio:1}};
    const display=[
      {str:'F(x)=E[log q(z)]',left:60,top:100,width:150,height:10},
      {str:'=E[log q(z)-log p(x,z)]',left:80,top:116,width:170,height:10},
      {str:'−E',left:80,top:142,width:20,height:10},
      {str:'ln |1+u ψ(z)|',left:125,top:142,width:100,height:10},
      {str:'(15)',left:450,top:142,width:20,height:10},
    ];
    const input={pageNumber:1,pageWidth:600,pageHeight:800,items:display};
    expect(sourceEquationsForRegion(input,region,['15']).map(row=>row.number)).toEqual(['15']);
      expect(sourceEquationsForRegion(input,region,['15'])[0]!.rowCount).toBe(3);
    expect(sourceEquationsForRegion({...input,items:[...display,{str:'where we use another definition',left:50,top:130,width:300,height:10}]},region,['15'])).toEqual([]);
    expect(sourceEquationsForRegion({...input,items:[...display,{str:'(14)',left:430,top:130,width:20,height:10}]},region,['15'])).toEqual([]);
  });
  it.runIf(Boolean(process.env.PI_PDF_REGRESSION_SOURCE))('locally binds HATNet labels 1–17 exactly once, including multirow groups', async () => {
    const prepared = await readLocalPdfLayout(process.env.PI_PDF_REGRESSION_SOURCE!);
    const rows = prepared.blocks.flatMap((block) => block.sourceEquations ?? []);
    expect(rows.map((row) => row.number).sort((a, b) => Number(a) - Number(b))).toEqual(Array.from({ length: 17 }, (_, i) => String(i + 1)));
    expect(new Set(rows.map((row) => row.id)).size).toBe(17);
    expect(rows.find((row) => row.number === '3')!.groupId).toBe(rows.find((row) => row.number === '4')!.groupId);
    const ten=rows.find(row=>row.number==='10')!,eleven=rows.find(row=>row.number==='11')!;
    expect(ten.groupId).toBe(ten.id);
    expect(eleven.groupId).toBe(ten.id);
    expect(rows.find((row) => row.number === '16')!.rowHint).toContain('Concat');
    expect(rows.find((row) => row.number === '15')!.rowCount).toBe(2);
    const combined = parseFormulaDocument({ formulas: [{ id: 'm1', display: true,
      sourceEquationId: rows.find((row) => row.number === '3')!.id,
      latex: String.raw`\left\{\begin{aligned}z_k &= x_{k-1}+\rho A^{\top}(y-Ax_{k-1}),\\x_k &= \arg\min_x\frac{1}{2\sigma^2}\|z_k-x\|_2^2+\mathcal{R}(x),\end{aligned}\right.` }],
      recognizedText: '{{m1}}', translation: '更新：{{m1}}' });
    const bound = bindPdfEquationNumbers(combined, rows);
    expect(bound.formulas.map((entry) => entry.equationNumber), JSON.stringify(rows.filter((row) => ['3', '4'].includes(row.number)))).toEqual(['3', '4']);
  });
});
