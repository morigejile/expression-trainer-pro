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
  function createConfigMenus({document,root}) {
    const menus=()=>Array.from(root.querySelectorAll('.config-more'));
    const owner=target=>{const menu=target?.closest?.('.config-more');return menu&&root.contains(menu)?menu:null;};
    function close(except=null){for(const menu of menus())if(menu!==except)menu.open=false;}
    document.addEventListener('click',event=>{
      const menu=owner(event.target);
      close(menu);
      if(menu&&event.target.closest('button'))menu.open=false;
    },true);
    root.addEventListener('toggle',event=>{const menu=owner(event.target);if(menu?.open)close(menu);},true);
    root.addEventListener('focusout',event=>{const menu=owner(event.target);if(menu&&!menu.contains(event.relatedTarget))menu.open=false;});
    root.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.defaultPrevented)return;
      const menu=menus().find(item=>item.open);if(!menu)return;
      event.preventDefault();event.stopPropagation();menu.open=false;
      menu.querySelector('summary')?.focus({preventScroll:true});
    },true);
    return {close:()=>close()};
  }
  return {createUtilityMenu,createConfigMenus};
});
