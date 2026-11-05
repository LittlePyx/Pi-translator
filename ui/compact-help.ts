/** Only explicitly selected, static explanations move to their associated control. */
export function bindCompactHelp(root:Document=document):void {
  for(const [index,help] of [...root.querySelectorAll<HTMLElement>('[data-pi-help-for]')].entries()){
    const selector=help.dataset.piHelpFor;
    const target=selector==='summary'?help.closest('summary'):selector?root.querySelector<HTMLElement>(selector):null;
    const text=help.textContent?.trim();
    if(!target||!text)continue;
    if(!target.title.includes(text))target.title=[target.title,text].filter(Boolean).join('\n');
    const label=target.closest('label');
    if(label&&!label.title.includes(text))label.title=[label.title,text].filter(Boolean).join('\n');
    help.id ||= `pi-compact-help-${index}`;
    const descriptions=new Set((target.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean));
    descriptions.add(help.id);target.setAttribute('aria-describedby',[...descriptions].join(' '));
    help.hidden=true;
  }
}
