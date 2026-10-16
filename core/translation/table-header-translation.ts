import type {GlossaryEntry} from './types';

/** Complete only exact, unchanged common academic header cells. Never rewrite
 * data rows, formulas, names, unknown abbreviations or a user's terminology. */
export function translateUnchangedTableHeaders(source:string,target:string,language:string,glossary:readonly GlossaryEntry[]=[]):string {
  if (!/^zh(?:-|$)/iu.test(language) || !/\p{Script=Han}/u.test(target)) return target;
  const traditional=/^zh-(?:TW|HK|Hant)(?:-|$)/iu.test(language);
  const cells=(line:string)=>/^\s*\|.*\|\s*$/u.test(line)?line.trim().slice(1,-1).split('|').map(cell=>cell.trim()):undefined;
  const header=(text:string)=>{
    const lines=text.split('\n');
    for(let index=0;index<lines.length-1;index++){
      const row=cells(lines[index]!),rule=cells(lines[index+1]!);
      if(row&&rule&&row.length===rule.length&&row.length>=2&&row.length<=16&&rule.every(cell=>/^:?-{3,}:?$/u.test(cell)))return {lines,index,row};
    }
    return undefined;
  };
  const original=header(source),translated=header(target);
  if(!original||!translated||original.row.length!==translated.row.length)return target;
  let changed=false;
  const row=translated.row.map((cell,index)=>{
    if(cell!==original.row[index]||glossary.some(entry=>{
      const term=entry.source.trim().toLocaleLowerCase('en-US'),label=cell.toLocaleLowerCase('en-US');
      return term===label || label.split(/[\s-]+/u).includes(term);
    }))return cell;
    const classification=/\bclassification\b/iu.test(source),accuracy=classification&&/^(\d{1,3})-way\s+Acc$/u.exec(cell);
    const replacement=accuracy?`${accuracy[1]} 类${traditional?'準確率':'准确率'}`:
      cell==='Runtime'?(traditional?'執行時間':'运行时间'):undefined;
    if(!replacement)return cell;
    changed=true;return replacement;
  });
  if(!changed)return target;
  translated.lines[translated.index]=`| ${row.join(' | ')} |`;
  return translated.lines.join('\n');
}
