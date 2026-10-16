import {describe,it,expect} from 'vitest';
import {tableOutputIssues} from '../core/translation/table-output-validation';
const source='| Model | Error |\n| --- | --- |\n| A | 1.85% |\n| B | 2.0% |';
describe('table structure and numeric preservation',()=>{
  it('accepts a genuine one-column formula table, keeping math pipes inside cells and rejecting dropped or changed data',()=>{
    const formulas=String.raw`| Potential $U(z)$ |
| --- |
| $\frac{1}{2}\|z\|^2-\log|1+z|$ |
| $p(z|x)=2.0$ |`;
    expect(tableOutputIssues(formulas,formulas.replace('Potential','势能'))).toEqual([]);
    expect(tableOutputIssues(formulas,formulas.replace('2.0','3.0'))).toContain('表格中的数值或排列发生变化。');
    expect(tableOutputIssues(formulas,formulas.split('\n').slice(0,-1).join('\n'))).toContain('原文与译文表格的行列数量不同。');
    const negative='| Value |\n| --- |\n| −293.7 |';
    expect(tableOutputIssues(negative,negative.replace('−','-'))).toEqual([]);
    expect(tableOutputIssues(negative,negative.replace('−','+'))).toContain('表格中的数值或排列发生变化。');
  });
  it('detects caption-only output and damaged columns instead of treating prose as a full table',()=>{
    expect(tableOutputIssues(source,'表 1：模型结果。')[0]).toContain('可能只翻译了表题');
    expect(tableOutputIssues(source,'| 模型 | 误差 |\n| --- | --- |\n| A | 1.85% | missing |')[0]).toContain('列数');
    const stub='| | $K=0$ | $K=2$ |\n| --- | --- | --- |\n| $-\\ln p(x)$ | -293.7 | -308.6 |';
    expect(tableOutputIssues(stub,stub)).toEqual([]);
    expect(tableOutputIssues(stub,stub.replace('| | $K=0$','| $K=0$').replace('| --- | --- | --- |','| --- | --- |'))[0]).toContain('列数');
  });
  it('requires all percentage values in row order while allowing equivalent numeric formatting',()=>{
    expect(tableOutputIssues(source,'| 模型 | 误差 |\n| --- | --- |\n| A | 1.85\\% |\n| B | 2% |')).toEqual([]);
    expect(tableOutputIssues(source,source.replace('1.85%','8.15%'))).toContain('表格百分比的数值、数量或排列发生变化。');
    expect(tableOutputIssues('A 1.85%\nB 2.0%',source)[0]).toContain('行列结构');
    expect(tableOutputIssues(source.replace('A | 1.85%','A | extra | 1.85%'),source)[0]).toContain('识别原文的表格列数');
    const plain='| Model | Count |\n| --- | --- |\n| A | 12 |';
    expect(tableOutputIssues(plain,plain.replace('12','21'))).toContain('表格中的数值或排列发生变化。');
    expect(tableOutputIssues(plain,plain.replace('12','12%'))).toContain('表格百分比的数值、数量或排列发生变化。');
  });
});
