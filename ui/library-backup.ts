import {RECOVERY_JOURNAL_KEY,interruptedRecovery,recoveryFingerprint} from '../core/translation/recovery-journal';
import {t,msg,localizeErrorMessage} from '../core/i18n/ui-language';
import {createLibraryBackupFile,readLibraryBackupFile,previewLibraryBackupFile,importLibraryBackupFile,originalPdfBackupSummary,type LibraryBackupFile,type LibraryBackupFilePreview} from '../core/translation/document-library-backup-file';

export function bindLibraryBackup(options:{status:(message:string,error?:boolean)=>void;refresh:()=>Promise<boolean>;focus:()=>void}):void{
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const exportButton=el<HTMLButtonElement>('export-library-backup'),importButton=el<HTMLButtonElement>('import-library-backup');
  const include=el<HTMLInputElement>('library-backup-originals'),size=el<HTMLElement>('library-backup-size'),input=el<HTMLInputElement>('library-backup-input');
  const dialog=el<HTMLDialogElement>('library-import-dialog'),summary=el<HTMLElement>('library-import-summary'),status=el<HTMLElement>('library-import-status');
  const confirm=el<HTMLButtonElement>('library-import-confirm'),cancel=el<HTMLButtonElement>('library-import-cancel');
  const progressDialog=el<HTMLDialogElement>('library-backup-progress-dialog'),progressStatus=el<HTMLElement>('library-backup-progress-status'),progressCancel=el<HTMLButtonElement>('library-backup-progress-cancel');
  const hint=el<HTMLElement>('library-recovery-hint'),resume=el<HTMLButtonElement>('library-recovery-continue'),dismiss=el<HTMLButtonElement>('library-recovery-dismiss');
  let data:LibraryBackupFile|undefined,preview:LibraryBackupFilePreview|undefined,busy=false,controller:AbortController|undefined,summaryEpoch=0,resumeRequested='',shown='';
  const dismissed=new Set<string>();
  let hintEpoch=0;
  function updateRecoveryHint(){const epoch=++hintEpoch;void interruptedRecovery().then(record=>{if(epoch===hintEpoch){shown=record?.pending.find(id=>!dismissed.has(id))??'';hint.querySelector('span')!.textContent=t('上次恢复可能未完成。重新选择原备份，核验后继续。');hint.querySelector('div')!.hidden=false;hint.hidden=!shown}}).catch(()=>{if(epoch===hintEpoch){shown='';hint.querySelector('span')!.textContent=t('恢复状态暂时无法读取，请稍后刷新。');hint.querySelector('div')!.hidden=true;hint.hidden=false}})}
  browser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&RECOVERY_JOURNAL_KEY in changes)updateRecoveryHint()});
  updateRecoveryHint();
  resume.addEventListener('click',()=>{resumeRequested=shown;input.click()});
  dismiss.addEventListener('click',()=>{if(shown)dismissed.add(shown);updateRecoveryHint()});
  const errorText=(error:unknown)=>localizeErrorMessage(error instanceof Error?error.message:t('备份失败。'));
  const fileSize=(bytes:number)=>bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${(bytes/1024).toFixed(1)} KB`;
  function closeMenu(){el<HTMLDetailsElement>('library-storage-tools').open=false}
  function updateProgress(done:number,total:number){progressStatus.textContent=msg`正在核验原 PDF：${done} / ${total}`}
  function beginProgress(){controller=new AbortController();exportButton.disabled=true;importButton.disabled=true;progressStatus.textContent=t('正在准备备份资料…');progressDialog.showModal();return {signal:controller.signal,onProgress:updateProgress}}
  function finishProgress(){progressDialog.close();controller=undefined;exportButton.disabled=false;importButton.disabled=false}
  function abortProgress(){controller?.abort(new DOMException('Cancelled','AbortError'));progressDialog.close()}
  progressCancel.addEventListener('click',abortProgress);
  progressDialog.addEventListener('cancel',()=>abortProgress());
  include.addEventListener('change',()=>{
    const epoch=++summaryEpoch;size.hidden=!include.checked;size.textContent='';if(!include.checked){if(!controller)exportButton.disabled=false;return}
    exportButton.disabled=true;
    void originalPdfBackupSummary().then(result=>{if(epoch===summaryEpoch)size.textContent=msg`${result.count} 份原 PDF · ${fileSize(result.bytes)}`})
      .catch(error=>{if(epoch===summaryEpoch){include.checked=false;size.hidden=true;options.status(errorText(error),true)}})
      .finally(()=>{if(epoch===summaryEpoch)exportButton.disabled=false});
  });
  exportButton.addEventListener('click',()=>{
    if(controller)return;closeMenu();const originals=include.checked;
    const progress=beginProgress();
    void createLibraryBackupFile(originals,progress).then(result=>{
      progress.signal?.throwIfAborted();
      const url=URL.createObjectURL(result.blob),anchor=document.createElement('a');anchor.href=url;anchor.download=result.name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);
      options.status(originals?t('备份已导出，包含本机保留的原 PDF；不含 API 配置或 Key。'):t('数据备份已导出：含译文、公式、修订、笔记、阅读位置和列表设置；不含原 PDF、API 配置或 Key。换设备请另行保留原 PDF。'));
    }).catch(error=>{if(!(error instanceof DOMException&&error.name==='AbortError'))options.status(errorText(error),true)})
      .finally(()=>finishProgress());
  });
  function render():void{
    if(!preview)return;const p=preview.library;summary.replaceChildren();
    const lines:string[]=[];
    if(p.addedDocuments+p.mergedDocuments+p.unchangedDocuments)lines.push(msg`新增 ${p.addedDocuments} 份 · 合并 ${p.mergedDocuments} 份 · 保持不变 ${p.unchangedDocuments} 份`);
    if(p.manualCorrectionsKept)lines.push(msg`保留本机人工修正 ${p.manualCorrectionsKept} 处冲突`);
    if(p.repairArchives)lines.push(msg`分歧版本存档 ${p.repairArchives} 份`);
    const counts=[p.readingStates?msg`阅读位置 ${p.readingStates} 份`:'',p.bookmarkDocuments?msg`书签 ${p.bookmarkDocuments} 份`:'',p.termDocuments?msg`术语 ${p.termDocuments} 份`:'',p.markerDocuments?msg`PDF 标记 ${p.markerDocuments} 份`:'',p.excerptPages?msg`网页摘录 ${p.excerptPages} 页`:''].filter(Boolean);
    if(counts.length)lines.push(counts.join(' · '));
    lines.push(preview.originals?msg`原 PDF：新增 ${preview.originals.added} 份 · 已有 ${preview.originals.existing} 份 · ${fileSize(preview.originals.bytes)}`:t('此备份不含原 PDF（包括本机副本）、API 配置或 Key。恢复后可选择原 PDF，核验后继续阅读。'));
    if(preview.originals)lines.push(t('已有原 PDF 保持不变；不含 API 配置或 Key。'));
    if(data&&Number(JSON.parse(data.libraryText).version)>=10)lines.push(t('此备份包含扩展修订或分歧存档；已有项目也会保留。旧版扩展无法恢复，请使用兼容版本。'));
    else if(data&&Number(JSON.parse(data.libraryText).version)>=9)lines.push(t('此备份包含项目和归属；旧版扩展无法恢复，请使用支持项目的版本。'));
    else if(data&&Number(JSON.parse(data.libraryText).version)>=8)lines.push(t('此备份使用版本 8，包含标签、区域笔记或完整来源信息；旧版扩展无法恢复，请使用本候选或后续兼容版本。'));
    if(p.organizationItems)lines.push(msg`标签与保存筛选 ${p.organizationItems} 项`);
    if(p.areaNotes)lines.push(msg`区域笔记 ${p.areaNotes} 条`);
    if(p.annotationCount)lines.push(msg`阅读批注 ${p.annotationCount} 条`);
    if(p.recentDocuments)lines.push(msg`最近阅读 ${p.recentDocuments} 份`);
    if(p.recentListSettings)lines.push(msg`最近列表名称与移除设置 ${p.recentListSettings} 份`);
    for(const text of lines){const paragraph=document.createElement('p');paragraph.textContent=text;summary.append(paragraph)}
  }
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
  dialog.addEventListener('close',()=>{data=undefined;preview=undefined;options.focus()});
  cancel.addEventListener('click',()=>dialog.close());
  confirm.addEventListener('click',()=>{
    if(busy||!data)return;const current=data;busy=true;confirm.disabled=true;cancel.disabled=true;
    void(async()=>{
      if(!preview){const progress=beginProgress();try{preview=await previewLibraryBackupFile(current,progress);render();status.textContent='';confirm.textContent=t('确认导入')}finally{finishProgress()}return}
      const annotations=preview.library.annotationCount,originals=preview.originals;status.classList.remove('error');status.textContent=t('正在恢复，请稍候…');
      const count=await importLibraryBackupFile(current,preview);dialog.close();const refreshed=await options.refresh().catch(()=>false);
      options.status(msg`${count?msg`已恢复 ${count} 份文档，网页摘录已合并`:t('备份已合并（含已保存网页摘录）')}；保留较新的记录，未调用翻译接口。`+(annotations?` ${msg`已合并阅读批注 ${annotations} 条。`}`:'')+' '+(originals?msg`已恢复原 PDF ${originals.added} 份，已有 ${originals.existing} 份保持不变；API 配置不变。`:t('原 PDF 和 API 配置未从此备份恢复；本机已有副本与配置不变。'))+(refreshed?'':' '+t('资料已恢复，但列表未能完整刷新；请点击刷新查看。')), !refreshed);
    })().catch(error=>{preview=undefined;status.classList.add('error');status.textContent=error instanceof DOMException&&error.name==='AbortError'?'':errorText(error);confirm.textContent=t('重新预览')})
      .finally(()=>{busy=false;confirm.disabled=false;cancel.disabled=false});
  });
  importButton.addEventListener('click',()=>{resumeRequested='';input.click()});
  input.addEventListener('change',()=>{
    closeMenu();const file=input.files?.[0],resuming=resumeRequested;resumeRequested='';input.value='';if(!file||controller||busy)return;
    const progress=beginProgress();
    void(async()=>{const parsed=await readLibraryBackupFile(file,progress);if(resuming){const pending=await interruptedRecovery();if(!pending?.pending.includes(await recoveryFingerprint(parsed)))throw new Error('请选择上次恢复使用的备份文件。')}const checked=await previewLibraryBackupFile(parsed,progress);progress.signal.throwIfAborted();finishProgress();data=parsed;preview=checked;render();status.textContent='';confirm.textContent=t('确认导入');dialog.showModal();cancel.focus()})()
      .catch(error=>{if(!(error instanceof DOMException&&error.name==='AbortError')){const message=errorText(error);if(resuming&&!hint.hidden)hint.querySelector('span')!.textContent=message;options.status(message,true)}})
      .finally(()=>{if(controller)finishProgress()});
  });
}
