(function(root,factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PracticeReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this,() => {
  'use strict';
  const {selectStructuredReport}=typeof module==='object' && module.exports?require('../shared/report-selection'):globalThis.ReportSelection;
  const states = {improved:'明显改善','partly-improved':'有所改善',unchanged:'变化不明显','needs-practice':'仍需继续练习',unavailable:'暂时无法可靠比较'};
  const limitationText=reason=>({
    'scope-mismatch':'练习范围发生变化，结论只用于所选目标的有效证据。',
    'training-context-mismatch':'主题或场景发生变化，比较需结合各自上下文。',
    'framework-mismatch':'训练方式或框架不同，不能据此比较完整框架表现。',
    'framework-definition-mismatch':'框架定义版本不同，比较存在限制。',
    'analysis-version-mismatch':'分析版本不同，比较存在限制。',
    'report-partial':'部分分析信息不可用，保留可复核的证据。'
  })[reason] || (reason.includes('timing-estimated')?'片段时间为估计值，不表示精确词语起止。'
    : reason.includes('timing-unavailable')?'部分时间位置不可用。'
    : reason.includes('audio-unavailable')?'部分录音不可用，保留原文复盘。'
    : reason.includes('asr-incomplete')?'转写覆盖不完整，相关比较存在限制。'
    : reason.includes('vad')?'语音活动证据为模型估计或暂不可用，相关比较存在限制。':'部分证据存在质量限制，请在该轮报告中复核。');
  function practiceAction(element,container,goal,onPractice,continuing = false) {
    if (typeof onPractice !== 'function') return;
    const button = element('button','practice-start','重新练习');
    button.type = 'button';button.addEventListener('click',() => onPractice(goal,'full',continuing));
    container.appendChild(button);
    return {button};
  }
  function renderPractice(element,root,{record,projection,api,onPractice,onOpen,onEvidence,onLayout}) {
    if (!record?.practice) return () => {};
    const practice = record.practice;
    const analysis=projection?.analysisRun,feedback=analysis?.value.practiceFeedback;
    const localTitle=record.saveState==='failed' && !record.factsSaved?'本轮训练尚未保存。':record.saveState==='incomplete'?'本轮训练尚未完成。':'本轮练习已保存。';
    const section = element('section','practice-result round-result');root.appendChild(section);
    section.appendChild(element('div','round-label',`针对性练习 · 第 ${practice.round} 轮 · 相比上一轮`));
    const feedbackSummary = element('h2','practice-feedback-summary',localTitle);
    section.appendChild(feedbackSummary);
    const status = element('p','practice-change source-note',`相比上一轮：${states.unavailable}`);
    section.appendChild(element('p','practice-current-target',`练习目标：${practice.goal.observation}`));section.appendChild(status);
    let active = true;
    const urls = [], players = [];
    const request = sessionId => ({requestId:globalThis.crypto.randomUUID(),sessionId});
    const history = element('details','practice-history report-disclosure');
    history.appendChild(element('summary',null,'查看练习历程'));
    const historyBody = element('div','chain');history.appendChild(historyBody);
    let historyLoading = false;
    history.addEventListener('toggle',async () => {
      if (!active || !history.open || historyLoading || !api?.getPracticeHistory) return;
      if(!projection?.snapshot?.id){historyBody.replaceChildren(element('p','source-note','本轮固定报告暂不可用，练习关系和可用内容仍保留。'));onLayout?.('history');return;}
      historyLoading = true;historyBody.replaceChildren(element('p',null,'正在读取历程…'));
      try {
        const response = await api.getPracticeHistory({...request(record.id),reportId:projection.snapshot.id});
        if (!active) return;
        if (!response?.ok) throw new Error('Unavailable');
        historyBody.replaceChildren();
        for (const row of response.value) {
          const line = element('div','practice-round chain-item');
          line.setAttribute('data-practice-round',row.round);
          line.appendChild(element('small',null,`${String(row.round).padStart(2,'0')} · ${row.round===1?'基准表达':row.sessionId===record.id?'当前轮':'针对性练习'}`));
          line.appendChild(element('p',null,row.deleted?'来源报告已删除':row.summary || '暂无可靠的练习变化结论'));
          if (!row.deleted) {
            for (const quote of (row.evidence || []).slice(0,2)) line.appendChild(element('blockquote','practice-history-quote',quote.text));
            for (const limitation of new Set((row.limitations || []).map(limitationText))) line.appendChild(element('p','source-note',limitation));
          }
          if (!row.deleted && row.reportId && !row.availabilityReasons?.includes('report-unavailable') && row.sessionId !== record.id && typeof onOpen === 'function') {
            const open = element('button','text-action',`查看第 ${row.round} 轮报告 →`);open.type = 'button';
            open.addEventListener('click',() => onOpen(row.sessionId,row.reportId,row.round));line.appendChild(open);
          }
          historyBody.appendChild(line);
        }
      } catch { if (active) historyBody.replaceChildren(element('p',null,'历程暂时无法读取，重新展开可重试。')); }
      finally { historyLoading = false;if(active)onLayout?.('history'); }
    });
    const evidence = element('details','practice-evidence report-disclosure');evidence.appendChild(element('summary',null,'查看对比证据'));
    const evidenceBody = element('div');evidence.appendChild(evidenceBody);section.appendChild(evidence);
    section.appendChild(history);
    const goal = element('article','practice-goal round-action');
    goal.appendChild(element('p','finding-recommendation',practice.goal.recommendation));
    const controls=element('div','practice-controls');
    const action=practiceAction(element,controls,practice.goal,onPractice,true);
    if(action && !projection?.snapshot?.id){action.button.disabled=true;controls.appendChild(element('p','source-note','本轮固定报告尚不可用，暂不能以当前轮继续。'));}
    if (action) action.button.className+=' practice-action';
    goal.appendChild(controls);section.appendChild(goal);
    let source = null, sourceLoaded = false, sourceRead = null, sourceReport=null;
    const sourceStatus = element('p','practice-source-status');section.appendChild(sourceStatus);
    function updateFeedback() {
      if (!active) return;
      const previousIds=new Set(source?.transcript?.segments?.map(segment=>segment.id) || []),currentIds=new Set(record.segments?.map(segment=>segment.id) || []);
      const validRefs=(refs,ids)=>Array.isArray(refs) && refs.length>0 && refs.length<=20 && new Set(refs).size===refs.length && refs.every(ref=>ids.has(ref));
      const verified=analysis?.status==='completed' && sourceReport && feedback && feedback.status!=='unavailable' &&
        analysis.value.assessment?.status!=='insufficient' && feedback.comparability?.status!=='unavailable' &&
        validRefs(feedback.previousEvidenceRefs,previousIds) && validRefs(feedback.currentEvidenceRefs,currentIds);
      status.textContent=`相比上一轮：${verified?states[feedback.status]:states.unavailable} · 本轮范围：${{sentence:'句子',segment:'片段',full:'完整表达'}[practice.scope]} · 目标来源：第 1 轮基准`;
      feedbackSummary.textContent=verified?feedback.summary:localTitle;
      if (sourceLoaded && !source) sourceStatus.textContent='来源报告已删除，无法比较上一轮；已有变化结论的来源证据已不可复核。';
      else if (sourceLoaded && !sourceReport) sourceStatus.textContent='上一轮固定报告暂不可用，已有变化结论的来源证据无法复核。';
      else if (analysis?.status!=='completed') {
        const reason=analysis?.value.reason;
        sourceStatus.textContent=reason==='not-enabled'?'自动 AI 分析已关闭，本轮未执行 AI 分析，无法可靠比较；可主动分析这一次。'
          : reason==='not-configured'?'尚未配置分析模型，本轮事实仍可查看，暂时无法可靠比较。'
          : reason==='disclosure-required'?'尚未完成 AI 数据告知，本轮尚无可靠的目标反馈。'
          : reason==='timeout'?'本轮分析超时，已有训练与可用结果仍可查看，暂时无法可靠比较。':'本轮分析未完成，已有训练与可用结果仍可查看，暂时无法可靠比较。';
      } else if (!verified) sourceStatus.textContent=analysis.value.assessment?.status==='insufficient' ? analysis.value.assessment.reason
        : feedback?.comparability?.status==='unavailable' ? feedback.comparability.reason
        : feedback?.status==='unavailable'?feedback.summary:'前后对比依据不足，尚无可靠的练习变化结论。';
      else sourceStatus.textContent='';
    }
    function loadSource() {
      if (sourceRead) return sourceRead;
      if (!active || !api?.getTrainingSession) return Promise.resolve();
      sourceRead = (async () => {
      try {
        const response = await api.getTrainingSession(request(practice.previousSessionId));
        if (!active) return;
        if (!response?.ok) throw new Error('Unavailable');
        source = response.value?.deletionPending ? null : response.value;sourceLoaded = true;
        const pinned=source?selectStructuredReport(source.results,{snapshotId:practice.previousReportId}):null;
        sourceReport=pinned && source.status==='completed' && pinned.snapshot.sessionId===source.id && pinned.snapshot.inputRevision===source.transcript?.revision?pinned:null;
        updateFeedback();
      } catch { if (active) {source=null;sourceReport=null;sourceLoaded=false;updateFeedback();sourceStatus.textContent = '上一轮暂时无法读取，展开对比证据可重试。';} }
      finally { sourceRead = null;if(active)onLayout?.('source'); }
      })();
      return sourceRead;
    }
    updateFeedback();void loadSource();
    let evidenceGeneration=0;
    evidence.addEventListener('toggle',async () => {
      const generation=++evidenceGeneration;
      stopPlayers();
      if (!active || !evidence.open) return;
      await loadSource();
      if (!active || !evidence.open || generation!==evidenceGeneration) return;
      evidenceBody.replaceChildren();
      if (!source) {evidenceBody.appendChild(element('p',null,sourceLoaded ? '来源报告已删除。' : '上一轮证据暂不可用，请重新展开重试。'));onLayout?.('evidence');return;}
      const pair=element('div','round-evidence');evidenceBody.appendChild(pair);
      for (const [label,segments,refs] of [['上一轮',source.transcript?.segments || [],feedback?.previousEvidenceRefs || []],
        ['本轮',record.segments || [],feedback?.currentEvidenceRefs || []]]) {
        const column=element('div');pair.appendChild(column);column.appendChild(element('h3',null,`${label} · 第 ${label==='上一轮'?practice.round-1:practice.round} 轮`));
        const selected=segments.filter(segment=>refs.includes(segment.id));
        if (!sourceReport || !selected.length) column.appendChild(element('p','source-note','可复核的对比引用暂不可用，可在原文与录音中查看本轮内容。'));
        for (const segment of sourceReport?selected:[]) {
          column.appendChild(element('blockquote','evidence-quote',segment.text));
          const time=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
          column.appendChild(element('p','source-note',!Number.isFinite(segment.startMs)?'时间位置不可用'
            : `${segment.timingSource==='model-token'?'模型标记时间':'片段位置为估计值'} · ${time(segment.startMs)}${Number.isFinite(segment.endMs)?`—${time(segment.endMs)}`:''}`));
          if (label === '本轮' && typeof onEvidence === 'function') {
            const seek = element('button',null,'定位本轮证据');seek.type = 'button';
            seek.addEventListener('click',() => onEvidence(segment.id));column.appendChild(seek);
          }
        }
        const id=label==='上一轮'?source.id:record.id;
        const available=label==='上一轮'?source.artifact?.state==='available':record.audioState==='available';
        if (!available || !api.readTrainingAudio) {column.appendChild(element('p','source-note','录音不可用，原文仍可查看。'));continue;}
        const play = element('button',label==='上一轮'?'practice-play-previous':'practice-play-current',`播放${label}录音`);play.type = 'button';column.appendChild(play);
        play.addEventListener('click',async () => {
          play.disabled = true;
          const currentEvidence=()=>active && evidence.open && generation===evidenceGeneration && column.isConnected!==false;
          try {
            const response = await api.readTrainingAudio(request(id));
            if(!currentEvidence())return;
            const latest=await api.getTrainingSession(request(id));
            if(!currentEvidence())return;
            if(!latest?.ok)throw new Error('Unavailable');
            if (!latest.value || latest.value.deletionPending) {
              ++evidenceGeneration;stopPlayers();void loadSource();evidenceBody.replaceChildren(element('p','source-note','来源报告已删除，录音与引用不可用。'));return;
            }
            if (!response?.ok) throw new Error('Unavailable');
            const url = URL.createObjectURL(new Blob([response.value],{type:'audio/wav'}));urls.push(url);
            const audio = element('audio');audio.controls = true;audio.src = url;players.push(audio);
            column.appendChild(audio);await audio.play().catch(() => {});
          } catch { if (active) play.textContent = '录音暂不可播放，可重新展开重试'; }
          finally {play.disabled=false;}
        });
      }
      const previousScope=source.practice?.scope || 'full';
      if (previousScope!==practice.scope) evidenceBody.appendChild(element('p','source-note','两轮练习范围不同，仅复盘所选目标的有效证据，不能直接比较完整表达。'));
      if (practice.scope!=='full') evidenceBody.appendChild(element('p','source-note','本轮仅练习所选句子或片段，未重录全文不表示完整框架缺失。'));
      if (JSON.stringify([source.trainingMode,source.framework,source.trainingPrompt])!==JSON.stringify([record.trainingMode,record.framework,record.trainingPrompt])) evidenceBody.appendChild(element('p','source-note','两轮主题、场景或训练方式有变化，比较结论需结合各自上下文。'));
      if (source.dataQuality?.length || record.dataQuality?.length) evidenceBody.appendChild(element('p','source-note','转写或时间证据存在质量限制，请结合保存的原文与来源信息复核。'));
      onLayout?.('evidence');
    });
    function stopPlayers() {
      for (const player of players.splice(0)) {player.pause();player.removeAttribute('src');player.load();player.remove?.();}
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    }
    return () => {active = false;++evidenceGeneration;stopPlayers();};
  }
  return {practiceAction,renderPractice};
});
