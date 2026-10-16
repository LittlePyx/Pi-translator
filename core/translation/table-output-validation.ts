/** Split only structural pipes; bars within complete inline math stay in the
 * cell. Shared by validation and the PDF reader's table renderer. */
export function splitMarkdownTableRow(line:string):string[]{
  return line.trim().replace(/^\|/u,'').replace(/\|$/u,'')
    .replace(/(?<!\\)\$(?:\\.|[^$])*(?<!\\)\$/gu,math=>math.replace(/\|/gu,'\u0000'))
    .split(/(?<!\\)\|/u).map(cell=>cell.replaceAll('\u0000','|').trim());
}
/** Table completeness is separate from mathematical expression validation. */
function tableRows(text:string):string[][]{
  const lines=text.split(/\r?\n/u),rows:string[][]=[];let inside=false;
  for(let index=0;index<lines.length;index++){
    const cells=(line:string)=>/^\s*\|.*\|\s*$/u.test(line)?splitMarkdownTableRow(line):undefined;
    const current=cells(lines[index]!);
    if(!inside){const next=cells(lines[index+1]??'');if(current&&next&&next.length>=1&&next.every(cell=>/^:?-{3,}:?$/u.test(cell))){rows.push(current);inside=true;index++}}
    else if(current)rows.push(current);else if(rows.length>1)break;
  }return rows;
}
export function tableOutputIssues(source:string,target:string):string[]{
  const original=tableRows(source),translated=tableRows(target);
  if(translated.length<2)return ['未返回完整 Markdown 表格，可能只翻译了表题；原图与识别原文仍需保留核对。'];
  if(translated.some(row=>row.length!==translated[0]!.length))return ['译文表格列数不一致，不能可靠对应单元格。'];
  if(original.length<2)return ['识别原文未保留可核对的 Markdown 行列结构，不能确认单元格对应。'];
  if(original.some(row=>row.length!==original[0]!.length))return ['识别原文的表格列数不一致，不能可靠对应单元格。'];
  const issues:string[]=[];
  if(original.length&&(original.length!==translated.length||original[0]!.length!==translated[0]!.length))issues.push('原文与译文表格的行列数量不同。');
  const percentages=(text:string)=>[...text.replaceAll('\\%','%').replaceAll('\\,','').matchAll(/(\d+(?:\.\d+)?)\s*%/gu)].map(match=>Number(match[1]));
  const dataText=(rows:string[][])=>rows.slice(1).map(row=>row.join(' ')).join('\n');
  const expected=percentages(original.length?dataText(original):source),actual=percentages(dataText(translated));
  if((expected.length||actual.length)&&JSON.stringify(expected)!==JSON.stringify(actual))issues.push('表格百分比的数值、数量或排列发生变化。');
  if(original.length){
    const numbers=(rows:string[][])=>dataText(rows).replaceAll('−','-').match(/(?<![\p{L}\p{N}])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/gu)?.map(Number)??[];
    if(JSON.stringify(numbers(original))!==JSON.stringify(numbers(translated)))issues.push('表格中的数值或排列发生变化。');
  }
  return issues;
}
