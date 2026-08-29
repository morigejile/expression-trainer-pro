const test = require('node:test');
const assert = require('node:assert/strict');

global.document = { addEventListener() {} };
const { mergeFinalText, ExpressionTrainer } = require('../src/app');
const { beginAsrSession, createAsrEventState, filterAsrEvent } = require('../src/asr-event-state');
const { createAudioCapture } = require('../src/audio-capture');
delete global.document;

function createClassList() {
  const classes = new Set();
  return {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    contains: (name) => classes.has(name)
  };
}

function createElement() {
  return {
    classList: createClassList(),
    style: {},
    textContent: '',
    children: [],
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    }
  };
}

function createTrainer() {
  const trainer = Object.create(ExpressionTrainer.prototype);
  trainer.audioCaptureFactory = createAudioCapture;
  trainer.audioCapture = null;
  trainer.audioCaptureStopPromise = null;
  trainer.isRecording = true;
  trainer.isPaused = false;
  trainer.startTime = Date.now();
  trainer.pausedTime = 0;
  trainer.pauseStart = null;
  trainer.timerInterval = null;
  trainer.fullText = '已经确认';
  trainer.sentences = ['已经确认'];
  trainer.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 4, duration: 0 };
  trainer.lastFeedbackText = '';
  trainer.llmGeneration = 0;
  trainer.asrEventState = createAsrEventState();
  trainer.asrStartAttempt = null;
  trainer.asrGeneration = 0;
  trainer.renderSubtitle = () => {};
  trainer.btnStop = createElement();
  trainer.btnPause = createElement();
  trainer.btnResume = createElement();
  trainer.btnStart = createElement();
  trainer.btnReport = createElement();
  trainer.btnCopyText = createElement();
  trainer.btnSaveText = createElement();
  trainer.btnClear = createElement();
  trainer.timer = createElement();
  trainer.subtitleContainer = createElement();
  trainer.feedbackContent = createElement();
  trainer.statFillers = createElement();
  trainer.statHedges = createElement();
  trainer.statVague = createElement();
  trainer.statDensity = createElement();
  trainer.reportBody = createElement();
  trainer.reportModal = createElement();
  return trainer;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createAudioCaptureFactoryFake({ start, stop } = {}) {
  const calls = { start: [], enabled: [], stop: [] };
  let handlers;
  const capture = {
    async start(options) {
      handlers = options;
      calls.start.push(options.sessionId);
      if (start) return start(options);
    },
    setEnabled(value) { calls.enabled.push(value); },
    async stop(options) {
      calls.stop.push(options ?? {});
      if (stop) return stop(options);
    }
  };
  return {
    calls,
    capture,
    factory: () => capture,
    emit(chunk) { return handlers.onChunk(chunk); }
  };
}

function activateAsrSession(trainer, sessionId = 'session-a') {
  trainer.asrEventState = beginAsrSession(trainer.asrEventState, sessionId);
  trainer.asrEventState = filterAsrEvent(trainer.asrEventState, {
    type: 'ready',
    sessionId,
    sequence: 0
  }).state;
  return sessionId;
}

function stopEnvelope(sessionId, text = '尾部文本') {
  const events = [];
  if (text.trim()) {
    events.push({ type: 'final', sessionId, sequence: 1, text });
  }
  events.push({
    type: 'stopped',
    sessionId,
    sequence: text.trim() ? 2 : 1
  });
  return { ok: true, events };
}

test('stop final text is appended exactly once', () => {
  const firstMerge = mergeFinalText('已经确认', '尾部文本');
  const secondMerge = mergeFinalText(firstMerge.fullText, '尾部文本');

  assert.deepEqual(firstMerge, {
    fullText: '已经确认尾部文本',
    appendedText: '尾部文本'
  });
  assert.deepEqual(secondMerge, {
    fullText: '已经确认尾部文本',
    appendedText: ''
  });
});

