'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createUtilityMenu}=require('../src/utility-menu');

function fixture() {
  const listeners=new Map(),menuListeners=new Map();let focusCalls=0;
  const document={addEventListener(type,handler){listeners.set(type,handler);}};
  const summary={focus(){focusCalls++;document.activeElement=this;},closest(){return null;}};
  const item={closest(selector){return selector==='.utility-menu-items button'?this:null;}};
  const other={closest(){return null;}};
  const menu={open:true,contains(node){return node===menu||node===summary||node===item;},
    querySelector(){return summary;},addEventListener(type,handler){menuListeners.set(type,handler);}};
  const controller=createUtilityMenu({document,menu});
  return {document,menu,summary,item,other,controller,get focusCalls(){return focusCalls;},
    click(target){let prevented=false;listeners.get('click')({target,preventDefault(){prevented=true;}});return prevented;},
    focusout(relatedTarget){menuListeners.get('focusout')({relatedTarget});},
    escape(){const event={key:'Escape',prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};listeners.get('keydown')(event);return event;}};
}
test('outside clicks close the menu without cancelling the target action or stealing focus',()=>{
  const f=fixture();f.document.activeElement=f.other;
  assert.equal(f.click(f.other),false);assert.equal(f.menu.open,false);assert.equal(f.focusCalls,0);assert.equal(f.document.activeElement,f.other);
});
test('summary clicks leave native details toggling intact; menu item selection closes it',()=>{
  const f=fixture();assert.equal(f.click(f.summary),false);assert.equal(f.menu.open,true);
  assert.equal(f.click(f.item),false);assert.equal(f.menu.open,false);assert.equal(f.focusCalls,0);
});
test('focus can move from the trigger to an item, and closes only when leaving the whole menu group',()=>{
  const f=fixture();f.focusout(f.item);assert.equal(f.menu.open,true);
  f.focusout(f.summary);assert.equal(f.menu.open,true);
  f.focusout(f.other);assert.equal(f.menu.open,false);assert.equal(f.focusCalls,0);
});
test('Escape closes an open menu and returns focus to the three dots',()=>{
  const f=fixture(),event=f.escape();assert.equal(f.menu.open,false);assert.equal(f.focusCalls,1);
  assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(f.document.activeElement,f.summary);
  const closed=f.escape();assert.equal(closed.prevented,false);assert.equal(f.focusCalls,1);
});
test('programmatic navigation closes without redirecting page focus',()=>{
  const f=fixture();f.controller.close();assert.equal(f.menu.open,false);assert.equal(f.focusCalls,0);
});
