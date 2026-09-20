(function(root,factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PracticeReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this,() => {
  'use strict';
  const states = {improved:'明显改善','partly-improved':'有所改善',unchanged:'变化不明显','needs-practice':'仍需继续练习',unavailable:'暂时无法可靠比较'};
  function practiceAction(element,container,goal,onPractice,scope = 'full',continuing = false) {
    if (typeof onPractice !== 'function') return;
    const label = element('label','practice-scope-label','练习范围 ');
    const select = element('select','practice-scope');
    for (const [value,text] of Object.entries({sentence:'句子',segment:'片段',full:'完整表达'})) {
      const option = element('option',null,text);option.value = value;select.appendChild(option);
    }
    select.value = scope;label.appendChild(select);container.appendChild(label);
    const button = element('button','practice-start',continuing ? '继续练习这个目标' : '针对这个问题继续练习');
    button.type = 'button';button.addEventListener('click',() => onPractice(goal,select.value,continuing));
    container.appendChild(button);
  }
  function renderPractice(element,root,{record,projection,api,onPractice,onOpen,onEvidence}) {
    if (!record?.practice) return () => {};
    const practice = record.practice;
    const feedback = projection.analysisRun.value.practiceFeedback;
    const section = element('section','practice-result');root.appendChild(section);
    section.appendChild(element('h2',null,`针对性练习结果 · 第 ${practice.round} 轮`));
    const status = element('p','practice-change',`相比上一轮：${states[feedback?.status] || states.unavailable}`);
    section.appendChild(status);
    const feedbackSummary = element('p','practice-feedback-summary',feedback?.summary || '尚无可靠的练习变化结论。');
    section.appendChild(feedbackSummary);
    const goal = element('article','practice-goal');
    goal.appendChild(element('h3',null,`本轮练习目标：${practice.goal.observation}`));
    goal.appendChild(element('p',null,practice.goal.recommendation));
    practiceAction(element,goal,practice.goal,onPractice,practice.scope,true);section.appendChild(goal);
    let active = true;
    const urls = [], players = [];
    const request = sessionId => ({requestId:globalThis.crypto.randomUUID(),sessionId});
    const history = element('details','practice-history');
    history.appendChild(element('summary',null,'查看练习历程'));
    const historyBody = element('div');history.appendChild(historyBody);section.appendChild(history);
    let historyLoading = false;
    history.addEventListener('toggle',async () => {
      if (!active || !history.open || historyLoading || !api?.getPracticeHistory) return;
      historyLoading = true;historyBody.replaceChildren(element('p',null,'正在读取历程…'));
      try {
        const response = await api.getPracticeHistory(request(record.id));
        if (!active) return;
        if (!response?.ok) throw new Error('Unavailable');
        historyBody.replaceChildren();
        for (const row of response.value) {
          const line = element('div','practice-round');
          line.appendChild(element('p',null,`第 ${row.round} 轮${row.round === 1 ? ' · 基准' : ''}：${row.deleted ? '来源报告已删除' : row.summary}`));
          if (!row.deleted && row.sessionId !== record.id && typeof onOpen === 'function') {
            const open = element('button',null,'查看这轮报告');open.type = 'button';
            open.addEventListener('click',() => onOpen(row.sessionId,row.reportId));line.appendChild(open);
          }
          historyBody.appendChild(line);
        }
      } catch { if (active) historyBody.replaceChildren(element('p',null,'历程暂时无法读取，重新展开可重试。')); }
      finally { historyLoading = false; }
    });
    const evidence = element('details','practice-evidence');evidence.appendChild(element('summary',null,'查看对比证据'));
    const evidenceBody = element('div');evidence.appendChild(evidenceBody);section.appendChild(evidence);
    let source = null, sourceLoaded = false, sourceRead = null;
    const sourceStatus = element('p','practice-source-status');section.appendChild(sourceStatus);
    function loadSource() {
      if (sourceRead) return sourceRead;
      if (!active || !api?.getTrainingSession) return Promise.resolve();
      sourceRead = (async () => {
      try {
        const response = await api.getTrainingSession(request(practice.previousSessionId));
        if (!active) return;
        if (!response?.ok) throw new Error('Unavailable');
        source = response.value?.deletionPending ? null : response.value;sourceLoaded = true;
        if (!source) {
          sourceStatus.textContent = '来源报告已删除，无法比较上一轮；已有变化结论的来源证据已不可复核。';
          status.textContent = '相比上一轮：暂时无法可靠比较';
          feedbackSummary.textContent = '上一轮证据已删除，本轮报告和练习目标仍可查看。';
        }
      } catch { if (active) sourceStatus.textContent = '上一轮暂时无法读取，展开对比证据可重试。'; }
      finally { sourceRead = null; }
      })();
      return sourceRead;
    }
    void loadSource();
    evidence.addEventListener('toggle',async () => {
      stopPlayers();
      if (!active || !evidence.open) return;
      if (!sourceLoaded) await loadSource();
      if (!active) return;
      evidenceBody.replaceChildren();
      if (!source) {evidenceBody.appendChild(element('p',null,sourceLoaded ? '来源报告已删除。' : '上一轮证据暂不可用，请重新展开重试。'));return;}
      for (const [label,segments,refs] of [['上一轮',source.transcript?.segments || [],feedback?.previousEvidenceRefs || []],
        ['本轮',record.segments || [],feedback?.currentEvidenceRefs || []]]) {
        evidenceBody.appendChild(element('h3',null,label));
        for (const segment of segments.filter(segment => !refs.length || refs.includes(segment.id))) {
          evidenceBody.appendChild(element('blockquote','evidence-quote',segment.text));
          if (label === '本轮' && typeof onEvidence === 'function') {
            const seek = element('button',null,'定位本轮证据');seek.type = 'button';
            seek.addEventListener('click',() => onEvidence(segment.id));evidenceBody.appendChild(seek);
          }
        }
      }
      if (source.artifact?.state === 'available' && api.readTrainingAudio) {
        const play = element('button','practice-play-previous','播放上一轮录音');play.type = 'button';evidenceBody.appendChild(play);
        play.addEventListener('click',async () => {
          play.disabled = true;
          try {
            const response = await api.readTrainingAudio(request(source.id));
            if (!active || !evidence.open) return;
            if (!response?.ok) throw new Error('Unavailable');
            const url = URL.createObjectURL(new Blob([response.value],{type:'audio/wav'}));urls.push(url);
            const audio = element('audio');audio.controls = true;audio.src = url;players.push(audio);
            evidenceBody.appendChild(audio);await audio.play().catch(() => {});
          } catch { if (active) play.textContent = '录音暂不可播放，可重新展开重试'; }
        });
      }
    });
    function stopPlayers() {
      for (const player of players.splice(0)) {player.pause();player.removeAttribute('src');player.load();}
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    }
    return () => {active = false;stopPlayers();};
  }
  return {practiceAction,renderPractice};
});
