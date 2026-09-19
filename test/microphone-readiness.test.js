'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('silent preflight never requests microphone permission and does not claim prompt is ready', async () => {
  const {checkMicrophoneReadiness} = require('../src/microphone-readiness');
  let requested = 0;
  const environment = {permissions:{query:async () => ({state:'prompt'})},mediaDevices:{
    getUserMedia:async () => {requested++;},enumerateDevices:async () => [{kind:'audioinput'}]
  }};
  assert.equal(await checkMicrophoneReadiness(environment),'unknown');
  environment.permissions.query = async () => ({state:'granted'});
  assert.equal(await checkMicrophoneReadiness(environment),'ready');
  environment.permissions.query = async () => ({state:'denied'});
  assert.equal(await checkMicrophoneReadiness(environment),'denied');
  assert.equal(requested,0);
});
test('preflight distinguishes missing devices from unqueryable permissions', async () => {
  const {checkMicrophoneReadiness} = require('../src/microphone-readiness');
  assert.equal(await checkMicrophoneReadiness({mediaDevices:{getUserMedia(){},enumerateDevices:async()=>[]}}),'unavailable');
  assert.equal(await checkMicrophoneReadiness({mediaDevices:{getUserMedia(){},enumerateDevices:async()=>{throw Error();}}}),'unknown');
});
