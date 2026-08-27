import { describe, expect, it } from 'vitest';
import {
  buildDocumentTranslationExport,
  documentTranslationDownload,
} from '../core/translation/document-export';

describe('document translation export', () => {
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
      pageCount: 0,
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
      pageCount: 2,
      complete: true,
    });
    expect(result.printableHtml).toContain('<h2>第 2 页</h2>');
    expect(result.printableHtml).toContain('完整结果 · 3 段');
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
      pageCount: 0,
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
