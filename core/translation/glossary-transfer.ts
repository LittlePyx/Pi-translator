import {msg} from '../i18n/ui-language';
import {MAX_GLOSSARY_ENTRIES,MAX_GLOSSARY_TERM_LENGTH,normalizeGlossaryTermKey} from './glossary';
import type {GlossaryEntry} from './types';

/** Bounded RFC-style quoted CSV/TSV; never silently drops a row. */
export function readGlossaryFile(text:string,separator:','|'\t'):GlossaryEntry[]{
  if(new TextEncoder().encode(text).length>100_000)throw new Error('术语文件最多 100 KB。');
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  const input=text.replace(/^\uFEFF/u,'').replace(/\r\n/gu,'\n');
  for(let i=0;i<=input.length;i++){
    const c=input[i];
    if(quoted){if(c===undefined)throw new Error('术语文件引号未闭合。');if(c==='"'){if(input[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
    if(c==='"'&&!field&&!closed){quoted=true;continue}
    if(c===separator||c==='\n'||c===undefined){row.push(field);field='';closed=false;if(c!==separator){if(row.some(v=>v.trim()))rows.push(row);row=[]}continue}
    if(closed||c==='"')throw new Error('术语文件引号后存在无效字符。');field+=c;
  }
  if(!rows.length||rows.length>MAX_GLOSSARY_ENTRIES)throw new Error('术语文件需包含 1–100 条记录。');
  const seen=new Set<string>();return rows.map((values,i)=>{
    if(values.length!==2)throw new Error(msg`第 ${i+1} 行需要两列：原词、译词。`);
    const source=values[0]!.trim(),target=values[1]!.trim(),key=normalizeGlossaryTermKey(source);
    if(!source||!target||source.length>MAX_GLOSSARY_TERM_LENGTH||target.length>MAX_GLOSSARY_TERM_LENGTH||/[\r\n\u0000-\u001f]/u.test(source+target))throw new Error(msg`第 ${i+1} 行术语无效或超过 120 字符。`);
    if(seen.has(key))throw new Error(msg`第 ${i+1} 行原词重复，请先整理文件。`);seen.add(key);return {source,target};
  });
}
export function planGlossaryImport(current:readonly GlossaryEntry[],incoming:readonly GlossaryEntry[]){
  const next=current.map(item=>({...item}));const rows=incoming.map(item=>{
    const existing=current.find(old=>normalizeGlossaryTermKey(old.source)===normalizeGlossaryTermKey(item.source));
    const status=existing?existing.target===item.target?'same':'conflict':'added';if(!existing)next.push({...item});return {...item,status,previous:existing?.target};
  });
  if(next.length>MAX_GLOSSARY_ENTRIES)throw new Error('合并后超过 100 条术语，原词表未改变。');
  return {entries:next,rows}; // Conflicts always keep local choices.
}
export function writeGlossaryFile(entries:readonly GlossaryEntry[]):string{return entries.map(e=>[e.source,e.target].map(v=>`"${v.replace(/"/gu,'""')}"`).join('\t')).join('\n')}
