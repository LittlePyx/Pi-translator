import {reuseReadingSource} from './reading-source-link';
import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import type {RecentPdfReading} from '../core/translation/recent-reading-library';
import {renameRecentPdfReading,removeRecentPdfReadingWithUndo} from '../core/translation/recent-reading-library';
import {showUndoNotice} from './action-feedback';
export function appendRecentReadingEntry(container:HTMLElement,item:RecentPdfReading,options:{drafts:Map<string,string>;changed:()=>Promise<void>;notice:(message:string,error?:boolean)=>void;focusAfterRemoval:()=>void}):void{
  const row=document.createElement('article');row.className='library-entry';row.dataset.libraryId=`recent:${item.id}`;row.dataset.kind='pdf';row.dataset.recentId=item.id;row.dataset.updatedAt=String(item.updatedAt);
  const preview=document.createElement('div');preview.className='library-preview';const link=document.createElement('a');link.className='library-open';link.href=browser.runtime.getURL(`/pdf.html?recent=${encodeURIComponent(item.id)}`);link.target='_blank';link.rel='noopener';reuseReadingSource(link);
  const kind=document.createElement('span');kind.className='library-kind';kind.textContent='PDF';kind.ariaHidden='true';
  const description=document.createElement('span');description.className='library-description';const title=document.createElement('strong');title.className='library-title';title.textContent=item.name;
  const meta=document.createElement('span');meta.className='library-meta';meta.textContent=[item.state?msg`上次第 ${item.state.pageNumber} 页`:t('阅读笔记'),item.noteCount?msg`${item.noteCount} 条批注`:'',item.originalCopyUnavailable?t('原 PDF 副本暂时无法读取'):item.hasLocalCopy?'':t('需选择原 PDF')].filter(Boolean).join(' · ');meta.title=msg`更新于 ${new Date(item.updatedAt).toLocaleString()}`;
  const action=document.createElement('span');action.className='library-continue';action.textContent=t('继续阅读');description.append(title,meta,action);link.append(kind,description);preview.append(link);
  const key=`recent:${item.id}`,menu=document.createElement('details');menu.className='library-menu';
  const toggle=document.createElement('summary');toggle.textContent='···';toggle.dataset.piIcon='more';toggle.title=toggle.ariaLabel=msg`${item.name} 的更多操作`;
  const actions=document.createElement('div');actions.className='library-actions';
  const editor=document.createElement('div');editor.className='library-name-editor';editor.hidden=!options.drafts.has(key);
  const name=document.createElement('input');name.type='text';name.maxLength=120;name.value=options.drafts.get(key)??item.name;name.ariaLabel=t('文档名称');name.addEventListener('input',()=>options.drafts.set(key,name.value));
  const rename=document.createElement('button');rename.type='button';rename.textContent=t('重命名');rename.addEventListener('click',()=>{menu.open=false;options.drafts.set(key,name.value);editor.hidden=false;name.focus();name.select()});
  const save=document.createElement('button');save.type='button';save.textContent=t('保存名称');save.addEventListener('click',()=>{
    save.disabled=true;
    void renameRecentPdfReading(item.id,name.value).then(async()=>{options.drafts.delete(key);options.notice(t('名称已保存到本机。'));await options.changed();container.querySelector<HTMLElement>(`[data-recent-id="${item.id}"] .library-open`)?.focus()}).catch(error=>{options.notice(error instanceof Error?localizeErrorMessage(error.message):t('命名失败，请重试。'),true);save.disabled=false});
  });
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent=t('取消');cancel.addEventListener('click',()=>{options.drafts.delete(key);name.value=item.name;editor.hidden=true;toggle.focus()});
  name.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save.click()}else if(event.key==='Escape'){event.preventDefault();cancel.click()}});
  const remove=document.createElement('button');remove.type='button';remove.textContent=t('从最近列表移除');remove.title=t('只移除列表记录，译文、笔记和阅读位置仍保留。');remove.addEventListener('click',()=>{
    remove.disabled=true;
    void removeRecentPdfReadingWithUndo(item.id).then(async undo=>{options.drafts.delete(key);await options.changed();options.focusAfterRemoval();showUndoNotice(t('已从最近列表移除'),async()=>{await undo();await options.changed();container.querySelector<HTMLElement>(`[data-recent-id="${item.id}"] .library-open`)?.focus()})}).catch(error=>{options.notice(error instanceof Error?localizeErrorMessage(error.message):t('移除失败，原有资料未改变。'),true);remove.disabled=false});
  });
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();menu.open=false;toggle.focus()}});
  menu.addEventListener('toggle',()=>{if(menu.open)container.querySelectorAll<HTMLDetailsElement>('.library-menu[open]').forEach(other=>{if(other!==menu)other.open=false})});
  editor.append(name,save,cancel);actions.append(rename,remove);menu.append(toggle,actions);row.append(preview,menu,editor);container.append(row);
}
