import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  normalizeVisionLatexText,
  reconcileImageFormulaResult,
  validateImageFormulaResult,
} from '../core/translation/formula-output-validation';
import {
  latexRenderParts,
  splitLatexDisplaySegments,
} from '../core/translation/latex-display';
import { renderLatexMathMl } from '../core/translation/latex-mathml';
import type { ProviderImageTranslationResult } from '../core/translation/types';

// This is an original, synthetic fixture. It mirrors the layout hazards of a
// dense academic PDF without copying any paper text or pixels: detached and
// nested equation numbers, blackboard-bold symbols, and optimizer limits.
const EQUATION_EIGHT = String.raw`\mathbb{Q}^{\Pi^*}(\mathrm{d}Z)
:=\pi^*(Z_\tau)\mathbb{Q}(\mathrm{d}Z),\tag{8}`;

const VARIATIONAL_EQUATIONS = String.raw`\begin{aligned}
\mathbb{Q}^{\Pi^*}
&=\operatorname*{arg\,min}_{\mathbb{P}\in\mathcal{P}(V,\Omega)}
\left\{\mathrm{KL}(\mathbb{P}\Vert\mathbb{Q})
:=\mathbb{E}_{\mathbb{P}}\left[\log\frac{\mathrm{d}\mathbb{P}}{\mathrm{d}\mathbb{Q}}(Z)\right],
\quad \mathrm{s.t.}\ \mathbb{P}_{\Omega}=\Pi^*\right\}\tag{12}\\
&=\operatorname*{arg\,min}_{\mathbb{P}\in\mathcal{P}(V,\Omega)}
\left\{\mathrm{KL}(\mathbb{P}\Vert\mathbb{Q}^{\Pi^*})
\equiv\mathrm{KL}(\mathbb{P}\Vert\mathbb{Q})
-\mathbb{E}_{\mathbb{P}}[\log\pi^*(Z_\tau)]\right\}\tag{13}
\end{aligned}`;

const SYNTHETIC_RESULT: ProviderImageTranslationResult = {
  recognizedText: [
    'A synthetic transform identity is',
    `\\[${EQUATION_EIGHT}\\]`,
    'A synthetic constrained objective is',
    `\\[${VARIATIONAL_EQUATIONS}\\]`,
  ].join('\n'),
  translatedText: [
    'The locally translated transform identity is',
    `\\[${EQUATION_EIGHT}\\]`,
    'The locally translated constrained objective is',
    `\\[${VARIATIONAL_EQUATIONS}\\]`,
  ].join('\n'),
  formulaLatex: [EQUATION_EIGHT, VARIATIONAL_EQUATIONS],
  uncertainSpans: [],
};

interface FormulaPipelineOutput {
  result: ProviderImageTranslationResult;
  validation: ReturnType<typeof validateImageFormulaResult>;
  rendered: Array<{
    equationTag?: string;
    html: string;
  }>;
}

function runLocalFormulaPipeline(): FormulaPipelineOutput {
  const normalized: ProviderImageTranslationResult = {
    ...SYNTHETIC_RESULT,
    recognizedText: normalizeVisionLatexText(SYNTHETIC_RESULT.recognizedText),
    translatedText: normalizeVisionLatexText(SYNTHETIC_RESULT.translatedText),
  };
  const result = reconcileImageFormulaResult(normalized);
  const validation = validateImageFormulaResult(result);
  const rendered = splitLatexDisplaySegments(result.translatedText)
    .filter((segment) => segment.kind === 'math')
    .map((segment) => {
      if (segment.kind !== 'math') throw new Error('Expected a math segment.');
      const parts = latexRenderParts(segment.tex, segment.displayMode);
      const html = renderLatexMathMl(parts.tex, segment.displayMode);
      if (!html) throw new Error('Synthetic benchmark formula did not render.');
      return {
        ...(parts.equationTag ? { equationTag: parts.equationTag } : {}),
        html,
      };
    });
  return { result, validation, rendered };
}

describe('offline academic formula performance regression', () => {
  it('preserves optimizer layout, equation numbers, and blackboard-bold semantics', () => {
    const output = runLocalFormulaPipeline();

    expect(output.validation).toEqual({ valid: true, issues: [] });
    expect(output.result.formulaLatex).toEqual([
      EQUATION_EIGHT,
      VARIATIONAL_EQUATIONS,
    ]);
    expect(output.rendered).toHaveLength(2);
    expect(output.rendered[0]?.equationTag).toBe('8');

    const identityHtml = output.rendered[0]?.html ?? '';
    expect(identityHtml).toContain('mathvariant="double-struck">Q</mi>');

    const variationalHtml = output.rendered[1]?.html ?? '';
    expect(variationalHtml).toContain('<munder>');
    expect(variationalHtml).not.toContain('<msub><mo>arg');
    expect(variationalHtml).toContain('mathvariant="double-struck">P</mi>');
    expect(variationalHtml).toContain('mathvariant="double-struck">Q</mi>');
    expect(variationalHtml).toContain('mathvariant="double-struck">E</mi>');
    expect(variationalHtml).toContain('<mtext>(12)</mtext>');
    expect(variationalHtml).toContain('<mtext>(13)</mtext>');
  });

  it('keeps the complete local formula path below a generous CI budget', () => {
    // These are regression tripwires rather than product latency claims. The
    // budgets are intentionally much wider than the normal millisecond-scale
    // runtime so a busy Windows CI runner does not fail spuriously, while a
    // newly introduced multi-second local stall is still caught.
    const coldStartedAt = performance.now();
    const cold = runLocalFormulaPipeline();
    const coldElapsedMs = performance.now() - coldStartedAt;
    expect(cold.validation.valid).toBe(true);
    expect(coldElapsedMs).toBeLessThan(500);

    const iterations = 40;
    const warmStartedAt = performance.now();
    let renderedBytes = 0;
    for (let index = 0; index < iterations; index += 1) {
      const output = runLocalFormulaPipeline();
      if (!output.validation.valid) throw new Error('Formula validation regressed.');
      renderedBytes += output.rendered.reduce((total, item) => total + item.html.length, 0);
    }
    const warmElapsedMs = performance.now() - warmStartedAt;

    expect(renderedBytes).toBeGreaterThan(0);
    expect(warmElapsedMs).toBeLessThan(1_000);
  });
});
