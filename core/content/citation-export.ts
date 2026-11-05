import {citationDoi,citationUrl} from './excerpt-citation';

export interface CitationExportFields {title:string;authors:string;year:string;doi:string;url:string}
/** Confirmed local draft only: never infer missing metadata or update saved notes. */
export function buildCitationExport(fields:CitationExportFields,format:'bibtex'|'ris'):string{
  const title=fields.title.replace(/\s+/gu,' ').trim();
  if(!title||title.length>500||/[\u0000-\u001f]/u.test(title))throw new Error('请填写 1–500 字符的来源标题。');
  const authors=fields.authors.split(/\r?\n/u).map(value=>value.trim()).filter(Boolean);
  if(authors.length>30||authors.some(value=>value.length>200||/[\u0000-\u001f]/u.test(value)))throw new Error('作者请每行填写一位，最多 30 位，每位最多 200 字符。');
  const year=fields.year.trim();
  if(year&&!/^\d{4}$/u.test(year))throw new Error('年份请填写四位数字，未知可留空。');
  const doi=citationDoi(fields.doi),url=citationUrl(fields.url);
  if(fields.doi.trim()&&!doi)throw new Error('DOI 应以 10. 开头，也可粘贴 doi.org 链接。');
  if(fields.url.trim()&&!url)throw new Error('来源链接需为有效的 HTTP 或 HTTPS 地址。');
  if(format==='ris')return ['TY  - GEN',`TI  - ${title}`,...authors.map(value=>`AU  - ${value}`),...(year?[`PY  - ${year}`]:[]),...(doi?[`DO  - ${doi}`]:[]),...(url?[`UR  - ${url}`]:[]),'ER  - ',''].join('\r\n');
  const escape=(value:string)=>value.replace(/[\\{}%&#_$~^]/gu,character=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[character]!));
  const entries=[['title',escape(title)],...(authors.length?[['author',authors.map(value=>`{${escape(value)}}`).join(' and ')]]:[]),...(year?[['year',year]]:[]),...(doi?[['doi',escape(doi)]]:[]),...(url?[['url',escape(url)]]:[])];
  let key=14695981039346656037n;
  for(const byte of new TextEncoder().encode(JSON.stringify([title,authors,year,doi,url])))key=BigInt.asUintN(64,(key^BigInt(byte))*1099511628211n);
  return `@misc{pi_${key.toString(16)},\n${entries.map(([name,value])=>`  ${name} = {${value}}`).join(',\n')}\n}\n`;
}
