import { describe, expect, it } from 'vitest';
import { buildPdfLayoutTranslationExport } from '../core/translation/pdf-layout-export';

describe('PDF layout translation export', () => {
  it('prints the paper hierarchy and complete publication details without a disclosure control', () => {
    const result=buildPdfLayoutTranslationExport([
      {id:'title',pageNumber:1,translatedText:'演示论文题名',paperRole:'title'},
      {id:'authors',pageNumber:1,translatedText:'作者 · 演示大学 · author@example.edu',paperRole:'authors'},
      {id:'publication',pageNumber:1,translatedText:'演示期刊 2024. DOI: 10.1000/example',paperRole:'publication'},
    ],[]);
    expect(result.html).toContain('data-paper-role="title"><h1 class="pdf-layout-block-content">演示论文题名</h1>');
    expect(result.html).toContain('data-paper-role="authors"');
    expect(result.html).toContain('data-paper-role="publication"');
    expect(result.html).toContain('DOI: 10.1000/example');
    expect(result.html).not.toContain('<details');
  });
  it('renders explicit source section depths as headings and keeps them out of numbered lists', () => {
    const result = buildPdfLayoutTranslationExport([
      {id: 'h1', pageNumber: 3, translatedText: '3. 相关研究', headingLevel: 1},
      {id: 'h2', pageNumber: 3, translatedText: '3.1. 高斯过程', headingLevel: 2},
      {id: 'h3', pageNumber: 3, translatedText: '3.1.1. 训练', headingLevel: 3},
      {id: 'p', pageNumber: 3, translatedText: '普通正文 $f \\sim P$。'},
      {id: 'next', pageNumber: 3, translatedText: '4. 实验', headingLevel: 1},
    ], []);
    expect(result.html).toContain('<h2 class="pdf-layout-block-content">3. 相关研究</h2>');
    expect(result.html).toContain('<h3 class="pdf-layout-block-content">3.1. 高斯过程</h3>');
    expect(result.html).toContain('<h4 class="pdf-layout-block-content">3.1.1. 训练</h4>');
    expect(result.html).not.toContain('class="pdf-layout-list" data-layout-list');
    expect(result.html).not.toContain('<span>正文</span>');
    expect(result.blockCount).toBe(5);
  });

  it('typesets prose continuously and keeps consecutive list items together without task labels', () => {
    const result = buildPdfLayoutTranslationExport([
      { id: 'p', pageNumber: 1, translatedText: '下面概括这个模型的三个特点。' },
      { id: 'a', pageNumber: 1, translatedText: '1. CNP 建模函数 $f \\sim P$ 的条件分布。' },
      { id: 'b', pageNumber: 1, translatedText: '2. CNP 具有置换不变性。' },
      { id: 'c', pageNumber: 1, translatedText: '3. CNP 的复杂度为 $O(n+m)$。', role: 'formula' },
      { id: 'q', pageNumber: 1, translatedText: '之后继续讨论模型的实现方式。' },
    ], []);
    expect(result.html).toContain('class="pdf-layout-list" data-layout-list');
    expect(result.html).not.toContain('<span>正文</span>');
    expect(result.html).not.toContain('<small>1/5</small>');
    expect(result.html).not.toContain('border-left:2pt solid');
    expect(result.html.indexOf('data-layout-block-id="a"')).toBeLessThan(result.html.indexOf('data-layout-block-id="c"'));
    expect(result.html).toContain('data-layout-block-id="q"');
    expect(result).toMatchObject({ blockCount: 5, complete: true });
  });

  it('does not group section numbers, interrupted lists or repeated item numbers', () => {
    for (const lines of [
      ['2.1. 模型', '2.2. 训练'], ['1. 第一个条目', '普通段落。', '2. 第二个条目'], ['1. 一个条目', '1. 新的列表'],
    ]) {
      const result = buildPdfLayoutTranslationExport(lines.map((translatedText, index) => ({ id: String(index), pageNumber: 1, translatedText })), []);
      expect(result.html).not.toContain('class="pdf-layout-list" data-layout-list');
    }
  });
  it('keeps each trusted source page intact and follows it with a readable translation page', () => {
    const result = buildPdfLayoutTranslationExport([{
      id: 'P2B1',
      pageNumber: 2,
      translatedText: '该方法保持公式 $E=mc^2$。',
      role: 'formula',
      sourceAnchor: {
        leftRatio: .1,
        topRatio: .2,
        widthRatio: .7,
        heightRatio: .12,
      },
    }], [{
      pageNumber: 2,
      dataUrl: 'data:image/jpeg;base64,AA==',
      pageWidth: 612,
      pageHeight: 792,
    }]);

    expect(result).toMatchObject({
      pageCount: 1,
      blockCount: 1,
      complete: true,
    });
    expect(result.html).toContain('@page pi-layout-page-2{size:612pt 792pt;margin:0}');
    expect(result.html).toContain('data-layout-source-page="2"');
    expect(result.html).toContain('data:image/jpeg;base64,AA==');
    expect(result.html).toContain('class="pdf-layout-page pdf-layout-source-page"');
    expect(result.html).toContain('data-layout-translation-page="2"');
    expect(result.html).toContain('data-layout-role="formula"');
    expect(result.html).not.toContain('data-layout-overlay');
    expect(result.html).not.toContain('pdf-layout-mask');
    expect(result.html).toContain('该方法保持公式 $E=mc^2$。');
  });

  it('uses the same page-pair layout when source coordinates are unavailable', () => {
    const result = buildPdfLayoutTranslationExport([{
      id: 'missing-anchor',
      pageNumber: 1,
      translatedText: '这段译文不能安全覆盖原文。',
    }], [{
      pageNumber: 1,
      dataUrl: 'data:image/png;base64,AA==',
      pageWidth: 595,
      pageHeight: 842,
    }]);

    expect(result).toMatchObject({ pageCount: 1, blockCount: 1 });
    expect(result.html).toContain('data-layout-overflow-page="1"');
    expect(result.html).toContain('上一页完整保留原始版式');
    expect(result.html).toContain('这段译文不能安全覆盖原文。');
  });

  it('styles translated footnotes compactly on the matching translation page', () => {
    const result = buildPdfLayoutTranslationExport([{
      id: 'P6-footnote-1',
      pageNumber: 6,
      translatedText: '1 我们使用了作者公开提供的源代码。',
      role: 'footnote',
      sourceAnchor: {
        leftRatio: .5,
        topRatio: .86,
        widthRatio: .39,
        heightRatio: .05,
      },
    }], [{
      pageNumber: 6,
      dataUrl: 'data:image/png;base64,AA==',
      pageWidth: 612,
      pageHeight: 792,
    }]);

    expect(result.html).toContain('data-layout-role="footnote"');
    expect(result.html).toContain('[data-layout-role="footnote"]');
    expect(result.html).toContain('font-size:8.5pt');
  });

  it('keeps code, tables, and figures visible on the source page and translates their descriptions', () => {
    const sourceAnchor = {
      leftRatio: .15,
      topRatio: .25,
      widthRatio: .7,
      heightRatio: .2,
    };
    const result = buildPdfLayoutTranslationExport([
      {
        id: 'P1B1', pageNumber: 1, translatedText: 'const answer = 42;',
        role: 'code', sourceAnchor,
      },
      {
        id: 'P1B2', pageNumber: 1, translatedText: '| 模型 | 分数 |',
        role: 'table', sourceAnchor,
      },
      {
        id: 'P1B3', pageNumber: 1, translatedText: '图 1：收敛曲线。',
        role: 'figure', sourceAnchor,
      },
    ], [{
      pageNumber: 1,
      dataUrl: 'data:image/jpeg;base64,AA==',
      pageWidth: 612,
      pageHeight: 792,
    }]);

    expect(result).toMatchObject({ pageCount: 1, blockCount: 3 });
    expect(result.html).toContain('data-layout-role="code"');
    expect(result.html).toContain('data-layout-role="table"');
    expect(result.html).toContain('data-layout-role="figure"');
    expect(result.html).not.toContain('data-layout-overlay');
    expect(result.html).toContain('const answer = 42;');
    expect(result.html).toContain('图 1：收敛曲线。');
  });

  it('labels an incomplete layout export as partial', () => {
    const result = buildPdfLayoutTranslationExport([{
      id: 'P1B1',
      pageNumber: 1,
      translatedText: '第一段。',
    }], [], {
      totalBlockCount: 3,
      unavailablePageCount: 1,
    });

    expect(result.complete).toBe(false);
    expect(result.html).toContain('部分结果 · 已完成 1/3 段 · 1 页未识别');
    expect(result.html).toContain('data-layout-partial-cover');
  });

  it('rejects active image formats and escapes translation content', () => {
    const result = buildPdfLayoutTranslationExport([{
      id: '" onmouseover="alert(1)',
      pageNumber: 3,
      translatedText: '<script>alert(1)</script>',
      sourceAnchor: {
        leftRatio: .1,
        topRatio: .1,
        widthRatio: .4,
        heightRatio: .1,
      },
    }], [{
      pageNumber: 3,
      dataUrl: 'data:image/svg+xml,<svg onload=alert(1)>',
      pageWidth: 612,
      pageHeight: 792,
    }]);

    expect(result).toMatchObject({
      pageCount: 1,
      blockCount: 1,
    });
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).not.toContain('svg+xml');
    expect(result.html).not.toContain('onmouseover="alert(1)');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.html).toContain('原页图生成失败');
  });
});
