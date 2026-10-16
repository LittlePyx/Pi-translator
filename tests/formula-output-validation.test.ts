import { describe, expect, it } from 'vitest';
import {
  normalizeVisionLatexText,
  repairCommonVisionLatex,
  reconcileImageFormulaResult,
  validateImageFormulaResult,
} from '../core/translation/formula-output-validation';

describe('vision formula output validation', () => {
  it('normalizes registered affiliation superscripts only when all markers match', () => {
    const result={recognizedText:'${}^1$DeepMind, London, UK ${}^2$Imperial College London.',translatedText:'¹DeepMind，伦敦，英国。²帝国理工学院，伦敦。',formulaLatex:['{}^1','{}^2'],uncertainSpans:[]};
    expect(validateImageFormulaResult(reconcileImageFormulaResult(result)).valid).toBe(true);
    expect(validateImageFormulaResult(reconcileImageFormulaResult({...result,translatedText:result.translatedText.replace('²','³')})).valid).toBe(false);
  });
  it('accepts a matching publication ordinal, preserving genuine mathematical powers', () => {
    const result={recognizedText:'Proceedings of the $35^{th}$ International Conference on Machine Learning.',translatedText:'第35届国际机器学习会议论文集。',formulaLatex:['35^{th}'],uncertainSpans:[]};
    expect(validateImageFormulaResult(reconcileImageFormulaResult(result)).valid).toBe(true);
    expect(validateImageFormulaResult(reconcileImageFormulaResult({...result,translatedText:'第36届国际机器学习会议论文集。'})).valid).toBe(false);
    expect(validateImageFormulaResult(reconcileImageFormulaResult({...result,recognizedText:'The variable is $35^{th}$.'})).valid).toBe(false);
  });
  it('matches an exact upright numeric percentage caption label without changing model-name superscripts', () => {
    const original={recognizedText:'Figure 3. Lena at SR = 10%. ISTA-Net$^+$',translatedText:String.raw`图 3. 采样率 $\mathrm{SR} = 10\%$。ISTA-Net$^+$`,formulaLatex:[String.raw`\mathrm{SR} = 10\%`],uncertainSpans:[]};
    expect(validateImageFormulaResult(original).valid).toBe(false);
    const fixed=reconcileImageFormulaResult(original);
    expect(fixed.recognizedText).toContain(String.raw`$\mathrm{SR} = 10\%$`);
    expect(fixed.recognizedText).toContain('ISTA-Net$^+$');
    expect(fixed.translatedText).toBe(original.translatedText);
    expect(validateImageFormulaResult(fixed).valid).toBe(true);
    for(const recognizedText of ['SR = 1%. ISTA-Net$^+$','SR = 10%. SR = 10%. ISTA-Net$^+$','`SR = 10%` ISTA-Net$^+$','https://example.com/SR=10% ISTA-Net$^+$']) {
      expect(reconcileImageFormulaResult({...original,recognizedText}).recognizedText).toBe(recognizedText);
    }
    const differentFont={...original,translatedText:original.translatedText.replace('mathrm','mathbf'),formulaLatex:[String.raw`\mathbf{SR} = 10\%`]};
    expect(reconcileImageFormulaResult(differentFont).recognizedText).toBe(original.recognizedText);
  });
  it('reconciles only identical affiliation superscript markers before the existing formula validation', () => {
    const original = {recognizedText:'${}^1$School of Engineering, Example University ${}^2$Example Institute', translatedText:'¹示例大学工学院 ²示例研究所', formulaLatex:[], uncertainSpans:[]};
    expect(validateImageFormulaResult(original).valid).toBe(false);
    const fixed = reconcileImageFormulaResult(original);
    expect(fixed.recognizedText).toContain('¹School');
    expect(fixed.translatedText).toBe(original.translatedText);
    expect(validateImageFormulaResult(fixed).valid).toBe(true);
    const plainMarkers = reconcileImageFormulaResult({...original,translatedText:'1示例大学工学院 2示例研究所'});
    expect(plainMarkers.translatedText).toBe(original.translatedText);
    expect(validateImageFormulaResult(plainMarkers).valid).toBe(true);
    for (const translatedText of ['²示例大学工学院 ¹示例研究所', '¹示例大学工学院', '¹示例大学工学院 ³示例研究所']) {
      expect(validateImageFormulaResult(reconcileImageFormulaResult({...original,translatedText})).valid).toBe(false);
    }
    const isotope = {...original, recognizedText:'${}^{14}$C remains measurable.', translatedText:'¹⁴C 可以测量。'};
    expect(validateImageFormulaResult(reconcileImageFormulaResult(isotope)).valid).toBe(false);
  });
  const channelFormula = String.raw`\mathrm{C-SA}(F) = F * \mathrm{Sigmoid}(\mathrm{ReLU}(\mathrm{GAP}(F)W_{1})W_{2}),\tag{17}`;
  const channelPlain = 'C-SA(F) = F * Sigmoid(ReLU(GAP(F)W_1)W_2), (17)';

  it('replaces the plain equation 17 in place instead of appending a second copy', () => {
    const result = reconcileImageFormulaResult({
      recognizedText: `\\[${channelFormula}\\]`, translatedText: channelPlain,
      formulaLatex: [channelFormula], uncertainSpans: [],
    });
    expect(result.translatedText).toBe(`\\[${channelFormula}\\]`);
    expect(validateImageFormulaResult(result).valid).toBe(true);
  });

  it.each([true, false])('removes only an adjacent equivalent plain equation (before=%s)', (before) => {
    const math = `\\[${channelFormula}\\]`;
    const text = before ? `${channelPlain}\n${math}` : `${math}\n${channelPlain}`;
    expect(normalizeVisionLatexText(text)).toBe(math);
  });

  it('does not append math when an ambiguous plain equation already exists', () => {
    const result = reconcileImageFormulaResult({
      recognizedText: String.raw`\[x=\frac{a}{b}\tag{1}\]`,
      translatedText: 'x = a / b, (1)', formulaLatex: [String.raw`x=\frac{a}{b}\tag{1}`], uncertainSpans: [],
    });
    expect(result.translatedText).toBe('x = a / b, (1)');
    expect(validateImageFormulaResult(result).valid).toBe(false);
  });

  it.each([
    'C-SA(F) = F * Sigmoid(ReLU(GAP(F)W_1)W_3), (17)',
    'C-SA(F) = F * Sigmoid(ReLU(GAP(F)W_1)W_2), (18)',
    '说明 C-SA(F) = F * Sigmoid(ReLU(GAP(F)W_1)W_2), (17)',
  ])('does not erase a different formula, equation number, or explanatory sentence: %s', (line) => {
    const text = `${line}\n\\[${channelFormula}\\]`;
    expect(normalizeVisionLatexText(text)).toBe(text);
  });

  it('keeps surrounding whitespace when no duplicate is present', () => {
    expect(normalizeVisionLatexText('  before\n\\[x=y\\]\nafter  '))
      .toBe('  before\n\\[x=y\\]\nafter  ');
  });

  it('repairs common OCR pseudo-TeX commands without another model request', () => {
    expect(repairCommonVisionLatex(String.raw`\textbbQ_{\textOmega}=\textPi_{\texttau}`))
      .toBe(String.raw`\mathbb{Q}_{\Omega}=\Pi_{\tau}`);
    const result = reconcileImageFormulaResult({
      recognizedText: String.raw`where $\textbbQ_{\textOmega}=\textPi_{\texttau}$`,
      translatedText: String.raw`其中 $\textbbQ_{\textOmega}=\textPi_{\texttau}$`,
      formulaLatex: [String.raw`\textbbQ_{\textOmega}=\textPi_{\texttau}`],
      uncertainSpans: [],
    });
    expect(result.formulaLatex).toEqual([String.raw`\mathbb{Q}_{\Omega}=\Pi_{\tau}`]);
    expect(result.translatedText).toContain(String.raw`$\mathbb{Q}_{\Omega}=\Pi_{\tau}$`);
  });

  it('repairs deterministic bare font pseudo commands only inside formulae', () => {
    expect(repairCommonVisionLatex(
      String.raw`mathbbQ_\Omega+\mathbbR+mathbfQ+\mathbfA+mathrm{d}x+mathrm d x`,
    )).toBe(
      String.raw`\mathbb{Q}_\Omega+\mathbb{R}+\mathbf{Q}+\mathbf{A}+\mathrm{d}x+\mathrm{d} x`,
    );
    expect(repairCommonVisionLatex(String.raw`xmathbbQ+2mathbfQ`))
      .toBe(String.raw`xmathbbQ+2mathbfQ`);

    const mixed = String.raw`正文 mathbbQ 与 C:\\Users 不应修改；公式 $mathbbQ_\Omega$。`;
    expect(normalizeVisionLatexText(mixed))
      .toBe(String.raw`正文 mathbbQ 与 C:\\Users 不应修改；公式 $\mathbb{Q}_\Omega$。`);
  });

  it('normalizes double-escaped vision commands for rendering and source copy', () => {
    const result = reconcileImageFormulaResult({
      recognizedText: String.raw`where $\\\\mathbb{Q}_\\Omega\\$ and C:\\papers remains literal`,
      translatedText: String.raw`其中 $\\\\mathbb{Q}_\\Omega\\$，且 C:\\papers 保持原样`,
      formulaLatex: [String.raw`\\\\mathbb{Q}_\\Omega\\`],
      uncertainSpans: [],
    });

    expect(result.recognizedText)
      .toBe(String.raw`where $\mathbb{Q}_\Omega$ and C:\\papers remains literal`);
    expect(result.translatedText)
      .toBe(String.raw`其中 $\mathbb{Q}_\Omega$，且 C:\\papers 保持原样`);
    expect(result.formulaLatex).toEqual([String.raw`\mathbb{Q}_\Omega`]);
    expect(validateImageFormulaResult(result)).toEqual({ valid: true, issues: [] });
  });

  it('normalizes paired double-escaped display delimiters locally', () => {
    const result = reconcileImageFormulaResult({
      recognizedText: String.raw`see \\[\\boldsymbol{x}=\\mathbf{A}\\boldsymbol{y},\\tag{8}\\]`,
      translatedText: String.raw`见 \\[\\boldsymbol{x}=\\mathbf{A}\\boldsymbol{y},\\tag{8}\\]`,
      formulaLatex: [String.raw`\\boldsymbol{x}=\\mathbf{A}\\boldsymbol{y},\\tag{8}`],
      uncertainSpans: [],
    });

    expect(result.recognizedText)
      .toBe(String.raw`see \[\boldsymbol{x}=\mathbf{A}\boldsymbol{y},\tag{8}\]`);
    expect(result.formulaLatex)
      .toEqual([String.raw`\boldsymbol{x}=\mathbf{A}\boldsymbol{y},\tag{8}`]);
    expect(validateImageFormulaResult(result)).toEqual({ valid: true, issues: [] });
  });

  it('removes both outer dollars around an over-escaped display delimiter', () => {
    const text = String.raw`before $\\[\\mathbb{Q}_\\Omega=Q\\]$ after`;
    expect(normalizeVisionLatexText(text))
      .toBe(String.raw`before \[\mathbb{Q}_\Omega=Q\] after`);

    const result = reconcileImageFormulaResult({
      recognizedText: text,
      translatedText: String.raw`之前 $\\[\\mathbb{Q}_\\Omega=Q\\]$ 之后`,
      formulaLatex: [String.raw`\\mathbb{Q}_\\Omega=Q`],
      uncertainSpans: [],
    });
    expect(validateImageFormulaResult(result)).toEqual({ valid: true, issues: [] });
  });

  it('repairs repeated command slashes and a redundant dollar after a display closer', () => {
    const result = reconcileImageFormulaResult({
      recognizedText: String.raw`see \\[\\\\mathbb{Q}_\\\Omega=Q\\]$`,
      translatedText: String.raw`见 \\[\\\\mathbb{Q}_\\\Omega=Q\\]$`,
      formulaLatex: [String.raw`\\\\mathbb{Q}_\\\Omega=Q`],
      uncertainSpans: [],
    });

    expect(result.recognizedText).toBe(String.raw`see \[\mathbb{Q}_\Omega=Q\]`);
    expect(result.translatedText).toBe(String.raw`见 \[\mathbb{Q}_\Omega=Q\]`);
    expect(result.formulaLatex).toEqual([String.raw`\mathbb{Q}_\Omega=Q`]);
    expect(validateImageFormulaResult(result)).toEqual({ valid: true, issues: [] });
  });

  it('preserves legal row separators in cases and aligned environments', () => {
    const cases = String.raw`\begin{cases}a,&x>0\\b,&x\le 0\end{cases}`;
    const aligned = String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`;
    expect(repairCommonVisionLatex(cases)).toBe(cases);
    expect(repairCommonVisionLatex(aligned)).toBe(aligned);
  });

  it('uses the same row protection for every matrix environment and substack', () => {
    const formulae = [
      String.raw`\begin{Bmatrix}a\\b\end{Bmatrix}`,
      String.raw`\begin{smallmatrix}a\\b\end{smallmatrix}`,
      String.raw`\begin{vmatrix}a\\b\end{vmatrix}`,
      String.raw`\begin{Vmatrix}a\\b\end{Vmatrix}`,
      String.raw`\substack{a\\b}`,
    ];
    for (const formula of formulae) expect(repairCommonVisionLatex(formula)).toBe(formula);
  });

  it('does not mistake ordinary row text for an over-escaped command', () => {
    const formula = String.raw`\begin{cases}a,&x>0\\otherwise,&x\le0\end{cases}`;
    expect(repairCommonVisionLatex(formula)).toBe(formula);
  });

  it('reattaches a visible trailing equation number as a LaTeX tag locally', () => {
    const result = reconcileImageFormulaResult({
      recognizedText: String.raw`where \[x=y\] (8)`,
      translatedText: String.raw`其中 \[x=y\] (8)`,
      formulaLatex: ['x=y'],
      uncertainSpans: [],
    });
    expect(result.recognizedText).toBe(String.raw`where \[x=y\tag{8}\]`);
    expect(result.translatedText).toBe(String.raw`其中 \[x=y\tag{8}\]`);
    expect(result.formulaLatex).toEqual([String.raw`x=y\tag{8}`]);
  });

  it('removes a duplicated visible number when the formula already contains the same tag', () => {
    const result = reconcileImageFormulaResult({
      recognizedText: String.raw`where \[x=y\tag{8}\] (8)`,
      translatedText: String.raw`其中 \[x=y\tag{8}\] (8)`,
      formulaLatex: [String.raw`x=y\tag{8}`],
      uncertainSpans: [],
    });
    expect(result.recognizedText).toBe(String.raw`where \[x=y\tag{8}\]`);
    expect(result.translatedText).toBe(String.raw`其中 \[x=y\tag{8}\]`);
    expect(result.formulaLatex).toEqual([String.raw`x=y\tag{8}`]);
  });

  it.each([
    [String.raw`$x=y$`, String.raw`\[x=y\]`],
    [String.raw`$$x=y$$`, String.raw`\[x=y\]`],
    [String.raw`\(x=y\)`, String.raw`\[x=y\]`],
  ])('promotes a standalone %s formula to display math', (source, expected) => {
    expect(normalizeVisionLatexText(`before\n${source}\nafter`))
      .toBe(`before\n${expected}\nafter`);
  });

  it.each([
    [String.raw`$x=y$ ( 8 )`, String.raw`\[x=y\tag{8}\]`],
    ['$$x=y$$\n\uFF08 8 \uFF09', String.raw`\[x=y\tag{8}\]`],
    ['\\(x=y\\) \uFF08 8 \uFF09', String.raw`\[x=y\tag{8}\]`],
  ])('absorbs a spaced ASCII or fullwidth equation number from %s', (source, expected) => {
    expect(normalizeVisionLatexText(`before\n${source}\nafter`))
      .toBe(`before\n${expected}\nafter`);
  });

  it('leaves an inline prose formula inline', () => {
    const source = String.raw`The objective is $x=y$ in this sentence.`;
    expect(normalizeVisionLatexText(source)).toBe(source);
  });

  it.each([
    [
      String.raw`\arg\min P\in\mathcal{P}(V,\Omega)\left\{KL(P\|Q)\right\}`,
      String.raw`\operatorname*{arg\,min}_{P\in\mathcal{P}(V,\Omega)}\left\{KL(P\|Q)\right\}`,
    ],
    [
      String.raw`\operatorname{argmin}P\in P(V,\Omega)\left\{KL(P\|Q)\right\}`,
      String.raw`\operatorname*{arg\,min}_{P\in P(V,\Omega)}\left\{KL(P\|Q)\right\}`,
    ],
    [
      String.raw`\mathrm{arg\,min} P\in\mathcal P(V,\Omega)\bigl\{F(P)\bigr\}`,
      String.raw`\operatorname*{arg\,min}_{P\in\mathcal{P}(V,\Omega)}\bigl\{F(P)\bigr\}`,
    ],
    [
      String.raw`\text{argmax}x∈\mathbb{R}\{f(x)\}`,
      String.raw`\operatorname*{arg\,max}_{x∈\mathbb{R}}\{f(x)\}`,
    ],
    [
      String.raw`argmin P\in\mathcal{P}(V,\Omega) \{F(P)\}`,
      String.raw`\operatorname*{arg\,min}_{P\in\mathcal{P}(V,\Omega)} \{F(P)\}`,
    ],
    [
      String.raw`\argmin P\in P(V,\Omega)\left\{F(P)\right\}`,
      String.raw`\operatorname*{arg\,min}_{P\in P(V,\Omega)}\left\{F(P)\right\}`,
    ],
    [
      String.raw`\mathop{\rm argmin}P\in P(V,\Omega)\left\{F(P)\right\}`,
      String.raw`\operatorname*{arg\,min}_{P\in P(V,\Omega)}\left\{F(P)\right\}`,
    ],
    [
      String.raw`\mathop{\mathrm{argmax}}x∈\mathbb{R}\biggl\{F(x)\biggr\}`,
      String.raw`\operatorname*{arg\,max}_{x∈\mathbb{R}}\biggl\{F(x)\biggr\}`,
    ],
    [
      String.raw`{\rm argmin}P\in\mathcal{P}(V,\Omega)\{F(P)\}`,
      String.raw`\operatorname*{arg\,min}_{P\in\mathcal{P}(V,\Omega)}\{F(P)\}`,
    ],
  ])('repairs a missing optimization lower limit in %s', (source, expected) => {
    expect(repairCommonVisionLatex(source)).toBe(expected);
  });

  it('preserves an existing optimization lower limit and an ambiguous expression', () => {
    const correct = String.raw`\arg\min_{P\in\mathcal{P}(V,\Omega)} KL(P\|Q)`;
    const canonical = String.raw`\operatorname*{arg\,min}_{P\in\mathcal{P}(V,\Omega)} KL(P\|Q)`;
    const wrapped = String.raw`\operatorname{argmin}_{P\in\mathcal{P}(V,\Omega)} KL(P\|Q)`;
    const compact = String.raw`\argmin_{P\in\mathcal{P}(V,\Omega)} KL(P\|Q)`;
    const mathop = String.raw`\mathop{\rm argmin}_{P\in\mathcal{P}(V,\Omega)} KL(P\|Q)`;
    const mathopCanonical = String.raw`\operatorname*{arg\,min}_{P\in\mathcal{P}(V,\Omega)} KL(P\|Q)`;
    const explicitLimits = String.raw`\mathop{\rm argmin}\limits_{P\in\mathcal{P}(V,\Omega)} KL(P\|Q)`;
    const underset = String.raw`\underset{P\in\mathcal{P}(V,\Omega)}{\operatorname{argmin}} KL(P\|Q)`;
    const ambiguous = String.raw`\arg\min P+Q`;
    const compactAmbiguous = String.raw`\argmin P+Q`;
    const missingObjective = String.raw`\operatorname{argmin}P\in\mathcal{P}(V,\Omega)`;
    const prose = String.raw`margin P\in\mathcal{P}(V,\Omega)\{F(P)\}`;
    expect(repairCommonVisionLatex(correct)).toBe(canonical);
    expect(repairCommonVisionLatex(wrapped)).toBe(canonical);
    expect(repairCommonVisionLatex(compact)).toBe(canonical);
    expect(repairCommonVisionLatex(mathop)).toBe(mathopCanonical);
    expect(repairCommonVisionLatex(explicitLimits)).toBe(explicitLimits);
    expect(repairCommonVisionLatex(underset)).toBe(underset);
    expect(repairCommonVisionLatex(canonical)).toBe(canonical);
    expect(repairCommonVisionLatex(ambiguous)).toBe(ambiguous);
    expect(repairCommonVisionLatex(compactAmbiguous)).toBe(compactAmbiguous);
    expect(repairCommonVisionLatex(missingObjective)).toBe(missingObjective);
    expect(repairCommonVisionLatex(prose)).toBe(prose);
  });

  it('normalizes promoted numbered optimization formulae idempotently', () => {
    const source = [
      'before',
      String.raw`$\arg\min P\in\mathcal{P}(V,\Omega)\left\{KL(P\|Q)\right\}$`,
      '\uFF08 8 \uFF09',
      'after',
    ].join('\n');
    const normalized = normalizeVisionLatexText(source);
    expect(normalized).toContain(String.raw`\operatorname*{arg\,min}_{P\in\mathcal{P}(V,\Omega)}`);
    expect(normalized).toContain(String.raw`\tag{8}`);
    expect(normalizeVisionLatexText(normalized)).toBe(normalized);
  });

  it('accepts matching, structurally valid LaTeX', () => {
    expect(validateImageFormulaResult({
      recognizedText: 'Energy is $E=mc^2$ and \\[R=\\frac{a+b}{c}.\\]',
      translatedText: '能量为 $E = mc^2$，且 \\[R = \\frac{a+b}{c}.\\]',
      formulaLatex: ['E=mc^2', 'R=\\frac{a+b}{c}.'],
      uncertainSpans: [],
    })).toEqual({ valid: true, issues: [] });
  });

  it('detects broken braces and formula drift', () => {
    const validation = validateImageFormulaResult({
      recognizedText: 'Source $R=\\frac{a+b}{c}$',
      translatedText: '译文 $R=\\frac{a-b}{c}$',
      formulaLatex: ['R=\\frac{a+b{c}'],
      uncertainSpans: [],
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContain('识别原文与译文中的公式不一致');
    expect(validation.issues.some((issue) => issue.includes('没有闭合'))).toBe(true);
  });

  it('rejects delimiters and mismatched environments in formulaLatex', () => {
    const validation = validateImageFormulaResult({
      recognizedText: '\\[x+y\\]',
      translatedText: '\\[x+y\\]',
      formulaLatex: ['$x+y$', '\\begin{matrix}a&b\\end{pmatrix}'],
      uncertainSpans: [],
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContain('formulaLatex 不应包含公式分隔符');
    expect(validation.issues.some((issue) => issue.includes('没有正确配对'))).toBe(true);
  });

  it('accepts ordinary image translations with no formula', () => {
    expect(validateImageFormulaResult({
      recognizedText: 'Plain source.',
      translatedText: '普通译文。',
      formulaLatex: [],
      uncertainSpans: [],
    }).valid).toBe(true);
  });

  it('does not overwrite different formula bodies merely because counts match', () => {
    const reconciled = reconcileImageFormulaResult({
      recognizedText: 'Source $R=\\frac{a+b}{c}$ and \\[y=Ax.\\]',
      translatedText: '译文 $R=\\frac{a-b}{c}$，以及 \\[y=A x.\\]',
      formulaLatex: ['broken metadata'],
      uncertainSpans: [],
    });

    expect(reconciled.translatedText).toBe('译文 $R=\\frac{a-b}{c}$，以及 \\[y=A x.\\]');
    expect(reconciled.formulaLatex).toEqual(['broken metadata']);
    expect(validateImageFormulaResult(reconciled).valid).toBe(false);
  });

  it('restores safe recognized formulae when the model omits every formula from translation', () => {
    const reconciled = reconcileImageFormulaResult({
      recognizedText: [
        'The linear system is',
        String.raw`\[y = \left[ \begin{array}{cc} a & b \\ c & d \end{array} \right] x\]`,
      ].join('\n'),
      translatedText: '该线性系统为',
      formulaLatex: [String.raw`y = \left[ \begin{array}{cc} a & b \\ c & d \end{array} \right] x`],
      uncertainSpans: [],
    });

    expect(reconciled.translatedText).toBe([
      '该线性系统为',
      String.raw`\[y = \left[ \begin{array}{cc} a & b \\ c & d \end{array} \right] x\]`,
    ].join('\n'));
    expect(reconciled.formulaLatex).toEqual([
      String.raw`y = \left[ \begin{array}{cc} a & b \\ c & d \end{array} \right] x`,
    ]);
    expect(validateImageFormulaResult(reconciled).valid).toBe(true);
  });

  it('does not move omitted inline formulae to the end of a translation', () => {
    const reconciled = reconcileImageFormulaResult({
      recognizedText: 'Given $x$, derive $y$ from the observation.',
      translatedText: '给定变量，并由观测推导结果。',
      formulaLatex: ['x', 'y'],
      uncertainSpans: [],
    });

    expect(reconciled.translatedText).toBe('给定变量，并由观测推导结果。');
    expect(validateImageFormulaResult(reconciled).valid).toBe(false);
  });

  it('does not duplicate an undelimited trailing display formula', () => {
    const reconciled = reconcileImageFormulaResult({
      recognizedText: 'The result is\n\\[y=Ax\\]',
      translatedText: '结果为 y=Ax',
      formulaLatex: ['y=Ax'],
      uncertainSpans: [],
    });

    expect(reconciled.translatedText).toBe('结果为 y=Ax');
    expect(validateImageFormulaResult(reconciled).valid).toBe(false);
  });

  it('accepts a dense academic paragraph with fractions, norms, tags, and bold symbols', () => {
    const recognizedText = [
      'Sampling ratio $\\frac{M}{N}$ with $M \\| N$.',
      '\\[\\boldsymbol{y}=\\mathbf{A}\\boldsymbol{x},\\tag{1}\\]',
      'Estimate $\\hat{\\boldsymbol{x}}$ by',
      '\\[\\hat{\\boldsymbol{x}}=\\arg \\min_{\\boldsymbol{x}} \\frac{1}{2}\\|\\boldsymbol{y}-\\mathbf{A}\\boldsymbol{x}\\|_2^2+\\lambda\\mathcal{R}(\\boldsymbol{x}),\\tag{2}\\]',
    ].join('\n');
    const result = reconcileImageFormulaResult({
      recognizedText,
      translatedText: [
        '采样率为 $\\frac{M}{N}$，其中 $M \\| N$。',
        '\\[\\boldsymbol{y} = \\mathbf{A} \\boldsymbol{x}, \\tag{1}\\]',
        '通过下式估计 $\\hat{\\boldsymbol{x}}$：',
        '\\[\\hat{\\boldsymbol{x}} = \\arg\\min_{\\boldsymbol{x}} \\frac{1}{2} \\|\\boldsymbol{y}-\\mathbf{A}\\boldsymbol{x}\\|_2^2 + \\lambda \\mathcal{R}(\\boldsymbol{x}), \\tag{2}\\]',
      ].join('\n'),
      formulaLatex: [],
      uncertainSpans: [],
    });

    expect(validateImageFormulaResult(result)).toEqual({ valid: true, issues: [] });
    expect(result.formulaLatex).toHaveLength(5);
  });
});
