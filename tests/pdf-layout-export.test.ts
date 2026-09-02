import { describe, expect, it } from 'vitest';
import { buildPdfLayoutTranslationExport } from '../core/translation/pdf-layout-export';

describe('PDF layout translation export', () => {
  it('places translated blocks over trusted local page images at their source coordinates', () => {
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
      positionedBlockCount: 1,
      fallbackBlockCount: 0,
      complete: true,
    });
    expect(result.html).toContain('@page pi-layout-page-2{size:612pt 792pt;margin:0}');
    expect(result.html).toContain('data-layout-source-page="2"');
    expect(result.html).toContain('data:image/jpeg;base64,AA==');
    expect(result.html).toContain('data-layout-role="formula"');
    expect(result.html).toContain('class="pdf-layout-mask"');
    expect(result.html).toContain('left:10%;top:20%;width:70%;height:12%');
    expect(result.html).toContain('该方法保持公式 $E=mc^2$。');
  });

  it('keeps unpositioned translations on a printable continuation page', () => {
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

    expect(result).toMatchObject({
      positionedBlockCount: 0,
      fallbackBlockCount: 1,
    });
    expect(result.html).toContain('data-layout-overflow-page="1"');
    expect(result.html).toContain('无法安全放回原位置或排版后溢出的译文');
    expect(result.html).toContain('这段译文不能安全覆盖原文。');
  });

  it('keeps code, tables, and figures visible and moves their translations to a continuation', () => {
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

    expect(result).toMatchObject({
      positionedBlockCount: 0,
      fallbackBlockCount: 3,
    });
    expect(result.html).not.toContain('data-layout-role="code" style=');
    expect(result.html).not.toContain('data-layout-role="table" style=');
    expect(result.html).not.toContain('data-layout-role="figure" style=');
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
      positionedBlockCount: 0,
      fallbackBlockCount: 1,
    });
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).not.toContain('svg+xml');
    expect(result.html).not.toContain('onmouseover="alert(1)');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.html).toContain('原页图生成失败');
  });
});
