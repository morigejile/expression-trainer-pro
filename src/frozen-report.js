(function(root,factory) {
  const context = typeof module === 'object' && module.exports ? require('../shared/training-context') : root.TrainingContext;
  const api = factory(context);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrozenReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(context) {
  'use strict';
  const reportSelection = () => typeof module === 'object' && module.exports
    ? require('../shared/report-selection') : globalThis.ReportSelection;
  const presentations = new WeakMap();
  function renderIdentity(document,record) {
    const identity=document.getElementById('record-identity');
    if (!identity) return;
    const date=new Date(record.createdAt);
    const time=document.createElement('time');time.className='record-date';
    time.textContent=Number.isFinite(date.getTime())
      ? `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}  ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}` : '时间未知';
    if (Number.isFinite(date.getTime())) time.setAttribute('datetime',date.toISOString());
    const mode=document.createElement('span');mode.className='record-mode';
    mode.textContent=context.formatTrainingContext({...record,trainingPrompt:null});
    identity.replaceChildren(time,mode);
    const prompt=context.formatTrainingContext(record).slice(mode.textContent.length).replace(/^ · /,'');
    if (prompt) {
      const label=document.createElement('span');label.className='record-context';label.textContent=prompt;identity.append(label);
    }
  }
  function reportModel(record) {
    const projection = record.structuredReport;
    const revised = projection?.metricRun?.value.definitionVersion===reportSelection().REPORT_METRICS_VERSION;
    const analysis = projection?.analysisRun;
    const assessment=analysis?.status==='completed' ? analysis.value.assessment : null;
    const summary = assessment?.status==='insufficient' ? null : analysis?.status === 'completed' ? analysis.value.summary : record.report || null;
    const reason = analysis?.value?.reason;
    const mode = context.formatTrainingContext({...record,trainingPrompt:null});
    const measured = id => {
      const metric = projection?.metricRun?.value?.metrics?.find(item => item.id === id);
      return metric ? (metric.status === 'available' && Number.isFinite(metric.value) ? metric.value : null) : undefined;
    };
    const fallback = (value,key) => value !== undefined ? value
      : record.metricsAvailable !== false && Number.isFinite(record.stats?.[key]) ? record.stats[key] : null;
    return {mode,analysisContext:context.formatTrainingContext(record),summary,
      assessmentStatus:assessment?.status,assessmentReason:assessment?.reason,
      title:record.saveState === 'failed' && !record.factsSaved ? '训练尚未保存'
        : record.dataQuality?.includes('asr-error') ? '转写暂时不可用'
        : assessment?.status==='insufficient' ? '本次材料不足以形成表达诊断'
        : summary ? null : record.reportPending ? '正在分析这一次'
        : reason === 'disclosure-required' ? '等待 AI 数据告知'
        : reason === 'not-enabled' ? '本次未生成 AI 分析'
        : reason === 'not-configured' ? '尚未配置分析模型' : '分析暂不可用',
      reason,analysisAction:{
        visible:assessment?.status!=='insufficient' && (Boolean(record.reportPending) || !summary || projection?.snapshot?.value?.availability==='partial'),
        label:record.reportPending ? '分析中…' : !summary && ['not-enabled','not-configured','disclosure-required'].includes(reason) ? '分析这一次' : '重试诊断'},metrics:[
        {id:'audio-duration-ms',label:revised?'录音时长':'表达时长',
          value:revised ? measured('audio-duration-ms') ?? null : Number.isFinite(record.durationMs) ? record.durationMs : null,unit:'ms'},
        {id:'text-character-count',label:revised?'转写字符数':'转写字数',
          value:revised ? measured('text-character-count') ?? null : fallback(measured('text-character-count'),'totalWords'),unit:'字'},
        revised ? {id:'review-word-count',label:'待核查用词',value:measured('review-word-count') ?? null,unit:'处'}
          : {label:'填充词',value:fallback(measured('filler-count'),'fillers'),unit:'次'}]};
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
    const detailSelector = '.report-metrics';
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
        : model.title==='本次材料不足以形成表达诊断' ? `${model.assessmentReason} 原文、录音与本地指标仍可查看；可以回到首页重新表达。`
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
      if(metric.id)row.id=`metric:${metric.id}`;
      const value = metric.value === null ? '—' : metric.unit === 'ms'
        ? `${String(Math.floor(metric.value/60000)).padStart(2,'0')}:${String(Math.floor(metric.value/1000)%60).padStart(2,'0')}`
        : `${metric.value} ${metric.unit}`;
      row.append(node('strong',value));metrics.append(row);
    }
    if (root) {
      for (const element of root.querySelectorAll('.report-title,.report-summary')) element.remove();
      (!model.summary || model.assessmentStatus==='limited' || record.structuredReport?.latestAttempt ? copy : info).append(...statuses);
    } else if (!record.report) body.replaceChildren();
    info.append(...details);
    if(!details.length){
      const reportUI=typeof module==='object' && module.exports ? require('./structured-report') : globalThis.StructuredReport;
      const {metricRun,evidenceRun}=record.structuredReport || {};
      info.appendChild(reportUI.createReportMetrics(document,{record,metrics:metricRun?.value.metrics || [],evidenceRun,metricRun}));
    }
    for(const basic of info.querySelectorAll('.metric-basics'))basic.remove();
    for (const line of byId('subtitle-container').querySelectorAll('[data-segment-id]')) {
      const segment=record.segments.find(item=>item.id === line.dataset.segmentId);
      if (!Number.isFinite(segment?.startMs)) continue;
      const seconds=Math.max(0,Math.floor(segment.startMs/1000));
      line.dataset.segmentTime=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
      line.title=segment.timingSource === 'estimated' ? '片段播放位置为估计值' : '保存的片段播放位置';
    }
    if (actions) {
      actions.hidden=!model.analysisAction.visible;
      actions.classList?.toggle('hidden',actions.hidden);
      (model.summary ? info : copy).append(actions);
      const label=actions.querySelector('.btn-label');
      if (label) label.textContent=model.analysisAction.label;
    }
    renderIdentity(document,record);
  }
  return {reportModel,present,renderIdentity};
});
