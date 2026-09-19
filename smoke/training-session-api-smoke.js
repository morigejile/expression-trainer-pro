'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn} = require('node:child_process');

async function run({app, mainWindow, BrowserWindow, phase}) {
  assert.ok(['write', 'read', 'future'].includes(phase));
  const missing = await mainWindow.webContents.executeJavaScript(`[
    'createTrainingSession', 'finalizeTrainingSession', 'listTrainingSessions',
    'getTrainingSession', 'deleteTrainingSession', 'readTrainingAudio'
  ].filter(method => typeof window.api[method] !== 'function')`);
  assert.deepEqual(missing, [], 'Training API must be available through the real Preload');
  const invoke = (method, command) => mainWindow.webContents.executeJavaScript(
    `window.api[${JSON.stringify(method)}](${JSON.stringify(command)})`
  );
  if (phase === 'future') {
    const result = await invoke('listTrainingSessions', {requestId: 'future'});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNSUPPORTED_SCHEMA');
  } else if (phase === 'write') {
    assert.deepEqual((await invoke('listTrainingSessions', {requestId: 'empty'})).value, []);
    const created = await invoke('createTrainingSession', {requestId: 'create', input: {
      createdAt: '2026-09-19T00:00:00Z', source: 'microphone', trainingPrompt: null,
      sourceSnapshot: {appVersion: 'api-smoke', asr: {modelId: 'fixture-asr'}}
    }});
    assert.equal(created.ok, true);
    const result = await mainWindow.webContents.executeJavaScript(`(async () => {
      const audio = new Uint8Array(364);
      const view = new DataView(audio.buffer);
      const text = (offset, value) => [...value].forEach((ch, index) => audio[offset + index] = ch.charCodeAt(0));
      text(0, 'RIFF'); view.setUint32(4, 356, true); text(8, 'WAVEfmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, 'data'); view.setUint32(40, 320, true);
      return window.api.finalizeTrainingSession({requestId: 'finish', sessionId: ${JSON.stringify(created.sessionId)},
        input: {completedAt: '2026-09-19T00:00:01Z', durationMs: 10, audio,
          transcript: {text: '应用接口重启', segments: [
            {id: 'segment-1', text: '应用接口重启', startMs: 0, endMs: 10, timingSource: 'audio-cursor'}
          ]}}});
    })()`);
    assert.equal(result.ok, true);
    assert.equal(result.requestId, 'finish');
    assert.equal(result.sessionId, created.sessionId);
    assert.equal(result.value.status, 'completed');
    assert.equal(Object.hasOwn(result.value.artifact, 'relativePath'), false);
    // A second real Main must exit before it can recover or write the primary instance's store.
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--headless', '--disable-gpu', '--no-sandbox',
        path.resolve(__dirname, '..'), '--training-persistence-smoke=write'], {
        env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Second instance did not exit')); }, 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        try {
          assert.equal(code, 0, output);
          assert.doesNotMatch(output, /TRAINING_PERSISTENCE_WRITE_OK/);
          resolve();
        } catch (error) { reject(error); }
      });
    });
    const deniedWindow = new BrowserWindow({show: false, webPreferences: {
      preload: path.resolve(__dirname, '../preload.js'), contextIsolation: true, nodeIntegration: false
    }});
    try {
      await deniedWindow.loadFile(path.resolve(__dirname, '../src/settings.html'));
      const denied = await deniedWindow.webContents.executeJavaScript(
        "window.api.listTrainingSessions({requestId: 'other-window'})"
      );
      assert.equal(denied.error.code, 'FORBIDDEN');
    } finally { deniedWindow.destroy(); }
  } else {
    const list = await invoke('listTrainingSessions', {requestId: 'history'});
    assert.equal(list.ok, true);
    assert.equal(list.value.length, 1);
    const sessionId = list.value[0].id;
    const record = await invoke('getTrainingSession', {requestId: 'open', sessionId});
    assert.equal(record.value.status, 'completed');
    assert.equal(record.value.transcript.text, '应用接口重启');
    assert.notEqual(record.value.sourceSnapshot.asr.modelId, 'fixture-asr', 'Renderer must not forge the runtime model source');
    assert.equal(record.value.sourceSnapshot.appVersion, app.getVersion());
    const audio = await invoke('readTrainingAudio', {requestId: 'play', sessionId});
    assert.equal(audio.ok, true);
    assert.equal(audio.value.byteLength, 364);
    assert.equal(Buffer.from(audio.value).toString('ascii', 0, 4), 'RIFF');
    assert.equal((await invoke('deleteTrainingSession', {requestId: 'delete', sessionId})).ok, true);
    assert.deepEqual((await invoke('listTrainingSessions', {requestId: 'empty'})).value, []);
  }
  console.log(`TRAINING_API_${phase.toUpperCase()}_OK`);
  app.quit(); // Exercise normal before-quit storage drain, not app.exit().
}

module.exports = {run};
