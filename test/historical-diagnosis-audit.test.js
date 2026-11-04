'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.join(__dirname,'../benchmark/prompt-evaluation');
for(const [name,calls]of [['merge-rule-position-v1',8],['diagnosis-writing-split-v1',12],['issue-independence-v1',12]]){
 test(`${name} audits its frozen evidence without rewriting records or requiring current production bytes`,()=>{
  const dir=path.join(root,name),files=['results.json','all-results.md','audit.json'];
  const before=files.map(file=>fs.readFileSync(path.join(dir,file)));
  const output=cp.execFileSync(process.execPath,[path.join(dir,'audit.js'),'--check'],{encoding:'utf8'});
  const result=JSON.parse(output);assert.equal(result.actualCalls,calls);
  assert.equal(result.frozenSourcesAndEarlierEvidenceUnchanged,true);
  assert.equal(Object.hasOwn(result,'trackedDiffUnchanged'),false);
  files.forEach((file,i)=>assert.deepEqual(fs.readFileSync(path.join(dir,file)),before[i]));
 });
}
test('v8 report preview can be checked without mixing production prompts or changing frozen outputs',()=>{
 const dir=path.join(root,'diagnosis-units-v1'),files=['comparison.md','prompt-preview.md','evidence-review.json'];
 const before=files.map(file=>fs.readFileSync(path.join(dir,file)));
 const result=JSON.parse(cp.execFileSync(process.execPath,[path.join(dir,'report.js'),'--check'],{encoding:'utf8'}));
 assert.equal(result.reviewed,61);
 files.forEach((file,i)=>assert.deepEqual(fs.readFileSync(path.join(dir,file)),before[i]));
});
