'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('preload exposes the saved-session diagnosis but no retired training-data generation APIs',()=>{
  let exposed;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../preload.js'),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld:(_name,api)=>{exposed=api;}},ipcRenderer:{}})
  });
  assert.equal(typeof exposed.analyzeTrainingSession,'function');
  for(const name of ['getRealtimeFeedback','getFinalReport','analyzePlayback']) assert.equal(exposed[name],undefined,name);
});

test('diagnosis application rejects attempts to choose a new analysis framework',async t=>{
  const os=require('node:os');
  const {createTrainingSessionApplication}=require('../lib/training-session-application');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'report-simplification-'));
  const app=createTrainingSessionApplication({root});
  t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
  const result=await app.execute('analyze',{requestId:'request',sessionId:'missing',framework:'prep'});
  assert.equal(result.error.code,'INVALID_SESSION');
});
