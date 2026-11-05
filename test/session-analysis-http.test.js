'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createTrainingSessionApplication} = require('../lib/training-session-application');
const {resolveAutomaticDiagnosisProfile} = require('../lib/llm-provider-config');
const {buildAnalysisContext} = require('../lib/analysis-context');
const {sendStructuredDiagnosis} = require('../lib/ai-feedback');
const {selectStructuredReport} = require('../src/structured-report');
const {buildSessionAnalysisInputs} = require('../lib/session-analysis-inputs');
test.before(() => require('../lib/lexicon').loadLexicon());

// Exercise the real HTTP/JSON/provider boundary with generated text and silence.
// This is protocol evidence, not an external model or microphone acceptance test.
async function fixture(t, provider = 'custom', {speechAvailable=false,framework=null} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-analysis-http-'));
  const received = [];
  let responseMode = 'valid';
  const prompt = {customWords:'行动'};
  let requestStarted;
  const requestReceived = new Promise(resolve=>{requestStarted=resolve;});
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const context = JSON.parse(body.messages[1].content);
    received.push({url:request.url,authorization:request.headers.authorization,body,context});
    requestStarted();
    if (responseMode === 'hang') return;
    if (responseMode.startsWith('http-')) {
      response.writeHead(Number(responseMode.slice(5)), {'Content-Type':'text/plain'});
      response.end('private upstream detail fixture-secret');
      return;
    }
    const diagnosis = {schemaVersion:1,assessment:{status:'analyzable',reason:'转写包含观点与行动。',
      categories:['organization','argument','delivery','wording'],frameworkAssessable:Boolean(context.analysisTarget),
      evidenceRefs:[context.transcript.segments[0].id]},summary:'建议补充支持观点的具体例子。',findings:[{
      id:'finding-1',category:'argument',observation:'表达提出了先明确目标的主张。',
      recommendation:'补充一个实际例子。',
      evidenceRefs:responseMode === 'invalid-ref' ? ['another-session'] : [context.transcript.segments[0].id,
        ...(speechAvailable ? ['metric:speech-duration-ms','speech-0'] : [])]
    }]};
    diagnosis.frameworkFindings = context.analysisTarget
      ? [{...diagnosis.findings[0],id:'framework-1',evidenceRefs:[context.transcript.segments[0].id]}] : [];
    if (responseMode==='insufficient') {
      diagnosis.assessment={status:'insufficient',reason:'只有试音和问候，没有展开表达内容。',
        categories:[],frameworkAssessable:false,evidenceRefs:[context.transcript.segments[0].id]};
      diagnosis.summary='本次材料不足以形成表达诊断。';diagnosis.findings=[];
      diagnosis.frameworkFindings=[];
    }
    response.writeHead(200, {'Content-Type':'application/json'});
    response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(diagnosis)}}]}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const settings = {schemaVersion:3,activeProfileId:'approved',profiles:[{
    id:'approved',provider,name:'Local protocol fixture',model:'fixture-model',apiKey:'fixture-secret',
    baseUrl:`${endpoint}/v1`,ollamaUrl:endpoint,autoDiagnosisEnabled:true
  }]};
  const options = {root,analysisOptions:{
    runSpeechEvidence:async () => speechAvailable ? {schemaVersion:1,status:'completed',
      audio:{sampleRateHz:16000,sampleCount:16000},capabilities:{speechIntervals:true,lexicalTiming:false},
      provenance:{engine:'fixture',engineVersion:'1',modelId:'fixture-vad',modelVersion:'1',modelSha256:'a'.repeat(64),
        thresholdVersion:'fixture-v1',normalizationVersion:'intervals-v1'},
      quality:{vad:{status:'degraded',reasons:['vad-thresholds-uncalibrated']}},
      segments:[{id:'speech-0',startSample:1600,endSample:9600}]} : {schemaVersion:1,status:'unavailable',segments:[],
      quality:{vad:{status:'unavailable',reasons:['vad-model-unavailable']}}},
    getDiagnosisProfile:() => resolveAutomaticDiagnosisProfile(settings),
    getAnalysisInputs:(session,options) => buildSessionAnalysisInputs(session,prompt,options),
    diagnose:({profile,signal,...input}) => sendStructuredDiagnosis(buildAnalysisContext(input),profile,{signal,timeoutMs:responseMode==='hang'?150:2000})
  }};
  const applications = [];
  const open = () => { const app=createTrainingSessionApplication(options);applications.push(app);return app; };
  t.after(async () => {
    for (const app of applications) await app.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
  });
  const app = open();
  const invoke = (target,operation,fields={}) => target.execute(operation,{requestId:randomUUID(),...fields});
  const created = await invoke(app,'create',{input:{createdAt:'2026-09-19T00:00:00Z',source:'microphone',...(framework?{trainingMode:'structured',framework,frameworkDefinitionVersion:`${framework}-v1`}:{})}});
  assert.equal(created.ok,true);
  const sessionId = created.sessionId;
  const audio = Buffer.alloc(32044);
  audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
  audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);
  audio.write('data',36);audio.writeUInt32LE(32000,40);
  return {app,settings,received,requestReceived,open,prompt,mode:value=>{responseMode=value;},
    command:(operation,fields={},target=app)=>invoke(target,operation,{sessionId,...fields}),
    async complete() {
      const text='我认为需要先明确目标，再安排具体行动。';
      const saved=await invoke(app,'finalize',{sessionId,input:{completedAt:'2026-09-19T00:00:01Z',durationMs:1000,audio,
        transcript:{text,segments:[{id:'segment-1',text,timingSource:'unavailable'}]}}});
      assert.equal(saved.ok,true);
      const report=await invoke(app,'analyze',{sessionId,trigger:'automatic'});
      assert.equal(report.ok,true);
      return (await invoke(app,'get',{sessionId})).value;
    }};
}

