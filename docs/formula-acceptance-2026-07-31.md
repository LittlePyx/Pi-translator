# Pi Translator formula acceptance - 2026-07-31

## Scope

This acceptance run used synthetic academic formulas only. No unpublished paper content was used or stored.

- Model: `qwen3.7-plus-2026-05-26`
- Image source: in-memory Edge screenshots
- Translation path: the production `OpenAiCompatibleTranslator`
- Formula compilation: TeX Live 2022 `pdflatex` with `amsmath` and `amssymb`
- API credentials: read from local environment variables and never written to the repository or report

## Results

| Case | First streamed text | Total time | LaTeX result | Result |
| --- | ---: | ---: | --- | --- |
| Inline equation | 2068 ms | 3296 ms | `E = mc^2` | Pass |
| Integral and fraction | 1373 ms | 3595 ms | `\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}` | Pass |
| Matrix equation | 1408 ms | 3487 ms | `y = \begin{bmatrix} a & b \\ c & d \end{bmatrix} x` | Pass |
| Formula mixed with academic prose | 2168 ms | 5710 ms | `y = \Phi x + n`; `n \sim \mathcal{N}\left(0, \sigma^2 I\right)` | Pass |
| Degraded low-clarity formula | 1484 ms | 3681 ms | `x_{k+1} = x_k - \eta \frac{\partial \mathcal{L}}{\partial x}` | Pass |

- Passed: 5 / 5
- Average first streamed text: 1700 ms
- Average total time: 3954 ms
- Maximum first streamed text: 2168 ms
- Maximum total time: 5710 ms

## Checks applied to every case

- A streamed partial translation arrived before completion.
- `formulaLatex` contained at least one formula.
- Expected mathematical structures were present.
- LaTeX braces were balanced.
- Every returned formula compiled successfully with `pdflatex`.
- The exact same LaTeX formula appeared in recognized source text and translated text.
- Total request time stayed below the acceptance ceiling.

## Browser regression

The same build also passed:

- TypeScript type checking.
- 185 unit tests.
- Production Edge extension build.
- 40 Edge end-to-end tests, including Pi PDF text selection, image-region selection, formula vision routing, LaTeX display, copy action, caching, streaming, and sidebar behavior.

## Repeat the live test

Configure `QWEN_API_KEY`, `QWEN_BASE_URL`, and `QWEN_MODEL` in the local environment, then run:

```powershell
npm run test:live-formula
```

The command prints a JSON report and returns a non-zero exit code when any acceptance check fails.
