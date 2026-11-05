import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import {layoutTaskDialog} from './task-dialog';
import {formatGlossaryEntries,parseGlossaryText} from '../core/translation/glossary';
import {readGlossaryFile,planGlossaryImport,writeGlossaryFile} from '../core/translation/glossary-transfer';

export function bindGlossaryTransfer(textarea:HTMLTextAreaElement,targetLanguage:()=>string,context:()=>number=()=>0){
  const tools=document.createElement('div');tools.className='support-task-actions';
  const input=document.createElement('input');input.type='file';input.accept='.csv,.tsv,.txt';input.hidden=true;
  const load=document.createElement('button'),save=document.createElement('button');load.type=save.type='button';load.textContent=t('导入词表…');save.textContent=t('导出词表');tools.append(load,save,input);textarea.closest('label')!.after(tools);
  const feedback=document.createElement('p');feedback.id='glossary-transfer-status';feedback.className='glossary-transfer-status';feedback.role='status';feedback.hidden=true;tools.after(feedback);let importedDraft:string|undefined;
  const notice=(message:string)=>{feedback.textContent=message;feedback.hidden=!message};
  textarea.addEventListener('input',()=>{if(importedDraft!==undefined){importedDraft=textarea.value;notice(t('术语草稿已更改，保存更改后生效。'))}else notice('')});
  load.addEventListener('click',()=>input.click());
  const error=(value:unknown)=>alert(localizeErrorMessage(value instanceof Error?value.message:String(value)));
  save.addEventListener('click',()=>{const parsed=parseGlossaryText(textarea.value);if(parsed.errors.length){error(parsed.errors[0]);return}const url=URL.createObjectURL(new Blob([writeGlossaryFile(parsed.entries)],{type:'text/tab-separated-values;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='pi-glossary.tsv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
  input.addEventListener('input',event=>event.stopPropagation());
  input.addEventListener('change',event=>{event.stopPropagation();const file=input.files?.[0];input.value='';if(!file)return;
    if(file.size>100_000){error(t('术语文件最多 100 KB。'));return}
    const importContext=context();
    void file.arrayBuffer().then(bytes=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new Error('术语文件需为 UTF-8 编码。')}}).then(text=>{
      if(context()!==importContext)throw new Error('术语方案已切换，请在当前方案重新导入。');
      const before=textarea.value,language=targetLanguage(),current=parseGlossaryText(before);if(current.errors.length)throw new Error(current.errors[0]);
      const incoming=readGlossaryFile(text,file.name.toLowerCase().endsWith('.csv')?',':'\t'),plan=planGlossaryImport(current.entries,incoming);
      const dialog=document.createElement('dialog');dialog.className='citation-export-dialog glossary-import-dialog';dialog.ariaLabel=t('导入术语预览');
      const heading=document.createElement('h2');heading.textContent=t('导入术语预览');const hint=document.createElement('p');hint.textContent=msg`目标语言：${language}。冲突保留当前译法；确认后加入草稿，保存更改后生效。`;
      const summary=document.createElement('p');summary.className='pi-task-summary';summary.textContent=msg`新增 ${plan.rows.filter(row=>row.status==='added').length} · 相同 ${plan.rows.filter(row=>row.status==='same').length} · 冲突 ${plan.rows.filter(row=>row.status==='conflict').length}`;
      const preview=document.createElement('textarea');preview.readOnly=true;preview.rows=10;preview.ariaLabel=t('导入预览');preview.value=plan.rows.map(row=>`${t(row.status==='added'?'新增':row.status==='same'?'相同':'冲突')}：${row.source} → ${row.target}${row.previous?` (${row.previous})`:''}`).join('\n');
      const status=document.createElement('p');status.role='status';const actions=document.createElement('div');actions.className='support-task-actions';
      const cancel=document.createElement('button'),confirm=document.createElement('button');cancel.type=confirm.type='button';cancel.textContent=t('取消');confirm.textContent=t('确认导入');confirm.className='primary';actions.append(cancel,confirm);layoutTaskDialog(dialog,heading,[summary,hint,preview],actions,status);document.body.append(dialog);
      cancel.addEventListener('click',()=>dialog.close());confirm.addEventListener('click',()=>{if(context()!==importContext||textarea.value!==before||targetLanguage()!==language){status.textContent=t('设置草稿已变化，请重新预览。');confirm.disabled=true;return}const added=plan.rows.filter(row=>row.status==='added').length,conflicts=plan.rows.filter(row=>row.status==='conflict').length;
        if(added){textarea.value=formatGlossaryEntries(plan.entries);textarea.dispatchEvent(new Event('input',{bubbles:true}));importedDraft=textarea.value;notice((msg`已将 ${added} 条新术语加入草稿，点击“保存更改”后生效。`)+(conflicts?msg` ${conflicts} 条冲突保留当前草稿译法。`:''))}
        else notice(t('本次没有新增术语，当前草稿未改动。')+(importedDraft!==undefined?t('已有术语草稿仍需保存更改后生效。'):''));dialog.close()});
      dialog.addEventListener('close',()=>{dialog.remove();load.focus({preventScroll:true})},{once:true});dialog.showModal();cancel.focus();preview.setSelectionRange(0,0);preview.scrollTop=0;
    }).catch(error);
  });
  return {reset:()=>{importedDraft=undefined;notice('')},saved:()=>{notice(importedDraft!==undefined&&importedDraft===textarea.value?t('术语已随设置保存。'):'');importedDraft=undefined}};
}
