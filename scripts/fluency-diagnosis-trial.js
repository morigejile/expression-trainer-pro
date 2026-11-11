'use strict';

const {MAX_CONTEXT_CHARS}=require('../lib/analysis-context');
const {getStructuredDiagnosisPrompt,parseStructuredDiagnosisResponse}=require('../lib/structured-diagnosis');
const {speechGap}=require('../shared/report-selection');

const METRICS=new Set(['speech-duration-ms','text-rate-per-speech-minute','between-speech-gap-percent',
  'between-speech-gap-rate-per-expression-minute']);
const BASE_PAUSE_RULE='- D：当前主诊断没有可靠声音与词级对齐证据，禁止评价精确停顿位置、重音、声音强调、局部语速变化、音高、音色或情绪质量；禁止推断紧张、准备不足等心理原因。';
const AGGREGATE_RULE='检测语音时长为每检测语音分钟字符数的分母，速率是整段转写产出估计，没有逐字对齐。内部间隔占比和频率用首尾检测语音之间的跨度作分母，均是整段背景。只有这些数值时，不判过快、过慢、卡顿或单处位置。不得将段落标点、估计时刻与这些数值组合成停顿定位。';
const WORD_RULE='wordCandidates 是原文词表命中位置。按用词在前后原文的实际作用判断，正常连接、指代、解释、保留判断均可合理。候选不是问题列表，保留未命中位置的语义检查。由命中引出的问题引用对应转写 segment，不按命中总数生成或排序问题。';

function alignedInput(context,pauses) {
  if(!Array.isArray(pauses) || pauses.length<1 || pauses.length>12 || context.speech?.status!=='completed' ||
    context.speech.sampleRateHz!==16000 || !context.metrics.some(metric=>
      metric.metricId==='between-speech-gap-count' && metric.status==='available')) throw new Error('Invalid aligned pause input');
  const segments=context.speech.segments;
  const gaps=segments.flatMap((segment,index)=>speechGap(segments[index-1],segment) || []);
  const text=context.transcript.segments.map(segment=>segment.text).join('');
  const seen=new Set(context.allowedEvidenceRefs);
  // The trial caller verifies the lexical alignment against the WAV. Here
  // we check that its result still belongs to these exact saved inputs.
  return pauses.map(({id,startSeconds,endSeconds,durationSeconds,before,after,transcriptRange})=>{
    const index=/^pause-gap-(0|[1-9]\d*)$/.exec(id)?.[1];
    const gap=gaps[index];
    const {beforeEnd,afterStart}=transcriptRange || {};
    if(!gap || seen.has(id) || gap.startSample/16000!==startSeconds || gap.endSample/16000!==endSeconds ||
      (gap.endSample-gap.startSample)/16000!==durationSeconds ||
      !Number.isSafeInteger(beforeEnd) || !Number.isSafeInteger(afterStart) || beforeEnd<1 ||
      afterStart<beforeEnd || afterStart>=text.length || /[\p{L}\p{N}]/u.test(text.slice(beforeEnd,afterStart)) ||
      typeof before!=='string' || !before.trim() || before.length>80 || beforeEnd<before.length ||
      typeof after!=='string' || !after.trim() || after.length>80 ||
      text.slice(beforeEnd-before.length,beforeEnd)!==before || text.slice(afterStart,afterStart+after.length)!==after) {
      throw new Error('Invalid aligned pause input');
    }
    seen.add(id);
    return {id,startSeconds,endSeconds,durationSeconds,before,after};
  });
}

function alignedRules(pauses) {
  const example=Object.fromEntries(pauses.map(({id})=>[id,{status:'insufficient',reason:'这里填写该处理由'}]));
  return `以下单独判断 pauses 中每个事件，三种状态为 natural、disruptive、insufficient。natural 需要前后意思与检测时长共同支持这处间隔符合表达分组；句意已完成只说明位置可能合理，无法判断间隔是否妨碍连续收听时用 insufficient。disruptive 需要能指出具体被割裂的语义关系及听者受影响的方式。语句断开、时长长短、ASR 标点或整段统计单独都不能决定状态。提供的是检测时间和两侧转写，不能声称听到换气、语气、音高，不能推测原因。
在原报告的同一个 JSON 对象内添加 pauseAssessments 对象，键恰好为下列事件 ID，每个值只写 status、reason。字段示例（status 不是默认判断）：${JSON.stringify(example)}。不要在 pauseAssessments 下添加 evidenceRefs 或任何其他字段。只有判为 disruptive 且值得优先练的事件才可进入报告 Finding，Finding 同时引用该事件 ID 和相关原文 ID。其他输出字段不变。`;
}

