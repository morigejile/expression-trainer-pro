'use strict';
const {randomUUID} = require('node:crypto');
const {requireId,sessionError,normalizePractice} = require('./training-session-data');
const {selectStructuredReport} = require('../shared/report-selection');

async function createPractice(store,request) {
  const invalid = () => {throw sessionError('INVALID_SESSION','Invalid practice source');};
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some(key => !['sessionId','reportId','findingId','continueChain','scope'].includes(key)) ||
      typeof request.continueChain !== 'boolean' || !['sentence','segment','full'].includes(request.scope)) invalid();
  requireId(request.sessionId); requireId(request.reportId);
  const source = await store.get(request.sessionId);
  if (!source || source.deletionPending) throw sessionError('SESSION_NOT_FOUND','Practice source deleted');
  if (source.status !== 'completed') invalid();
  const report = selectStructuredReport(source.results,{snapshotId:request.reportId});
  if (!report) invalid();
  const membership = {sessionId:source.id,reportId:report.snapshot.id,round:1};
  if (request.continueChain) {
    if (!source.practice || request.findingId !== null) invalid();
    return normalizePractice({...source.practice,scope:request.scope,round:source.practice.round+1,
      previousSessionId:source.id,previousReportId:report.snapshot.id,
      history:[...source.practice.history,{...membership,round:source.practice.round}]});
  }
  requireId(request.findingId);
  if (report.analysisRun.status !== 'completed') invalid();
  const finding = [...report.analysisRun.value.findings,...(report.analysisRun.value.frameworkAnalysis?.findings || [])]
    .find(value => value.id === request.findingId);
  if (!finding) invalid();
  return normalizePractice({chainId:randomUUID(),round:2,scope:request.scope,previousSessionId:source.id,
    previousReportId:report.snapshot.id,history:[membership],
    goal:{category:finding.category,observation:finding.observation,recommendation:finding.recommendation},
    origin:{sessionId:source.id,reportId:report.snapshot.id,analysisId:report.analysisRun.id,
      findingId:finding.id,definitionVersion:report.analysisRun.definitionVersion}});
}

async function practiceHistory(store,sessionId) {
  const current = await store.get(sessionId);
  if (!current || current.deletionPending) throw sessionError('SESSION_NOT_FOUND','Practice deleted');
  if (!current.practice) return [];
  const report = selectStructuredReport(current.results);
  const entries = [...current.practice.history,{sessionId:current.id,reportId:report?.snapshot.id ?? null,round:current.practice.round}];
  const sessions = new Map(await Promise.all(entries.map(async entry => [entry.sessionId,
    entry.sessionId === current.id ? current : await store.get(entry.sessionId)])));
  return entries.map(entry => {
    const session = sessions.get(entry.sessionId);
    if (!session || session.deletionPending) return {...entry,deleted:true,summary:null};
    const projection = selectStructuredReport(session.results,{snapshotId:entry.reportId});
    const previous = session.practice ? sessions.get(session.practice.previousSessionId) : null;
    return {...entry,deleted:false,summary:entry.round === 1 ? '基准表达'
      : session.practice && (!previous || previous.deletionPending) ? '来源报告已删除，历史变化结论无法复核'
      : projection?.analysisRun.value.practiceFeedback?.summary || '暂无可靠的练习变化结论'};
  });
}

async function previousPractice(store,session) {
  if (!session.practice) return null;
  const previous = await store.get(session.practice.previousSessionId);
  if (!previous || previous.deletionPending) return {status:'unavailable',reason:'source-deleted'};
  const report = selectStructuredReport(previous.results,{snapshotId:session.practice.previousReportId});
  if (previous.status !== 'completed' || !report) return {status:'unavailable',reason:'source-unavailable'};
  return {status:'available',session:previous,report};
}
module.exports = {createPractice,practiceHistory,previousPractice};
