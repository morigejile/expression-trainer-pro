'use strict';

const {countCharacters, percentage, densityPercent} = require('../shared/text-statistics');
const {REPORT_METRICS_VERSION,wordMatches,speechGap} = require('../shared/report-selection');

const DEFINITION_VERSION = 'common-metrics-v1';
const LEGACY_ONLY_METRICS = new Set(['hedge-count','vague-word-count','text-rate-per-recorded-minute',
  'filler-rate-per-recorded-minute','non-filler-hedge-character-percent','non-speech-duration-ms','between-speech-gap-max-ms']);
const VERSION_FIELDS = ['engine','engineVersion','modelId','modelVersion','modelSha256','thresholdVersion','normalizationVersion'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

function transcriptFacts(transcript) {
  if (!transcript || typeof transcript.text !== 'string') return {reason:'transcript-unavailable',refs:[]};
  const invalid = {reason:'transcript-evidence-invalid',refs:[]};
  if (!integer(transcript.revision) || transcript.revision < 1 || !Array.isArray(transcript.segments)) return invalid;
  const seen = new Set();
  let joined = '';
  for (const segment of transcript.segments) {
    if (!segment || !validId(segment.id) || segment.id === 'audio' || /^speech-\d+$/.test(segment.id) ||
        seen.has(segment.id) || typeof segment.text !== 'string') return invalid;
    seen.add(segment.id);
    joined += segment.text;
  }
  if (joined !== transcript.text) return invalid;
  return {reason:null,refs:[...seen],count:countCharacters(transcript.text)};
}

function audioFacts(session) {
  const artifact = session?.artifact;
  if (artifact?.state !== 'available') return {reason:'audio-unavailable',refs:[]};
  const invalid = {reason:'audio-timing-invalid',refs:[]};
  if (artifact.sampleRateHz !== 16000 || !integer(artifact.durationMs)) return invalid;
  const timing = session.timing;
  if (timing != null) {
    if (timing.schemaVersion !== 1 || timing.sampleRateHz !== 16000 ||
        timing.capabilities?.audioTimeline !== true || !integer(timing.capturedSampleCount) ||
        Math.round(timing.capturedSampleCount / 16) !== artifact.durationMs ||
        session.durationMs !== artifact.durationMs) return invalid;
    return {reason:null,refs:['audio'],durationMs:timing.capturedSampleCount / 16,
      sampleCount:timing.capturedSampleCount};
  }
  // Legacy artifact duration comes from the validated WAV. The old session's wall
  // clock and estimated transcript times are not substituted for its audio clock.
  return {reason:null,refs:['audio'],durationMs:artifact.durationMs,sampleCount:null};
}

function speechFacts(evidence, audio, coverageReason) {
  const failed = reason => ({reason,refs:[],version:null,quality:null});
  if (audio.reason || coverageReason) return failed(audio.reason || coverageReason);
  if (evidence?.status !== 'completed') return failed('vad-unavailable');
  if (evidence.schemaVersion !== 1 || evidence.capabilities?.speechIntervals !== true ||
      evidence.audio?.sampleRateHz !== 16000 || !integer(evidence.audio.sampleCount) ||
      !Array.isArray(evidence.segments) || VERSION_FIELDS.some(key =>
        typeof evidence.provenance?.[key] !== 'string' || !evidence.provenance[key].trim())) {
    return failed('vad-evidence-invalid');
  }
  const quality = evidence.quality?.vad;
  const usableQuality = Array.isArray(quality?.reasons) &&
    ((quality.status === 'ok' && quality.reasons.length === 0) ||
      (quality.status === 'degraded' && quality.reasons.length > 0 &&
        quality.reasons.every(reason => reason === 'vad-thresholds-uncalibrated')));
  if (!usableQuality ||
      (audio.sampleCount !== null ? evidence.audio.sampleCount !== audio.sampleCount
        : Math.round(evidence.audio.sampleCount / 16) !== audio.durationMs)) return failed('vad-coverage-incomplete');
  let end = 0;
  let speechSamples = 0;
  let gapSamples = 0;
  let maxGapSamples = 0;
  let gapCount = 0;
  let previous = null;
  const ids = new Set();
  for (const segment of evidence.segments) {
    if (!segment || !/^speech-\d+$/.test(segment.id) || ids.has(segment.id) ||
        !integer(segment.startSample) || !integer(segment.endSample) ||
        segment.startSample < end || segment.endSample <= segment.startSample ||
        segment.endSample > evidence.audio.sampleCount) return failed('vad-evidence-invalid');
    // Only a positive gap between two observed speech intervals counts here.
    const interval = speechGap(previous,segment);
    if (interval) {
      const gap = interval.endSample - interval.startSample;
      gapCount += 1;
      gapSamples += gap;
      maxGapSamples = Math.max(maxGapSamples,gap);
    }
    speechSamples += segment.endSample - segment.startSample;
    end = segment.endSample;
    ids.add(segment.id);
    previous = segment;
  }
  return {reason:null,refs:['audio',...ids],quality:{status:quality.status,reasons:[...quality.reasons]},
    version:{schemaVersion:1,...Object.fromEntries(VERSION_FIELDS.map(key => [key,evidence.provenance[key]]))},
    speechMs:speechSamples / 16,nonSpeechMs:(evidence.audio.sampleCount - speechSamples) / 16,
    gapCount,gapMs:gapSamples / 16,maxGapMs:maxGapSamples / 16};
}

function countWordMatches(transcript,stats) {
  const map = stats?.wordMatchMap;
  if (typeof map !== 'string') return {reason:'local-stats-unavailable'};
  const invalid = {reason:'local-stats-invalid'};
  if (map.length > transcript.length || /[^ 1-7-]|(?:^| )-/.test(map)) return invalid;
  let count = 0, fillers = 0, hedges = 0, vagueWords = 0;
  for (const {start,end,kinds} of wordMatches(map)) {
    if (end-start > 32 || !transcript.slice(start,end).trim()) return invalid;
    count += 1;
    if (kinds & 1) fillers += 1;
    if (kinds & 2) hedges += 1;
    if (kinds & 4) vagueWords += 1;
  }
  return fillers===stats.fillers && hedges===stats.hedges && vagueWords===stats.vagueWords ? {count} : invalid;
}

/**
 * Pure measurement over one saved transcript/audio snapshot. The caller owns
 * run IDs, timestamps and persistence; these observations are not quality scores.
 * localStats are the saved lexicon counts (including that run's custom words),
 * not a second tokenization of the transcript with today's vocabulary.
 */
function computeCommonAnalysis({session, speechEvidence = null, localStats = null, definitionVersion = DEFINITION_VERSION} = {}) {
  const revised = definitionVersion === REPORT_METRICS_VERSION;
  const text = transcriptFacts(session?.transcript);
  const audio = audioFacts(session);
  const flags = [...(Array.isArray(session?.dataQuality) ? session.dataQuality : []),
    ...(session?.timing?.qualityEvents || []).map(event=>event.code)];
  const coverageReason = flags.some(flag=>['audio-overrun','audio-discontinuity'].includes(flag)) ? 'audio-coverage-incomplete' : null;
  const speech = speechFacts(speechEvidence,audio,coverageReason);
  const accepted = session?.timing?.asrAcceptedSampleCount;
  const asrReason = flags.includes('asr-error') || (integer(accepted) && integer(audio.sampleCount) &&
    accepted < audio.sampleCount) ? 'asr-incomplete' : null;
  const statsReason = text.reason || (!localStats ? 'local-stats-unavailable'
    : localStats.totalWords !== text.count ? 'local-stats-invalid' : null);
  const statReason = key => statsReason || (!integer(localStats[key]) || localStats[key] > text.count ? 'local-stats-invalid' : null);
  const statsValue = key => localStats?.[key] ?? null;
  const metrics = [];
  function add(id,label,unit,value,reason,refs) {
    if (revised && LEGACY_ONLY_METRICS.has(id)) return;
    metrics.push({id,label,value:reason ? null : value,unit,
      status:reason ? 'unavailable' : 'available',reason:reason || null,evidenceRefs:reason ? [] : [...new Set(refs)]});
  }
  add('text-character-count','文字与数字字符数','characters',text.count,text.reason,text.refs);
  add('audio-duration-ms','已保存录音时长','ms',audio.durationMs,audio.reason,audio.refs);
  for (const [id,label,key] of [['filler-count','填充词命中次数','fillers'],['hedge-count','犹豫词命中次数','hedges'],
    ['vague-word-count','笼统词命中次数','vagueWords']]) {
    add(id,label,'occurrences',statsValue(key),statReason(key),text.refs);
  }
  if (revised) {
    const matches = statsReason ? {reason:statsReason} : countWordMatches(session.transcript.text,localStats);
    add('review-word-count','待核查用词','locations',matches.count,matches.reason,text.refs);
  }
  const recordedRateReason = text.reason || audio.reason || coverageReason || asrReason ||
    (audio.durationMs === 0 ? 'no-recorded-duration' : null);
  add('text-rate-per-recorded-minute','每录音分钟字符数（含静音）','characters/recorded-minute',
    text.count * 60000 / audio.durationMs,recordedRateReason,[...text.refs,...audio.refs]);
  add('filler-rate-per-recorded-minute','每录音分钟填充词命中次数','occurrences/recorded-minute',
    statsValue('fillers') * 60000 / audio.durationMs,statReason('fillers') || recordedRateReason,[...text.refs,...audio.refs]);
  const noText = !text.reason && text.count === 0 ? 'no-measured-text' : null;
  add('hedge-character-percent','犹豫词字符占比','percent',percentage(statsValue('hedgeCharacters'),text.count),
    statReason('hedgeCharacters') || noText,text.refs);
  add('non-filler-hedge-character-percent','非填充词与犹豫词字符占比','percent',densityPercent(text.count,statsValue('excludedCharacters')),
    statReason('excludedCharacters') || noText,text.refs);
  for (const [id,label,key,unit] of [['speech-duration-ms','VAD 检测语音时长','speechMs','ms'],
    ['non-speech-duration-ms','VAD 检测非语音时长','nonSpeechMs','ms'],
    ['between-speech-gap-count','语音区间之间的间隔次数','gapCount','occurrences'],
    ['between-speech-gap-total-ms','语音区间之间的间隔总时长','gapMs','ms'],
    ['between-speech-gap-max-ms','语音区间之间的最长间隔','maxGapMs','ms']]) {
    add(id,label,unit,speech[key],speech.reason,speech.refs);
  }
  add('text-rate-per-speech-minute','每检测语音分钟字符数（非逐字对齐）','characters/speech-minute',
    text.count * 60000 / speech.speechMs,text.reason || speech.reason || asrReason ||
      (speech.speechMs === 0 ? 'no-observed-speech' : null) || (revised && noText),[...text.refs,...speech.refs]);
  if (revised) {
    const derived = deriveFluencyMetrics(metrics);
    metrics.push(...derived.filter(metric=>metric.id!=='text-rate-per-expression-minute'));
  }
  return {schemaVersion:1,definitionVersion,analysisMode:'common',
    sessionId:validId(session?.id) ? session.id : null,
    inputRevision:integer(session?.transcript?.revision) && session.transcript.revision > 0 ? session.transcript.revision : null,
    speechEvidenceVersion:speech.version,speechEvidenceQuality:speech.quality,
    metrics,evidenceRefs:[...new Set(metrics.flatMap(item => item.evidenceRefs))]};
}

function deriveFluencyMetrics(metrics) {
  const byId = new Map(metrics.map(item=>[item.id,item]));
  const speech = byId.get('speech-duration-ms'), gaps = byId.get('between-speech-gap-total-ms');
  const count = byId.get('between-speech-gap-count'), text = byId.get('text-character-count');
  const speechRate = byId.get('text-rate-per-speech-minute');
  // The sum is exact at the 16 kHz sample resolution, including fractional ms.
  const spanMs = speech.value + gaps.value;
  const spanReason = speech.reason || gaps.reason || (spanMs===0 ? 'no-observed-speech' : null);
  const refs = speech.evidenceRefs;
  const measured = (id,label,unit,value,reason,evidenceRefs) => ({id,label,unit,
    value:reason ? null : value,status:reason ? 'unavailable' : 'available',reason:reason || null,
    evidenceRefs:reason ? [] : [...new Set(evidenceRefs)]});
  return [
    measured('expression-span-ms','表达跨度（不含首尾非语音）','ms',spanMs,spanReason,refs),
    measured('text-rate-per-expression-minute','每表达分钟字符数（含内部间隔）','characters/expression-minute',
      text.value*60000/spanMs,spanReason || speechRate.reason,[...text.evidenceRefs,...refs]),
    measured('between-speech-gap-percent','内部语音间隔占比','percent',gaps.value*100/spanMs,spanReason,refs),
    measured('between-speech-gap-rate-per-expression-minute','每表达分钟内部语音间隔次数','occurrences/expression-minute',
      count.value*60000/spanMs,spanReason,refs)
  ];
}

function computeFluencyPreview({session,speechEvidence=null} = {}) {
  const common = computeCommonAnalysis({session,speechEvidence});
  const metrics = [...deriveFluencyMetrics(common.metrics),common.metrics.find(item=>item.id==='text-rate-per-speech-minute')];
  return {...common,definitionVersion:'fluency-metrics-v1-experimental',metrics,
    evidenceRefs:[...new Set(metrics.flatMap(item=>item.evidenceRefs))]};
}

module.exports = {computeCommonAnalysis,computeFluencyPreview,DEFINITION_VERSION,REPORT_METRICS_VERSION};
