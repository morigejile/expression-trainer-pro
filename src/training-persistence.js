(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrainingPersistence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const emptyStats = () => ({fillers:0,hedges:0,vagueWords:0,totalWords:0,duration:0,excludedCharacters:0,hedgeCharacters:0});
  const reportView = typeof module !== 'undefined' && module.exports ? require('./structured-report') : globalThis.StructuredReport;
  function sessionToRecord(session) {
    const results = session.results || [];
    const latest = kind => results.filter(result => result.kind === kind).at(-1);
    const success = kind => results.filter(result => result.kind === kind && result.status === 'completed').at(-1);
    return {
      id:session.id, createdAt:session.createdAt, durationMs:session.durationMs || 0,
      trainingMode:session.trainingMode ?? 'free', framework:session.framework ?? null,
      frameworkDefinitionVersion:session.frameworkDefinitionVersion ?? null, trainingPrompt:session.trainingPrompt ?? null,
      practice:session.practice ?? null,
      status:session.status, deletionPending:session.deletionPending, sourceSnapshot:session.sourceSnapshot,
      timing:session.timing ?? null, dataQuality:session.dataQuality || [],
      fullText:session.transcript?.text || '', segments:session.transcript?.segments || [],
      stats:success('metrics')?.value?.stats || null, metricsAvailable:Boolean(success('metrics')?.value?.stats),
      report:success('report')?.value || '', reportStatus:latest('report')?.status,
      playbackAnalysis:success('playback')?.value || null, playbackStatus:latest('playback')?.status,
      results, resultIntegrity:session.resultIntegrity, factsSaved:session.status === 'completed', audioState:session.artifact?.state || 'missing', audioUrl:null,
      structuredReport:reportView.selectStructuredReport(results),
      saveState:session.status === 'completed' ? 'saved' : 'incomplete'
    };
  }
  function createTrainingPersistence({api, onChange = () => {}}) {
    const saving = new Map();
    const id = () => globalThis.crypto.randomUUID();
    const command = (method, sessionId, input) => api[method]({requestId:id(), ...(sessionId ? {sessionId} : {}), ...(input ? {input} : {})});
    const notify = record => onChange(record);
    async function start(input) {
      const response = await command('createTrainingSession', null, input);
      if (!response?.ok) throw new Error(response?.error?.message || '无法建立训练记录，请重试');
      return {...response.value, setupSaved:response.setupSaved};
    }
    function result(record, input) {
      return {id:id(),inputRevision:1,definitionVersion:null,analyzerVersion:null,
        analysisMode:input.kind === 'metrics' ? 'common' : 'coaching',
        createdAt:new Date().toISOString(),status:'completed',
        evidenceRefs:record.segments.map(s => s.id),provenance:{},...input};
    }
    async function flush(record) {
      while (record.pendingResults?.length) {
        const next = record.pendingResults[0];
        const response = await command('appendTrainingResult',record.id,next);
        if (!response?.ok) throw Object.assign(new Error(response?.error?.message || '分析结果保存失败'), {code:response?.error?.code});
        record.results ||= [];
        if (!record.results.some(item => item.id === next.id)) record.results.push(response.value);
        record.pendingResults.shift();
      }
    }
    function save(record) {
      if (saving.has(record.id)) return saving.get(record.id);
      const work = (async () => {
        record.saveState = 'saving'; notify(record);
        try {
          if (!record.factsSaved) {
            const response = await command('finalizeTrainingSession',record.id,{
              completedAt:record.completedAt,durationMs:Math.round(record.durationMs),
              transcript:{text:record.fullText,segments:record.segments.map(s => {
                const timingSource = s.timingSource ?? 'estimated'; // Legacy renderer intervals were estimates.
                const time = value => timingSource === 'unavailable' || value == null ? null
                  : timingSource === 'estimated' ? Math.min(Math.round(record.durationMs),Math.round(value)) : value;
                return {id:s.id,text:s.text,startMs:time(s.startMs),endMs:time(s.endMs),
                  timingSource,timingVersion:s.timingVersion ?? null};
              })},
              timing:record.timing ?? null,
              dataQuality:record.dataQuality ?? (record.segments.length ? ['timing-estimated'] : ['timing-unavailable']),
              audio:new Uint8Array(await record.audioBlob.arrayBuffer())
            });
            if (!response?.ok) throw new Error(response?.error?.message || '训练保存失败，请重试');
            record.factsSaved = true; record.status = 'completed'; record.audioState = 'available';
            record.audioBlob = null;
            record.pendingResults ||= [];
            record.pendingResults.unshift(result(record,{kind:'metrics',definitionVersion:'expression-rules-v1',analyzerVersion:'lexicon-v1',
              value:{stats:record.stats,segments:record.segments.map(({id,localAnalysis}) => ({id,localAnalysis:localAnalysis || null}))}}));
          }
          await flush(record);
          record.saveState = 'saved'; record.saveError = null; notify(record); return true;
        } catch (error) {
          record.saveState = 'failed'; record.saveError = error.message; notify(record); return false;
        }
      })().finally(() => saving.delete(record.id));
      saving.set(record.id,work); return work;
    }
    async function append(record, input) {
      record.pendingResults ||= [];
      record.pendingResults.push(result(record,input));
      if (record.saveState === 'saved') record.factsSaved = true;
      if (saving.has(record.id)) await saving.get(record.id);
      return save(record);
    }
    return {start,save,append,interrupt:(sessionId,input) => command('interruptTrainingSession',sessionId,input),
      drain:async () => { while (saving.size) await Promise.allSettled([...saving.values()]); }};
  }
  return {createTrainingPersistence,sessionToRecord};
});
