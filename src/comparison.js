(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.SessionComparison=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const node=typeof module==='object' && module.exports;
  const {CATEGORIES,selectStructuredReport}=node?require('../shared/report-selection'):globalThis.ReportSelection;
  const {sessionToRecord}=node?require('./training-persistence'):globalThis.TrainingPersistence;
  const REASONS={
    'metric-unavailable':'该项没有已保存的有效测量','report-unavailable':'没有已保存的结构化报告',
    'unsupported-metric-version':'指标定义或计算版本未知，暂不计算差值','invalid-metric':'已保存指标与其输入或单位不一致',
    'lexicon-unknown':'当次词表来源未保存','lexicon-mismatch':'两次统计使用的词表不同',
    'asr-source-unknown':'识别来源信息不完整','asr-source-mismatch':'识别模型或版本不同',
    'vad-source-unknown':'语音检测来源信息不完整','vad-source-mismatch':'语音检测模型或配置不同',
    'unit-mismatch':'两侧计量单位不同','audio-unavailable':'音频缺失或不可用',
    'audio-timing-invalid':'音频时间信息不完整','audio-coverage-incomplete':'音频覆盖不完整',
    'asr-incomplete':'转写覆盖不完整','vad-unavailable':'语音活动证据不可用',
    'vad-evidence-invalid':'语音活动证据无效','vad-coverage-incomplete':'语音活动证据覆盖不完整',
    'no-recorded-duration':'没有有效录音时长','no-measured-text':'没有可计数文本',
    'no-observed-speech':'没有检测到可用语音时长','local-stats-unavailable':'未保存当次词项统计',
    'local-stats-invalid':'词项统计与转写不一致','transcript-unavailable':'没有可用转写',
    'transcript-evidence-invalid':'转写证据无效'
  };
  const UNITS={characters:'字',occurrences:'次',ms:'毫秒',percent:'%',
    'characters/recorded-minute':'字/录音分钟','characters/speech-minute':'字/检测语音分钟',
    'occurrences/recorded-minute':'次/录音分钟','percentage-points':'个百分点'};
  const number=value=>Number.isFinite(value)?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value):'不可用';
  const valueText=(value,unit)=>Number.isFinite(value)?`${number(value)} ${UNITS[unit] || unit}`:'不可用';
  const reasonText=reason=>REASONS[reason] || '证据或分析暂不可用';

  function renderComparison(container,projection,{onReport=()=>{},onPlay=()=>{}}={}) {
    const document=container.ownerDocument;
    const element=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
    const button=(text,action)=>{const el=element('button','btn-support btn-support-secondary',text);el.type='button';el.addEventListener('click',action);return el;};
    function details(parent,key,label,build) {
      const el=element('details','comparison-details');el.dataset.detailKey=key;
      el.appendChild(element('summary',null,label));let built=false;
      el.populateEvidence=()=>{if(el.open && !built){built=true;build(el);}};
      el.addEventListener('toggle',el.populateEvidence);
      parent.appendChild(el);return el;
    }
    function evidence(parent,side,refs,visited=new Set()) {
      for(const ref of [...new Set(refs)]) {
        if(visited.has(ref))continue;
        const branch=new Set(visited);branch.add(ref);
        const item=side.evidence[ref];const row=element('div','comparison-evidence');parent.appendChild(row);
        if(!item?.available){row.appendChild(element('p','comparison-note','该证据已缺失或不可用。'));continue;}
        if(item.kind==='metric') {
          row.appendChild(element('p',null,`${item.label}：${valueText(item.value,item.unit)}`));
          evidence(row,side,item.evidenceRefs,branch);continue;
        }
        if(item.kind==='transcript')row.appendChild(element('blockquote',null,item.text));
        const hasTime=Number.isFinite(item.startMs) && Number.isFinite(item.endMs);
        if(hasTime)row.appendChild(element('p','comparison-note',`${number(item.startMs/1000)}–${number(item.endMs/1000)} 秒${item.timingSource==='estimated'?'（估计位置）':item.kind==='speech'?'（语音检测区间，未校准）':''}`));
        else row.appendChild(element('p','comparison-note','没有可靠时间位置，可查看原文。'));
        if(side.evidence.audio.available && hasTime) {
          const player=element('audio','comparison-player');player.controls=true;player.preload='none';player.hidden=true;
          const status=element('p','comparison-note');status.setAttribute('role','status');
          row.appendChild(button('播放此处',()=>onPlay(side===projection.baseline?'baseline':'target',ref,player,status)));
          row.appendChild(player);row.appendChild(status);
        } else if(!side.evidence.audio.available)row.appendChild(element('p','comparison-note','音频不可用，文字仍可复盘。'));
      }
    }
    container.replaceChildren();
    const sides=[projection.baseline,projection.target];
    const header=element('div','comparison-pair');container.appendChild(header);
    sides.forEach((side,index)=>{
      const role=index===0?'baseline':'target';const card=element('section','comparison-card');header.appendChild(card);
      card.appendChild(element('h2',null,index===0?'基线 · 较早记录':'目标 · 较晚记录'));
      card.appendChild(element('p',null,new Date(side.session.createdAt).toLocaleString()));
      const audioDuration=side.evidence.audio.endMs;
      card.appendChild(element('p','comparison-note',`${side.session.trainingMode==='structured'?(side.session.framework || '结构化表达'):'自由表达'} · ${valueText(Number.isFinite(audioDuration)?audioDuration/1000:null,'秒')}`));
      const prompt=side.session.trainingPrompt;
      if(prompt?.text)card.appendChild(element('p',null,prompt.text));
      const report=button('查看完整报告',()=>onReport(role));report.dataset.comparisonReport=role;card.appendChild(report);
      details(card,`original-${role}`,'查看原文与录音',body=>{
        body.appendChild(element('p','comparison-note',`识别来源：${side.sources.asr?.modelId || '未知'} · ${side.sources.asr?.modelVersion || '版本未知'}`));
        const refs=(side.session.transcript?.segments || []).map(segment=>segment.id);
        if(!refs.length)body.appendChild(element('p',null,side.session.transcript?.text || '暂无可读原文。'));
        evidence(body,side,['audio',...refs]);
      });
    });
    container.appendChild(element('p','comparison-note','差值 = 目标 − 基线。数值变化是本次表达的观察，不代表能力提升或下降。'));
    if(projection.limitations.includes('framework-mismatch'))container.appendChild(element('p','comparison-note','两次训练框架不同，结构化指标无法直接比较；其他可用证据仍可查看。'));
    const analysis=element('section','comparison-analysis');container.appendChild(analysis);
    analysis.appendChild(element('h2',null,'问题与建议复盘'));
    analysis.appendChild(element('p','comparison-note','暂未建立跨录音问题对应。以下为两侧已保存的发现，不自动判断改善、持续或新出现；缺少发现不表示问题消失。'));
    for(const [category,label] of Object.entries(CATEGORIES)) {
      if(!sides.some(side=>side.findings.some(finding=>finding.category===category)))continue;
      details(analysis,`category-${category}`,label,body=>{
        const columns=element('div','comparison-pair');body.appendChild(columns);
        sides.forEach((side,index)=>{
          const column=element('section','comparison-card');columns.appendChild(column);column.appendChild(element('h3',null,index===0?'基线':'目标'));
          const findings=side.findings.filter(finding=>finding.category===category);
          if(!findings.length)column.appendChild(element('p',null,'该侧未返回此类发现，不代表没有问题。'));
          for(const finding of findings) {
            const findingEl=element('article','comparison-finding');column.appendChild(findingEl);
            findingEl.appendChild(element('p','finding-observation',finding.observation));
            findingEl.appendChild(element('p',null,finding.interpretation));
            findingEl.appendChild(element('p',null,finding.recommendation));
            evidence(findingEl,side,finding.evidenceRefs);
          }
        });
      });
    }
    sides.forEach((side,index)=>{if(side.diagnosisStatus!=='completed')analysis.appendChild(element('p','comparison-note',`${index===0?'基线':'目标'}：诊断不可用，已保存的文字、音频和指标仍可查看。`));});
    if(sides.every(side=>side.diagnosisStatus==='completed' && !side.findings.length))analysis.appendChild(element('p',null,'两侧报告均未形成有充分证据的改善建议，不据此判断问题已解决。'));
    const measurements=element('section','comparison-measurements');container.appendChild(measurements);measurements.appendChild(element('h2',null,'指标变化'));
    for(const metric of projection.metrics) {
      const row=element('article','comparison-metric');measurements.appendChild(row);row.dataset.metricId=metric.id;
      row.appendChild(element('h3',null,metric.label));
      const values=element('div','comparison-values');row.appendChild(values);
      values.appendChild(element('p',null,`基线：${valueText(metric.baseline?.value,metric.baseline?.rawUnit || metric.unit)}`));
      values.appendChild(element('p',null,`目标：${valueText(metric.target?.value,metric.target?.rawUnit || metric.unit)}`));
      values.appendChild(element('p','comparison-delta',metric.delta===null?'差值：—':`差值：${metric.delta>0?'+':''}${valueText(metric.delta,metric.deltaUnit)}`));
      row.appendChild(element('p','comparison-note',metric.status==='unavailable'?`暂时无法可靠比较：${metric.reasons.map(reasonText).join('；')}`:
        metric.status==='normalized'?'需归一化 · 已按保存的速率/占比口径比较，保留各自分母。':'可比 · 总量差异受表达长度与任务影响。'));
      if(metric.limitations.includes('vad-uncalibrated'))row.appendChild(element('p','comparison-note','语音检测尚未完整校准；区间差异不等于停顿过长或不流利。'));
      if(metric.limitations.includes('asr-observation-only'))row.appendChild(element('p','comparison-note','识别来源不同或未知，文字差异可能来自识别结果。'));
      details(row,`metric-${metric.id}`,'查看两侧证据',body=>{
        sides.forEach((side,index)=>{const section=element('section','comparison-evidence-side');body.appendChild(section);section.appendChild(element('h4',null,index===0?'基线证据':'目标证据'));
          const value=index===0?metric.baseline:metric.target;
          if(!value?.available)section.appendChild(element('p','comparison-note',reasonText(value?.reason)));
          else evidence(section,side,value.evidenceRefs);
        });
      });
    }
    container.appendChild(element('p','comparison-note','雷达未校准，暂不提供雷达数值对比。'));
  }

  function createComparisonController({trainer,api,document}) {
    const selection=new Set();let context=null,loading=false,request=0,action=0;
    const get=id=>document.getElementById(id);
    const content=get('comparison-content'),status=get('comparison-status'),area=get('comparison-screen');
    const compareButton=get('btn-history-compare'),retry=get('btn-comparison-retry');
    const urls=new Map();let activePlayer=null;
    function stopAudio() {activePlayer?.pause();activePlayer=null;}
    function releaseAudio() {stopAudio();for(const url of urls.values())trainer.getObjectUrlApi().revokeObjectURL(url);urls.clear();}
    function syncSelection() {
      for(const checkbox of trainer.historyList.querySelectorAll('[data-compare-id]')) {
        checkbox.checked=selection.has(checkbox.dataset.compareId);
        checkbox.disabled=checkbox.dataset.unavailable==='true' || (selection.size===2 && !checkbox.checked);
      }
      compareButton.disabled=selection.size!==2;
      get('history-selection-status').textContent=`已选择 ${selection.size}/2 条训练`;
    }
    function addChoice(row,item) {
      const label=document.createElement('label');label.className='history-compare-choice';
      const input=document.createElement('input');input.type='checkbox';input.dataset.compareId=item.id;
      input.dataset.unavailable=String(Boolean(item.deletionPending || ['recording','finalizing'].includes(item.status)));
      input.setAttribute('aria-label',`选择 ${new Date(item.createdAt).toLocaleString()} 的训练用于对比`);
      input.addEventListener('change',()=>{if(input.checked && selection.size<2)selection.add(item.id);else selection.delete(item.id);syncSelection();});
      label.appendChild(input);row.appendChild(label);
    }
    function leave(clearSelection=false) {
      request++;action++;loading=false;context=null;releaseAudio();content.replaceChildren();
      if(clearSelection)selection.clear();syncSelection();
    }
    function fail(error) {
      releaseAudio();content.replaceChildren();status.textContent=error?.message || '无法读取对比，请重试。';
      area.dataset.availability='unavailable';retry.hidden=false;
    }
    function capture() {
      if(!context)return;
      context.scroll=area.scrollTop;
      context.expanded=new Set([...content.querySelectorAll('details[data-detail-key]')].filter(el=>el.open).map(el=>el.dataset.detailKey));
    }
    function draw() {
      if(!context?.projection)return;
      const p=context.projection;
      stopAudio();renderComparison(content,p,{onReport:openReport,onPlay:play});
      area.dataset.availability=p.availability;
      status.textContent=p.availability==='ready'?'已读取两次训练的保存结果':p.availability==='partial'?'部分项目暂不可比；可用内容仍可复盘。':'核心证据不足，暂时无法完成有意义的对比。';
      retry.hidden=p.availability!=='unavailable';
      for(const el of content.querySelectorAll('details[data-detail-key]'))if(context.expanded?.has(el.dataset.detailKey)){el.open=true;el.populateEvidence();}
      area.scrollTop=context.scroll || 0;
    }
    async function read(expected=context) {
      if(!expected)return null;
      const sequence=++request,navigation=trainer.navigationGeneration;loading=true;
      try {
        const p=expected.projection;
        const response=await api.compareTrainingSessions({requestId:globalThis.crypto.randomUUID(),sessionIds:expected.ids,
          ...(p?{snapshots:[p.baseline.snapshot,p.target.snapshot]}:{})});
        if(context!==expected || sequence!==request || navigation!==trainer.navigationGeneration)return null;
        if(!response?.ok)throw new Error(response?.error?.message || '无法读取对比，请重试。');
        expected.projection=response.value;return response.value;
      } catch(error) {if(context===expected && sequence===request && navigation===trainer.navigationGeneration)fail(error);return null;}
      finally {if(sequence===request)loading=false;}
    }
    async function open() {
      if(selection.size!==2 || trainer.isRecording || trainer.asrStartAttempt || trainer.recordingStopOperation)return;
      releaseAudio();request++;action++;
      trainer.historyScroll=get('history-screen').scrollTop;trainer.historyReturnFocus='btn-history-compare';
      trainer.audioPlayer?.pause();trainer.releaseSavedRecordCache();
      context={ids:[...selection],projection:null,expanded:new Set(),scroll:0};
      trainer.setScreen('comparison');content.replaceChildren();status.textContent='正在读取两次训练…';retry.hidden=true;
      area.focus();if(await read())draw();
    }
    async function restore() {
      if(!context)return trainer.showHistory({restore:true});
      action++;
      trainer.audioPlayer?.pause();trainer.setScreen('comparison');status.textContent='正在检查原对比…';
      if(await read()){draw();content.querySelector(`[data-comparison-report="${context.reportSide || 'baseline'}"]`)?.focus({preventScroll:true});}
    }
    async function openReport(role) {
      if(!context || loading)return;capture();stopAudio();
      const operation=++action,expected=context;let p=await read(expected);if(!p || operation!==action)return;
      let side=p[role];const navigation=trainer.navigationGeneration;
      let audio=null;
      if(side.evidence.audio.available)audio=await api.readTrainingAudio({requestId:globalThis.crypto.randomUUID(),sessionId:side.session.id}).catch(()=>null);
      if(context!==expected || trainer.navigationGeneration!==navigation || operation!==action)return;
      // Audio loading yields to deletion/repair. Revalidate the pinned input before
      // adding any cached record or Blob URL to the shared Report workspace.
      p=await read(expected);if(!p || operation!==action)return;side=p[role];
      const record=sessionToRecord(side.session);
      record.structuredReport=selectStructuredReport(record.results,{snapshotId:side.snapshot.reportId});
      if(audio?.ok)record.audioUrl=trainer.getObjectUrlApi().createObjectURL(new Blob([audio.value],{type:'audio/wav'}));
      else if(record.audioState==='available')record.audioState='missing';
      const store=trainer.getTrainingRecordStore();
      const existing=store.list().find(item=>item.id===record.id);
      if(existing && (existing.reportPending || existing.playbackPending || ['failed','saving'].includes(existing.saveState))) {
        // Preserve pending writes and their identity; the comparison itself stays pinned.
        if(record.audioUrl)trainer.getObjectUrlApi().revokeObjectURL(record.audioUrl);
        trainer.showRecord(existing,'comparison');
      } else {store.remove(record.id);store.add(record);trainer.showRecord(record,'comparison');}
      expected.reportSide=role;trainer.reportBack.focus();
    }
    async function play(role,ref,player,message) {
      const operation=++action,expected=context;if(!expected)return;
      message.textContent='正在读取录音…';const p=await read(expected);if(!p)return;
      const side=p[role],evidence=side.evidence[ref];
      if(!evidence?.available || !side.evidence.audio.available){message.textContent='这条证据的音频已不可用，原文仍可查看。';return;}
      const navigation=trainer.navigationGeneration;
      const audio=await api.readTrainingAudio({requestId:globalThis.crypto.randomUUID(),sessionId:side.session.id}).catch(()=>null);
      if(context!==expected || navigation!==trainer.navigationGeneration || operation!==action)return;
      if(!audio?.ok){message.textContent='录音已不可用，请重试或返回历史检查记录。';return;}
      if(!await read(expected) || operation!==action)return;
      stopAudio();let url=urls.get(side.session.id);
      if(!url){url=trainer.getObjectUrlApi().createObjectURL(new Blob([audio.value],{type:'audio/wav'}));urls.set(side.session.id,url);}
      player.src=url;player.hidden=false;activePlayer=player;
      player.onloadedmetadata=()=>{player.currentTime=(evidence.startMs || 0)/1000;};
      player.ontimeupdate=()=>{if(Number.isFinite(evidence.endMs) && player.currentTime>=evidence.endMs/1000)player.pause();};
      try {await player.play();message.textContent=role==='baseline'?'正在播放基线录音':'正在播放目标录音';}
      catch {message.textContent='未能播放录音，可使用播放器重试。';}
    }
    compareButton.addEventListener('click',()=>void open());
    get('btn-comparison-back').addEventListener('click',()=>void trainer.showHistory({restore:true}));
    retry.addEventListener('click',async()=>{capture();status.textContent='正在重试读取…';if(await read())draw();});
    syncSelection();
    return {addChoice,syncSelection,open,restore,leave,read,openReport,
      remove(id){selection.delete(id);if(context?.ids.includes(id)){request++;context=null;fail(new Error('对比记录已删除，请返回训练历史。'));}syncSelection();},
      get context(){return context;},get selection(){return selection;},get loading(){return loading;}};
  }
  return {renderComparison,createComparisonController};
});
