(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.UtilityMenu=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  function createUtilityMenu({document,menu=document.querySelector?.('.utility-menu')}) {
    function close(restoreFocus=false) {
      if(!menu?.open)return;
      menu.open=false;
      if(restoreFocus)menu.querySelector('summary')?.focus({preventScroll:true});
    }
    if(menu) {
      // Capture clicks without cancelling them, so navigation and Utility
      // controls still run their own action and focus behavior.
      document.addEventListener('click',event=>{
        if(!menu.contains(event.target)||event.target?.closest?.('.utility-menu-items button'))close();
      },true);
      document.addEventListener('keydown',event=>{
        if(event.key!=='Escape'||!menu.open||event.defaultPrevented)return;
        event.preventDefault();event.stopPropagation();close(true);
      },true);
      menu.addEventListener('focusout',event=>{
        if(!menu.contains(event.relatedTarget))close();
      });
    }
    return {close};
  }
  return {createUtilityMenu};
});
