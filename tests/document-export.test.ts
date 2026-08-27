import { describe, expect, it } from 'vitest';
import { buildDocumentTranslationExport } from '../core/translation/document-export';

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

    expect(result).toEqual({
      translationText: '该值为 $f(x)=0$。\n\n使用以下代码：\nconst x = 1;',
      bilingualMarkdown: [
        'The value is $f(x)=0$.\n\n> 该值为 $f(x)=0$。',
        'Use the following code:\nconst x = 1;\n\n> 使用以下代码：\n> const x = 1;',
      ].join('\n\n'),
      blockCount: 2,
      pageCount: 0,
    });
  });

  it('adds compact page boundaries to PDF bilingual Markdown', () => {
    const result = buildDocumentTranslationExport([
      { pageNumber: 2, sourceText: 'First.', translatedText: '第一段。' },
      { pageNumber: 2, sourceText: 'Second.', translatedText: '第二段。' },
      { pageNumber: 5, sourceText: 'Fifth.', translatedText: '第五页。' },
    ]);

    expect(result.translationText).toBe('第一段。\n\n第二段。\n\n第五页。');
    expect(result.bilingualMarkdown).toBe([
      '## 第 2 页',
      'First.\n\n> 第一段。',
      'Second.\n\n> 第二段。',
      '## 第 5 页',
      'Fifth.\n\n> 第五页。',
    ].join('\n\n'));
    expect(result).toMatchObject({ blockCount: 3, pageCount: 2 });
  });

  it('returns an empty export when no translation is complete', () => {
    expect(buildDocumentTranslationExport([
      { sourceText: 'Pending.' },
    ])).toEqual({
      translationText: '',
      bilingualMarkdown: '',
      blockCount: 0,
      pageCount: 0,
    });
  });
});
