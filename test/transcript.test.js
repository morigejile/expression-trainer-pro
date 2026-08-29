const test = require('node:test');
const assert = require('node:assert/strict');

global.document = { addEventListener() {} };
const { mergeFinalText, ExpressionTrainer } = require('../src/app');
const { beginAsrSession, createAsrEventState, filterAsrEvent } = require('../src/asr-event-state');
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
  trainer.audioProcessor = null;
  trainer.audioContext = null;
  trainer.mediaStream = null;
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
  trainer.asrInputSequence = 0;
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

test('start creates a UUID session before microphone capture and feeds contiguous input sequences', async (t) => {
  const calls = [];
  const feedCommands = [];
  let processor;
  const stream = { getTracks: () => [{ stop() {} }] };
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  const originalAudioContext = global.AudioContext;
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          calls.push('microphone');
          return stream;
        }
      }
    }
  });
  global.AudioContext = class {
    constructor(options) {
      calls.push(['audio-context', options]);
      this.destination = {};
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createScriptProcessor(frames, inputs, outputs) {
      calls.push(['script-processor', frames, inputs, outputs]);
      processor = { connect() {}, disconnect() {}, onaudioprocess: null };
      return processor;
    }
    close() {}
  };
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
        return {
          ok: true,
          events: [{
            type: command.sequence === 0 ? 'partial' : 'final',
            sessionId: command.sessionId,
            sequence: command.sequence + 1,
            text: command.sequence === 0 ? '草稿' : '定稿'
          }]
        };
      },
      analyzeText: async () => ({ totalWords: 2, fillers: [], hedges: [], vagueWords: [] })
    }
  };
  t.after(() => {
    delete global.window;
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator);
    else delete global.navigator;
    if (originalAudioContext === undefined) delete global.AudioContext;
    else global.AudioContext = originalAudioContext;
  });
  const trainer = createTrainer();

  await trainer.startRecording();
  await processor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array([0.1]) }
  });
  await processor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array([0.2]) }
  });

  const startCommand = calls.find(call => Array.isArray(call) && call[0] === 'start')[1];
  assert.match(startCommand.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(startCommand, { sessionId: startCommand.sessionId, sampleRateHz: 16000 });
  assert.ok(calls.findIndex(call => Array.isArray(call) && call[0] === 'start') < calls.indexOf('microphone'));
  assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === 'script-processor'), [
    'script-processor', 4096, 1, 1
  ]);
  assert.deepEqual(feedCommands.map(command => command.sequence), [0, 1]);
  assert.deepEqual(feedCommands.map(command => command.sessionId), [
    startCommand.sessionId,
    startCommand.sessionId
  ]);
  assert.equal(trainer.fullText, '定稿');
  clearInterval(trainer.timerInterval);
});

test('microphone failure invalidates locally before cancellation completes', async (t) => {
  let cancelCommand;
  let resolveCancel;
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          throw new Error('permission denied');
        }
      }
    }
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
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator);
    else delete global.navigator;
  });
  const trainer = createTrainer();
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
