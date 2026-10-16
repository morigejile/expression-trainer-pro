'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');

for(const dpr of [1,1.5])test(`regional-scroll shell fills the root viewport and paints its right edge at DPR ${dpr}`,{timeout:40000},()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'expression-root-viewport-'));
 try{
  const env={...process.env,ROOT_VIEWPORT_DATA:data,ROOT_VIEWPORT_DPR:String(dpr)};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(require('electron'),['--headless','--no-sandbox',path.join(__dirname,'../scripts/root-viewport-fixture.cjs')],{env,windowsHide:true,encoding:'utf8',timeout:30000});
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/ROOT_VIEWPORT_OK 32/);
 }finally{
  assert.equal(path.dirname(data),os.tmpdir());assert(path.basename(data).startsWith('expression-root-viewport-'));fs.rmSync(data,{recursive:true,force:true});
 }
});
