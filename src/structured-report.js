(function initializeStructuredReport(root,factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StructuredReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this,() => {
  'use strict';

  const {selectStructuredReport,CATEGORIES} = typeof module === 'object' && module.exports
    ? require('../shared/report-selection') : globalThis.ReportSelection;
  const REASONS = {
    'not-configured':'尚未配置 AI 服务，可在设置中添加配置后重试',
    'not-enabled':'自动 AI 诊断尚未启用，可主动分析这一次',
    'disclosure-required':'尚未完成 AI 数据告知，确认说明后可分析这一次',
    'configuration-changed':'分析配置已改变，请检查当前配置后重试',
    'network':'网络连接失败，可重试',timeout:'分析等待超时，可重试',cancelled:'分析已取消',
    'unauthorized':'AI 服务认证失败，请检查配置','rate-limited':'AI 服务暂时限流，可稍后重试',
    'invalid-response':'AI 结果未通过校验，可重试','invalid-json':'AI 结果格式无效，可重试',
    'analysis-failed':'AI 诊断失败，可重试','analysis-context-too-large':'本次分析内容超过可处理范围',
    'analysis-context-invalid':'本次分析证据未通过校验','analysis-context-stale':'分析证据版本不一致',
    'transcript-unavailable':'转写文本不可用','transcript-evidence-invalid':'转写证据未通过校验',
    'audio-unavailable':'录音不可用','audio-timing-invalid':'录音时间信息无效',
    'audio-coverage-incomplete':'录音覆盖不完整','vad-unavailable':'语音活动证据不可用',
    'vad-evidence-invalid':'语音活动区间未通过校验','vad-coverage-incomplete':'语音活动证据覆盖不完整',
    'local-stats-unavailable':'本地词项统计不可用','local-stats-invalid':'本地词项统计与转写不一致',
    'asr-incomplete':'转写覆盖不完整','no-recorded-duration':'没有有效录音时长',
    'no-measured-text':'没有可计数文本','no-observed-speech':'未检测到语音',
    'model-unavailable':'语音活动模型不可用','audio-or-model-unavailable':'录音或语音活动模型不可用'
  };
  const UNITS = {characters:'字',occurrences:'次',ms:'毫秒',percent:'%',
    'characters/recorded-minute':'字/录音分钟','characters/speech-minute':'字/检测语音分钟',
    'occurrences/recorded-minute':'次/录音分钟'};
  const reasonText = reason => REASONS[reason] || '当前证据或分析不可用';

  function renderStructuredReport(container,projection,{onEvidence,onFramework,onReanalyze,onPractice,onOpen,onLayout,record,api,frozen:useFrozen=false,segments = []} = {}) {
    container.replaceChildren();
    if (!projection) return;
    const document = container.ownerDocument;
    function element(tag,className,text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    }
    const {evidenceRun,metricRun,analysisRun,latestAttempt} = projection;
    const root = element('section','structured-report');
    const frozen=useFrozen || document.body?.dataset?.frozenUi==='report';
    root.setAttribute('aria-label','本次表达报告');
    const practiceView = typeof module === 'object' && module.exports ? require('./practice-report') : globalThis.PracticeReport;
    const dispose = record?.practice ? practiceView.renderPractice(element,root,{record,projection,api,onPractice,onOpen,onEvidence,frozen,onLayout}) : () => {};
    const successful = analysisRun.status === 'completed';
    const assessment=successful ? analysisRun.value.assessment : null;
    const insufficient=assessment?.status==='insufficient';
    root.appendChild(element('h2','report-title','本次表现摘要'));
    root.appendChild(element('p','report-summary',insufficient ? '本次材料不足以形成表达诊断。' : successful ? analysisRun.value.summary : '本地分析已保留，AI 诊断暂不可用。'));
    if (assessment && assessment.status!=='analyzable') root.appendChild(element('p','report-status',
      `${insufficient?'材料不足':'有限分析'}：${assessment.reason}${insufficient?' 原文、录音与本地指标仍可查看；可以回到首页重新表达。':''}`));
    if (!successful) root.appendChild(element('p','report-status',reasonText(analysisRun.value.reason)));
    if (latestAttempt) {
      const status = element('p','report-status',`最近一次重试未完成：${reasonText(latestAttempt.reason)}。当前显示此前已保存的诊断。`);
      status.setAttribute('role','status');
      root.appendChild(status);
    }

    const metrics = metricRun.value.metrics;
    const metricById = new Map(metrics.map(metric => [metric.id,metric]));
    const segmentById = new Map(segments.map(segment => [segment.id,segment]));
    const speechById = new Map((evidenceRun.value?.segments || []).map(segment => [segment.id,segment]));
    const metricDetails = element('details','metric-details');
    metricDetails.appendChild(element('summary',null,'详细本地指标'));
    const table = element('table','metric-table');
    table.appendChild(element('caption',null,'确定性本地指标'));
    const heading = element('thead');
    const headers = element('tr');
    for (const label of ['指标','数值','说明']) {
      const cell = element('th',null,label);cell.setAttribute('scope','col');headers.appendChild(cell);
    }
    heading.appendChild(headers);table.appendChild(heading);
    const body = element('tbody');
    function formattedMetric(metric) {
      if (metric.status !== 'available' || !Number.isFinite(metric.value)) return '未知';
      return `${Number(metric.value.toFixed(2))} ${UNITS[metric.unit] ?? metric.unit}`;
    }
    for (const metric of metrics) {
      const row = element('tr');row.id = `metric:${metric.id}`;
      const label = element('th',null,metric.label);label.setAttribute('scope','row');
      row.append(label,element('td',null,formattedMetric(metric)),
        element('td',null,metric.status === 'available' && Number.isFinite(metric.value) ? '确定性计算' : reasonText(metric.reason)));
      body.appendChild(row);
    }
    table.appendChild(body);metricDetails.appendChild(table);

    let findingIndex=0;
    function findingCard(finding) {
      const card = element('article','finding');
      const details = element('details','finding-details');
      details.setAttribute('data-finding-id',finding.id);
      details.appendChild(element('summary',frozen?'visually-hidden':null,'解释、建议与证据'));
      let content=details;
      if (frozen) {
        card.className+=' frozen-finding';
        const row=element('div','finding-row');row.appendChild(element('span','finding-index',String(++findingIndex).padStart(2,'0')));
        const title=element('div');title.append(element('h3','finding-observation',finding.observation),element('p','finding-category',CATEGORIES[finding.category]));
        const toggle=element('button','finding-open');toggle.type='button';toggle.setAttribute('aria-label',`展开：${finding.observation}`);
        details.id=`finding-detail-${finding.id}`;toggle.setAttribute('aria-controls',details.id);toggle.setAttribute('aria-expanded','false');
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','m6 9 6 6 6-6');svg.appendChild(path);toggle.appendChild(svg);
        toggle.addEventListener('click',()=>{details.open=!details.open;toggle.setAttribute('aria-expanded',String(details.open));});
        details.addEventListener('toggle',()=>toggle.setAttribute('aria-expanded',String(details.open)));
        row.append(title,toggle);card.appendChild(row);content=element('div','finding-detail');details.appendChild(content);
      } else card.append(element('p','finding-category',CATEGORIES[finding.category]),element('h3','finding-observation',finding.observation));
      const evidence = element('div','finding-evidence');
      for (const ref of finding.evidenceRefs) {
        const metric = ref.startsWith('metric:') ? metricById.get(ref.slice(7)) : null;
        const speech = speechById.get(ref);
        const transcript = segmentById.get(ref);
        const button = element('button','evidence-button',metric ? `查看指标：${metric.label}`
          : speech ? '查看语音区间' : '查看原文证据');
        button.type = 'button';
        button.setAttribute('data-evidence-ref',ref);
        button.addEventListener('click',() => {
          if (metric) metricDetails.open = true;
          if (typeof onEvidence === 'function') onEvidence(ref);
        });
        const block=frozen?element('div','evidence-block'):evidence;
        if (frozen) {
          const seconds=Number.isFinite(transcript?.startMs)?Math.floor(transcript.startMs/1000):null;
          block.appendChild(element('span',null,transcript ? `你的原话${seconds===null?'':` · ${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}` : metric?'本地指标证据':'语音活动证据'));
        }
        if (transcript) block.appendChild(element('blockquote','evidence-quote',transcript.text));
        if (speech) {
          block.appendChild(element('p','speech-interval',
            `VAD 模型估计区间：samples ${speech.startSample}–${speech.endSample}（终点不含在区间内），不表示词语起止。`));
        }
        block.appendChild(button);if (frozen) evidence.appendChild(block);
      }
      content.appendChild(evidence);
      content.append(element('h4',null,frozen?'为什么值得练':'解释'),element('p','finding-interpretation',finding.interpretation));
      if (typeof finding.example==='string' && finding.example.trim()) content.append(element('h4',null,'一种表达参考'),element('p','example',finding.example));
      content.append(element('h4',null,frozen?'下一轮怎么练':'建议'),element('p','finding-recommendation',finding.recommendation));
      card.appendChild(details);
      const controls=frozen?element('div','practice-controls'):content;
      practiceView?.practiceAction(element,controls,finding,onPractice,
        ['organization','argument'].includes(finding.category) ? 'full' : finding.evidenceRefs.length === 1 ? 'sentence' : 'segment');
      if (frozen && typeof onPractice==='function') {controls.querySelector('button').textContent='练习这一点';controls.querySelector('button').className+=' practice-action';content.appendChild(controls);}
      return card;
    }
    if (successful && !insufficient) {
      const framework = analysisRun.value.frameworkAnalysis;
      const findings = frozen ? [...analysisRun.value.findings,...(framework?.findings || [])] : analysisRun.value.findings;
      const priorityCount=frozen?2:3;
      root.appendChild(element('h2',null,'优先改善'));
      for (const finding of findings.slice(0,priorityCount)) root.appendChild(findingCard(finding));
      if (findings.length > priorityCount) {
        const more = element('details',frozen?'more-findings report-disclosure':'more-findings');
        more.appendChild(element('summary',null,`更多发现（${findings.length - priorityCount}）`));
        for (const finding of findings.slice(priorityCount)) more.appendChild(findingCard(finding));
        root.appendChild(more);
      } else if (!findings.length) {
        root.appendChild(element('p','report-empty-state','本次分析未形成有充分证据的改善建议。'));
      }
      const labels = {prep:'PREP',star:'STAR',pyramid:'金字塔'};
      if (framework) {
        const target=frozen?element('details','framework-analysis'):root;
        target.appendChild(element(frozen?'summary':'h2',null,`${labels[framework.framework]} 专项分析`));
        target.appendChild(element('p','framework-summary',framework.summary));
        if (frozen) root.appendChild(target);
        else for (const finding of framework.findings) root.appendChild(findingCard(finding));
      }
      const rec = analysisRun.value.frameworkRecommendation;
      if (rec) {
        root.appendChild(element('p','framework-reason',rec.reason));
        const button = element('button','framework-recommendation',`用 ${labels[rec.framework]} 准备下一次表达`);
        button.type = 'button'; button.disabled = typeof onFramework !== 'function';
        button.addEventListener('click',() => onFramework?.(rec.framework));
        root.appendChild(button);
      }
    }
    root.appendChild(metricDetails);
    if (typeof onReanalyze === 'function' && !insufficient) {
      const actions = element('details','framework-reanalysis');
      actions.appendChild(element('summary',null,'换个框架分析这次表达'));
      actions.appendChild(element('p',null,'使用已保存的转写与证据追加分析，保留原训练方式和历史结果。'));
      for (const [id,label] of Object.entries({prep:'PREP',star:'STAR',pyramid:'金字塔'})) {
        const button = element('button',null,`按 ${label} 分析`); button.type = 'button';
        button.addEventListener('click',async () => {
          for (const child of actions.children) if (child.tagName === 'BUTTON') child.disabled = true;
          try { await onReanalyze(id); }
          finally { for (const child of actions.children) if (child.tagName === 'BUTTON') child.disabled = false; }
        });
        actions.appendChild(button);
      }
      root.appendChild(actions);
    }
    root.appendChild(element('p','report-limitations',evidenceRun.value?.status === 'completed'
      ? '语音区间为模型估计，短停顿可能合并；尚未完成代表性标注校准。'
      : `语音活动分析暂不可用：${reasonText(evidenceRun.value?.reason)}。相关指标显示未知。`));
    root.appendChild(element('p','radar-unavailable','雷达量程尚未校准，暂不提供分数或图形。'));
    container.appendChild(root);
    return dispose;
  }

  return {selectStructuredReport,renderStructuredReport};
});
