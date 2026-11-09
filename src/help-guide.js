(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../shared/support-links'):root.SupportLinks);if(typeof module==='object'&&module.exports)module.exports=api;else root.HelpGuide=api;})(typeof globalThis!=='undefined'?globalThis:this,links=>{
 'use strict';
 function inline(document,parent,text,onExternal){
  const tokens=/\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*(.+?)\*\*/g;let offset=0;
  const add=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;parent.appendChild(node);return node;};
  for(const match of text.matchAll(tokens)){
   if(match.index>offset)add('span',text.slice(offset,match.index));
   if(match[1]){
    if(links.isAllowedSupportUrl(match[2])){
     const button=add('button',match[1]+' ↗');button.type='button';button.className='guide-link';button.dataset.external=match[2];button.disabled=typeof onExternal!=='function';
     button.addEventListener('click',()=>{if(!button.disabled)onExternal(match[2]);});
    }else add('span',match[1]);
   }else add(match[3]?'code':'strong',match[3]||match[4]);
   offset=match.index+match[0].length;
  }
  if(offset<text.length)add('span',text.slice(offset));
 }
 function render(document,parent,blocks,{onExternal}={}){
  const add=(target,tag,text)=>{const node=document.createElement(tag);if(text)inline(document,node,text,onExternal);target.appendChild(node);return node;};
  const article=add(parent,'article');article.className='help-manual';
  for(const block of blocks){
   if(block.type==='heading'){if(block.level>1)add(article,'h2',block.text);}
   else if(block.type==='paragraph')add(article,'p',block.text);
   else if(block.type==='list'){const list=add(article,block.ordered?'ol':'ul');for(const item of block.items)add(list,'li',item);}
   else if(block.type==='table'){
    const wrapper=add(article,'div');wrapper.className='guide-table';wrapper.setAttribute('tabindex','0');wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label','配置与排查说明表格，可横向滚动');
    const table=add(wrapper,'table'),head=add(table,'thead'),body=add(table,'tbody');
    for(const[index,cells]of block.rows.entries()){const row=add(index?body:head,'tr');for(const cell of cells){const node=add(row,index?'td':'th',cell);if(!index)node.setAttribute('scope','col');}}
   }
  }
  return article;
 }
 return {render};
});
