(function(root,factory) {
  const api=factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.AiDisclosure=api;
})(typeof globalThis!=='undefined'?globalThis:this,() => {
  'use strict';
  function createDisclosure({document,api,open,close,onPrivacy}={}) {
    const byId=id=>document.getElementById(id);
    const modal=byId('ai-disclosure-modal'), confirm=byId('btn-ai-disclosure-confirm');
    let pending=null;
    function cancel() {
      if (!pending) return;
      const decision=pending;pending=null;close(modal);decision.resolve(false);
    }
    async function accept() {
      const decision=pending;
      if (!decision || confirm.disabled) return;
      confirm.disabled=true;
      try {
        const result=await api.acknowledgeAiDisclosure({scopeVersion:decision.state.scopeVersion});
        if (pending!==decision) return;
        if (!result?.success) throw new Error(result?.error || 'AI 告知确认保存失败，请重试。');
        pending=null;close(modal);decision.resolve(true);
      } catch(error) {if (pending===decision) byId('ai-disclosure-error').textContent=error.message;}
      finally {if (!pending || pending===decision) confirm.disabled=false;}
    }
    confirm?.addEventListener('click',accept);
    for (const id of ['btn-ai-disclosure-cancel','btn-close-ai-disclosure']) byId(id)?.addEventListener('click',cancel);
    byId('btn-ai-disclosure-privacy')?.addEventListener('click',()=>{cancel();onPrivacy?.();});
    async function ensure({profileId,isCurrent=()=>true}={}) {
      const state=await api.getAiDisclosureState(profileId?{profileId}:{});
      if (!isCurrent()) return false;
      if (state?.success===false) throw new Error(state.error || 'AI 告知暂时无法读取。');
      if (!state?.profile) throw new Error('尚未配置有效的分析模型，请先检查设置。');
      if (!state.required) return true;
      if (!modal) throw new Error('AI 数据告知暂不可用，尚未发起分析。');
      if (pending) return pending.promise;
      const profile=state.profile;
      byId('ai-disclosure-service').textContent=`${profile.name} · ${profile.model} · ${profile.location==='local'?'本机回环地址':'远程服务'}\n${profile.endpoint}`;
      const data=byId('ai-disclosure-data');data.replaceChildren();
      for (const category of state.dataCategories) {
        const item=document.createElement('li');item.textContent=category.label;data.appendChild(item);
      }
      byId('ai-disclosure-error').textContent='';confirm.disabled=false;
      const decision={state};decision.promise=new Promise(resolve=>{decision.resolve=resolve;});pending=decision;
      open(modal,confirm);return decision.promise;
    }
    return {ensure,cancel,get modal(){return modal;}};
  }
  return {createDisclosure};
});
