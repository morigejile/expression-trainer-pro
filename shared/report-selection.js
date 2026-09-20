(function(root,factory) {
  const api=factory();
  if (typeof module === 'object' && module.exports) module.exports=api;
  else root.ReportSelection=api;
})(typeof globalThis !== 'undefined' ? globalThis : this,() => {
  'use strict';
  const CATEGORIES = {organization:'组织与衔接',argument:'论点与论据',delivery:'节奏与停顿',wording:'措辞与口头禅'};
  const frameworks = typeof module === 'object' && module.exports ? require('./training-frameworks') : globalThis.TrainingFrameworks;
  const refs = value => Array.isArray(value) && value.every(ref => typeof ref === 'string');
  const finding = value => value && Object.hasOwn(CATEGORIES,value.category) &&
    ['id','observation','interpretation','recommendation'].every(key => typeof value[key] === 'string') && refs(value.evidenceRefs);
  function extensionsValid(value) {
    const f = value.frameworkAnalysis, r = value.frameworkRecommendation, p = value.practiceFeedback;
    return (!f || Boolean(frameworks?.getFramework(f.framework,f.definitionVersion)) && typeof f.summary === 'string' &&
      Array.isArray(f.findings) && f.findings.every(finding)) &&
      (!r || Boolean(frameworks?.getFramework(r.framework)) && typeof r.reason === 'string' && refs(r.evidenceRefs)) &&
      (!p || ['improved','partly-improved','unchanged','needs-practice','unavailable'].includes(p.status) &&
        typeof p.summary === 'string' && refs(p.previousEvidenceRefs) && refs(p.currentEvidenceRefs));
  }
  function selectStructuredReport(results, {snapshotId} = {}) {
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
      if (!extensionsValid(analysisRun.value)) continue;
      if (analysisRun.status === 'completed' && (typeof analysisRun.value.summary !== 'string' ||
          analysisRun.value.findings.some(finding => !finding || !Object.hasOwn(CATEGORIES,finding.category) ||
            ['observation','interpretation','recommendation'].some(key => typeof finding[key] !== 'string') ||
            !Array.isArray(finding.evidenceRefs) || finding.evidenceRefs.some(ref => typeof ref !== 'string')))) continue;
      valid.push({snapshot,evidenceRun,metricRun,analysisRun});
    }
    if (snapshotId !== undefined) return snapshotId === null ? null : valid.find(report => report.snapshot.id === snapshotId) || null;
    if (!valid.length) return null;
    const latest = valid.at(-1);
    const selected = valid.findLast(report => report.analysisRun.status === 'completed') || latest;
    return {...selected,latestAttempt:latest === selected ? null : {
      snapshotId:latest.snapshot.id,analysisRunId:latest.analysisRun.id,status:latest.analysisRun.status,
      reason:typeof latest.analysisRun.value.reason === 'string' ? latest.analysisRun.value.reason : null
    }};
  }

  return {selectStructuredReport,CATEGORIES};
});
