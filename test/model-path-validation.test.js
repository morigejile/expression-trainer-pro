'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {verifyModelDirectory} = require('../lib/model-manager');

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'model-path-boundary-'));
  t.after(() => fs.rmSync(temporary, {recursive:true, force:true}));
  const root = path.join(temporary, 'installed'), outside = path.join(temporary, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  const bytes = Buffer.from('validated model bytes');
  fs.writeFileSync(path.join(root, 'model.onnx'), bytes);
  fs.writeFileSync(path.join(outside, 'model.onnx'), bytes);
  const file = {relativePath:'model.onnx', bytes:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  return {root, outside, temporary, model:{modelId:'fixture', files:[file]}};
}

test('valid model remains readable when native realpath exposes a different Windows virtualization view', {skip:process.platform !== 'win32'}, async t => {
  const {root, temporary, model} = fixture(t);
  const nativeRealpath = fs.promises.realpath;
  t.after(() => {fs.promises.realpath = nativeRealpath;});
  // Native Windows resolution can keep the directory logical but expose a
  // redirected physical path for its files. The file identity is unchanged.
  fs.promises.realpath = async input => input === path.join(root, 'model.onnx')
    ? path.join(temporary, 'virtualized', 'model.onnx') : nativeRealpath(input);
  const files = await verifyModelDirectory(model, root);
  assert.deepEqual(fs.readFileSync(files[0].path), Buffer.from('validated model bytes'));
});

test('model directory alias resolves consistently while retaining file validation', async t => {
  const {root, temporary, model} = fixture(t);
  const alias = path.join(temporary, 'alias');
  fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await verifyModelDirectory(model, alias)).length, 1);
});

test('a model file reached through an outside directory link is still rejected even with matching bytes', async t => {
  const {root, outside, model} = fixture(t);
  fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  model.files[0].relativePath = 'escape/model.onnx';
  await assert.rejects(verifyModelDirectory(model, root), {code:'asr-model-corrupt', message:'Model file escapes install root: escape/model.onnx'});
});
