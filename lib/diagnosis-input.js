'use strict';

// These measurements provide scale and a lexical clue, never a quality score.
// Full Common Analysis remains local; derived rates and VAD estimates are not
// reliable enough to establish an additional main-diagnosis judgement today.
const DIAGNOSIS_METRIC_IDS=new Set(['text-character-count','audio-duration-ms','filler-count']);

// Project only the remote request. Local evidence, provenance and saved reports
// keep their complete shapes for validation, playback and historical comparison.
function transcriptInput(transcript) {
  return {segments:(transcript?.segments || []).map(segment=>({id:segment.id,text:segment.text,
    ...(segment.timingSource!=='unavailable' && Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs)
      ? {startMs:segment.startMs,endMs:segment.endMs,timingSource:segment.timingSource} : {})}))};
}

function trainingInput(context) {
  if (!context) return undefined;
  const result={};
  for(const key of ['trainingMode','framework'])if(context[key]!=null)result[key]=context[key];
  const prompt=context.trainingPrompt;
  if(prompt?.schemaVersion===2){
    const parts={};
    for(const key of ['topic','scenario'])if(prompt[key]?.text?.trim())parts[key]={text:prompt[key].text};
    if(Object.keys(parts).length)result.trainingPrompt={schemaVersion:2,...parts};
  }else if(prompt?.text?.trim())result.trainingPrompt={kind:prompt.kind,text:prompt.text};
  return Object.keys(result).length?result:undefined;
}

function qualityInput(quality) {
  const result={};
  for(const [key,value] of Object.entries(quality || {})){
    if(key==='vad')continue; // No acoustic evidence is sent by the main diagnosis.
    // A missing timestamp or unavailable measurement needs no separate notice.
    // Keep defects in supplied material and limitations of supplied estimates.
    const reasons=(value?.reasons || []).filter(reason=>reason!=='timing-unavailable');
    if(value?.status==='degraded' && reasons.length)result[key]={status:'degraded',reasons};
  }
  return Object.keys(result).length?result:undefined;
}

function createDiagnosisInput(context) {
  const result={schemaVersion:1,transcript:transcriptInput(context.transcript)};
  const metrics=(context.metrics || []).filter(metric=>metric.status==='available' && DIAGNOSIS_METRIC_IDS.has(metric.metricId))
    .map(metric=>({id:metric.id,label:metric.label,value:metric.value,unit:metric.unit}));
  if(metrics.length)result.metrics=metrics;
  const training=trainingInput(context.trainingContext);
  if(training)result.trainingContext=training;
  if(context.analysisTarget)result.analysisTarget={...context.analysisTarget};
  const quality=qualityInput(context.quality);
  if(quality)result.quality=quality;
  const instructions=Object.fromEntries(['goals','styleRef'].flatMap(key=>
    typeof context.analysisInstructions?.[key]==='string' && context.analysisInstructions[key].trim()
      ? [[key,context.analysisInstructions[key]]] : []));
  if(Object.keys(instructions).length)result.analysisInstructions=instructions;
  if(context.practiceComparison){
    const {status,goal,scope,previousScope,previous}=context.practiceComparison;
    result.practiceComparison={status,goal:structuredClone(goal),scope};
    if(status==='available' && previous){
      if(previousScope)result.practiceComparison.previousScope=previousScope;
      const prior={transcript:transcriptInput(previous.transcript)};
      const training=trainingInput(previous.trainingContext),quality=qualityInput(previous.quality);
      if(training)prior.trainingContext=training;
      if(quality)prior.quality=quality;
      result.practiceComparison.previous=prior;
    }
  }
  const visible=new Set([...result.transcript.segments,...metrics].map(item=>item.id));
  result.allowedEvidenceRefs=[...new Set(context.allowedEvidenceRefs.filter(ref=>visible.has(ref)))];
  return result;
}

module.exports={createDiagnosisInput};
