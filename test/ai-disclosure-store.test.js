'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const policy = require('../lib/ai-disclosure-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ai-disclosure-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  return {root,file:path.join(root,policy.AI_DISCLOSURE_FILENAME)};
}

test('only explicit AI disclosure persists full data/local/remote coverage independently of recording policy',t => {
  const {root,file} = fixture(t);
  fs.writeFileSync(path.join(root,'recording-policy.json'),JSON.stringify({schemaVersion:2,acknowledged:true}));
  assert.equal(policy.disclosureRequired(policy.loadAiDisclosure(root),'local'),true);
  assert.equal(fs.existsSync(file),false);
  const saved = policy.acknowledgeAiDisclosure(root,{scopeVersion:policy.AI_DATA_SCOPE_VERSION});
  assert.deepEqual(saved.coveredLocations,['local','remote']);
  assert.deepEqual(saved.coveredData,policy.AI_DATA_SCOPE);
  assert.equal(typeof saved.acknowledgedAt,'string');
  const restarted = policy.loadAiDisclosure(root);
  assert.deepEqual(restarted,saved);
  assert.equal(policy.disclosureRequired(restarted,'local'),false);
  assert.equal(policy.disclosureRequired(restarted,'remote'),false);
});

test('coverage sets, rather than prompt/notice/provider/model versions, determine supplementary notice',t => {
  const {root,file} = fixture(t);
  const saved = policy.acknowledgeAiDisclosure(root,{scopeVersion:policy.AI_DATA_SCOPE_VERSION});
  saved.noticeVersion='old-copy';saved.scopeVersion='older-scope-label';saved.coveredLocations=['local'];
  fs.writeFileSync(file,JSON.stringify(saved));
  const legacy = policy.loadAiDisclosure(root);
  assert.equal(policy.disclosureRequired(legacy,'local'),false);
  assert.equal(policy.disclosureRequired(legacy,'remote'),true);
  assert.equal(policy.disclosureRequired(saved,'local',{dataScope:[...policy.AI_DATA_SCOPE,'new-sensitive-data']}),true);
  assert.throws(() => policy.acknowledgeAiDisclosure(root,{scopeVersion:'unknown-future-scope'}),{code:'disclosure-scope-stale'});
  assert.deepEqual(policy.loadAiDisclosure(root),legacy);
});

test('invalid or future policy files fail closed and are not overwritten by acknowledgement',t => {
  const {root,file} = fixture(t);
  for (const original of ['{"schemaVersion":',JSON.stringify({schemaVersion:99,acknowledged:true,coveredData:policy.AI_DATA_SCOPE,coveredLocations:['local','remote']})]) {
    fs.writeFileSync(file,original);
    assert.equal(policy.disclosureRequired(policy.loadAiDisclosure(root,{logger:{warn(){}}}),'remote'),true);
    assert.throws(() => policy.acknowledgeAiDisclosure(root,{scopeVersion:policy.AI_DATA_SCOPE_VERSION}),
      error => ['invalid-disclosure-json','unsupported-schema-version'].includes(error.code));
    assert.equal(fs.readFileSync(file,'utf8'),original);
  }
});

test('failed atomic save never marks disclosure acknowledged',t => {
  const {root,file} = fixture(t);
  assert.throws(() => policy.acknowledgeAiDisclosure(root,{scopeVersion:policy.AI_DATA_SCOPE_VERSION,atomicWrite(){throw new Error('disk full');}}));
  assert.equal(fs.existsSync(file),false);
  assert.equal(policy.disclosureRequired(policy.loadAiDisclosure(root),'remote'),true);
});
