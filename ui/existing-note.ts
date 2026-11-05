import {t} from '../core/i18n/ui-language';
import type {TranslationMarkerContent} from '../core/content/session-translation-markers';
import {layoutTaskDialog} from './task-dialog';
import {renderTranslationContent} from './translation-content';
import {reuseReadingSource} from './reading-source-link';
import {hasReadingDraft} from '../core/content/reading-navigation';
import styles from './note-summary.css?inline';

/** A separate read-only view keeps the current editor and its draft mounted. */
export function openExistingNote(content:TranslationMarkerContent,href:string,host:HTMLElement|ShadowRoot=document.body,locate?:()=>Promise<boolean>):void{
  const origin=host instanceof ShadowRoot?host.activeElement:document.activeElement,dialog=document.createElement('dialog');dialog.className='pi-note-summary pi-existing-note';dialog.ariaLabel=t('已有笔记');
  const style=document.createElement('style');style.textContent=styles;const title=document.createElement('h2');title.textContent=t('已有笔记');const source=document.createElement('strong');source.textContent=content.sourceTitle;
  const note=document.createElement('p');note.textContent=content.note??'';note.hidden=!content.note;const original=document.createElement('blockquote');original.textContent=content.originalText;const translation=document.createElement('div');void renderTranslationContent(translation,content.translatedText,true);
  const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=t('定位原文');if(locate)link.addEventListener('click',event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();if(hasReadingDraft()){status.textContent=t('旧笔记和当前草稿均保留，未合并或覆盖。');return}void locate().then(found=>{if(found)dialog.close();else status.textContent=t('当前原文位置已变化，笔记和小结仍保留。')}).catch(error=>{status.textContent=error instanceof Error?error.message:String(error)})});else reuseReadingSource(link);
  const status=document.createElement('p');status.textContent=t('旧笔记和当前草稿均保留，未合并或覆盖。');const actions=document.createElement('div'),close=document.createElement('button');actions.className='note-summary-actions';close.type='button';close.textContent=t('关闭');close.addEventListener('click',()=>dialog.close());actions.append(close);
  layoutTaskDialog(dialog,title,[source,note,translation,original,link],actions,status);dialog.append(style);host.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();if(origin instanceof HTMLElement&&origin.isConnected)origin.focus({preventScroll:true})},{once:true});dialog.showModal();close.focus();
}
