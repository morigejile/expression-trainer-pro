'use strict';

// Read-only inspection of saved M2 evidence. No model inference, store recovery or migrations.
const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const {createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {normalizeStart,normalizeTiming,normalizeResult,requireId,MAX_DURATION_MS} = require('../lib/training-session-data');
const {validateAudio} = require('../lib/training-audio-store');
const {computeCommonAnalysis,DEFINITION_VERSION} = require('../lib/common-analysis');
const {selectStructuredReport} = require('../src/structured-report');

const METRICS = ['speech-duration-ms','non-speech-duration-ms','between-speech-gap-count',
  'between-speech-gap-total-ms','between-speech-gap-max-ms'];
const HELP = `Read saved VAD evidence (does not rerun analysis or modify history).
  node scripts/inspect-speech-evidence.js --root <userData/training> --list
  node scripts/inspect-speech-evidence.js --root <userData/training> --session <id> [--report <snapshot-id>] [--output <directory>]
Default: select the same saved snapshot as Report; --report selects an explicit linked snapshot.
--output writes UTF-8 .txt and .json outside the training root; existing files are never overwritten.
Exit: 0 = inspected (may be unavailable), 1 = invalid input/read error, 2 = audio/metric integrity mismatch.
`;

function readSaved(root,sessionId) {
  // Do not use openTrainingSessionStore: opening it can recover/reconcile persistent state.
  const db = new DatabaseSync(path.join(root,'sessions.sqlite'), {readOnly:true});
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000; BEGIN;');
    if (db.prepare('PRAGMA user_version').get().user_version !== 2) throw new Error('Expected training schema v2; no migration performed.');
    if (!sessionId) return db.prepare(`SELECT s.id,s.created_at AS createdAt,s.duration_ms AS durationMs,
      s.status,substr(t.text,1,60) AS preview FROM sessions s LEFT JOIN transcripts t ON t.session_id=s.id
      WHERE s.deletion_pending=0 ORDER BY s.created_at DESC,s.id DESC`).all();
    requireId(sessionId);
    const row = db.prepare('SELECT * FROM sessions WHERE id=? AND deletion_pending=0').get(sessionId);
    if (!row) throw new Error('Session not found (or deletion pending). Use --list.');
    if (row.status !== 'completed') throw new Error('Session is not completed.');
    const facts = JSON.parse(row.facts_json);
    const transcript = db.prepare('SELECT * FROM transcripts WHERE session_id=?').get(sessionId);
    if (!transcript) throw new Error('Saved transcript is missing.');
    const artifact = db.prepare('SELECT * FROM artifacts WHERE session_id=?').get(sessionId);
    const session = {...normalizeStart(facts),id:row.id,status:row.status,createdAt:row.created_at,
      durationMs:row.duration_ms,timing:normalizeTiming(facts.timing),dataQuality:JSON.parse(row.quality_json),
      transcript:{revision:1,text:transcript.text,segments:JSON.parse(transcript.segments_json)},
      artifact:artifact ? {state:artifact.state,relativePath:artifact.relative_path,byteLength:artifact.byte_length,
        sha256:artifact.sha256,sampleRateHz:16000,
        durationMs:artifact.byte_length == null ? null : Math.round((artifact.byte_length-44)/32)} : null};
    const results = [], unreadableResults = [];
    for (const stored of db.prepare('SELECT * FROM results WHERE session_id=? ORDER BY created_at,id').all(sessionId)) {
      try {
        const snapshot = JSON.parse(stored.snapshot_json);
        if (snapshot.id !== stored.id || snapshot.sessionId !== sessionId || snapshot.createdAt !== stored.created_at) {
          throw new Error('Result identity mismatch');
        }
        results.push(normalizeResult(snapshot,session));
      } catch { unreadableResults.push(stored.id); }
    }
    return {session,results,unreadableResults};
  } finally { db.close(); }
}

function verifyAudio(root,session) {
  const artifact = session.artifact;
  const result = {path:null,expectedSha256:artifact?.sha256 ?? null,actualSha256:null,
    verification:'unavailable',sampleCount:null,sampleRateHz:16000};
  if (!artifact || artifact.relativePath !== `audio/${session.id}.wav`) return result;
  const filename = path.join(root,artifact.relativePath);
  result.path = filename;
  if (artifact.state !== 'available') return result;
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(filename) !== filename ||
        stat.size > 44 + MAX_DURATION_MS * 32 || stat.size !== artifact.byteLength) {
      result.verification = 'file-mismatch'; return result;
    }
    const bytes = fs.readFileSync(filename);
    result.actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (result.actualSha256 !== artifact.sha256) { result.verification = 'hash-mismatch'; return result; }
    validateAudio(bytes);
    result.sampleCount = (bytes.length-44)/2;
    result.verification = 'verified';
  } catch (error) { result.verification = error.code === 'ENOENT' ? 'missing' : 'invalid-wav'; }
  return result;
}

