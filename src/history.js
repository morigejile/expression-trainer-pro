(function(root,factory){const context=typeof module==='object'&&module.exports?require('../shared/training-context'):root.TrainingContext;const api=factory(context);if(typeof module==='object'&&module.exports)module.exports=api;else root.TrainingHistory=api;})(typeof globalThis!=='undefined'?globalThis:this,context=>{
  'use strict';
  const modes={prep:'PREP',star:'STAR',pyramid:'金字塔'};
  function describe(item){
    let parts={topic:null,scenario:null};try{parts=context.getPromptParts(item.trainingPrompt);}catch{}
    const mode=item.trainingMode==='free'?'自由表达':item.trainingMode==='structured'?(modes[item.framework] || '结构化表达'):'训练方式未保存';
    const ms=item.audioDurationMs;
    const duration=Number.isFinite(ms)&&ms>=0?`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`:'录音时长不可用';
    const state=item.deletionPending?'删除未完成':({completed:'报告可查看',incomplete:'未完成',corrupt:'记录损坏',recording:'录音中',finalizing:'保存中'}[item.status] || '记录状态未知');
    return {title:parts.topic?.text || mode,mode,date:new Date(item.createdAt).toLocaleString(),duration,state,
      context:[parts.scenario?.text,item.practice?`针对性练习第 ${item.practice.round} 轮 · ${item.practice.goal.observation}`:null].filter(Boolean).join(' · ')};
  }
  function renderRow(document,item,{comparison,onOpen,onDelete}){
    const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
    const info=describe(item),row=node('div','history-row history-entry');row.dataset.historyId=item.id;
    comparison?.addChoice(row,item);
    const open=node('button','history-row-main');open.type='button';open.dataset.recordId=item.id;
    open.disabled=Boolean(item.deletionPending || ['recording','finalizing'].includes(item.status));
    if(document.createElementNS){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');for(const [key,value] of Object.entries({class:'mic',width:'22',height:'24',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.3','aria-hidden':'true'}))svg.setAttribute(key,value);const rect=document.createElementNS(ns,'rect');for(const [key,value] of Object.entries({x:'8',y:'2',width:'8',height:'13',rx:'4'}))rect.setAttribute(key,value);const path=document.createElementNS(ns,'path');path.setAttribute('d','M5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8');svg.appendChild(rect);svg.appendChild(path);open.appendChild(svg);}
    const text=node('div');text.appendChild(node('strong',null,info.title));text.appendChild(node('small',null,`${info.date} · ${info.duration} · ${info.mode} · ${info.state}`));if(info.context)text.appendChild(node('small',null,info.context));open.appendChild(text);
    open.addEventListener('click',()=>onOpen(item.id));
    const remove=node('button','history-row-actions',item.deletionPending?'重试删除':'删除');remove.type='button';remove.setAttribute('aria-label',`删除 ${info.date} · ${info.title}`);remove.addEventListener('click',()=>onDelete(item.id));
    row.appendChild(open);row.appendChild(remove);return row;
  }
  function createDeletionController({document,api,trainer,selection,items,confirm,onDeleted,onFailed,onRefresh,onStateChange}){
    const get=id=>document.getElementById(id);let task=null,busy=false,decision=null,ids=[];
    function cancel(){const waiting=decision;decision=null;waiting?.resolve(false);}
    function finish(value){const waiting=decision;decision=null;waiting?.resolve(value);trainer.closeModal(get('history-delete-modal'));}
    if(!confirm){
      get('btn-history-delete-confirm').addEventListener('click',()=>finish(true));
      for(const id of ['btn-history-delete-cancel','btn-history-delete-close'])get(id).addEventListener('click',()=>finish(false));
      get('history-delete-modal').addEventListener('closed',cancel);
      confirm=captured=>new Promise(resolve=>{
        decision={resolve};get('history-delete-title').textContent=captured.length===1?'删除这条记录？':`删除选中的 ${captured.length} 条记录？`;
        get('history-delete-description').textContent='将删除这些记录的录音、转写和分析结果。未选中的记录与后续练习不会一并删除，此操作无法撤销。';
        const list=get('history-delete-records');list.replaceChildren();
        for(const id of captured.slice(0,5)){const item=items.get(id),info=item?describe(item):null;const line=document.createElement('p');line.textContent=info?`${info.date} · ${info.title}`:'所选训练记录';list.appendChild(line);}
        if(captured.length>5){const line=document.createElement('p');line.textContent=`以及另外 ${captured.length-5} 条已选记录。`;list.appendChild(line);}
        get('btn-history-delete-confirm').textContent=captured.length===1?'删除这条记录':`删除 ${captured.length} 条记录`;
        get('btn-history-delete-confirm').disabled=false;trainer.openModal(get('history-delete-modal'),get('btn-history-delete-cancel'));
      });
    }
    function remove(requested){
      if(busy)return task;
      ids=[...new Set(requested)].filter(id=>typeof id==='string' && id);if(!ids.length)return Promise.resolve(null);
      const captured=[...ids];busy=true;onStateChange?.(captured,true);
      task=(async()=>{
        const deleted=[],failed=[];
        try{
          if(!await confirm(captured))return {cancelled:true,deleted,failed};
          for(const id of captured){
            let response;try{response=await api.deleteTrainingSession({requestId:globalThis.crypto.randomUUID(),sessionId:id});}catch{}
            let actual=null;
            if(!response?.ok && api.getTrainingSession){try{actual=await api.getTrainingSession({requestId:globalThis.crypto.randomUUID(),sessionId:id});}catch{}}
            if(response?.ok || actual?.ok && !actual.value){deleted.push(id);selection.delete(id);items.delete(id);onDeleted?.(id);}
            else{failed.push(id);selection.add(id);onFailed?.(id,actual?.ok?actual.value:null);}
          }
          await onRefresh?.(deleted,failed);
          get('history-status').textContent=failed.length?`已删除 ${deleted.length} 条；${failed.length} 条删除失败，仍保留选中，可重试删除。`:`已删除 ${deleted.length} 条记录。`;
          return {cancelled:false,deleted,failed};
        }finally{busy=false;ids=[];task=null;onStateChange?.([],false);}
      })();return task;
    }
    return {remove,cancel,get busy(){return busy;},get ids(){return [...ids];}};
  }
  return {describe,renderRow,createDeletionController};
});
