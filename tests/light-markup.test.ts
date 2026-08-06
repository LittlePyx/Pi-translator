import { describe, expect, it } from 'vitest';
import { splitLightMarkup } from '../core/translation/light-markup';

describe('light result markup', () => {
  it('recognizes common strong markers without interpreting HTML', () => {
    expect(splitLightMarkup('这是 **命题 2.8**，也是 __重要结论__。')).toEqual([
      { kind: 'text', text: '这是 ' },
      { kind: 'strong', text: '命题 2.8' },
      { kind: 'text', text: '，也是 ' },
      { kind: 'strong', text: '重要结论' },
      { kind: 'text', text: '。' },
    ]);
    expect(splitLightMarkup('**<img src=x onerror=alert(1)>**')).toEqual([
      { kind: 'strong', text: '<img src=x onerror=alert(1)>' },
    ]);
  });

  it('leaves empty, escaped, and unmatched markers as literal text', () => {
    expect(splitLightMarkup('空标记 **** 不变化')).toEqual([
      { kind: 'text', text: '空标记 **** 不变化' },
    ]);
    expect(splitLightMarkup('转义 \\**不是加粗**')).toEqual([
      { kind: 'text', text: '转义 \\**不是加粗**' },
    ]);
    expect(splitLightMarkup('未闭合 **内容')).toEqual([
      { kind: 'text', text: '未闭合 **内容' },
    ]);
  });

  it('treats triple emphasis as safe strong text', () => {
    expect(splitLightMarkup('这是 ***命题 2.8***。')).toEqual([
      { kind: 'text', text: '这是 ' },
      { kind: 'strong', text: '命题 2.8' },
      { kind: 'text', text: '。' },
    ]);
  });

  it('keeps one strong span across formulae without parsing markers inside formulae', () => {
    expect(splitLightMarkup('**文字 $x=y$ 文字**')).toEqual([
      { kind: 'strong', text: '文字 $x=y$ 文字' },
    ]);
    expect(splitLightMarkup('公式 $a**b**c$ 不应触发加粗')).toEqual([
      { kind: 'text', text: '公式 $a**b**c$ 不应触发加粗' },
    ]);
  });

  it('protects strong markers inside double-escaped display delimiters', () => {
    expect(splitLightMarkup(String.raw`正文 \\[a**b**c\\] **结论**`)).toEqual([
      { kind: 'text', text: String.raw`正文 \\[a**b**c\\] ` },
      { kind: 'strong', text: '结论' },
    ]);
  });
});
