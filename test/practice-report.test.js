'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {renderPractice}=require('../src/practice-report');
class Node {
  constructor(tag,className='',text=''){this.tagName=tag.toUpperCase();this.className=className||'';this.text=text||'';this.children=[];this.listeners={};this.open=false;}
  append(...nodes){this.children.push(...nodes);}appendChild(node){this.children.push(node);return node;}
  replaceChildren(...nodes){this.children=nodes;}set textContent(text){this.text=text;this.children=[];}get textContent(){return this.text+this.children.map(n=>n.textContent).join('');}
  setAttribute(key,value){this[key]=String(value);}addEventListener(key,handler){this.listeners[key]=handler;}
  click(){return this.listeners.click?.();}toggle(){return this.listeners.toggle?.();}
}
const element=(tag,className,text)=>new Node(tag,className,text);
const find=(node,name)=>[...(node.className.split(' ').includes(name)?[node]:[]),...node.children.flatMap(child=>find(child,name))];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({missing=false,failed=false,invalidRef=false,withoutReport=false,unsaved=false,historyRows,audioAvailable=false,apiOverrides,feedbackOverride}={}) {
  const wrap=(id,kind,value,status='completed')=>({id,kind,value,status,sessionId:'previous',inputRevision:1});
  const previous={id:'previous',status:'completed',trainingMode:'free',framework:null,trainingPrompt:null,artifact:{state:'missing'},transcript:{revision:1,segments:[{id:'p',text:'上一轮真实原文',startMs:100,endMs:1000,timingSource:'estimated'}]},results:[
    wrap('e','speech-evidence',{schemaVersion:1,segments:[]}),wrap('m','common-analysis',{schemaVersion:1,speechEvidenceRunId:'e',metrics:[]}),
    wrap('d','diagnosis',{schemaVersion:1,speechEvidenceRunId:'e',metricRunId:'m',summary:'前轮摘要',findings:[]}),
    wrap('r','report-snapshot',{schemaVersion:1,availability:'partial',evidenceRunId:'e',metricRunId:'m',analysisRunId:'d'})]};
  const record={id:'current',factsSaved:true,trainingMode:'free',framework:null,trainingPrompt:null,audioState:'missing',segments:[{id:'c',text:'本轮真实原文',startMs:200,endMs:1100,timingSource:'estimated'}],practice:{chainId:'chain',round:3,scope:'sentence',previousSessionId:'previous',previousReportId:'r',origin:{sessionId:'origin',reportId:'origin-r'},goal:{observation:'真实目标',recommendation:'真实建议'}}};
  if(unsaved){record.factsSaved=false;record.saveState='failed';}
  if(audioAvailable){previous.artifact.state='available';record.audioState='available';}
  const projection=withoutReport?null:{snapshot:{id:'current-r'},analysisRun:{status:failed?'failed':'completed',value:{reason:failed?'timeout':null,practiceFeedback:{status:'improved',summary:'已保存的改善结论',previousEvidenceRefs:[invalidRef?'missing':'p'],currentEvidenceRefs:['c']}}}};
  if (feedbackOverride) Object.assign(projection.analysisRun.value.practiceFeedback,feedbackOverride);
  const calls=[],opens=[];const api={getTrainingSession:async command=>{calls.push(command);return {ok:true,value:missing?null:previous};},getPracticeHistory:async command=>{calls.push(command);return {ok:true,value:historyRows || [{round:1,sessionId:'origin',reportId:'origin-r',deleted:false,summary:'基准表达',evidence:[]},{round:2,sessionId:'previous',reportId:'r',deleted:true,summary:null},{round:3,sessionId:'current',reportId:'current-r',deleted:false,summary:'当前反馈',evidence:[]}]};}};
  Object.assign(api,apiOverrides);
  const root=element('div'),dispose=renderPractice(element,root,{record,projection,api,frozen:true,onPractice:()=>{},onOpen:(...args)=>opens.push(args)});
  return {root,record,previous,projection,calls,opens,api,dispose};
}

