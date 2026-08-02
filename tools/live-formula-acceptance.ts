import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { OpenAiCompatibleTranslator } from '../core/translation/openai-compatible-translator';

const execFileAsync = promisify(execFile);
const edgeExecutable = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

interface FormulaCase {
  name: string;
  markup: string;
  recognizedTextHint?: string;
  expected: RegExp[];
}

const cases: FormulaCase[] = [
  {
    name: '行内公式',
    markup: `
      <p>Einstein's mass-energy relation
        <math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math>
        is invariant.
      </p>`,
    recognizedTextHint: 'Einstein mass-energy relation E = mc2 is invariant.',
    expected: [/E\s*=/u, /mc|m\s*c/u],
  },
  {
    name: '积分与分式',
    markup: `
      <p>The Gaussian integral is</p>
      <math display="block">
        <msubsup><mo>∫</mo><mn>0</mn><mo>∞</mo></msubsup>
        <msup><mi>e</mi><mrow><mo>−</mo><msup><mi>x</mi><mn>2</mn></msup></mrow></msup>
        <mi>d</mi><mi>x</mi><mo>=</mo>
        <mfrac><msqrt><mi>π</mi></msqrt><mn>2</mn></mfrac>
      </math>`,
    recognizedTextHint: 'The Gaussian integral from 0 to infinity equals square root pi over 2.',
    expected: [/\\int/u, /\\(?:sqrt|frac)/u],
  },
  {
    name: '矩阵公式',
    markup: `
      <p>The linear system is</p>
      <math display="block">
        <mi>y</mi><mo>=</mo>
        <mrow><mo>[</mo><mtable>
          <mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr>
          <mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr>
        </mtable><mo>]</mo></mrow>
        <mi>x</mi>
      </math>`,
    expected: [/\\begin\{(?:bmatrix|pmatrix|matrix|array)\}/u, /y\s*=/u],
  },
  {
    name: '公式与学术句子混排',
    markup: `
      <p>The measurements obey
        <math><mi>y</mi><mo>=</mo><mi>Φ</mi><mi>x</mi><mo>+</mo><mi>n</mi></math>,
        where <math><mi>n</mi><mo>∼</mo><mi>𝒩</mi><mo>(</mo><mn>0</mn><mo>,</mo><msup><mi>σ</mi><mn>2</mn></msup><mi>I</mi><mo>)</mo></math>.
      </p>`,
    recognizedTextHint: 'The measurements obey y = Phi x + n, where n follows N(0, sigma2 I).',
    expected: [/\\Phi|\\phi|Φ/u, /\\sigma|σ/u],
  },
  {
    name: '低清晰度扫描公式',
    markup: `
      <div class="degraded">
        <p>The update rule is</p>
        <math display="block">
          <msub><mi>x</mi><mrow><mi>k</mi><mo>+</mo><mn>1</mn></mrow></msub>
          <mo>=</mo><msub><mi>x</mi><mi>k</mi></msub><mo>−</mo>
          <mi>η</mi><mfrac><mrow><mo>∂</mo><mi>ℒ</mi></mrow><mrow><mo>∂</mo><mi>x</mi></mrow></mfrac>
        </math>
      </div>`,
    expected: [/\\frac/u, /\\partial/u],
  },
];

function pageHtml(markup: string): string {
  return `<!doctype html>
    <html>
      <head>
        <style>
          html,body{margin:0;background:#eef2f7;color:#172033}
          body{padding:40px;font:24px/1.6 Georgia,"Times New Roman",serif}
          #capture{width:820px;min-height:170px;box-sizing:border-box;padding:28px 34px;background:#fff;border:1px solid #d7deea}
          p{margin:0 0 14px}
          math{font-size:1.2em}
          math[display="block"]{margin:18px auto}
          .degraded{filter:blur(.65px);opacity:.72;transform:scale(.96);transform-origin:left top}
        </style>
      </head>
      <body><section id="capture">${markup}</section></body>
    </html>`;
}

