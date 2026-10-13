(function(root,factory) {
  const context = typeof module === 'object' && module.exports ? require('../shared/training-context') : root.TrainingContext;
  const api = factory(context);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrozenReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(context) {
  'use strict';
  const presentations = new WeakMap();
  function reportModel(record) {
    const projection = record.structuredReport;
    const analysis = projection?.analysisRun;
    const summary = analysis?.status === 'completed' ? analysis.value.summary : record.report || null;
    const reason = analysis?.value?.reason;
    const mode = context.formatTrainingContext({...record,trainingPrompt:null});
    const measured = id => {
      const metric = projection?.metricRun?.value?.metrics?.find(item => item.id === id);
      return metric ? (metric.status === 'available' && Number.isFinite(metric.value) ? metric.value : null) : undefined;
    };
    const fallback = (value,key) => value !== undefined ? value
      : record.metricsAvailable !== false && Number.isFinite(record.stats?.[key]) ? record.stats[key] : null;
    return {mode,analysisContext:context.formatTrainingContext(record),summary,
      title:record.saveState === 'failed' && !record.factsSaved ? '训练尚未保存'
        : record.dataQuality?.includes('asr-error') ? '转写暂时不可用'
        : summary ? null : record.reportPending ? '正在分析这一次'
        : reason === 'disclosure-required' ? '等待 AI 数据告知'
        : reason === 'not-enabled' ? '本次未生成 AI 分析'
        : reason === 'not-configured' ? '尚未配置分析模型' : '分析暂不可用',
      reason,metrics:[
        {label:'表达时长',value:Number.isFinite(record.durationMs) ? record.durationMs : null,unit:'ms'},
        {label:'转写字数',value:fallback(measured('text-character-count'),'totalWords'),unit:'字'},
        {label:'填充词',value:fallback(measured('filler-count'),'fillers'),unit:'次'}]};
  }
  // Adapt the existing report projection and controls; no analysis or storage
  // work is owned by this presentation module.
  function present(document,record) {
    const byId = id => document.getElementById(id);
    const copy = byId('report-summary-copy'), metrics = byId('report-summary-metrics');
    const info = byId('report-analysis-info'), body = byId('report-body');
    if (!copy || !metrics || !info || !body) return;
    const model = reportModel(record);
    const actions = byId('report-analysis-actions');
    const root = body.querySelector('.structured-report');
    const previous = presentations.get(document);
    const reuse = root && previous?.recordId === record.id
      && previous.projection === record.structuredReport && previous.root === root;
    presentations.set(document,{recordId:record.id,projection:record.structuredReport,root});
    const practiceSlot=byId('frozen-practice-result');
    if (practiceSlot) {
      const practice=root?.querySelector('.practice-result') || (reuse?practiceSlot.querySelector('.practice-result'):null);
      practiceSlot.replaceChildren();practiceSlot.hidden=!record.practice || !practice;
      if (record.practice && practice) practiceSlot.append(practice);
    }
    const detailSelector = '.metric-details,.framework-analysis,.framework-reanalysis,.report-limitations,.radar-unavailable';
    const details = [...(root?.querySelectorAll(detailSelector) || [])];
    // A navigation/state refresh can project the same report twice; retain
    // already moved controls and listeners instead of deleting them.
    if (!details.length && reuse) details.push(...info.querySelectorAll(detailSelector));
    const statuses = [...(root?.querySelectorAll('.report-status') || [])];
    if (!statuses.length && reuse) statuses.push(...info.querySelectorAll('.report-status'),...copy.querySelectorAll('.report-status'));
    const node = (tag,text,className) => {
      const element = document.createElement(tag);element.textContent=text || '';
      if (className) element.className=className;return element;
    };
    copy.replaceChildren();metrics.replaceChildren();info.replaceChildren();
    if (record.practice) copy.append(node('p','本次表现','summary-subtitle'));
    if (model.summary && !model.title) copy.append(node('h2',model.summary));
    else {
      const notice = node('section','', 'state-notice state-report');notice.setAttribute('role','status');
      notice.append(node('h2',model.title));
      notice.append(node('p',model.title === '训练尚未保存'
        ? '本次内容仍暂存在当前会话中。请重试保存；关闭应用可能丢失未保存内容。'
        : model.title === '转写暂时不可用' ? '保留已保存的录音及可用证据。转写未完成，可改选模型进行新训练。'
        : record.reportPending ? '分析完成后显示结果。原文、录音与本地指标仍可查看。'
        : model.reason === 'disclosure-required' ? '确认 AI 数据说明后执行本次分析。暂不分析仍可查看已保存的训练。'
        : model.reason === 'not-enabled'
        ? '自动 AI 分析处于关闭状态。本次未执行 AI 分析，可查看原文、录音与本地指标。'
        : model.reason === 'not-configured' ? '可以查看原文与录音。在设置中配置分析模型后，可生成分析。'
        : '保留可用的原文、录音与本地指标，分析结果暂不可用。'));
      copy.append(notice);
    }
    for (const metric of model.metrics) {
      const row = node('div');row.append(node('span',metric.label));
      const value = metric.value === null ? '—' : metric.unit === 'ms'
        ? `${String(Math.floor(metric.value/60000)).padStart(2,'0')}:${String(Math.floor(metric.value/1000)%60).padStart(2,'0')}`
        : `${metric.value} ${metric.unit}`;
      row.append(node('strong',value));metrics.append(row);
    }
    info.append(node('p',`训练方式与上下文：${model.analysisContext}`,'source-note'));
    info.append(node('p',`ASR：${record.sourceSnapshot?.asr?.modelId || record.sourceSnapshot?.asr?.provider || '来源信息不可用'}。片段时间按保存的来源标记，不表示精确词语起止。`,'source-note'));
    if (root) {
      for (const element of root.querySelectorAll('.report-title,.report-summary')) element.remove();
      (model.summary && record.structuredReport?.latestAttempt ? copy : info).append(...statuses);
    } else if (!record.report) body.replaceChildren();
    info.append(...details);
    for (const line of byId('subtitle-container').querySelectorAll('[data-segment-id]')) {
      const segment=record.segments.find(item=>item.id === line.dataset.segmentId);
      if (!Number.isFinite(segment?.startMs)) continue;
      const seconds=Math.max(0,Math.floor(segment.startMs/1000));
      line.dataset.segmentTime=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
      line.title=segment.timingSource === 'estimated' ? '片段播放位置为估计值' : '保存的片段播放位置';
    }
    if (actions) {
      (model.summary ? info : copy).append(actions);
      const label=actions.querySelector('.btn-label');
      if (label) label.textContent=record.reportPending ? '分析中…' : !model.summary && ['not-enabled','not-configured','disclosure-required'].includes(model.reason) ? '分析这一次' : '重试诊断';
    }
    byId('record-identity').textContent = `${new Date(record.createdAt).toLocaleString()} · ${model.analysisContext}`;
  }
  return {reportModel,present};
});