function interval(id,kind,startSample,endSample,evidenceRefs) {
  return {id,kind,startSample,endSample,durationSamples:endSample-startSample,
    startSeconds:startSample/16000,endSeconds:endSample/16000,durationSeconds:(endSample-startSample)/16000,evidenceRefs};
}

function inspect(root,saved,reportId) {
  const {session,results,unreadableResults} = saved;
  const report = selectStructuredReport(reportId
    ? results.filter(run=>run.kind !== 'report-snapshot' || run.id === reportId) : results);
  if (!report) throw new Error('No valid linked Report snapshot found. No orphan results were substituted.');
  const {snapshot,evidenceRun,metricRun,analysisRun,latestAttempt} = report;
  if (metricRun.value.definitionVersion !== DEFINITION_VERSION) throw new Error('Unsupported saved metric definition version.');
  const source = evidenceRun.value;
  const audio = verifyAudio(root,session);
  const measuredSession = {...session,artifact:session.artifact ? {...session.artifact,
    state:audio.verification==='verified' ? 'available' : 'missing'} : null};
  // Use the same dependency/coverage validation and metric definitions as the product.
  const common = computeCommonAnalysis({session:measuredSession,speechEvidence:source});
  const metricChecks = METRICS.map(id=>{
    const matches = metricRun.value.metrics.filter(metric=>metric.id === id);
    const savedMetric = matches.length===1 ? matches[0] : null;
    const recomputed = common.metrics.find(metric=>metric.id===id);
    return {id,saved:savedMetric,recomputed,matches:Boolean(savedMetric && savedMetric.status === recomputed.status &&
      savedMetric.unit === recomputed.unit && savedMetric.reason === recomputed.reason &&
      (recomputed.status==='available' ? Number.isFinite(savedMetric.value) && Math.abs(savedMetric.value-recomputed.value)<1e-6
        : savedMetric.value===null))};
  });
  const reason = metricChecks.find(check=>check.recomputed.status!=='available')?.recomputed.reason ?? null;
  const availability = reason ? 'unavailable' : 'available';
  let speechRegions = null, gaps = null, edgeNonSpeech = null;
  if (!reason) {
    speechRegions = source.segments.map(segment=>interval(segment.id,'speech',segment.startSample,segment.endSample,[segment.id]));
    gaps = []; edgeNonSpeech = [];
    for (let i=1;i<speechRegions.length;i++) {
      const before = speechRegions[i-1], after = speechRegions[i];
      if (after.startSample>before.endSample) gaps.push(interval(`gap-${gaps.length}`,'between-speech-gap',
        before.endSample,after.startSample,[before.id,after.id]));
    }
    if (!speechRegions.length) {
      if (source.audio.sampleCount>0) edgeNonSpeech.push(interval('non-speech-all','all-non-speech',0,source.audio.sampleCount,['audio']));
    } else {
      if (speechRegions[0].startSample>0) edgeNonSpeech.push(interval('non-speech-leading','leading-non-speech',
        0,speechRegions[0].startSample,['audio',speechRegions[0].id]));
      const last = speechRegions.at(-1);
      if (last.endSample<source.audio.sampleCount) edgeNonSpeech.push(interval('non-speech-trailing','trailing-non-speech',
        last.endSample,source.audio.sampleCount,[last.id,'audio']));
    }
  }
  return {schemaVersion:1,kind:'saved-vad-inspection',session:{id:session.id,createdAt:session.createdAt,
    durationMs:session.durationMs,transcriptRevision:session.transcript.revision,sourceSnapshot:session.sourceSnapshot,
    dataQuality:session.dataQuality,timingQualityEvents:session.timing?.qualityEvents ?? []},
    selection:{reportSnapshotId:snapshot.id,evidenceRunId:evidenceRun.id,metricRunId:metricRun.id,
      analysisRunId:analysisRun.id,inputRevision:snapshot.inputRevision,latestAttempt,unreadableResults},
    availability,reason,audio,rawSourceResult:evidenceRun,
    speechRegions,gaps,edgeNonSpeech,metricDefinitionVersion:common.definitionVersion,metricChecks,
    limitations:['Model estimates, not human ground truth. Short pauses may be merged; boundaries may include padding.',
      'Internal gaps exclude leading/trailing non-speech. Non-speech is not necessarily acoustic silence.',
      'Times are on the saved WAV clock, not wall-clock or word alignment. Samples use [start, end).',
      'No model rerun, new thresholds, or calibration judgment is performed.']};
}

function clock(seconds) {
  const ms = Math.round(seconds*1000);
  return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}

