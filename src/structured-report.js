(function initializeStructuredReport(root,factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StructuredReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this,() => {
  'use strict';

  const CATEGORIES = {organization:'组织与衔接',argument:'论点与论据',delivery:'节奏与停顿',wording:'措辞与口头禅'};
  const REASONS = {
    'not-configured':'尚未配置 AI 服务，可在设置中添加配置后重试',
    'not-enabled':'自动 AI 诊断尚未启用，可在设置中启用后重试',
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

  function selectStructuredReport(results) {
    if (!Array.isArray(results)) return null;
    const byId = new Map();
    const duplicateIds = new Set();
    for (const run of results) {
      if (!run || typeof run.id !== 'string') continue;
      if (byId.has(run.id)) duplicateIds.add(run.id);
      else byId.set(run.id,run);
    }
    function linked(snapshot,id,kind) {
      const run = byId.get(id);
      return run && !duplicateIds.has(id) && run.kind === kind &&
        run.sessionId === snapshot.sessionId && run.inputRevision === snapshot.inputRevision ? run : null;
    }
    const valid = [];
    for (const snapshot of results) {
      if (snapshot?.kind !== 'report-snapshot' || snapshot.status !== 'completed' || duplicateIds.has(snapshot.id) ||
          snapshot.value?.schemaVersion !== 1 || !['complete','partial'].includes(snapshot.value.availability)) continue;
      const {evidenceRunId,metricRunId,analysisRunId} = snapshot.value;
      const evidenceRun = linked(snapshot,evidenceRunId,'speech-evidence');
      const metricRun = linked(snapshot,metricRunId,'common-analysis');
      const analysisRun = linked(snapshot,analysisRunId,'diagnosis');
      if (!evidenceRun || !metricRun || !analysisRun || metricRun.status !== 'completed' ||
          !['completed','failed','unavailable'].includes(analysisRun.status) ||
          !Array.isArray(evidenceRun.value?.segments) || evidenceRun.value.segments.some(segment =>
            !segment || typeof segment.id !== 'string' || !Number.isSafeInteger(segment.startSample) ||
              !Number.isSafeInteger(segment.endSample) || segment.startSample < 0 || segment.endSample <= segment.startSample) ||
          metricRun.value?.schemaVersion !== 1 || !Array.isArray(metricRun.value.metrics) ||
          metricRun.value.metrics.some(metric => !metric || typeof metric.id !== 'string' ||
            typeof metric.label !== 'string' || typeof metric.unit !== 'string' ||
            !['available','unavailable'].includes(metric.status)) ||
          metricRun.value.speechEvidenceRunId !== evidenceRunId ||
          analysisRun.value?.schemaVersion !== 1 || !Array.isArray(analysisRun.value.findings) ||
          analysisRun.value.speechEvidenceRunId !== evidenceRunId || analysisRun.value.metricRunId !== metricRunId) continue;
      if (analysisRun.status === 'completed' && (typeof analysisRun.value.summary !== 'string' ||
          analysisRun.value.findings.some(finding => !finding || !Object.hasOwn(CATEGORIES,finding.category) ||
            ['observation','interpretation','recommendation'].some(key => typeof finding[key] !== 'string') ||
            !Array.isArray(finding.evidenceRefs) || finding.evidenceRefs.some(ref => typeof ref !== 'string')))) continue;
      valid.push({snapshot,evidenceRun,metricRun,analysisRun});
    }
    if (!valid.length) return null;
    const latest = valid.at(-1);
    const selected = valid.findLast(report => report.analysisRun.status === 'completed') || latest;
    return {...selected,latestAttempt:latest === selected ? null : {
      snapshotId:latest.snapshot.id,analysisRunId:latest.analysisRun.id,status:latest.analysisRun.status,
      reason:typeof latest.analysisRun.value.reason === 'string' ? latest.analysisRun.value.reason : null
    }};
  }

  function renderStructuredReport(container,projection,{onEvidence,segments = []} = {}) {
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
    root.setAttribute('aria-label','本次表达报告');
    const successful = analysisRun.status === 'completed';
    root.appendChild(element('h2','report-title','本次表现摘要'));
    root.appendChild(element('p','report-summary',successful ? analysisRun.value.summary : '本地分析已保留，AI 诊断暂不可用。'));
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

    function findingCard(finding) {
      const card = element('article','finding');
      card.appendChild(element('p','finding-category',CATEGORIES[finding.category]));
      card.appendChild(element('h3','finding-observation',finding.observation));
      const details = element('details','finding-details');
      details.appendChild(element('summary',null,'解释、建议与证据'));
      details.appendChild(element('h4',null,'解释'));
      details.appendChild(element('p','finding-interpretation',finding.interpretation));
      details.appendChild(element('h4',null,'建议'));
      details.appendChild(element('p','finding-recommendation',finding.recommendation));
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
        evidence.appendChild(button);
        if (transcript) evidence.appendChild(element('blockquote','evidence-quote',transcript.text));
        if (speech) {
          evidence.appendChild(element('p','speech-interval',
            `VAD 模型估计区间：samples ${speech.startSample}–${speech.endSample}（终点不含在区间内），不表示词语起止。`));
        }
      }
      details.appendChild(evidence);card.appendChild(details);
      return card;
    }
    if (successful) {
      const findings = analysisRun.value.findings;
      root.appendChild(element('h2',null,'优先改善'));
      for (const finding of findings.slice(0,3)) root.appendChild(findingCard(finding));
      if (findings.length > 3) {
        const more = element('details','more-findings');
        more.appendChild(element('summary',null,`更多发现（${findings.length - 3}）`));
        for (const finding of findings.slice(3)) more.appendChild(findingCard(finding));
        root.appendChild(more);
      } else if (!findings.length) {
        root.appendChild(element('p','report-status','本次分析未形成有充分证据的改善建议。'));
      }
    }
    root.appendChild(metricDetails);
    root.appendChild(element('p','report-limitations',evidenceRun.value?.status === 'completed'
      ? '语音区间为模型估计，短停顿可能合并；尚未完成代表性标注校准。'
      : `语音活动分析暂不可用：${reasonText(evidenceRun.value?.reason)}。相关指标显示未知。`));
    root.appendChild(element('p','radar-unavailable','雷达量程尚未校准，暂不提供分数或图形。'));
    container.appendChild(root);
  }

  return {selectStructuredReport,renderStructuredReport};
});
