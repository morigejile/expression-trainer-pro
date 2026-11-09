'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createAsrSessionProvider} = require('../lib/asr-session');
const {normalizeTiming} = require('../lib/training-session-data');
const {createAudioFeedQueue} = require('../src/audio-feed-queue');
const {beginAsrSession, filterAsrEvent} = require('../src/asr-event-state');

test('utterance readiness declares the enforced recording bound and never promises partials', async () => {
  const provider = createAsrSessionProvider({capabilities:{recognitionMode:'utterance', partialResults:false, maxDurationMs:300000},
    adapter:{initialize(){},start(){},feed(){},stop(){},cancel(){},dispose(){}}});
  const ready = await provider.start({sessionId:'u',sampleRateHz:16000});
  assert.equal(ready.capabilities.maxDurationMs, 300000);
  assert.equal(ready.capabilities.partialResults, false);
});

test('terminal timing degradation describes the known accepted range without fabricating lexical time', async () => {
  const provider = createAsrSessionProvider({adapter:{initialize(){},start(){},feed(){},stop(){},cancel(){},dispose(){}}});
  await provider.start({sessionId:'q',sampleRateHz:16000});
  provider.feed({sessionId:'q',sequence:0,absoluteSampleStart:0,samples:new Float32Array(320)});
  const events = provider.stop({sessionId:'q'});
  assert.deepEqual(events.at(-1).qualityEvents, [{code:'timing-unavailable',startSample:0,endSample:320}]);
  assert.equal(events.at(-1).finalAcceptedSampleCursor, 320);
});

test('quality evidence round trips through validation and rejects ranges outside captured audio', () => {
  const timing = {schemaVersion:1,sampleRateHz:16000,capturedSampleCount:640,asrAcceptedSampleCount:320,
    capabilities:{audioTimeline:true,speechSegments:false,tokenTimestamps:false},
    qualityEvents:[{code:'audio-overrun',startSample:320,endSample:640},{code:'asr-error',startSample:null,endSample:null}]};
  assert.deepEqual(normalizeTiming(timing), timing);
  assert.throws(() => normalizeTiming({...timing,qualityEvents:[{code:'audio-overrun',startSample:320,endSample:641}]}), {code:'INVALID_SESSION'});
  assert.throws(() => normalizeTiming({...timing,qualityEvents:[{code:'audio-overrun',startSample:null,endSample:640}]}), {code:'INVALID_SESSION'});
});

test('queue overflow reports discarded queued and rejected audio while leaving the active chunk unknown', async () => {
  let release;
  const queue = createAudioFeedQueue({maxChunks:2,send:() => new Promise(resolve => {release=resolve;})});
  queue.enqueue({absoluteSampleStart:0,samples:new Float32Array(320)});
  queue.enqueue({absoluteSampleStart:320,samples:new Float32Array(320)});
  assert.equal(queue.enqueue({absoluteSampleStart:640,samples:new Float32Array(160)}), false);
  await assert.rejects(queue.drain(), error => {
    assert.deepEqual(error.affectedRange, {startSample:320,endSample:800});
    return error.code === 'audio-overrun';
  });
  release();
});

test('quality events honor the same session and sequence filter as transcript events', () => {
  const state = beginAsrSession(null,'q');
  const event = {type:'quality-event',sessionId:'q',sequence:1,code:'audio-overrun',startSample:10,endSample:20};
  const accepted = filterAsrEvent(state,event);
  assert.deepEqual(accepted.effect,{type:'quality',code:'audio-overrun',startSample:10,endSample:20});
  assert.equal(filterAsrEvent(accepted.state,event).effect,null);
  assert.equal(filterAsrEvent(state,{...event,sessionId:'old'}).effect,null);
});
