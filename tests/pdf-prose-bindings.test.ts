import {describe,it,expect} from 'vitest';
import {pdfProseUnits,pdfProseBindingIssues,pdfFormulaProseIssues,pdfCitationIssues} from '../core/pdf/prose-bindings';
describe('academic prose bindings',()=>{
  it('keeps soft wraps, conditions, sentence endings and source paragraph breaks intact',()=>{
    const source='If {{m1}} counters\n{{m2}}, then {{m3}} counters {{m4}}.\nHence an equilibrium point exists. This need not hold in general².';
    const units=pdfProseUnits(source);expect(units).toHaveLength(3);expect(units[0]!.text).toContain('counters\n{{m2}}');expect(units.map(unit=>unit.text+unit.after).join('')).toBe(source);
  });
  it('detects variables crossing condition/conclusion boundaries and reversed relations',()=>{
    const source='If {{m1}} counters {{m2}}, then {{m3}} counters {{m4}}.';
    expect(pdfProseBindingIssues(source,'若 {{m1}} 反制 {{m2}}，则 {{m3}} 反制 {{m4}}。','zh-CN')).toEqual([]);
    expect(pdfProseBindingIssues(source,'若 {{m3}} 反制 {{m4}}，则 {{m1}} 反制 {{m2}}。','zh-CN')).toContain('条件与结论中的公式指代不对应');
    expect(pdfProseBindingIssues(source,'若 {{m1}} 反制 {{m2}}，则 {{m4}} 反制 {{m3}}。','zh-CN')).toContain('变量关系的主语与对象可能颠倒');
    expect(pdfProseBindingIssues('{{m1}} counters {{m2}}.','{{m2}} 被 {{m1}} 反制。','zh-CN')).toEqual([]);
  });
  it('allows an English trailing condition to move before its conclusion in Chinese',()=>{
    const source='One {{m1}}-tuple counters another if the strategies of {{m2}} players in the countered {{m3}}-tuple are fixed.';
    expect(pdfProseBindingIssues(source,'如果被反制的 {{m3}} 元组中 {{m2}} 位参与者的策略已固定，则该 {{m1}} 元组反制另一个。','zh-CN')).toEqual([]);
  });
  it('detects participant quantities attached to strategies or tuples instead of people',()=>{
    const source='Against the {{m1}} strategies of the other players in the {{m2}}-tuple.';
    expect(pdfProseBindingIssues(source,'针对该 {{m2}} 元组中其他 {{m1}} 位参与者的策略。','zh-CN')).toEqual([]);
    expect(pdfProseBindingIssues(source,'针对 {{m1}} 个策略和 {{m2}} 元组。','zh-CN')).toContain('参与者数量与策略或元组的指代可能错位');
  });
  it('detects missing final qualifications, inference markers and footnotes',()=>{
    expect(pdfProseBindingIssues('This need not hold in general.','一般情况下总是成立。','zh-CN')).toContain('原文的否定或例外条件可能遗漏');
    expect(pdfProseBindingIssues('Hence an equilibrium point exists.','存在均衡点。','zh-CN')).toContain('结论句的推导关系可能遗漏');
    expect(pdfCitationIssues('The theorem¹ and main theorem² follow from [3].','定理¹与主要定理源自[3]。')).toEqual(['脚注或引文标记未对应：²']);
  });
  it('checks sentence ownership and citations even when registry counts are valid',()=>{
    const document={version:1 as const,sourceTemplate:'The first domain {{m1}} is fixed. The second domain {{m2}} is independent¹.',translationTemplate:'第一定义域 {{m2}} 固定。第二定义域 {{m1}} 独立。',formulas:[{id:'m1',latex:'P',display:false},{id:'m2',latex:'Q',display:false}],issues:[]};
    expect(pdfFormulaProseIssues(document,'zh-CN')).toContain('脚注或引文标记未对应：¹');
  });
});
