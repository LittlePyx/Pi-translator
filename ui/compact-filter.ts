/** Keep the native select and its keyboard behavior; expose its value on hover. */
export function updateCompactFilter(select:HTMLSelectElement):void {
  const label=select.getAttribute('aria-label')??'';
  select.title=`${label}: ${select.selectedOptions[0]?.textContent??''}`;
  const wrapper=select.closest<HTMLElement>('.compact-filter');
  if(wrapper){wrapper.title=select.title;wrapper.dataset.active=String(select.value!=='all');wrapper.hidden=select.hidden;}
}
