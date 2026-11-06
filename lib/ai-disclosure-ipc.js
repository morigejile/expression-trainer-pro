'use strict';

function registerAiDisclosureIpc({ipcMain,getMainWebContents,mainUrl,getState,acknowledge}) {
  function allowed(event) {
    const contents=getMainWebContents();
    if (!contents || contents.isDestroyed() || event.sender!==contents || event.senderFrame!==contents.mainFrame) return false;
    try {const url=new URL(event.senderFrame.url);url.hash='';return url.href===mainUrl;} catch{return false;}
  }
  const fail=(errorCode,error)=>({success:false,errorCode,error});
  function fields(value,names) {
    return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(key=>names.includes(key));
  }
  function getError(error) {
    const messages={
      'unsupported-schema-version':'当前版本无法更新更高版本的 AI 告知记录，请使用兼容版本。',
      'invalid-disclosure-json':'AI 告知记录不可读取，尚未确认新的分析数据范围。',
      'disclosure-scope-stale':'分析数据范围已更新，请重新查看说明后确认。'
    };
    return fail(Object.hasOwn(messages,error?.code)?error.code:'disclosure-save-failed',
      messages[error?.code] || 'AI 告知确认保存失败，请重试。');
  }
  ipcMain.handle('get-ai-disclosure-state',async (event,options={})=>{
    if (!allowed(event)) return fail('forbidden','当前窗口不能访问 AI 告知。');
    if (!fields(options,['profileId']) || options.profileId!==undefined &&
      (typeof options.profileId!=='string' || !options.profileId.trim() || options.profileId.length>128)) {
      return fail('invalid-ipc-input','AI 告知请求无效。');
    }
    try{return await getState(options);}catch{return fail('configuration-unavailable','AI 配置暂时无法读取，请重试。');}
  });
  ipcMain.handle('acknowledge-ai-disclosure',async (event,options)=>{
    if (!allowed(event)) return fail('forbidden','当前窗口不能确认 AI 告知。');
    if (!fields(options,['scopeVersion']) || typeof options.scopeVersion!=='string' || !options.scopeVersion || options.scopeVersion.length>100) {
      return fail('invalid-ipc-input','AI 告知确认请求无效。');
    }
    try {await acknowledge(options);return {success:true,...await getState({})};}catch(error){return getError(error);}
  });
}
module.exports={registerAiDisclosureIpc};