// Developer trial only. It builds the experimental request without any network
// calls, credential access, settings changes or production report integration.
function buildTrialPrompt(context,{variant,pauses,wordCandidates}={}) {
  const baseline=getStructuredDiagnosisPrompt(context);
  if(variant==='baseline')return baseline;
  const input=JSON.parse(baseline.user);
  let system=baseline.system;
  let rules;
  switch(variant) {
    case 'words':
      if(!Array.isArray(wordCandidates) || wordCandidates.length>12)throw new Error('Invalid word candidate input');
      input.wordCandidates=wordCandidates.map(({evidenceRefs,word,kinds,before,after})=>{
        if(typeof word!=='string' || !word.trim() || word.length>32 ||
          typeof before!=='string' || before.length>24 || typeof after!=='string' || after.length>24 ||
          !Array.isArray(kinds) || !kinds.length || kinds.length>3 ||
          kinds.some(kind=>!['填充词','犹豫词','笼统词'].includes(kind)) ||
          !Array.isArray(evidenceRefs) || !evidenceRefs.length ||
          evidenceRefs.some(ref=>!input.transcript.segments.some(segment=>segment.id===ref))) throw new Error('Invalid word candidate input');
        return {evidenceRefs,word,kinds,before,after};
      });
      rules=WORD_RULE;
      break;
    case 'aggregate':
    case 'aligned': {
      const metrics=context.metrics.filter(metric=>metric.status==='available' && METRICS.has(metric.metricId))
        .map(({id,label,value,unit})=>({id,label,value,unit}));
      input.metrics=[...(input.metrics || []),...metrics];
      input.allowedEvidenceRefs.push(...metrics.map(metric=>metric.id));
      rules=AGGREGATE_RULE;
      if(variant==='aligned'){
        if(!system.includes(BASE_PAUSE_RULE))throw new Error('Baseline pause rule changed');
        input.pauses=alignedInput(context,pauses);
        input.allowedEvidenceRefs.push(...input.pauses.map(pause=>pause.id));
        system=system.replace(BASE_PAUSE_RULE,
          '- 只有提供了带前后原文的 pauses，才可根据给定检测边界评估该处停顿与句意的关系。其余声音判断与心理推断仍不可用。');
        rules+='\n'+alignedRules(input.pauses);
      }
      break;
    }
    default:throw new Error('Unknown fluency trial variant');
  }
  const user=JSON.stringify(input);
  if(user.length>MAX_CONTEXT_CHARS)throw new Error('Fluency trial input too large');
  return {system:system+'\n【本轮评估规则】\n'+rules,user};
}

function parseTrialResponse(raw,input) {
  const options={requireAssessment:true,currentFormat:true};
  if(!input.pauses)return {report:parseStructuredDiagnosisResponse(raw,input,options)};
  if(typeof raw!=='string' || raw.length>64000)throw new Error('Invalid pause assessment');
  const response=JSON.parse(raw);
  const values=response?.pauseAssessments;
  if(!values || typeof values!=='object' || Array.isArray(values) ||
    Object.keys(values).length!==input.pauses.length) throw new Error('Invalid pause assessment');
  const assessments=input.pauses.map(({id})=>{
    const value=values[id];
    if(!value || Object.keys(value).length!==2 ||
      !['natural','disruptive','insufficient'].includes(value.status) ||
      typeof value.reason!=='string' || !value.reason.trim() || value.reason.length>800) throw new Error('Invalid pause assessment');
    return {id,status:value.status,reason:value.reason};
  });
  delete response.pauseAssessments;
  const report=parseStructuredDiagnosisResponse(JSON.stringify(response),input,options);
  const statuses=new Map(assessments.map(({id,status})=>[id,status]));
  const transcriptRefs=new Set(input.transcript.segments.map(segment=>segment.id));
  for(const finding of [...report.findings,...(report.frameworkAnalysis?.findings || [])]){
    for(const ref of finding.evidenceRefs.filter(id=>statuses.has(id))){
      if(statuses.get(ref)!=='disruptive' || finding.category!=='delivery' ||
        !finding.evidenceRefs.some(id=>transcriptRefs.has(id))) throw new Error('Invalid pause finding');
    }
  }
  return {report,assessments};
}

module.exports={buildTrialPrompt,parseTrialResponse};
