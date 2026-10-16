(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('../lib/appearance-config'):root.AppearanceConfig);if(typeof module==='object'&&module.exports)module.exports=api;else root.Appearance=api;})(typeof globalThis!=='undefined'?globalThis:this,config=>{
  'use strict';
  function applyAppearance(root,appearance){
    const normalized=config.normalizeAppearance(appearance);
    root.dataset.theme=normalized.theme;
    root.dataset.layout=normalized.layout;
    syncMaterialFallback(root);
    return normalized;
  }
  function syncMaterialFallback(root){
    if(!root?.ownerDocument)return;
    delete root.dataset.materialFallback;
    if(root.dataset.theme!=='coral-glow')return;
    const view=root.ownerDocument.defaultView,utility=root.ownerDocument.getElementById('utility');
    const supported=view.CSS?.supports?.('backdrop-filter','blur(1px)');
    if(!supported||view.matchMedia?.('(prefers-reduced-transparency: reduce)').matches
      ||(utility?.open&&view.getComputedStyle(utility).backdropFilter==='none'))root.dataset.materialFallback='solid';
  }
  function createAppearanceController({root=globalThis.document.documentElement,api=globalThis.api}={}){
    let appearance=applyAppearance(root,root.dataset),saved={...appearance},status='loading',error='',revision=0,receivedBroadcast=false,initialized=false,task=null;
    const listeners=new Set();
    const snapshot=()=>({appearance:{...appearance},savedAppearance:{...saved},status,error});
    const notify=()=>{const value=snapshot();for(const listener of listeners)listener(value);};
    const stop=api?.onAppearanceChanged?.(next=>{
      receivedBroadcast=true;
      // Save IPC broadcasts precede their responses; keep the newest local intent visible.
      if(task||revision)return;
      saved=appearance=applyAppearance(root,next);status='saved';error='';notify();
    });
    const ready=(async()=>{
      try{const loaded=await api?.getAppearance?.();if(!receivedBroadcast)saved=appearance=applyAppearance(root,loaded);status='saved';}
      catch{status='error';error='外观读取失败，已使用默认外观。';}
      initialized=true;notify();
    })();
    async function drain(){
      await ready;
      while(revision){
        const current=revision,draft={...appearance};
        try{
          const result=await api.saveAppearance(draft);
          if(!result?.success||!result.appearance)throw Error(typeof result?.error==='string'?result.error:'外观保存失败，请重试。');
          saved=config.normalizeAppearance(result.appearance);
          if(current===revision){appearance=applyAppearance(root,saved);status='saved';error='';revision=0;}
        }catch(failure){
          if(current===revision){appearance=applyAppearance(root,saved);status='error';error=failure?.message||'外观保存失败，请重试。';revision=0;}
        }
        notify();
      }
    }
    function select(theme){
      if(!initialized)return ready.then(()=>select(theme));
      if(!config.THEME_IDS.includes(theme))return Promise.resolve(snapshot());
      appearance=applyAppearance(root,{theme});revision++;status='saving';error='';notify();
      if(!task)task=drain().finally(()=>{task=null;});
      return task.then(snapshot);
    }
    return {ready,snapshot,select,
      subscribe(listener){listeners.add(listener);listener(snapshot());return ()=>listeners.delete(listener);},
      dispose(){if(typeof stop==='function')stop();listeners.clear();}
    };
  }
  async function initializeAppearance(options){const controller=createAppearanceController(options);await controller.ready;return {appearance:controller.snapshot().appearance,unsubscribe:()=>controller.dispose()};}
  return {applyAppearance,createAppearanceController,initializeAppearance,syncMaterialFallback,THEME_OPTIONS:config.THEME_OPTIONS};
});