test('unavailable comparability is not displayed as unchanged even when both reference sets exist',async()=>{
  const f=fixture({feedbackOverride:{status:'unchanged',summary:'无法判断组织层面的改善。',
    comparability:{status:'unavailable',reason:'当前材料不对应所选目标。'}}});
  await tick();
  assert.match(find(f.root,'practice-change')[0].textContent,/暂时无法可靠比较/);
  assert.doesNotMatch(find(f.root,'practice-change')[0].textContent,/变化不明显/);
  assert.match(find(f.root,'practice-source-status')[0].textContent,/当前材料不对应所选目标/);
  f.dispose();
});
test('frozen targeted report orders evidence and history before scope/continuation and pins history',async()=>{
  const f=fixture();await tick();const section=find(f.root,'practice-result')[0];
  assert.ok(section.children.indexOf(find(section,'practice-evidence')[0])<section.children.indexOf(find(section,'practice-goal')[0]));
  assert.ok(section.children.indexOf(find(section,'practice-history')[0])<section.children.indexOf(find(section,'practice-goal')[0]));
  const history=find(section,'practice-history')[0];history.open=true;await history.toggle();
  assert.equal(f.calls.at(-1).reportId,'current-r');assert.match(section.textContent,/基准/);assert.match(section.textContent,/来源报告已删除/);
  f.dispose();
});
test('saved comparison uses actual references and marks estimated time; missing audio is local degradation',async()=>{
  const f=fixture();await tick();const evidence=find(f.root,'practice-evidence')[0];evidence.open=true;await evidence.toggle();
  assert.match(evidence.textContent,/上一轮真实原文/);assert.match(evidence.textContent,/本轮真实原文/);assert.match(evidence.textContent,/估计/);
  assert.match(evidence.textContent,/录音.*不可用/);assert.match(f.root.textContent,/已保存的改善结论/);f.dispose();
});
for(const mode of ['deleted','failed','invalid-ref'])test(`${mode} cannot display saved improvement as currently verifiable`,async()=>{
  const f=fixture({missing:mode==='deleted',failed:mode==='failed',invalidRef:mode==='invalid-ref'});await tick();
  assert.doesNotMatch(f.root.textContent,/已保存的改善结论/);assert.match(f.root.textContent,/真实目标/);assert.match(f.root.textContent,/无法|未完成|不可用/);f.dispose();
});

test('an unavailable comparison does not hide a healthy fixed report in the history',async()=>{
  const f=fixture({historyRows:[
    {round:1,sessionId:'origin',reportId:'origin-r',deleted:true,summary:null},
    {round:2,sessionId:'previous',reportId:'r',deleted:false,summary:'来源报告已删除，历史变化结论无法复核',availability:'unavailable',availabilityReasons:['source-deleted']},
    {round:3,sessionId:'missing-snapshot',reportId:'missing-r',deleted:false,availability:'unavailable',availabilityReasons:['report-unavailable']}
  ]});await tick();const history=find(f.root,'practice-history')[0];history.open=true;await history.toggle();
  const buttons=find(history,'text-action');assert.equal(buttons.length,1);await buttons[0].click();
  assert.deepEqual(f.opens,[['previous','r',2]]);f.dispose();
});

test('a missing fixed report retains the target without implying save success or choosing a newer report',async()=>{
  const f=fixture({withoutReport:true,unsaved:true});await tick();
  assert.match(f.root.textContent,/真实目标/);assert.match(f.root.textContent,/本轮训练尚未保存/);
  assert.doesNotMatch(f.root.textContent,/本轮练习已保存|已保存的改善结论/);
  assert.equal(find(f.root,'practice-start')[0].disabled,true);
  const history=find(f.root,'practice-history')[0];history.open=true;await history.toggle();
  assert.match(history.textContent,/固定报告暂不可用/);assert.equal(f.calls.some(call=>call.sessionId==='current'),false);f.dispose();
});

for(const pendingStage of ['audio','session'])test(`a late ${pendingStage} read cannot revive playback after evidence is collapsed and reopened`,async t=>{
  let resolveRead;const pending=new Promise(resolve=>{resolveRead=resolve;});
  const createUrl=URL.createObjectURL;let urlsCreated=0;
  URL.createObjectURL=()=>{urlsCreated++;return 'blob:late';};t.after(()=>{URL.createObjectURL=createUrl;});
  const f=fixture({audioAvailable:true,apiOverrides:{readTrainingAudio:()=>pendingStage==='audio'?pending:Promise.resolve({ok:true,value:new Uint8Array([1])})}});await tick();
  const evidence=find(f.root,'practice-evidence')[0];evidence.open=true;await evidence.toggle();
  if(pendingStage==='session'){let reads=0;f.api.getTrainingSession=()=>++reads===1?pending:Promise.resolve({ok:true,value:f.previous});}
  const playing=find(evidence,'practice-play-previous')[0].click();
  await tick();
  evidence.open=false;await evidence.toggle();evidence.open=true;await evidence.toggle();
  resolveRead({ok:true,value:pendingStage==='audio'?new Uint8Array([1]):f.previous});await playing;
  assert.equal(urlsCreated,0);assert.equal(find(evidence,'practice-play-previous').length,1);f.dispose();
});