function formatText(data) {
  const lines = [`Session: ${data.session.id}`,`Created: ${data.session.createdAt}`,
    `Report: ${data.selection.reportSnapshotId}`,`Evidence: ${data.selection.evidenceRunId}`,
    `Metric: ${data.selection.metricRunId}`,`Revision: ${data.selection.inputRevision}`,
    `WAV: ${data.audio.path ?? '(unavailable)'}`,`Audio verification: ${data.audio.verification}`,
    `SHA256: ${data.audio.expectedSha256 ?? '(unknown)'}`,
    `Duration: ${(data.session.durationMs/1000).toFixed(3)} s`,
    `Intervals: ${data.availability}${data.reason ? ` (${data.reason})` : ''}`,
    `VAD quality: ${JSON.stringify(data.rawSourceResult.value.quality ?? null)}`,
    `Provenance: ${JSON.stringify(data.rawSourceResult.value.provenance ?? null)}`];
  if (data.selection.latestAttempt) lines.push(`Latest retry (not displayed Report): ${JSON.stringify(data.selection.latestAttempt)}`);
  if (data.selection.unreadableResults.length) lines.push(`Unreadable results skipped: ${data.selection.unreadableResults.join(', ')}`);
  for (const [title,rows] of [['Speech regions / 语音区间',data.speechRegions],
    ['Internal gaps / 内部间隔',data.gaps],['Edge non-speech / 首尾非语音',data.edgeNonSpeech]]) {
    lines.push('',title,'id | kind | start -> end | duration(s) | [startSample, endSample)');
    if (rows === null) lines.push('unavailable (unknown, not zero)');
    else if (!rows.length) lines.push('(none)');
    else for (const row of rows) lines.push(`${row.id} | ${row.kind} | ${clock(row.startSeconds)} -> ${clock(row.endSeconds)} | ${row.durationSeconds.toFixed(3)} | [${row.startSample}, ${row.endSample})`);
  }
  lines.push('','Saved metric cross-check / 与原报告汇总核对');
  for (const check of data.metricChecks) lines.push(`${check.matches ? 'MATCH' : 'MISMATCH'} ${check.id}: saved=${check.saved?.value ?? 'unknown'}, recomputed=${check.recomputed.value ?? 'unknown'} ${check.recomputed.unit}`);
  lines.push('','注意：模型区间不是人工真值；短停顿可能合并，边界可能带 padding。',
    '非语音不一定是静音；内部 gap 不含首尾。时间相对已保存 WAV（暂停录音时间不在其中），不是逐字时间戳。',
    '请先试听独立标注，再比较区间；JSON 保留精确 sample 边界、质量限制和原始 Source 快照。');
  return lines.join('\n')+'\n';
}

function writeOutput(root,directory,data,text) {
  // Resolve existing ancestors so a junction cannot redirect exports into managed storage.
  let ancestor = path.resolve(directory);
  const missing = [];
  while (!fs.existsSync(ancestor)) { missing.unshift(path.basename(ancestor)); ancestor=path.dirname(ancestor); }
  const output = path.join(fs.realpathSync(ancestor),...missing);
  const relative = path.relative(root,output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative!=='..' && !path.isAbsolute(relative))) {
    throw new Error('Output must be outside the training root.');
  }
  const stem = `${data.session.id}-${data.selection.reportSnapshotId}`;
  const files = [path.join(output,`${stem}.txt`),path.join(output,`${stem}.json`)];
  if (files.some(file=>fs.existsSync(file))) throw new Error('Output already exists; choose a new output directory.');
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(files[0],text,{encoding:'utf8',flag:'wx'});
  fs.writeFileSync(files[1],JSON.stringify(data,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  return files;
}

function main() {
  const {values} = parseArgs({options:{root:{type:'string'},session:{type:'string'},report:{type:'string'},
    output:{type:'string'},list:{type:'boolean'},help:{type:'boolean'}},strict:true,allowPositionals:false});
  if (values.help) { process.stdout.write(HELP); return; }
  if (!values.root || Boolean(values.list)===Boolean(values.session) ||
    (values.list && (values.report || values.output))) throw new Error(HELP);
  const root = fs.realpathSync(path.resolve(values.root));
  const saved = readSaved(root,values.session);
  if (values.list) {
    process.stdout.write('Created (local time) | duration(s) | status | Session ID | transcript preview\n');
    for (const row of saved) process.stdout.write(`${new Date(row.createdAt).toLocaleString()} | ${row.durationMs==null ? '?' : (row.durationMs/1000).toFixed(3)} | ${row.status} | ${row.id} | ${(row.preview ?? '').replace(/[\r\n\t]/g,' ')}\n`);
    return;
  }
  const data = inspect(root,saved,values.report);
  const text = formatText(data);
  if (values.output) {
    const files = writeOutput(root,values.output,data,text);
    process.stdout.write(text+`\nWritten:\n${files.join('\n')}\n`);
  } else process.stdout.write(text);
  if (data.metricChecks.some(check=>!check.matches) ||
    !['verified','unavailable'].includes(data.audio.verification) || data.selection.unreadableResults.length) process.exitCode=2;
}

if (require.main===module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
