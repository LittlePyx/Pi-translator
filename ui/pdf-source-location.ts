/** Move only the reader viewport, keeping the toolbar and application body fixed. */
export function revealPdfSource(viewer:HTMLElement,target:Element):void{
  const stage=viewer.parentElement!,bounds=stage.getBoundingClientRect(),rect=target.getBoundingClientRect();
  stage.scrollTop+=rect.top-bounds.top-12;
  if(rect.left<bounds.left)stage.scrollLeft+=rect.left-bounds.left;
  else if(rect.right>bounds.right)stage.scrollLeft+=Math.min(rect.right-bounds.right,Math.max(0,rect.left-bounds.left));
}
