import {dialogReturnTarget} from './dialog-navigation';
import {layoutTaskDialog} from './task-dialog';
import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import {buildResearchExport,type ResearchExportPreset} from '../core/content/research-export';
import type {ResearchExcerpt} from '../core/content/research-excerpt-repository';

export function openResearchExport(items:readonly ResearchExcerpt[]):void{
  const origin=dialogReturnTarget(),dialog=document.createElement('dialog');dialog.className='citation-export-dialog research-export-dialog';dialog.ariaLabel=t('导出笔记');
  const title=document.createElement('h2');title.textContent=t('导出笔记');
  const label=document.createElement('label'),caption=document.createElement('span'),preset=document.createElement('select');caption.textContent=t('格式');preset.ariaLabel=t('格式');
  for(const [value,text] of [['research',t('研究摘录')],['obsidian','Obsidian Markdown'],['anki-basic',t('Anki 单词卡（Basic）')],['anki',t('Anki 八字段（自定义类型）')]]){const option=document.createElement('option');option.value=value!;option.textContent=text!;preset.append(option)}label.append(caption,preset);
  const summary=document.createElement('p'),preview=document.createElement('textarea');summary.className='pi-task-summary';preview.readOnly=true;preview.rows=8;preview.ariaLabel=t('导出预览');
  const hint=document.createElement('p');hint.hidden=true;const status=document.createElement('p');status.role='status';
  const duplicateHelp=document.createElement('details'),duplicateTitle=document.createElement('summary'),duplicateMatch=document.createElement('p'),duplicateChoices=document.createElement('p');
  duplicateTitle.textContent=t('重复导入与人工修改');duplicateMatch.textContent=t('Anki 按首字段和所选匹配范围识别重复，同词的不同来源也可能匹配。');duplicateChoices.textContent=t('要保留 Anki 中的人工修改，请选 Preserve（保留）；Update（更新）会覆盖已映射字段，Basic 背面会整体替换；Duplicate（新增副本）会另建同词笔记。');duplicateHelp.append(duplicateTitle,duplicateMatch,duplicateChoices);
  const actions=document.createElement('div');actions.className='support-task-actions';
  const cancel=document.createElement('button'),copy=document.createElement('button'),download=document.createElement('button');cancel.textContent=t('取消');copy.textContent=t('复制');download.textContent=t('下载');download.className='primary';for(const button of [cancel,copy,download])button.type='button';actions.append(cancel,copy,download);layoutTaskDialog(dialog,title,[label,summary,hint,duplicateHelp,preview],actions,status);document.body.append(dialog);
  let result:ReturnType<typeof buildResearchExport>|undefined;
  const update=()=>{hint.hidden=!preset.value.startsWith('anki');hint.textContent=preset.value==='anki-basic'?t('导入 Anki 时选择 Basic（基础）两字段类型，确认 Front 为正面、Back 为背面；语境、笔记和出处都在背面。'):preset.value==='anki'?t('需先在 Anki 建立八字段笔记类型，并逐列映射 Word、Meaning、Context fragment、Note、Source、URL、Page、DOI；Basic 不适用。'):'';try{result=buildResearchExport(items,preset.value as ResearchExportPreset);preview.value=result.text;summary.textContent=msg`导出 ${result.included} 条；不符合格式 ${result.excluded} 条。`;status.textContent='';copy.disabled=download.disabled=false}catch(error){result=undefined;preview.value='';status.textContent=localizeErrorMessage(error instanceof Error?error.message:String(error));copy.disabled=download.disabled=true}};
  const updateDuplicateHelp=()=>{duplicateHelp.hidden=!preset.value.startsWith('anki');if(duplicateHelp.hidden)duplicateHelp.open=false};
  preset.addEventListener('change',()=>{update();updateDuplicateHelp()});cancel.addEventListener('click',()=>dialog.close());
  copy.addEventListener('click',()=>{if(result)void navigator.clipboard.writeText(result.text).then(()=>{status.textContent=t('已复制')}).catch(()=>{status.textContent=t('复制失败，请重试。')})});
  download.addEventListener('click',()=>{if(!result)return;const url=URL.createObjectURL(new Blob([result.text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`pi-notes-${preset.value}.${result.extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);dialog.close()});
  dialog.addEventListener('close',()=>{dialog.remove();if(origin?.isConnected)origin.focus({preventScroll:true})},{once:true});update();updateDuplicateHelp();dialog.showModal();preset.focus();
}
export function researchExportAction(items:readonly ResearchExcerpt[]):HTMLButtonElement{
  const button=document.createElement('button');button.type='button';button.textContent=t('导出笔记…');button.addEventListener('click',()=>{const menu=button.closest('details');if(menu)menu.open=false;openResearchExport(items)});return button;
}