for (const provider of ['custom','ollama']) test(`${provider} protocol preserves a validated report across restart without repeating HTTP`,async t=>{
  const f=await fixture(t,provider);
  const saved=await f.complete();
  const diagnosis=saved.results.find(result=>result.kind==='diagnosis');
  assert.equal(diagnosis.status,'completed');
  assert.equal(f.received.length,1);
  const request=f.received[0];
  assert.equal(request.url,'/v1/chat/completions');
  assert.equal(request.authorization,provider==='ollama'?'Bearer ollama':'Bearer fixture-secret');
  assert.equal(request.context.sessionId,saved.id);
  assert.equal(request.context.quality.vad.status,'unavailable');
  assert.ok(request.context.allowedEvidenceRefs.includes('segment-1'));
  assert.doesNotMatch(JSON.stringify(request.body),/fixture-secret|apiKey|audioBytes|base64|ollamaUrl|baseUrl|http:\/\/127/);
  assert.doesNotMatch(JSON.stringify(saved.results),/fixture-secret|127\.0\.0\.1/);
  await f.app.close();
  const reopened=f.open();
  const restored=(await f.command('get',{},reopened)).value;
  assert.deepEqual(restored.results,saved.results);
  assert.equal(selectStructuredReport(restored.results).analysisRun.id,diagnosis.id);
  assert.equal(f.received.length,1);
});

for(const framework of ['prep','star','pyramid'])test(`${framework} diagnosis persists optional explanations and selected-framework findings with only one summary`,async t=>{
  const f=await fixture(t,'custom',{speechAvailable:true,framework});
  const saved=await f.complete(),report=selectStructuredReport(saved.results);
  assert.equal(report.analysisRun.status,'completed');
  assert.equal(report.analysisRun.value.frameworkAnalysis.framework,framework);
  assert.equal(Object.hasOwn(report.analysisRun.value.frameworkAnalysis,'summary'),false);
  assert.equal(Object.hasOwn(report.analysisRun.value.findings[0],'interpretation'),false);
  assert.equal(report.analysisRun.value.frameworkAnalysis.findings.length,1);
  assert.deepEqual(report.analysisRun.value.frameworkAnalysis.findings[0].evidenceRefs,['segment-1']);
  await f.app.close();
  const restored=(await f.command('get',{},f.open())).value;
  assert.deepEqual(restored.results,saved.results);assert.ok(selectStructuredReport(restored.results));
  assert.equal(f.received.length,1);
});

test('speech, metric and Finding evidence keep exact run ownership through HTTP and restart',async t=>{
  const f=await fixture(t,'custom',{speechAvailable:true});
  const saved=await f.complete();
  const report=selectStructuredReport(saved.results);
  assert.equal(report.snapshot.value.availability,'complete');
  assert.deepEqual(report.snapshot.value.radar,{status:'unavailable',reason:'not-calibrated',version:null});
  assert.equal(report.metricRun.value.speechEvidenceRunId,report.evidenceRun.id);
  assert.equal(report.analysisRun.value.speechEvidenceRunId,report.evidenceRun.id);
  assert.equal(report.analysisRun.value.metricRunId,report.metricRun.id);
  assert.equal(report.metricRun.value.metrics.find(metric=>metric.id==='speech-duration-ms').value,500);
  const finding=report.analysisRun.value.findings[0];
  assert.deepEqual(finding.evidenceRefs,['segment-1','metric:speech-duration-ms','speech-0']);
  const context=f.received[0].context;
  for (const ref of finding.evidenceRefs) assert.ok(Object.hasOwn(context.evidenceMap,ref));
  assert.deepEqual(context.quality.vad,{status:'degraded',reasons:['vad-thresholds-uncalibrated']});
  assert.equal(report.analysisRun.provenance.profileId,'approved');
  assert.equal(report.analysisRun.provenance.promptVersion,'structured-diagnosis-v11');
  assert.equal(report.analysisRun.provenance.problemLibraryVersion,'expression-problem-library-v0.4');
  assert.equal((await f.command('analyze',{retry:true})).value.id,report.snapshot.id,'complete report is not reanalyzed');
  await f.app.close();
  const restored=(await f.command('get',{},f.open())).value;
  assert.deepEqual(selectStructuredReport(restored.results),report);
  assert.equal(f.received.length,1);
});

