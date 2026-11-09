'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

test('CLI readiness output cannot overwrite existing audio',async t=>{
  const f=await fixture(t);
  const previews=path.join(path.dirname(f.stateFile),'previews');
  const sampleDir=path.join(previews,'sample');fs.mkdirSync(sampleDir,{recursive:true});
  const audioPath=f.samples[0].audioPath,before=fs.readFileSync(audioPath);
  fs.writeFileSync(path.join(sampleDir,'inspection.json'),JSON.stringify({
    kind:'saved-vad-inspection',availability:'available',session:{id:'session-a'},
    selection:{evidenceRunId:'source-a',reportSnapshotId:'report-a'},
    audio:{verification:'verified',path:audioPath,sampleCount:160000,sampleRateHz:16000,
      expectedSha256:require('node:crypto').createHash('sha256').update(before).digest('hex')},
    metricChecks:[{matches:true}],gaps:[{id:'gap-0',startSeconds:3,endSeconds:4}]
  }));
  const evidencePath=path.join(sampleDir,'inspection.json'),evidenceBefore=fs.readFileSync(evidencePath);
  const cliState=path.join(path.dirname(f.stateFile),'cli-review.json');
  for(const readyPath of [audioPath,evidencePath,cliState]) {
    const result=require('node:child_process').spawnSync(process.execPath,[
      path.join(__dirname,'../scripts/fluency-review.js'),'--previews',previews,
      '--state',cliState,'--ready',readyPath
    ],{encoding:'utf8',windowsHide:true,timeout:3000});
    assert.deepEqual(fs.readFileSync(audioPath),before,'existing audio must remain byte-for-byte unchanged');
    assert.deepEqual(fs.readFileSync(evidencePath),evidenceBefore,'exported evidence must remain unchanged');
    assert.equal(result.status,1);
    assert.equal(fs.existsSync(cliState),false,'readiness must not create a malformed annotations file');
  }
});

async function fixture(t) {
  const {createReviewServer}=require('../scripts/fluency-review');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fluency-review-'));
  const audioPath=path.join(dir,'sample.wav');
  fs.writeFileSync(audioPath,Buffer.from('RIFF-test-audio'));
  const samples=[{id:'A',label:'录音 A',duration:10,audioPath,sessionId:'session-a',sourceId:'source-a',
    reportId:'report-a',audioSha256:'test',gaps:[{id:'gap-0',start:3,end:4}]}];
  const stateFile=path.join(dir,'review.json');
  const server=createReviewServer({samples,stateFile});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  async function save(state,revision=0,headers={}) {
    return fetch(url+'/api/state',{method:'PUT',headers:{'content-type':'application/json',origin:url,...headers},
      body:JSON.stringify({revision,state})});
  }
  return {url,stateFile,samples,save,get:async()=>fetch(url+'/api/review').then(r=>r.json())};
}

test('review server serves only allowlisted audio with seekable ranges and hides private paths',async t=>{
  const f=await fixture(t),data=await f.get();
  assert.equal(data.samples[0].audioUrl,'/audio/A');
  assert.equal(Object.hasOwn(data.samples[0],'audioPath'),false);
  assert.equal(data.state.A.blindComplete,false);
  const audio=await fetch(f.url+'/audio/A',{headers:{range:'bytes=0-3'}});
  assert.equal(audio.status,206);
  assert.equal(audio.headers.get('content-range'),'bytes 0-3/15');
  assert.equal(await audio.text(),'RIFF');
  assert.equal((await fetch(f.url+'/audio/unknown')).status,404);
  assert.equal((await fetch(f.url+'/audio/A',{headers:{range:'bytes=999-'}})).status,416);
});

test('review annotations survive reload and export while stale writers cannot overwrite them',async t=>{
  const f=await fixture(t),data=await f.get();
  data.state.A.markers=[{id:'mark-1',time:2.25}];
  data.state.A.flow='occasional';
  data.state.A.speed='suitable';
  data.state.A.blindComplete=true;
  data.state.A.judgments['gap-0']={presence:'yes',impact:'natural',boundary:'unsure',note:'正常停顿'};
  const saved=await f.save(data.state);
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).revision,1);
  assert.deepEqual((await f.get()).state,data.state);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.stateFile,'utf8')).state,data.state);
  assert.equal((await f.save(data.state,0)).status,409);
  const exported=await fetch(f.url+'/api/export');
  assert.match(exported.headers.get('content-disposition'),/attachment/);
  assert.deepEqual((await exported.json()).state,data.state);
});

test('review server rejects unrelated origins and invalid labels, times or evidence references',async t=>{
  const f=await fixture(t),data=await f.get();
  assert.equal((await f.save(data.state,0,{origin:'https://unrelated.example'})).status,403);
  for(const mutate of [
    state=>{state.A.markers=[{id:'bad',time:11}];},
    state=>{state.A.judgments.foreign={presence:'yes',impact:'natural',boundary:'unsure',note:''};},
    state=>{state.A.flow='perfect-score';},
    state=>{state.A.judgments['gap-0']={presence:'yes',impact:'unknown',boundary:'unsure',note:''};}
  ]) {
    const state=structuredClone(data.state);mutate(state);
    assert.equal((await f.save(state)).status,400);
  }
  assert.equal(fs.existsSync(f.stateFile),false);
});

test('review state is pinned to the source dataset and corrupt saved records are never reset silently',async t=>{
  const f=await fixture(t),{createReviewServer}=require('../scripts/fluency-review');
  const data=await f.get();assert.equal((await f.save(data.state)).status,200);
  assert.throws(()=>createReviewServer({samples:[{...f.samples[0],sourceId:'another-source'}],stateFile:f.stateFile}),/来源/);
  fs.writeFileSync(f.stateFile,'broken-json');
  assert.throws(()=>createReviewServer({samples:f.samples,stateFile:f.stateFile}),/记录/);
});

test('a second review service cannot own the same annotations file',async t=>{
  const f=await fixture(t),{createReviewServer}=require('../scripts/fluency-review');
  assert.throws(()=>createReviewServer({samples:f.samples,stateFile:f.stateFile}),/使用|服务/);
});

test('skipped and uncertain intervals remain pending rather than triggering completion',()=>{
  const {summarizeJudgments}=require('../scripts/fluency-review/review-state');
  const gaps=[{id:'gap-0'},{id:'gap-1'}];
  const judgments=Object.fromEntries(gaps.map(gap=>[gap.id,{presence:'unsure',impact:'unsure'}]));
  assert.deepEqual(summarizeJudgments(gaps,judgments),
    {recorded:2,decided:0,uncertain:2,remaining:2,allRecorded:true,allDecided:false});
  judgments['gap-0']={presence:'yes',impact:'natural'};
  assert.equal(summarizeJudgments(gaps,judgments).allDecided,false);
  judgments['gap-1']={presence:'yes',impact:'disruptive'};
  assert.equal(summarizeJudgments(gaps,judgments).allDecided,true);
});