test('stop final text reaches transcript, analysis, and the next report', async (t) => {
  let reportPayload;
  let resolveAnalysis;
  const finalAnalysis = {
    totalWords: 4,
    fillers: [],
    hedges: [],
    vagueWords: []
  };
  global.document = { createElement };
  global.window = {
    api: {
      stopASR: async () => stopEnvelope('session-a'),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => new Promise(resolve => { resolveAnalysis = resolve; }),
      getFinalReport: async (payload) => {
        reportPayload = payload;
        return { success: false, error: 'offline test double' };
      }
    }
  };
  t.after(() => {
    resolveAnalysis?.(finalAnalysis);
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  activateAsrSession(trainer);

  let stopResolved = false;
  const stopPromise = trainer.stopRecording().then(() => { stopResolved = true; });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(stopResolved, false, 'stop must wait for final-text analysis');
  resolveAnalysis(finalAnalysis);
  await stopPromise;
  await trainer.generateReport();

  assert.equal(trainer.fullText, '已经确认尾部文本');
  assert.deepEqual(trainer.sentences, ['已经确认', '尾部文本']);
  assert.equal(trainer.stats.totalWords, 8);
  assert.equal(reportPayload.fullText, '已经确认尾部文本');
  assert.equal(reportPayload.stats.totalWords, 8);
});

test('clear suppresses feedback that completed after cancellation', async (t) => {
  let resolveFeedback;
  const feedbackItems = [];
  global.document = { createElement };
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      getRealtimeFeedback: async () => new Promise(resolve => { resolveFeedback = resolve; })
    }
  };
  t.after(() => {
    resolveFeedback?.({ success: false, error: 'test cleanup' });
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.fullText = '旧会话已经积累了足够长的逐字稿内容';
  trainer.addFeedbackItem = (text) => feedbackItems.push(text);

  const pending = trainer.requestRealtimeFeedback();
  trainer.clearAll();
  resolveFeedback({ success: true, feedback: '旧会话迟到反馈' });
  await pending;

  assert.deepEqual(feedbackItems, []);
  assert.equal(trainer.fullText, '');
});

test('clear suppresses a report that completed after cancellation', async (t) => {
  let resolveReport;
  let renderedReport;
  global.document = { createElement };
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      getFinalReport: async () => new Promise(resolve => { resolveReport = resolve; })
    }
  };
  t.after(() => {
    resolveReport?.({ success: false, error: 'test cleanup' });
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.renderReport = (report) => { renderedReport = report; };

  const pending = trainer.generateReport();
  trainer.clearAll();
  resolveReport({ success: true, report: '旧会话迟到报告' });
  await pending;

  assert.equal(renderedReport, undefined);
  assert.equal(trainer.lastReport, '');
});

test('stop suppresses pending feedback before final analysis completes', async (t) => {
  let resolveAnalysis;
  let resolveFeedback;
  const feedbackItems = [];
  global.window = {
    api: {
      stopASR: async () => stopEnvelope('session-a'),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => new Promise(resolve => { resolveAnalysis = resolve; }),
      getRealtimeFeedback: async () => new Promise(resolve => { resolveFeedback = resolve; })
    }
  };
  t.after(() => {
    resolveAnalysis?.({ totalWords: 4, fillers: [], hedges: [], vagueWords: [] });
    resolveFeedback?.({ success: false, error: 'test cleanup' });
    delete global.window;
  });
  const trainer = createTrainer();
  activateAsrSession(trainer);
  trainer.fullText = '旧会话已经积累了足够长的逐字稿内容';
  trainer.addFeedbackItem = (text) => feedbackItems.push(text);

  const feedbackPromise = trainer.requestRealtimeFeedback();
  const stopPromise = trainer.stopRecording();
  await new Promise(resolve => setImmediate(resolve));
  resolveFeedback({ success: true, feedback: '停止期间迟到反馈' });
  await feedbackPromise;

  resolveAnalysis({ totalWords: 4, fillers: [], hedges: [], vagueWords: [] });
  await stopPromise;
  assert.deepEqual(feedbackItems, []);
});

test('stop finalizes recording when final-text analysis fails', async (t) => {
  let cancelCalls = 0;
  const shownErrors = [];
  global.window = {
    api: {
      stopASR: async () => stopEnvelope('session-a'),
      cancelLLMRequests: async () => {
        cancelCalls += 1;
        return { success: true };
      },
      analyzeText: async () => {
        throw new Error('analysis unavailable');
      }
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  activateAsrSession(trainer);
  trainer.btnStart.classList.add('hidden');
  trainer.showError = (message) => shownErrors.push(message);

  await trainer.stopRecording();

  assert.equal(trainer.fullText, '已经确认尾部文本');
  assert.equal(trainer.isRecording, false);
  assert.equal(cancelCalls, 1);
  assert.equal(trainer.btnStop.classList.contains('hidden'), true);
  assert.equal(trainer.btnStart.classList.contains('hidden'), false);
  assert.deepEqual(shownErrors, ['尾部文本分析失败: analysis unavailable']);
});

test('an endpoint final and the matching stop final update state only once', async (t) => {
  global.window = {
    api: {
      stopASR: async () => stopEnvelope('session-a'),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => ({
        totalWords: 4,
        fillers: [],
        hedges: [],
        vagueWords: []
      })
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  activateAsrSession(trainer);

  trainer.handleASRResult({ text: '尾部文本', isFinal: true });
  await new Promise(resolve => setImmediate(resolve));
  await trainer.stopRecording();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(trainer.fullText, '已经确认尾部文本');
  assert.deepEqual(trainer.sentences, ['已经确认', '尾部文本']);
  assert.equal(trainer.stats.totalWords, 8);
});

test('blank stop final text leaves transcript state unchanged', async (t) => {
  global.window = {
    api: {
      stopASR: async () => stopEnvelope('session-a', ' \n\t '),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => {
        throw new Error('blank final text must not be analyzed');
      }
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  activateAsrSession(trainer);

  await trainer.stopRecording();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(trainer.fullText, '已经确认');
  assert.deepEqual(trainer.sentences, ['已经确认']);
  assert.equal(trainer.stats.totalWords, 4);
});

test('renderer routes an active recording through the injected audio capture', async (t) => {
  const calls = [];
  const feedCommands = [];
  const audio = createAudioCaptureFactoryFake();
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      async startASR(command) {
        calls.push(['start', command]);
        return {
          ok: true,
          events: [{ type: 'ready', sessionId: command.sessionId, sequence: 0 }]
        };
      },
      async feedAudio(command) {
        feedCommands.push(command);
        return { ok: true, events: [] };
      }
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  trainer.audioCaptureFactory = audio.factory;
  trainer.audioCapture = null;
  trainer.audioCaptureStopPromise = null;

  await trainer.startRecording();
  const startCommand = calls[0][1];
  assert.match(startCommand.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(startCommand, { sessionId: startCommand.sessionId, sampleRateHz: 16000 });
  await audio.emit({
    sessionId: startCommand.sessionId,
    sequence: 0,
    sampleRateHz: 16000,
    channels: 1,
    format: 'f32',
    frames: 2,
    samples: new Float32Array([0.25, -0.5])
  });

  assert.deepEqual(audio.calls.start, [startCommand.sessionId]);
  assert.deepEqual(audio.calls.enabled, [true]);
  assert.deepEqual(feedCommands, [{
    sessionId: startCommand.sessionId,
    sequence: 0,
    samples: new Float32Array([0.25, -0.5])
  }]);
  trainer.pauseRecording();
  trainer.resumeRecording();
  assert.deepEqual(audio.calls.enabled, [true, false, true]);
  clearInterval(trainer.timerInterval);
});

test('microphone failure invalidates locally before cancellation completes', async (t) => {
  let cancelCommand;
  let resolveCancel;
  const audio = createAudioCaptureFactoryFake({
    async start() { throw new Error('permission denied'); }
  });
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      async startASR(command) {
        return {
          ok: true,
          events: [{ type: 'ready', sessionId: command.sessionId, sequence: 0 }]
        };
      },
      cancelASR(command) {
        cancelCommand = command;
        return new Promise(resolve => { resolveCancel = resolve; });
      }
    }
  };
  t.after(() => {
    resolveCancel?.({ ok: true, events: [] });
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.audioCaptureFactory = audio.factory;
  const shownErrors = [];
  trainer.showError = message => shownErrors.push(message);

  const startPromise = trainer.startRecording();
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(cancelCommand.sessionId);
  assert.deepEqual(trainer.asrEventState, createAsrEventState());
  resolveCancel({ ok: true, events: [{
    type: 'stopped', sessionId: cancelCommand.sessionId, sequence: 1
  }] });
  await startPromise;
  assert.deepEqual(shownErrors, ['麦克风访问失败: permission denied']);
});

test('clear invalidates ASR before cancel resolves and late final events stay ignored', async (t) => {
  let resolveCancel;
  let cancelCommand;
  global.document = { createElement };
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      cancelASR(command) {
        cancelCommand = command;
        return new Promise(resolve => { resolveCancel = resolve; });
      }
    }
  };
  t.after(() => {
    resolveCancel?.({ ok: true, events: [] });
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  activateAsrSession(trainer);

  trainer.clearAll();

  assert.deepEqual(cancelCommand, { sessionId: 'session-a' });
  assert.deepEqual(trainer.asrEventState, createAsrEventState());
  await trainer.processASRResponse({
    ok: true,
    events: [{ type: 'final', sessionId: 'session-a', sequence: 1, text: '迟到文本' }]
  }, '语音识别失败');
  assert.equal(trainer.fullText, '');
  resolveCancel({ ok: true, events: [] });
});

test('command errors are rendered as text content', async (t) => {
  global.document = { createElement };
  t.after(() => { delete global.document; });
  const trainer = createTrainer();
  activateAsrSession(trainer);

  await trainer.processASRResponse({
    ok: false,
    error: { code: 'asr-start-failed', message: '<img src=x onerror=evil()>' }
  }, '语音识别启动失败');

  assert.equal(trainer.subtitleContainer.children.length, 1);
  assert.equal(
    trainer.subtitleContainer.children[0].textContent,
    '语音识别启动失败: <img src=x onerror=evil()>'
  );
});

test('clear during initial cancellation await prevents the stale start from claiming a session', async (t) => {
  const initialCancellation = createDeferred();
  let cancelCalls = 0;
  let startCalls = 0;
  let microphoneCalls = 0;
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          microphoneCalls += 1;
          throw new Error('must not reach microphone');
        }
      }
    }
  });
  global.document = { createElement };
  global.window = {
    api: {
      cancelLLMRequests() {
        cancelCalls += 1;
        return cancelCalls === 1
          ? initialCancellation.promise
          : Promise.resolve({ success: true });
      },
      async startASR() {
        startCalls += 1;
        return { ok: false, error: { code: 'unexpected', message: 'unexpected start' } };
      }
    }
  };
  t.after(() => {
    initialCancellation.resolve({ success: true });
    delete global.document;
    delete global.window;
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator);
    else delete global.navigator;
  });
  const trainer = createTrainer();
  trainer.showError = () => {};

  const startPromise = trainer.startRecording();
  trainer.clearAll();
  initialCancellation.resolve({ success: true });
  await startPromise;

  assert.equal(startCalls, 0);
  assert.equal(microphoneCalls, 0);
  assert.deepEqual(trainer.asrEventState, createAsrEventState());
});

test('only the latest of two overlapping starts may pass the initial await', async (t) => {
  const firstCancellation = createDeferred();
  const secondCancellation = createDeferred();
  const gates = [firstCancellation, secondCancellation];
  const startCommands = [];
  let cancellationCalls = 0;
  global.window = {
    api: {
      cancelLLMRequests() {
        const gate = gates[cancellationCalls];
        cancellationCalls += 1;
        return gate.promise;
      },
      async startASR(command) {
        startCommands.push(command);
        return { ok: false, error: { code: 'test-stop', message: 'stop after ownership check' } };
      }
    }
  };
  t.after(() => {
    firstCancellation.resolve({ success: true });
    secondCancellation.resolve({ success: true });
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.showError = () => {};

  const firstStart = trainer.startRecording();
  const secondStart = trainer.startRecording();
  firstCancellation.resolve({ success: true });
  await new Promise(resolve => setImmediate(resolve));
  secondCancellation.resolve({ success: true });
  await Promise.all([firstStart, secondStart]);

  assert.equal(startCommands.length, 1);
  assert.deepEqual(trainer.asrEventState, createAsrEventState());
});

test('audio capture setup failure releases the local capture and leaves no owner', async (t) => {
  const audio = createAudioCaptureFactoryFake({
    async start() { throw new Error('graph connection failed'); }
  });
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      async startASR(command) {
        return {
          ok: true,
          events: [{ type: 'ready', sessionId: command.sessionId, sequence: 0 }]
        };
      },
      cancelASR: async () => ({ ok: true, events: [] })
    }
  };
  t.after(() => {
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.audioCaptureFactory = audio.factory;
  trainer.showError = () => {};

  await trainer.startRecording();

  assert.equal(audio.calls.stop.length, 1);
  assert.equal(trainer.audioCapture, null);
});

test('microphone rejection from a replaced start does not display a stale error', async (t) => {
  const firstMicrophone = createDeferred();
  const microphoneRequested = createDeferred();
  const secondCancellation = createDeferred();
  let cancelLlmCalls = 0;
  let startCalls = 0;
  const shownErrors = [];
  const audio = createAudioCaptureFactoryFake({
    start() {
      microphoneRequested.resolve();
      return firstMicrophone.promise;
    }
  });
  global.window = {
    api: {
      cancelLLMRequests() {
        cancelLlmCalls += 1;
        return cancelLlmCalls === 1
          ? Promise.resolve({ success: true })
          : secondCancellation.promise;
      },
      async startASR(command) {
        startCalls += 1;
        if (startCalls === 1) {
          return {
            ok: true,
            events: [{ type: 'ready', sessionId: command.sessionId, sequence: 0 }]
          };
        }
        return { ok: false, error: { code: 'second-stopped', message: 'second stopped' } };
      },
      cancelASR: async () => ({ ok: true, events: [] })
    }
  };
  t.after(() => {
    firstMicrophone.reject(new Error('old permission failure'));
    secondCancellation.resolve({ success: true });
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.audioCaptureFactory = audio.factory;
  trainer.showError = message => shownErrors.push(message);

  const firstStart = trainer.startRecording();
  await microphoneRequested.promise;
  const secondStart = trainer.startRecording();
  firstMicrophone.reject(new Error('old permission failure'));
  await firstStart;

  assert.equal(shownErrors.some(message => message.includes('old permission failure')), false);
  secondCancellation.resolve({ success: true });
  await secondStart;
});

test('clear during stop-final analysis prevents stale analysis side effects', async (t) => {
  const analysis = createDeferred();
  global.document = { createElement };
  global.window = {
    api: {
      stopASR: async () => stopEnvelope('session-a'),
      cancelASR: async () => ({ ok: true, events: [] }),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => analysis.promise
    }
  };
  t.after(() => {
    analysis.resolve({ totalWords: 4, fillers: [], hedges: [], vagueWords: [] });
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  activateAsrSession(trainer);

  const stopPromise = trainer.stopRecording();
  await new Promise(resolve => setImmediate(resolve));
  trainer.clearAll();
  analysis.resolve({ totalWords: 4, fillers: [], hedges: [], vagueWords: [] });
  await stopPromise;

  assert.equal(trainer.fullText, '');
  assert.deepEqual(trainer.sentences, []);
  assert.equal(trainer.stats.totalWords, 0);
  assert.equal(trainer.feedbackContent.children.length, 0);
});

test('LLM cancellation alone does not discard analysis owned by the active ASR session', async (t) => {
  const analysis = createDeferred();
  global.window = {
    api: {
      analyzeText: async () => analysis.promise
    }
  };
  t.after(() => {
    analysis.resolve({ totalWords: 4, fillers: [], hedges: [], vagueWords: [] });
    delete global.window;
  });
  const trainer = createTrainer();
  activateAsrSession(trainer);

  const resultPromise = trainer.processASRResponse({
    ok: true,
    events: [{ type: 'final', sessionId: 'session-a', sequence: 1, text: '同一会话定稿' }]
  }, '语音识别失败');
  await new Promise(resolve => setImmediate(resolve));
  trainer.advanceLLMGeneration();
  analysis.resolve({ totalWords: 4, fillers: [], hedges: [], vagueWords: [] });
  await resultPromise;

  assert.equal(trainer.stats.totalWords, 8);
});

test('stop rejection after clear does not display a stale error', async (t) => {
  const stopped = createDeferred();
  const shownErrors = [];
  global.document = { createElement };
  global.window = {
    api: {
      stopASR: async () => stopped.promise,
      cancelASR: async () => ({ ok: true, events: [] }),
      cancelLLMRequests: async () => ({ success: true })
    }
  };
  t.after(() => {
    stopped.reject(new Error('old stop failed'));
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  activateAsrSession(trainer);
  trainer.showError = message => shownErrors.push(message);

  const stopPromise = trainer.stopRecording();
  await new Promise(resolve => setImmediate(resolve));
  trainer.clearAll();
  stopped.reject(new Error('old stop failed'));
  await stopPromise;

  assert.equal(shownErrors.some(message => message.includes('old stop failed')), false);
});

async function startActiveRecordingHarness(t, { feedAudio, cancelASR } = {}) {
  let sessionId;
  const feedCommands = [];
  const cancelCommands = [];
  const audio = createAudioCaptureFactoryFake();
  global.document = { createElement };
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      async startASR(command) {
        sessionId = command.sessionId;
        return {
          ok: true,
          events: [{ type: 'ready', sessionId, sequence: 0 }]
        };
      },
      async feedAudio(command) {
        feedCommands.push(command);
        return feedAudio
          ? feedAudio(command)
          : { ok: true, events: [] };
      },
      cancelASR(command) {
        cancelCommands.push(command);
        return cancelASR
          ? cancelASR(command)
          : Promise.resolve({ ok: true, events: [] });
      },
      analyzeText: async () => ({ totalWords: 0, fillers: [], hedges: [], vagueWords: [] })
    }
  };

  const trainer = createTrainer();
  trainer.audioCaptureFactory = audio.factory;
  t.after(() => {
    clearInterval(trainer.timerInterval);
    delete global.document;
    delete global.window;
  });
  await trainer.startRecording();

  return {
    audio,
    cancelCommands,
    feedCommands,
    get sessionId() { return sessionId; },
    trainer
  };
}

test('a completed-session restart can be cleared back to an inert idle state', async (t) => {
  const cancel = createDeferred();
  const shownErrors = [];
  const harness = await startActiveRecordingHarness(t, {
    cancelASR: () => cancel.promise
  });
  const { trainer } = harness;
  trainer.showError = message => shownErrors.push(message);

  assert.equal(trainer.btnReport.classList.contains('hidden'), true);
  assert.equal(trainer.btnCopyText.classList.contains('hidden'), true);
  assert.equal(trainer.btnSaveText.classList.contains('hidden'), true);
  assert.equal(trainer.btnClear.classList.contains('hidden'), true);

  trainer.clearAll();
  trainer.clearAll();

  assert.deepEqual(harness.cancelCommands, [{ sessionId: harness.sessionId }]);
  assert.deepEqual(trainer.asrEventState, createAsrEventState());
  assert.equal(harness.audio.calls.stop.length, 1);
  assert.equal(trainer.audioCapture, null);
  assert.equal(trainer.timerInterval, null);
  assert.equal(trainer.isRecording, false);
  assert.equal(trainer.isPaused, false);
  assert.equal(trainer.btnStart.classList.contains('hidden'), false);
  assert.equal(trainer.btnStop.classList.contains('hidden'), true);
  assert.equal(trainer.btnPause.classList.contains('hidden'), true);
  assert.equal(trainer.btnResume.classList.contains('hidden'), true);

  await harness.audio.emit({
    sessionId: harness.sessionId,
    sequence: 0,
    samples: new Float32Array([0.25])
  });
  await trainer.processASRResponse({
    ok: true,
    events: [{
      type: 'final',
      sessionId: harness.sessionId,
      sequence: 1,
      text: '迟到文本'
    }]
  }, '语音识别失败');
  cancel.reject(new Error('late cancellation failed'));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.feedCommands.length, 0);
  assert.equal(trainer.fullText, '');
  assert.deepEqual(shownErrors, []);
});

for (const feedFailure of [
  {
    name: 'rejection',
    run: async () => { throw new Error('transport rejected'); }
  },
  {
    name: 'command-error envelope',
    run: async () => ({
      ok: false,
      error: { code: 'asr-feed-failed', message: 'sanitized feed failure' }
    })
  }
]) {
  test(`feed ${feedFailure.name} fails the recording closed once`, async (t) => {
    const cancel = createDeferred();
    const shownErrors = [];
    const harness = await startActiveRecordingHarness(t, {
      feedAudio: feedFailure.run,
      cancelASR: () => cancel.promise
    });
    const { trainer } = harness;
    trainer.showError = message => shownErrors.push(message);

    await harness.audio.emit({
      sessionId: harness.sessionId,
      sequence: 0,
      samples: new Float32Array([0.5])
    });
    await harness.audio.emit({
      sessionId: harness.sessionId,
      sequence: 1,
      samples: new Float32Array([0.75])
    });

    assert.deepEqual(harness.feedCommands.map(command => command.sequence), [0]);
    assert.deepEqual(harness.cancelCommands, [{ sessionId: harness.sessionId }]);
    assert.deepEqual(trainer.asrEventState, createAsrEventState());
    assert.equal(harness.audio.calls.stop.length, 1);
    assert.equal(trainer.audioCapture, null);
    assert.equal(trainer.timerInterval, null);
    assert.equal(trainer.isRecording, false);
    assert.equal(trainer.isPaused, false);
    assert.equal(trainer.btnStart.classList.contains('hidden'), false);
    assert.equal(trainer.btnStop.classList.contains('hidden'), true);
    assert.deepEqual(shownErrors, ['语音识别处理失败，录音已停止，请重新开始']);

    cancel.resolve({
      ok: false,
      error: { code: 'asr-cancel-failed', message: 'late cancel failure' }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shownErrors, ['语音识别处理失败，录音已停止，请重新开始']);
  });
}