test('insufficient-material assessment survives real HTTP, immutable persistence and restart as a successful result',async t=>{
  const f=await fixture(t,'custom',{speechAvailable:true});f.mode('insufficient');
  const saved=await f.complete(),report=selectStructuredReport(saved.results);
  assert.equal(report.analysisRun.status,'completed');
  assert.equal(report.analysisRun.value.assessment.status,'insufficient');
  assert.equal(report.snapshot.value.availability,'complete');
  assert.deepEqual(report.analysisRun.value.findings,[]);
  assert.ok(report.metricRun.value.metrics.some(m=>m.status==='available'));
  assert.equal(f.received.length,1);
  await f.app.close();
  const restored=(await f.command('get',{},f.open())).value;
  assert.deepEqual(restored.results,saved.results);
  assert.equal(selectStructuredReport(restored.results).analysisRun.value.assessment.status,'insufficient');
  assert.equal(f.received.length,1);
});

test('saved reports reject all external framework switches without HTTP or new snapshots',async t=>{
  const f=await fixture(t,'custom',{speechAvailable:true});const original=await f.complete();
  for(const framework of ['prep','star','pyramid']) {
    const result=await f.command('analyze',{framework});assert.equal(result.error.code,'INVALID_SESSION');
  }
  const saved=(await f.command('get')).value;
  assert.deepEqual(saved.results,original.results);assert.equal(f.received.length,1);
});

for (const [status,reason] of [[401,'unauthorized'],[429,'rate-limited'],[503,'analysis-failed']]) {
  test(`HTTP ${status} preserves facts, saves a safe partial result and recovers only on explicit retry`,async t=>{
    const f=await fixture(t);
    f.mode(`http-${status}`);
    const saved=await f.complete();
    const partial=selectStructuredReport(saved.results);
    assert.equal(partial.snapshot.value.availability,'partial');
    assert.equal(partial.analysisRun.value.reason,reason);
    assert.equal(saved.artifact.state,'available');
    assert.equal(saved.status,'completed');
    assert.doesNotMatch(JSON.stringify(saved),/private upstream|fixture-secret/);
    await f.command('get');
    assert.equal(f.received.length,1);
    f.mode('valid');
    await f.command('analyze',{retry:true});
    const recovered=(await f.command('get')).value;
    assert.equal(selectStructuredReport(recovered.results).analysisRun.status,'completed');
    assert.deepEqual(recovered.transcript,saved.transcript);
    assert.deepEqual(recovered.results.slice(0,saved.results.length),saved.results);
    assert.equal(f.received.length,2);
  });
}

test('cancelling an active HTTP diagnosis preserves a partial snapshot without an automatic replacement request',async t=>{
  const f=await fixture(t);
  f.mode('hang');
  const pending=f.complete();
  await f.requestReceived;
  assert.equal((await f.command('cancelAnalysis')).ok,true);
  const saved=await pending;
  assert.equal(selectStructuredReport(saved.results).analysisRun.value.reason,'cancelled');
  assert.equal(saved.artifact.state,'available');
  assert.equal((await f.command('analyze')).value.id,saved.results.at(-1).id);
  assert.equal(f.received.length,1);
  f.mode('valid');
  await f.command('analyze',{retry:true});
  assert.equal(selectStructuredReport((await f.command('get')).value.results).analysisRun.status,'completed');
  assert.equal(f.received.length,2);
});

test('HTTP timeout and invalid evidence remain partial; explicit retry recovers and revocation prevents further dispatch',async t=>{
  const f=await fixture(t);
  f.mode('hang');
  const timed=await f.complete();
  assert.equal(timed.results.find(result=>result.kind==='diagnosis').value.reason,'timeout');
  assert.equal(timed.artifact.state,'available');
  const originalMetrics=timed.results.find(result=>result.kind==='common-analysis');
  assert.ok(originalMetrics.value.localStatsSnapshot.fillers>0);
  f.prompt.customWords='现在';
  f.mode('invalid-ref');
  assert.equal((await f.command('analyze',{retry:true})).ok,true);
  let saved=(await f.command('get')).value;
  assert.equal(saved.results.at(-2).value.reason,'invalid-response');
  assert.deepEqual(saved.results.filter(result=>result.kind==='common-analysis').at(-1).value.localStatsSnapshot,originalMetrics.value.localStatsSnapshot);
  f.mode('valid');
  await f.command('analyze',{retry:true});
  saved=(await f.command('get')).value;
  const successful=selectStructuredReport(saved.results).analysisRun.id;
  assert.equal(f.received.length,3);
  f.settings.profiles[0].autoDiagnosisEnabled=false;
  await f.command('analyze',{retry:true});
  saved=(await f.command('get')).value;
  assert.equal(saved.results.at(-2).value.reason,'not-enabled');
  assert.equal(f.received.length,3);
  assert.equal(selectStructuredReport(saved.results).analysisRun.id,successful);
  assert.equal(selectStructuredReport(saved.results).latestAttempt.reason,'not-enabled');
});
