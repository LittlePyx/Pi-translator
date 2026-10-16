import {describe,expect,it} from 'vitest';
import {translateUnchangedTableHeaders as translate} from '../core/translation/table-header-translation';
const source='Table 2. Classification results.\n| Method | 5-way Acc | Runtime |\n| --- | --- | --- |\n| CNP | 95.3% | $O(n+m)$ |';
const target=source.replace('Table 2. Classification results.','表 2. 分类结果。');
describe('unchanged academic table headers',()=>{
  it('translates only unchanged, aligned headers while preserving data and math exactly',()=>{
    const fixed=translate(source,target,'zh-CN');
    expect(fixed).toContain('| Method | 5 类准确率 | 运行时间 |');
    expect(fixed.split('\n').at(-1)).toBe(target.split('\n').at(-1));
    expect(translate(source,target,'zh-TW')).toContain('準確率 | 執行時間');
  });
  it('respects custom wording, terminology, other languages and uncertain header shapes',()=>{
    expect(translate(source,target.replace('Runtime','耗时'),'zh-CN')).toContain('耗时');
    expect(translate(source,target,'zh-CN',[{source:'Runtime',target:'Runtime'}])).toContain('Runtime');
    expect(translate(source,target,'zh-CN',[{source:'Acc',target:'准确度'}])).toContain('5-way Acc');
    expect(translate(source,source,'zh-CN')).toBe(source);
    expect(translate(source,target,'fr')).toBe(target);
    expect(translate(source,target.replace('| Method | 5-way Acc | Runtime |','| Method | Runtime |'),'zh-CN')).toBe(target.replace('| Method | 5-way Acc | Runtime |','| Method | Runtime |'));
    expect(translate(source.replace('Classification','Acceleration'),target,'zh-CN')).toContain('5-way Acc');
    expect(translate(source,target.replace('5-way Acc','ACC'),'zh-CN')).toContain('ACC');
  });
});
