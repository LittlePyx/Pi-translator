import {t} from '../core/i18n/ui-language';

export interface ActionGuideItem { label:string; selector:string }
/** Discover an existing control without executing it or changing saved state. */
export function actionGuideButton(root:Document|ShadowRoot,items:ActionGuideItem[]):HTMLButtonElement{
  const trigger=document.createElement('button');trigger.type='button';trigger.className='pi-action-guide-trigger';trigger.textContent=t('操作帮助');
  trigger.addEventListener('click',event=>{
    event.stopPropagation();
    const menu=trigger.closest<HTMLDetailsElement>('details'),origin=menu?.querySelector<HTMLElement>(':scope > summary')??trigger;
    if(menu)menu.open=false;
    const dialog=document.createElement('dialog');dialog.className='pi-action-guide';dialog.ariaLabel=t('常用操作');
    const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');title.textContent=t('常用操作');close.type='button';close.textContent='×';close.ariaLabel=t('关闭');header.append(title,close);
    const hint=document.createElement('p');hint.textContent=t('选择一项，定位到原入口。');
    const search=document.createElement('input');search.type='search';search.ariaLabel=search.placeholder=t('搜索操作');
    const list=document.createElement('div');list.className='pi-action-guide-list';
    const empty=document.createElement('p');empty.role='status';empty.textContent=t('当前没有可用的匹配操作。');
    let revealing=false;
    function render(){
      list.replaceChildren();const query=search.value.trim().toLocaleLowerCase();
      for(const item of items){
        const target=root.querySelector<HTMLElement>(item.selector);
        if(!target||target.closest('[hidden]')||target.matches(':disabled')||!item.label.toLocaleLowerCase().includes(query))continue;
        let hidden=false;for(let node:HTMLElement|null=target;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'){hidden=true;break}}if(hidden)continue;
        const row=document.createElement('button');row.type='button';row.textContent=item.label;
        row.addEventListener('click',()=>{
          revealing=true;dialog.close();
          const ancestors:HTMLDetailsElement[]=[];for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)ancestors.unshift(parent);
          for(const detail of ancestors)detail.open=true;
          if(!target.matches('button,input,select,textarea,a[href],summary,[tabindex]')){target.tabIndex=-1;target.addEventListener('blur',()=>target.removeAttribute('tabindex'),{once:true})}
          target.scrollIntoView({block:'nearest'});target.focus({preventScroll:true});target.classList.add('pi-action-revealed');setTimeout(()=>target.classList.remove('pi-action-revealed'),1800);
        });list.append(row);
      }
      empty.hidden=Boolean(list.childElementCount);
    }
    search.addEventListener('input',render);close.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();dialog.close()}});
    dialog.addEventListener('close',()=>{dialog.remove();if(!revealing&&origin.isConnected)origin.focus({preventScroll:true})},{once:true});
    dialog.append(header,hint,search,list,empty);(root instanceof Document?root.body:root).append(dialog);render();dialog.showModal();search.focus();
  });return trigger;
}
export function bindActionGuide(root:Document|ShadowRoot,mounts:string[],items:ActionGuideItem[]):void{
  for(const selector of mounts)root.querySelector(selector)?.append(actionGuideButton(root,items));
}
