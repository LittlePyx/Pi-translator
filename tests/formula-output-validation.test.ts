import { describe, expect, it } from 'vitest';
import {
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
