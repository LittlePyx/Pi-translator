import { describe, expect, it } from 'vitest';
import {
  buildDocumentTranslationExport,
  documentTranslationDownload,
} from '../core/translation/document-export';

describe('document translation export', () => {
  it('preserves source-derived paper roles in complete exports while keeping full publication text',()=>{
    const result=buildDocumentTranslationExport([{sourceText:'Demonstration paper',translatedText:'演示论文',pageNumber:1,paperRole:'title'},{sourceText:'Alice Researcher',translatedText:'Alice Researcher · 演示大学',pageNumber:1,paperRole:'authors'},{sourceText:'DOI: 10.1000/demo',translatedText:'出版信息 DOI: 10.1000/demo',pageNumber:1,paperRole:'publication'}]);
    expect(result.translationMarkdown).toContain('# 演示论文');expect(result.printableHtml).toContain('<h1 class="document-paper-title">演示论文</h1>');expect(result.printableHtml).toContain('data-paper-role="authors"');expect(result.printableHtml).toContain('data-paper-role="publication"');expect(result.translationText).toContain('DOI: 10.1000/demo');expect(result.printableHtml).not.toContain('<details');
  });
  it('preserves source heading levels in Markdown and bilingual HTML without changing plain copy text', () => {
    const result = buildDocumentTranslationExport([
      {sourceText: '3. Related research', translatedText: '3. 相关研究', pageNumber: 3, headingLevel: 1},
      {sourceText: '3.1. Gaussian Processes', translatedText: '3.1. 高斯过程', pageNumber: 3, headingLevel: 2},
      {sourceText: 'A normal paragraph.', translatedText: '普通段落 $f \\sim P$。', pageNumber: 3},
    ]);
    expect(result.translationMarkdown).toContain('### 3. 相关研究\n\n#### 3.1. 高斯过程');
    expect(result.bilingualMarkdown).toContain('### 3. Related research\n\n> ### 3. 相关研究');
    expect(result.printableHtml).toContain('<h2 class="document-section-title">3. 相关研究</h2>');
    expect(result.printableHtml).toContain('<h3 class="document-section-title">3.1. Gaussian Processes</h3>');
    expect(result.translationText).toBe('3. 相关研究\n\n3.1. 高斯过程\n\n普通段落 $f \\sim P$。');
    expect(result.blockCount).toBe(3);
  });

  it('copies only completed blocks and preserves formulas and code', () => {
    const result = buildDocumentTranslationExport([
      {
        sourceText: 'The value is $f(x)=0$.',
        translatedText: '该值为 $f(x)=0$。',
      },
      { sourceText: 'const value = solve();' },
      { sourceText: 'Ignored.', translatedText: '   ' },
      {
        sourceText: 'Use the following code:\r\nconst x = 1;',
        translatedText: '使用以下代码：\r\nconst x = 1;',
      },
    ]);

    expect(result).toMatchObject({
      translationText: '该值为 $f(x)=0$。\n\n使用以下代码：\nconst x = 1;',
      blockCount: 2,
      totalBlockCount: 4,
      missingBlockCount: 2,
      unavailablePageCount: 0,
      contentTruncated: false,
      pageCount: 0,
      embeddedImageCount: 0,
      complete: false,
    });
    expect(result.translationMarkdown).toContain('部分结果：已完成 2/4 段');
    expect(result.translationMarkdown).toContain('$f(x)=0$');
    expect(result.bilingualMarkdown).toContain('The value is $f(x)=0$.');
    expect(result.bilingualMarkdown).toContain('> const x = 1;');
    expect(result.printableHtml).toContain('部分结果 · 已完成 2/4 段');
    expect(result.printableHtml).toContain('$f(x)=0$');
  });

  it('adds compact page boundaries to PDF bilingual Markdown', () => {
    const result = buildDocumentTranslationExport([
      { pageNumber: 2, sourceText: 'First.', translatedText: '第一段。' },
      { pageNumber: 2, sourceText: 'Second.', translatedText: '第二段。' },
      { pageNumber: 5, sourceText: 'Fifth.', translatedText: '第五页。' },
    ]);

    expect(result.translationText).toBe('第一段。\n\n第二段。\n\n第五页。');
    expect(result.translationMarkdown).toBe([
      '## 第 2 页',
      '第一段。',
      '第二段。',
      '## 第 5 页',
      '第五页。',
    ].join('\n\n'));
    expect(result.bilingualMarkdown).toBe([
      '## 第 2 页',
      'First.\n\n> 第一段。',
      'Second.\n\n> 第二段。',
      '## 第 5 页',
      'Fifth.\n\n> 第五页。',
    ].join('\n\n'));
    expect(result).toMatchObject({
      blockCount: 3,
      totalBlockCount: 3,
      missingBlockCount: 0,
      unavailablePageCount: 0,
      contentTruncated: false,
      pageCount: 2,
      complete: true,
    });
    expect(result.printableHtml).toContain('<h2>第 2 页</h2>');
    expect(result.printableHtml).toContain('完整结果 · 3 段');
  });

  it('keeps source-only bibliography entries once in bilingual exports', () => {
    const reference = '[12] A. Author. An Exact Paper Title. CVPR, 2026.';
    const result = buildDocumentTranslationExport([
      { sourceText: 'References', translatedText: '参考文献', pageNumber: 8 },
      {
        sourceText: reference,
        translatedText: reference,
        pageNumber: 8,
        sourceOnly: true,
      },
    ]);

    expect(result.translationText).toContain(reference);
    expect(result.bilingualMarkdown.match(/An Exact Paper Title/gu)).toHaveLength(1);
    expect(result.printableHtml.match(/An Exact Paper Title/gu)).toHaveLength(1);
    expect(result.printableHtml).toContain('class="pair source-only"');
    expect(result).toMatchObject({ complete: true, blockCount: 2, missingBlockCount: 0 });
  });

  it('embeds trusted local PDF page images beside bilingual printable content', () => {
    const result = buildDocumentTranslationExport([{
      pageNumber: 2,
      sourceText: 'Formula E = mc^2.',
      translatedText: '公式 E = mc^2。',
    }], {
      pageImages: [
        { pageNumber: 2, dataUrl: 'data:image/jpeg;base64,AA==' },
        { pageNumber: 3, dataUrl: 'data:image/svg+xml,<svg onload=alert(1)>' },
      ],
    });

    expect(result.printableHtml).toContain(
      '<img src="data:image/jpeg;base64,AA==" alt="原 PDF 第 2 页">',
    );
    expect(result.printableHtml).toContain('class="page-layout"');
    expect(result.printableHtml).toContain('.page-bundle:first-of-type{break-before:auto}');
    expect(result.printableHtml).toContain('.pi-math-inline');
    expect(result.printableHtml).toContain('.pi-math-display');
    expect(result.printableHtml).not.toContain('svg+xml');
    expect(result.printableHtml).not.toContain('onload');
  });

  it('embeds trusted visual crops in bilingual Markdown without bloating pure translation', () => {
    const result = buildDocumentTranslationExport([{
      pageNumber: 6,
      sourceText: 'Figure 6. PSNR comparison.',
      translatedText: '图 6：PSNR 对比。',
      sourceImageDataUrl: 'data:image/png;base64,AA==',
      sourceImageAlt: '原 PDF 第 6 页图表截图',
    }, {
      pageNumber: 6,
      sourceText: 'Unsafe figure.',
      translatedText: '不安全图像。',
      sourceImageDataUrl: 'data:image/svg+xml,<svg onload=alert(1)>',
      sourceImageAlt: 'bad](javascript:alert(1))',
    }]);

    expect(result.embeddedImageCount).toBe(1);
    expect(result.bilingualMarkdown).toContain(
      '![原 PDF 第 6 页图表截图](data:image/png;base64,AA==)',
    );
    expect(result.bilingualMarkdown).toContain('Figure 6. PSNR comparison.');
    expect(result.bilingualMarkdown).toContain('> 图 6：PSNR 对比。');
    expect(result.translationMarkdown).not.toContain('data:image');
    expect(result.bilingualMarkdown).not.toContain('svg+xml');
    expect(result.bilingualMarkdown).not.toContain('javascript:');
  });

  it('returns an empty export when no translation is complete', () => {
    expect(buildDocumentTranslationExport([
      { sourceText: 'Pending.' },
    ])).toMatchObject({
      translationText: '',
      translationMarkdown: '',
      bilingualMarkdown: '',
      blockCount: 0,
      totalBlockCount: 1,
      missingBlockCount: 1,
      unavailablePageCount: 0,
      contentTruncated: false,
      pageCount: 0,
      embeddedImageCount: 0,
      complete: false,
    });
  });

  it('marks an otherwise completed PDF export partial when pages remain unrecognized', () => {
    const result = buildDocumentTranslationExport([{
      pageNumber: 1,
      sourceText: 'Readable page.',
      translatedText: '可读页面。',
    }], { unavailablePageCount: 2 });

    expect(result).toMatchObject({
      blockCount: 1,
      totalBlockCount: 1,
      unavailablePageCount: 2,
      complete: false,
    });
    expect(result.translationMarkdown).toContain('另有 2 页尚未识别');
    expect(result.printableHtml).toContain('另有 2 页尚未识别');
  });

  it('does not call a safety-limited webpage export complete', () => {
    const result = buildDocumentTranslationExport([{
      sourceText: 'Recognized paragraph.',
      translatedText: '已识别段落。',
    }], { contentTruncated: true });

    expect(result).toMatchObject({
      blockCount: 1,
      totalBlockCount: 1,
      contentTruncated: true,
      complete: false,
    });
    expect(result.translationMarkdown).toContain('已完成已识别的 1 段');
    expect(result.translationMarkdown).toContain('页面仍有后续正文超出安全上限');
    expect(result.printableHtml).toContain('页面仍有后续正文超出安全上限');
  });

  it('builds anonymous downloads and escapes untrusted document content in HTML', () => {
    const result = buildDocumentTranslationExport([{
      sourceText: '<img src=x onerror=alert(1)>',
      translatedText: '<script>alert(1)</script> $x^2$',
    }]);
    const markdown = documentTranslationDownload(result, 'bilingual-markdown', 'webpage');
    const html = documentTranslationDownload(result, 'printable-html', 'pdf');

    expect(markdown).toMatchObject({
      filename: 'pi-translator-webpage-bilingual.md',
      mimeType: 'text/markdown;charset=utf-8',
    });
    expect(html.filename).toBe('pi-translator-pdf-bilingual.html');
    expect(html.content).not.toContain('<script>alert(1)</script>');
    expect(html.content).not.toContain('<img src=x');
    expect(html.content).toContain('&lt;script&gt;alert(1)&lt;/script&gt; $x^2$');
    expect(html.content).not.toContain('example.com');
  });
});