function balancedBraces(source: string): boolean {
  let depth = 0;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

async function compilesWithPdfLatex(formula: string): Promise<boolean> {
  const directory = await mkdtemp(path.join(tmpdir(), 'pi-formula-'));
  const texPath = path.join(directory, 'formula.tex');
  const document = String.raw`\documentclass{article}
\usepackage{amsmath,amssymb}
\pagestyle{empty}
\begin{document}
\[
${formula}
\]
\end{document}
`;
  try {
    await writeFile(texPath, document, 'utf8');
    await execFileAsync(
      'C:\\texlive\\2022\\bin\\win32\\pdflatex.exe',
      ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', directory, texPath],
      { cwd: directory, windowsHide: true, timeout: 30_000 },
    );
    return true;
  } catch {
    return false;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.QWEN_API_KEY?.trim();
  const apiBaseUrl = process.env.QWEN_BASE_URL?.trim();
  const model = process.env.QWEN_MODEL?.trim();
  if (!apiKey || !apiBaseUrl || !model) {
    throw new Error('QWEN_API_KEY, QWEN_BASE_URL, and QWEN_MODEL must be configured.');
  }

  const browserInstance = await chromium.launch({
    executablePath: edgeExecutable,
    headless: true,
  });
  const context = await browserInstance.newContext({
    viewport: { width: 960, height: 420 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const translator = new OpenAiCompatibleTranslator();
  const results: Array<{
    name: string;
    passed: boolean;
    ttftMs?: number;
    totalMs: number;
    formulas: string[];
    checks: Record<string, boolean>;
    error?: string;
  }> = [];

  try {
    for (const testCase of cases) {
      try {
        await page.setContent(pageHtml(testCase.markup), { waitUntil: 'load' });
        const capture = page.locator('#capture');
        const bounds = await capture.boundingBox();
        if (!bounds) throw new Error('Unable to measure formula fixture.');
        const png = await capture.screenshot({ type: 'png' });
        const startedAt = performance.now();
        let firstPartialAt: number | undefined;
        const output = await translator.translateImageRegion(
          {
            imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
            imageWidth: Math.round(bounds.width * 2),
            imageHeight: Math.round(bounds.height * 2),
            ...(testCase.recognizedTextHint
              ? { recognizedTextHint: testCase.recognizedTextHint }
              : {}),
          },
          {
            model,
            sourceLanguage: 'auto',
            targetLanguage: 'zh-CN',
            style: 'academic',
          },
          { apiKey, apiBaseUrl },
          new AbortController().signal,
          {
            onPartialText: (partialText) => {
              if (partialText && firstPartialAt === undefined) {
                firstPartialAt = performance.now();
              }
            },
          },
        );
        const totalMs = Math.round(performance.now() - startedAt);
        const formulas = output.formulaLatex;
        const compiled = await Promise.all(formulas.map(compilesWithPdfLatex));
        const formulaCorpus = formulas.join('\n');
        const checks = {
          streamed: firstPartialAt !== undefined,
          hasFormulaLatex: formulas.length > 0,
          expectedStructure: testCase.expected.every((pattern) => pattern.test(formulaCorpus)),
          balanced: formulas.every(balancedBraces),
          compilable: formulas.length > 0 && compiled.every(Boolean),
          formulaConsistent: formulas.length > 0 && formulas.every(
            (formula) =>
              output.recognizedText.includes(formula) &&
              output.translatedText.includes(formula),
          ),
          boundedLatency: totalMs < 120_000,
        };
        results.push({
          name: testCase.name,
          passed: Object.values(checks).every(Boolean),
          ...(firstPartialAt === undefined
            ? {}
            : { ttftMs: Math.round(firstPartialAt - startedAt) }),
          totalMs,
          formulas,
          checks,
        });
      } catch (error) {
        results.push({
          name: testCase.name,
          passed: false,
          totalMs: 0,
          formulas: [],
          checks: {},
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await browserInstance.close();
  }

  console.log(JSON.stringify({ model, results }, null, 2));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

await main();
