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

  const context=node?require('../shared/training-context'):globalThis.TrainingContext;
  const labels={'audio-duration-ms':'录音时长','text-character-count':'转写字符数','filler-count':'填充词命中次数','filler-rate-per-recorded-minute':'填充词命中频率'};
  const limitations={'vad-uncalibrated':'VAD 检测尚未完整校准；区间差异不表示节奏评分。','asr-observation-only':'识别来源不同或未知，文字差异可能来自识别结果。','totals-not-quality':'总量差异受录音长度与表达范围影响，不表示能力评分。','saved-denominator':'按各自保存的分母比较；不混用字符数、墙钟时长或其他分母。'};
  function renderComparison(container,projection,{onReport=()=>{},onPlay=()=>{},onCollapse=()=>{}}){
    const document=container.ownerDocument,sides=[projection.baseline,projection.target];
    const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
    const button=(text,click)=>{const node=el('button','text-action',text);node.type='button';node.addEventListener('click',click);return node;};
    const value=(number,unit)=>unit==='ms' && Number.isFinite(number)?valueText(number/1000,'秒'):valueText(number,unit);
    function disclosure(parent,key,title,build){
      const node=el('details','report-disclosure comparison-details');node.dataset.detailKey=key;node.appendChild(el('summary',null,title));let built=false;
      node.populateEvidence=()=>{if(node.open && !built){built=true;const body=el('div');node.appendChild(body);build(body);}};
      node.addEventListener('toggle',()=>{if(node.open)node.populateEvidence();else onCollapse();});parent.appendChild(node);return node;
    }
    function evidence(parent,side,refs,visited=new Set()){
      for(const ref of new Set(refs || [])){
        if(visited.has(ref))continue;const branch=new Set(visited);branch.add(ref);
        const item=side.evidence[ref],block=el('div','evidence-block');parent.appendChild(block);
        if(!item?.available){block.appendChild(el('p','source-note','该证据已缺失或不可用。'));continue;}
        if(item.kind==='metric'){block.appendChild(el('p',null,`${labels[ref.slice(7)] || item.label}：${value(item.value,item.unit)}`));evidence(block,side,item.evidenceRefs,branch);continue;}
        if(item.kind==='transcript'){block.appendChild(el('span',null,'你的原话'));block.appendChild(el('blockquote','evidence-quote',item.text));}
        else block.appendChild(el('p','source-note',item.kind==='audio'?'已保存的录音':'VAD 模型检测区间，尚未校准。'));
        const timed=Number.isFinite(item.startMs)&&Number.isFinite(item.endMs);
        if(timed){const time=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
          const source=item.kind==='speech'?'检测区间':item.kind==='audio'?'录音范围':item.timingSource==='model-token'?'模型标记时间':'片段位置为估计值';
          block.appendChild(el('p','source-note',`${source} · ${time(item.startMs)}—${time(item.endMs)}`));
        }else block.appendChild(el('p','source-note','时间位置不可用，原文仍可查看。'));
        if(side.evidence.audio.available && timed){const player=el('audio','comparison-player');player.controls=true;player.preload='none';player.hidden=true;const status=el('p','source-note');status.setAttribute('role','status');const role=side===projection.baseline?'baseline':'target';block.appendChild(button('播放此处',()=>onPlay(role,ref,player,status)));block.appendChild(player);block.appendChild(status);}
        else if(!side.evidence.audio.available)block.appendChild(el('p','source-note','录音不可用，原文仍可查看。'));
      }
    }
    container.replaceChildren();
    const prompts=sides.map(side=>context.getPromptParts(side.session.trainingPrompt)),text=key=>prompts.map(parts=>parts[key]?.text || null);
    const topic=text('topic'),scenario=text('scenario');
    const subheading=[topic.every(value=>value===null)?'未设置主题':topic[0] && topic[0]===topic[1]?'同一主题':'不同主题',scenario.every(value=>value===null)?'未设置场景':scenario[0] && scenario[0]===scenario[1]?'同一场景':'不同场景',sides[0].session.trainingMode===sides[1].session.trainingMode && sides[0].session.framework===sides[1].session.framework?sides[0].session.trainingMode?context.formatTrainingContext({...sides[0].session,trainingPrompt:null}):'训练方式未保存':'不同训练方式'];
    document.getElementById('comparison-context').textContent=subheading.join(' · ');
    const header=el('section','compare-header'),identities=el('div','compare-identities'),fixed=document.getElementById('comparison-identities');header.appendChild(identities);
    let originals;
    if(fixed){fixed.replaceChildren(header);const section=el('section','comparison-originals');originals=el('div','comparison-pair');section.appendChild(originals);container.appendChild(section);}
    else container.appendChild(header);
    for(const [index,side] of sides.entries()){
      const role=index?'target':'baseline',identity=el('div');identities.appendChild(identity);
      const parts=context.getPromptParts(side.session.trainingPrompt),mode=side.session.trainingMode==='free'?'自由表达':side.session.trainingMode==='structured'?context.formatTrainingContext({...side.session,trainingPrompt:null}):'训练方式未保存';
      identity.appendChild(el('small',null,index?'目标记录 · 较晚一次':'基线记录 · 较早一次'));
      identity.appendChild(el('h2',null,parts.topic?.text || mode));
      identity.appendChild(el('p',null,`${new Date(side.session.createdAt).toLocaleString()} · ${value(side.evidence.audio.endMs,'ms')}`));
      identity.appendChild(el('p',null,[mode,parts.scenario?.text,side.session.practice?`针对性练习第 ${side.session.practice.round} 轮`:null].filter(Boolean).join(' · ')));
      if(side.session.practice)identity.appendChild(el('p',null,`练习范围：${{sentence:'句子',segment:'片段',full:'完整表达'}[side.session.practice.scope]} · 目标：${side.session.practice.goal.observation}`));
      for(const line of identity.children)if(['H2','P'].includes(line.tagName))line.setAttribute('title',line.textContent);
      const open=button('查看这次报告 →',()=>onReport(role));open.dataset.comparisonReport=role;identity.appendChild(open);
      const materials=originals?el('div'):identity;if(originals)originals.appendChild(materials);
      disclosure(materials,`original-${role}`,'查看原文与录音',body=>{body.appendChild(el('p','source-note',`识别来源：${side.sources.asr?.modelId || '来源未保存'} · ${side.sources.asr?.modelVersion || '版本未保存'}`));const refs=(side.session.transcript?.segments || []).map(segment=>segment.id);if(!refs.length)body.appendChild(el('p',null,side.session.transcript?.text || '暂无可读原文。'));evidence(body,side,['audio',...refs]);});
    }
    const observations=projection.metrics.filter(metric=>['audio-duration-ms','filler-count'].includes(metric.id)&&metric.delta!==null);
    if(observations.length){const section=el('section','report-section');section.appendChild(el('h2',null,'可以观察到的变化'));const insight=el('p','compare-insight');
      for(const metric of observations){const line=el(metric.id==='filler-count'?'em':'span',null,`${labels[metric.id]}从 ${value(metric.baseline.value,metric.unit)} 变为 ${value(metric.target.value,metric.unit)}。`);insight.appendChild(line);insight.appendChild(el('br'));}section.appendChild(insight);section.appendChild(el('p','compare-note','这些是记录中的差异；时长更短或用词更少，不直接等于表达更好。'));container.appendChild(section);}
    const analysis=el('section','report-section comparison-analysis');container.appendChild(analysis);const sectionHead=el('header','section-head');sectionHead.appendChild(el('h2',null,'分析与证据'));sectionHead.appendChild(el('small',null,'按类别查看两侧结果'));analysis.appendChild(sectionHead);
    analysis.appendChild(el('p','source-note','两侧展示各自保存的分析，尚未自动建立问题对应关系。另一侧未返回 Finding 不表示问题改善或消失。'));
    for(const [category,label] of Object.entries(CATEGORIES)){
      if(!sides.some(side=>side.findings.some(finding=>finding.category===category)))continue;
      const group=el('article','comparison-group');group.dataset.category=category;group.appendChild(el('h3',null,label));const pair=el('div','comparison-pair');group.appendChild(pair);analysis.appendChild(group);
      for(const [index,side] of sides.entries()){
        const column=el('div');pair.appendChild(column);column.appendChild(el('small',null,index?'目标':'基线'));const findings=side.findings.filter(finding=>finding.category===category);
        if(!findings.length)column.appendChild(el('p','source-note','此类别未保存分析项，无法判断问题是否存在或改善。'));
        findings.forEach((finding,i)=>{const card=el('article','comparison-finding');column.appendChild(card);card.appendChild(el('h4','finding-observation',finding.observation));if(typeof finding.interpretation==='string' && finding.interpretation.trim())card.appendChild(el('p',null,finding.interpretation));card.appendChild(el('small',null,'下一轮怎么练'));card.appendChild(el('p',null,finding.recommendation));disclosure(card,`finding-${index?'target':'baseline'}-${category}-${i}`,'查看证据',body=>evidence(body,side,finding.evidenceRefs));});
      }
    }
    for(const [i,side] of sides.entries())if(side.diagnosisStatus!=='completed')analysis.appendChild(el('p','source-note',`${i?'目标':'基线'}分析暂不可用；保存的原文、录音与健康指标仍可查看。`));
    if(sides.every(side=>!side.findings.length))analysis.appendChild(el('p','source-note','两侧暂无可复盘的 Finding，不据此判断问题已解决。'));
    const metrics=el('section','report-section comparison-measurements');metrics.appendChild(el('h2',null,'指标对比'));container.appendChild(metrics);const table=el('table','metric-table');metrics.appendChild(table);
    const thead=el('thead'),head=el('tr');for(const title of ['指标','基线','目标','变化']){const th=el('th',null,title);th.setAttribute('scope','col');head.appendChild(th);}thead.appendChild(head);table.appendChild(thead);const body=el('tbody');table.appendChild(body);
    for(const metric of projection.metrics){
      const row=el('tr','comparison-metric');row.dataset.metricId=metric.id;body.appendChild(row);
      const sideValue=side=>`${value(side?.value,side?.rawUnit || metric.unit)}${side?.available===false && Number.isFinite(side.value)?'（保存值，当前不可用）':''}`;
      row.appendChild(el('td',null,labels[metric.id] || metric.label));row.appendChild(el('td',null,sideValue(metric.baseline)));row.appendChild(el('td',null,sideValue(metric.target)));row.appendChild(el('td','comparison-delta',metric.delta===null?'—':`${metric.delta>0?'+':''}${value(metric.delta,metric.deltaUnit)}`));
      const noteRow=el('tr','metric-note-row'),cell=el('td');cell.colSpan=4;noteRow.appendChild(cell);body.appendChild(noteRow);
      disclosure(cell,`metric-${metric.id}`,metric.status==='unavailable'?'暂时无法可靠比较 · 查看原因与证据':'查看口径与证据',detail=>{
        detail.appendChild(el('p','source-note',metric.status==='unavailable'?`暂时无法可靠比较：${metric.reasons.map(reasonText).join('；')}`:metric.status==='normalized'?'已按保存的频率或占比口径比较，保留各自分母。':'可比；数值差异仅是观察，不表示能力评分。'));
        if(metric.id==='filler-count' || metric.id==='filler-rate-per-recorded-minute')detail.appendChild(el('p','source-note','统计当次保存词表的填充词命中次数；频率为命中次数／已保存录音分钟数，分母包含静音。'));
        for(const limitation of metric.limitations)detail.appendChild(el('p','source-note',limitations[limitation] || '比较需结合保存证据的限制。'));
        const pair=el('div','comparison-pair');detail.appendChild(pair);for(const [index,side] of sides.entries()){const column=el('div','comparison-evidence-side');pair.appendChild(column);column.appendChild(el('small',null,index?'目标证据':'基线证据'));const sideMetric=index?metric.target:metric.baseline;if(!sideMetric?.available)column.appendChild(el('p','source-note',reasonText(sideMetric?.reason)));else evidence(column,side,sideMetric.evidenceRefs);}
      });
    }
    table.appendChild(el('caption',null,'转写字符数不含标点；填充词命中频率单位为次／录音分钟，分母包含静音。变化为目标减基线，数值不表示能力评分。'));
    disclosure(metrics,'compare-limits','比较范围与限制',detail=>{detail.appendChild(el('p',null,'本页固定两条所选记录与进入时的报告版本；训练方式、主题或练习范围不同时，需要结合上下文阅读。'));detail.appendChild(el('p',null,'对比只读取两次保存的结果，不重新运行识别或分析。某项缺失不影响其他资料查看，也不能据此认定问题已解决。'));detail.appendChild(el('p',null,'VAD 表示模型检测事实，不代表对表达质量的评价。'));});
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
      const selectedInputs=[...selection].map(id=>trainer.historyItems?.get(id) || trainer.historyList.querySelector(`[data-compare-id="${id}"]`)?.dataset);
      for(const checkbox of trainer.historyList.querySelectorAll('[data-compare-id]')) {
        checkbox.checked=selection.has(checkbox.dataset.compareId);
        checkbox.disabled=false;
      }
      compareButton.disabled=selection.size!==2 || selectedInputs.some(item=>item?.unavailable==='true' || item?.deletionPending || ['recording','finalizing'].includes(item?.status));
      get('btn-history-delete-selected').disabled=selection.size===0 || Boolean(trainer.historyDeletion?.busy);
      get('history-selection-status').textContent=`已选 ${selection.size} 条`;
    }
    function addChoice(row,item) {
      const label=document.createElement('label');label.className='history-compare-choice';
      const input=document.createElement('input');input.type='checkbox';input.dataset.compareId=item.id;
      input.dataset.unavailable=String(Boolean(item.deletionPending || ['recording','finalizing'].includes(item.status)));
      input.setAttribute('aria-label',`选择 ${new Date(item.createdAt).toLocaleString()} 的训练`);
      input.addEventListener('change',()=>{if(input.checked)selection.add(item.id);else selection.delete(item.id);syncSelection();});
      label.appendChild(input);row.appendChild(label);
    }
    function leave(clearSelection=false) {
      request++;action++;loading=false;context=null;releaseAudio();content.replaceChildren();get('comparison-identities')?.replaceChildren();
      if(clearSelection)selection.clear();syncSelection();
    }
    function fail(error) {
      releaseAudio();content.replaceChildren();get('comparison-identities')?.replaceChildren();status.textContent=error?.message || '无法读取对比，请重试。';
      area.dataset.availability='unavailable';retry.hidden=false;
    }
    function capture() {
      if(!context)return;
      context.scroll=get('comparison-scroll').scrollTop;
      context.expanded=new Set([...content.querySelectorAll('details[data-detail-key]')].filter(el=>el.open).map(el=>el.dataset.detailKey));
    }
    function draw() {
      if(!context?.projection)return;
      const p=context.projection;
      stopAudio();renderComparison(content,p,{onReport:openReport,onPlay:play,onCollapse:()=>{action++;stopAudio();}});
      area.dataset.availability=p.availability;
      status.textContent=p.availability==='ready'?'已读取两次训练的保存结果':p.availability==='partial'?'部分项目暂不可比；可用内容仍可复盘。':'核心证据不足，暂时无法完成有意义的对比。';
      retry.hidden=p.availability!=='unavailable';
      for(const el of content.querySelectorAll('details[data-detail-key]'))if(context.expanded?.has(el.dataset.detailKey)){el.open=true;el.populateEvidence();}
      get('comparison-scroll').scrollTop=context.scroll || 0;
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
      syncSelection();if(compareButton.disabled || selection.size!==2 || trainer.isRecording || trainer.asrStartAttempt || trainer.recordingStopOperation)return;
      releaseAudio();request++;action++;
      trainer.historyScroll=get('history-scroll').scrollTop;trainer.historyReturnFocus='btn-history-compare';
      trainer.audioPlayer?.pause();trainer.releaseSavedRecordCache();
      context={ids:[...selection],projection:null,expanded:new Set(),scroll:0};
      trainer.setScreen('comparison');content.replaceChildren();get('comparison-identities')?.replaceChildren();status.textContent='正在读取两次训练…';retry.hidden=true;
      area.focus();if(await read())draw();
    }
    async function restore() {
      if(!context)return trainer.showHistory({restore:true});
      action++;
      trainer.audioPlayer?.pause();trainer.setScreen('comparison');status.textContent='正在检查原对比…';
      if(await read()){draw();get('comparison-identities').querySelector(`[data-comparison-report="${context.reportSide || 'baseline'}"]`)?.focus({preventScroll:true});}
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
        existing.structuredReport=record.structuredReport;trainer.showRecord(existing,'comparison',side.snapshot.reportId);
      } else {store.remove(record.id);store.add(record);trainer.showRecord(record,'comparison',side.snapshot.reportId);}
      trainer.viewingReportSnapshot={sessionId:side.session.id,reportId:side.snapshot.reportId};
      expected.reportSide=role;trainer.reportBack.focus();
    }
    async function play(role,ref,player,message) {
      const operation=++action,expected=context;if(!expected)return;
      message.textContent='正在读取录音…';const p=await read(expected);if(!p)return;
      const side=p[role],evidence=side.evidence[ref];
      if(!evidence?.available || !side.evidence.audio.available){message.textContent='这条证据的音频已不可用，原文仍可查看。';return;}
      const navigation=trainer.navigationGeneration;
      const audio=await api.readTrainingAudio({requestId:globalThis.crypto.randomUUID(),sessionId:side.session.id}).catch(()=>null);
      if(context!==expected || navigation!==trainer.navigationGeneration || operation!==action || player.isConnected===false)return;
      if(!audio?.ok){message.textContent='录音已不可用，请重试或返回历史检查记录。';return;}
      if(!await read(expected) || operation!==action || player.isConnected===false)return;
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
  return {renderComparison,createComparisonController,valueText,reasonText};
});
