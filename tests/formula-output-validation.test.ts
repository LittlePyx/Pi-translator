import { describe, expect, it } from 'vitest';
import {
  normalizeVisionLatexText,
  repairCommonVisionLatex,
  reconcileImageFormulaResult,
  validateImageFormulaResult,
} from '../core/translation/formula-output-validation';

describe('vision formula output validation', () => {
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

  it('restores recognized formula bodies locally when the model only drifts in translation', () => {
    const reconciled = reconcileImageFormulaResult({
      recognizedText: 'Source $R=\\frac{a+b}{c}$ and \\[y=Ax.\\]',
      translatedText: '译文 $R=\\frac{a-b}{c}$，以及 \\[y=A x.\\]',
      formulaLatex: ['broken metadata'],
      uncertainSpans: [],
    });

    expect(reconciled.translatedText).toBe('译文 $R=\\frac{a+b}{c}$，以及 \\[y=Ax.\\]');
    expect(reconciled.formulaLatex).toEqual(['R=\\frac{a+b}{c}', 'y=Ax.']);
    expect(validateImageFormulaResult(reconciled).valid).toBe(true);
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
