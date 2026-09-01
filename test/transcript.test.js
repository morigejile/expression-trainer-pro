const test = require('node:test');
const assert = require('node:assert/strict');

global.document = { addEventListener() {} };
const { mergeFinalText, ExpressionTrainer } = require('../src/app');
const { beginAsrSession, createAsrEventState, filterAsrEvent } = require('../src/asr-event-state');
const { createAudioCapture } = require('../src/audio-capture');
const { createPcmWavRecorder } = require('../src/pcm-wav');
const { createTrainingRecordStore } = require('../src/training-records');
delete global.document;

function createClassList() {
  const classes = new Set();
  return {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    toggle(name, force) {
      if (force === true) classes.add(name);
      else if (force === false) classes.delete(name);
      else if (classes.has(name)) classes.delete(name);
      else classes.add(name);
    },
    contains: (name) => classes.has(name)
  };
}

function createElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    classList: createClassList(),
    style: {},
    textContent: '',
    children: [],
    get firstChild() {
      return this.children[0] ?? null;
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    insertBefore(node, reference) {
      const index = this.children.indexOf(reference);
      if (index === -1) this.children.push(node);
      else this.children.splice(index, 0, node);
      return node;
    },
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index !== -1) this.children.splice(index, 1);
      return node;
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
    addEventListener() {}
  };
}

function createTrainer() {
  const trainer = Object.create(ExpressionTrainer.prototype);
  trainer.audioCaptureFactory = createAudioCapture;
  trainer.audioCapture = null;
  trainer.audioCaptureStopPromise = null;
  trainer.audioFeedTracker = null;
  trainer.recordingStopOperation = null;
  trainer.lastAudioCaptureRates = null;
  trainer.lastAudioFeedMetrics = null;
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
  trainer.recordingPolicyAcknowledged = true;
  trainer.renderSubtitle = () => {};
  trainer.btnStop = createElement();
  trainer.btnStopLabel = createElement();
  trainer.btnPause = createElement();
  trainer.btnResume = createElement();
  trainer.btnStart = createElement();
  trainer.btnStartLabel = createElement();
  trainer.btnPaste = createElement();
  trainer.btnAnalyzePaste = createElement();
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
  trainer.pasteModal = createElement();
  trainer.pasteTextarea = { value: '', focus() {} };
  trainer.userMessage = createElement();
  trainer.userMessageText = createElement();
  trainer.userMessageAction = createElement();
  trainer.trainingStatus = createElement();
  trainer.feedbackStatus = createElement();
  trainer.recordingPolicyModal = createElement();
  trainer.btnRecordingPolicyConfirm = createElement('button');
  trainer.btnRecordingPolicyCancel = createElement('button');
  trainer.trainingRecordSelect = createElement('select');
  trainer.pasteAnalysisPending = false;
  trainer.pasteAnalysisGeneration = 0;
  trainer.activeModal = null;
  trainer.modalOpener = null;
  return trainer;
}

function audioChunk(sessionId = 'session-a', samples = new Float32Array([0.25, 0.5])) {
  return {
    sessionId,
    sequence: 0,
    sampleRateHz: 16000,
    channels: 1,
    format: 'f32',
    frames: samples.length,
    samples
  };
}

function fakeRecorder({ limitOnAppend = false, durationMs = 20 } = {}) {
  return {
    durationMs,
    append(samples) {
      this.durationMs += samples.length / 16;
      return { acceptedFrames: samples.length, limitReached: limitOnAppend };
    },
    finish: () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }),
    clear() {}
  };
}

function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

function flushTimers() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function startAudioCaptureHarness(t, {
  captureStop,
  feedAudio,
  stopASR,
  cancelASR
} = {}) {
  const order = [];
  const calls = { captureStop: 0, feedAudio: 0, stopASR: 0, cancelASR: 0 };
  let handlers;
  let sessionId;
  const capture = {
    async start(options) {
      handlers = options;
      return {
        requestedSampleRateHz: 16000,
        contextSampleRateHz: 16000,
        trackSampleRateHz: 48000
      };
    },
    setEnabled() {},
    stop(stopOptions) {
      calls.captureStop += 1;
      return captureStop
        ? captureStop({ stopOptions, handlers, order })
        : Promise.resolve();
    }
  };
  global.document = { createElement };
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      async startASR(command) {
        sessionId = command.sessionId;
        return { ok: true, events: [{ type: 'ready', sessionId, sequence: 0 }] };
      },
      feedAudio(command) {
        calls.feedAudio += 1;
        return feedAudio ? feedAudio(command, order) : Promise.resolve({ ok: true, events: [] });
      },
      stopASR(command) {
        calls.stopASR += 1;
        return stopASR ? stopASR(command, order) : Promise.resolve(stopEnvelope(command.sessionId, ''));
      },
      cancelASR(command) {
        calls.cancelASR += 1;
        return cancelASR ? cancelASR(command, order) : Promise.resolve({ ok: true, events: [] });
      },
      analyzeText: async () => ({ totalWords: 2, fillers: [], hedges: [], vagueWords: [] })
    }
  };
  const trainer = createTrainer();
  trainer.audioCaptureFactory = () => capture;
  t.after(() => {
    clearInterval(trainer.timerInterval);
    delete global.document;
    delete global.window;
  });
  await trainer.startRecording();
  return { trainer, capture, get handlers() { return handlers; }, get sessionId() { return sessionId; }, order, calls };
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

function ownActiveRecording(trainer, sessionId = 'session-a') {
  trainer.recordingSessionId = sessionId;
  trainer.recordingPcm = { durationMs: 0, clear() {} };
  trainer.pendingSegments = [];
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
  ownActiveRecording(trainer);

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

test('realtime configuration failures show their reason with a settings action', async (t) => {
  const messages = [];
  global.window = {
    api: {
      getRealtimeFeedback: async () => ({
        success: false,
        error: '请先配置 API Key',
        errorCode: 'missing-api-key'
      })
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  trainer.fullText = '这是一段足够长的实时反馈测试文本';
  trainer.showUserMessage = (message, options) => messages.push({ message, options });

  await trainer.requestRealtimeFeedback();

  assert.deepEqual(messages, [{
    message: '实时反馈失败：请先配置 API Key',
    options: { openSettings: true }
  }]);
});

test('user messages can be dismissed explicitly', () => {
  const trainer = createTrainer();

  trainer.showUserMessage('实时反馈失败：请先配置 API Key', {openSettings: true});
  trainer.hideUserMessage();

  assert.equal(trainer.userMessage.classList.contains('hidden'), true);
  assert.equal(trainer.userMessageAction.classList.contains('hidden'), true);
});

test('saved LLM settings dismiss only a configuration-related message', () => {
  const trainer = createTrainer();

  trainer.showUserMessage('实时反馈失败：请先配置 API Key', {openSettings: true});
  trainer.handleLlmProviderSettingsChanged();
  assert.equal(trainer.userMessage.classList.contains('hidden'), true);
  assert.equal(trainer.feedbackStatus.textContent, '本地分析可用；AI 建议将在后续表达中生成');

  trainer.showUserMessage('复制失败，请重试');
  trainer.handleLlmProviderSettingsChanged();
  assert.equal(trainer.userMessage.classList.contains('hidden'), false);
  assert.equal(trainer.userMessageText.textContent, '复制失败，请重试');
});

test('starting recognition immediately exposes preparation state and locks conflicting actions', async (t) => {
  const cancellation = createDeferred();
  global.document = { createElement };
  global.window = {
    api: {
      cancelLLMRequests: () => cancellation.promise,
      startASR: async () => ({ ok: false, error: { message: 'test stop' } })
    }
  };
  let start;
  t.after(async () => {
    cancellation.resolve({ success: true });
    await start?.catch(() => {});
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.fullText = '';

  start = trainer.startRecording();

  assert.equal(trainer.trainingStatus.textContent, '正在准备语音识别，首次运行可能需要数分钟');
  assert.equal(trainer.btnStart.disabled, true);
  assert.equal(trainer.btnPaste.disabled, true);

  cancellation.resolve({ success: true });
  await start;
});

test('stopping recording immediately exposes finalization state and locks recording controls', async (t) => {
  const captureStop = createDeferred();
  global.document = { createElement };
  global.window = {
    api: {
      stopASR: async ({ sessionId }) => stopEnvelope(sessionId, ''),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => ({ totalWords: 0, fillers: [], hedges: [], vagueWords: [] })
    }
  };
  t.after(() => {
    captureStop.resolve();
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  activateAsrSession(trainer);
  ownActiveRecording(trainer);
  trainer.audioCapture = {
    setEnabled() {},
    stop: () => captureStop.promise
  };

  const stopping = trainer.stopRecording();

  assert.equal(trainer.trainingStatus.textContent, '正在结束并整理尾部文字…');
  assert.equal(trainer.btnStop.disabled, true);
  assert.equal(trainer.btnPause.disabled, true);

  captureStop.resolve();
  await stopping;
  assert.equal(trainer.trainingStatus.textContent, '本次训练已结束');
});

test('successful recording, pause, and resume expose the current operation state', async (t) => {
  const { trainer } = await startAudioCaptureHarness(t);

  assert.equal(trainer.trainingStatus.textContent, '正在录音');
  assert.equal(trainer.btnPaste.disabled, true);

  trainer.pauseRecording();
  assert.equal(trainer.trainingStatus.textContent, '录音已暂停');

  trainer.resumeRecording();
  assert.equal(trainer.trainingStatus.textContent, '正在录音');
});

test('clearing an idle result restores ready and local-analysis states', (t) => {
  global.document = { createElement };
  global.window = {
    confirm: () => true,
    api: { cancelLLMRequests: () => ({ success: true }) }
  };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.trainingStatus.textContent = '本次训练已结束';
  trainer.feedbackStatus.textContent = '本地分析正常，AI 建议已更新';

  trainer.clearAll();

  assert.equal(trainer.trainingStatus.textContent, '准备就绪');
  assert.equal(trainer.feedbackStatus.textContent, '本地分析可用；AI 建议约每新增 30 字生成');
  assert.equal(trainer.btnPaste.disabled, false);
});

test('realtime AI work exposes pending and updated status without hiding local analysis', async (t) => {
  const feedback = createDeferred();
  global.document = { createElement };
  global.window = {
    api: { getRealtimeFeedback: () => feedback.promise }
  };
  t.after(() => {
    feedback.resolve({ success: false, errorCode: 'cancelled' });
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.fullText = '这是一段足够长的实时反馈测试文本';

  const pending = trainer.requestRealtimeFeedback();
  assert.equal(trainer.feedbackStatus.textContent, '本地分析正常，AI 建议生成中…');

  feedback.resolve({ success: true, feedback: '表达清楚' });
  await pending;

  assert.equal(trainer.feedbackStatus.textContent, '本地分析正常，AI 建议已更新');
});

test('feedback items follow the transcript reading direction from oldest to newest', () => {
  global.document = { createElement };
  const trainer = createTrainer();

  try {
    trainer.addFeedbackItem('第一条');
    trainer.addFeedbackItem('第二条');

    assert.deepEqual(
      trainer.feedbackContent.children.map(item => item.textContent),
      ['第一条', '第二条']
    );
  } finally {
    delete global.document;
  }
});

test('report configuration failures show their reason with a settings action', async (t) => {
  const messages = [];
  global.document = { createElement };
  global.window = {
    api: {
      getFinalReport: async () => ({
        success: false,
        error: 'API Key 无效或无权限',
        errorCode: 'unauthorized'
      })
    }
  };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.showUserMessage = (message, options) => messages.push({ message, options });

  await trainer.generateReport();

  assert.deepEqual(messages, [{
    message: '生成报告失败：API Key 无效或无权限',
    options: { openSettings: true }
  }]);
  assert.equal(trainer.btnReport.disabled, false);
  assert.deepEqual(
    trainer.reportBody.children.map(node => [node.tagName, node.textContent]),
    [
      ['P', '生成报告失败：API Key 无效或无权限'],
      ['BUTTON', '重试生成']
    ]
  );
});

test('a second report request is rejected while the first is pending', async (t) => {
  const report = createDeferred();
  const messages = [];
  let calls = 0;
  global.document = { createElement };
  global.window = {
    api: {
      getFinalReport: async () => {
        calls += 1;
        return report.promise;
      }
    }
  };
  t.after(() => {
    report.resolve({ success: false, error: 'test cleanup', errorCode: 'generic' });
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.showUserMessage = message => messages.push(message);
  trainer.renderReport = () => {};

  const first = trainer.generateReport();
  await new Promise(resolve => setImmediate(resolve));
  await trainer.generateReport();

  assert.equal(calls, 1);
  assert.deepEqual(messages, ['报告正在生成，请稍候']);
  report.resolve({ success: true, report: '完成' });
  await first;
});

test('opening paste analysis during recording is blocked with an explanation', () => {
  const messages = [];
  const trainer = createTrainer();
  trainer.pasteModal.classList.add('hidden');
  trainer.showUserMessage = message => messages.push(message);

  trainer.openPasteModal();

  assert.equal(trainer.pasteModal.classList.contains('hidden'), true);
  assert.deepEqual(messages, ['请先结束当前录制，再导入逐字稿']);
});

test('blank pasted text is explained without starting analysis', async (t) => {
  const messages = [];
  global.window = {
    api: {
      cancelLLMRequests: async () => assert.fail('blank text must not start analysis')
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.fullText = '';
  trainer.pasteTextarea.value = '  \n  ';
  trainer.showUserMessage = message => messages.push(message);

  await trainer.analyzePastedText();

  assert.deepEqual(messages, ['请先粘贴需要分析的逐字稿']);
});

test('declining replacement keeps existing content when a new recording is requested', async (t) => {
  global.window = {
    confirm: () => false,
    api: {
      cancelLLMRequests: async () => assert.fail('declined replacement must not start')
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  trainer.isRecording = false;

  await trainer.startRecording();

  assert.equal(trainer.fullText, '已经确认');
  assert.equal(trainer.asrStartAttempt, null);
});

test('declining replacement keeps existing content when pasted text is analyzed', async (t) => {
  global.window = {
    confirm: () => false,
    api: {
      cancelLLMRequests: async () => assert.fail('declined replacement must not analyze')
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.pasteTextarea.value = '新逐字稿';

  await trainer.analyzePastedText();

  assert.equal(trainer.fullText, '已经确认');
});

test('declining clear keeps existing idle content', (t) => {
  global.window = {
    confirm: () => false,
    api: { cancelLLMRequests: () => ({ success: true }) }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  trainer.isRecording = false;

  trainer.clearAll();

  assert.equal(trainer.fullText, '已经确认');
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
  ownActiveRecording(trainer);
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
  ownActiveRecording(trainer);
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
  ownActiveRecording(trainer);

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
  ownActiveRecording(trainer);

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

test('a repeated start is rejected while the first start is pending', async (t) => {
  const firstCancellation = createDeferred();
  const startCommands = [];
  let cancellationCalls = 0;
  global.window = {
    api: {
      cancelLLMRequests() {
        cancellationCalls += 1;
        return firstCancellation.promise;
      },
      async startASR(command) {
        startCommands.push(command);
        return { ok: false, error: { code: 'test-stop', message: 'stop after ownership check' } };
      }
    }
  };
  t.after(() => {
    firstCancellation.resolve({ success: true });
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.showError = () => {};
  const messages = [];
  trainer.showUserMessage = message => messages.push(message);

  const firstStart = trainer.startRecording();
  const secondStart = trainer.startRecording();
  firstCancellation.resolve({ success: true });
  await Promise.all([firstStart, secondStart]);

  assert.equal(cancellationCalls, 1);
  assert.equal(startCommands.length, 1);
  assert.deepEqual(messages, ['录制正在启动，请稍候']);
  assert.deepEqual(trainer.asrEventState, createAsrEventState());
});

test('audio capture setup failure releases the local capture and leaves no owner', async (t) => {
  const rateError = new Error('AudioContext output rate 48000 Hz; expected 16000 Hz');
  rateError.code = 'unsupported-audio-context-rate';
  rateError.audioRates = Object.freeze({
    requestedSampleRateHz: 16000,
    contextSampleRateHz: 48000,
    trackSampleRateHz: 44100
  });
  const audio = createAudioCaptureFactoryFake({
    async start() { throw rateError; }
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
  assert.deepEqual(trainer.lastAudioCaptureRates, rateError.audioRates);
});

test('a repeated start cannot replace a start that is waiting for microphone access', async (t) => {
  const firstMicrophone = createDeferred();
  const microphoneRequested = createDeferred();
  let cancelLlmCalls = 0;
  let startCalls = 0;
  const shownErrors = [];
  const messages = [];
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
        return Promise.resolve({ success: true });
      },
      async startASR(command) {
        startCalls += 1;
        return {
          ok: true,
          events: [{ type: 'ready', sessionId: command.sessionId, sequence: 0 }]
        };
      },
      cancelASR: async () => ({ ok: true, events: [] })
    }
  };
  t.after(() => {
    firstMicrophone.reject(new Error('old permission failure'));
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.audioCaptureFactory = audio.factory;
  trainer.showError = message => shownErrors.push(message);
  trainer.showUserMessage = message => messages.push(message);

  const firstStart = trainer.startRecording();
  await microphoneRequested.promise;
  const secondStart = trainer.startRecording();
  firstMicrophone.reject(new Error('old permission failure'));
  await firstStart;

  assert.equal(cancelLlmCalls, 1);
  assert.equal(startCalls, 1);
  assert.equal(shownErrors.some(message => message.includes('old permission failure')), true);
  assert.deepEqual(messages, ['录制正在启动，请稍候']);
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
  ownActiveRecording(trainer);

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
  ownActiveRecording(trainer);
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

    const firstFeed = harness.audio.emit({
      sessionId: harness.sessionId,
      sequence: 0,
      samples: new Float32Array([0.5])
    });
    await new Promise(resolve => setImmediate(resolve));
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
    assert.equal(trainer.btnStart.disabled, false);
    assert.equal(trainer.btnPaste.disabled, false);
    assert.equal(trainer.btnStop.classList.contains('hidden'), true);
    assert.deepEqual(shownErrors, ['语音识别处理失败，录音已停止，请重新开始']);

    cancel.resolve({
      ok: false,
      error: { code: 'asr-cancel-failed', message: 'late cancel failure' }
    });
    await firstFeed;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shownErrors, ['语音识别处理失败，录音已停止，请重新开始']);
  });
}

test('the eleventh pending audio chunk fails the active recording with observable overrun metrics', async (t) => {
  const firstFeed = createDeferred();
  const harness = await startActiveRecordingHarness(t, {
    feedAudio: () => firstFeed.promise
  });

  for (let sequence = 0; sequence < 11; sequence += 1) {
    void harness.audio.emit({
      sessionId: harness.sessionId,
      sequence,
      samples: new Float32Array(320)
    });
  }
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(harness.feedCommands.map(command => command.sequence), [0]);
  assert.deepEqual(harness.cancelCommands, [{ sessionId: harness.sessionId }]);
  assert.deepEqual(harness.trainer.asrEventState, createAsrEventState());
  assert.equal(harness.trainer.lastAudioFeedMetrics.maxChunks, 10);
  assert.equal(harness.trainer.lastAudioFeedMetrics.peakDepth, 10);
  assert.equal(harness.trainer.lastAudioFeedMetrics.overruns, 1);
  assert.equal(harness.trainer.lastAudioFeedMetrics.discarded, 9);
  assert.equal(harness.trainer.audioCapture, null);

  firstFeed.resolve({ ok: true, events: [] });
});

test('concurrent normal stops share one flush, tail drain, and stopASR flight', async (t) => {
  const feedStarted = createDeferred();
  const feedGate = createDeferred();
  const harness = await startAudioCaptureHarness(t, {
    captureStop({ stopOptions, handlers, order }) {
      assert.deepEqual(stopOptions, { flush: true });
      order.push('capture-flush');
      handlers.onChunk({
        sessionId: handlers.sessionId,
        sequence: 0,
        sampleRateHz: 16000,
        channels: 1,
        format: 'f32',
        frames: 17,
        samples: new Float32Array(17).fill(0.5)
      });
      return Promise.resolve();
    },
    feedAudio(command, order) {
      order.push(`feed:${command.sequence}`);
      feedStarted.resolve();
      return feedGate.promise;
    },
    stopASR(command, order) {
      order.push('stop-asr');
      return stopEnvelope(command.sessionId, '尾块后的定稿');
    }
  });

  const firstStop = harness.trainer.stopRecording();
  const secondStop = harness.trainer.stopRecording();
  assert.equal(firstStop, secondStop);
  await feedStarted.promise;
  assert.deepEqual(harness.calls, { captureStop: 1, feedAudio: 1, stopASR: 0, cancelASR: 0 });
  assert.deepEqual(harness.order, ['capture-flush', 'feed:0']);
  feedGate.resolve({ ok: true, events: [] });
  await Promise.all([firstStop, secondStop]);
  assert.deepEqual(harness.order, ['capture-flush', 'feed:0', 'stop-asr']);
  assert.deepEqual(harness.calls, { captureStop: 1, feedAudio: 1, stopASR: 1, cancelASR: 0 });
  assert.equal(harness.trainer.fullText, '尾块后的定稿');
});

test('flush failure cancels once and never calls stopASR', async (t) => {
  const flushFailure = createDeferred();
  const shownErrors = [];
  const harness = await startAudioCaptureHarness(t, {
    captureStop: () => flushFailure.promise,
    cancelASR: async () => ({ ok: true, events: [] }),
    stopASR: assert.fail
  });
  harness.trainer.showError = message => shownErrors.push(message);

  const firstStop = harness.trainer.stopRecording();
  const secondStop = harness.trainer.stopRecording();
  assert.equal(firstStop, secondStop);
  flushFailure.reject(new Error('AudioWorklet flush timed out'));
  await firstStop;

  assert.equal(harness.calls.captureStop, 1);
  assert.equal(harness.calls.cancelASR, 1);
  assert.equal(harness.calls.stopASR, 0);
  assert.equal(shownErrors.filter(message => message === '语音识别处理失败，录音已停止，请重新开始').length, 1);
});

test('tail feed failure during stop fails the owning session closed', async (t) => {
  const feedFailure = createDeferred();
  const shownErrors = [];
  const harness = await startAudioCaptureHarness(t, {
    captureStop({ handlers }) {
      handlers.onChunk({
        sessionId: handlers.sessionId,
        sequence: 0,
        sampleRateHz: 16000,
        channels: 1,
        format: 'f32',
        frames: 17,
        samples: new Float32Array(17)
      });
      return Promise.resolve();
    },
    feedAudio: () => feedFailure.promise,
    cancelASR: async () => ({ ok: true, events: [] }),
    stopASR: assert.fail
  });
  harness.trainer.showError = message => shownErrors.push(message);

  const stop = harness.trainer.stopRecording();
  feedFailure.reject(new Error('tail feed failed'));
  await stop;

  assert.equal(harness.calls.feedAudio, 1);
  assert.equal(harness.calls.cancelASR, 1);
  assert.equal(harness.calls.stopASR, 0);
  assert.equal(shownErrors.length, 1);
  assert.equal(harness.trainer.asrEventState.activeSessionId, null);
});

test('pause during normal stop cannot suppress the flushed tail chunk', async (t) => {
  const flushStarted = createDeferred();
  const flushGate = createDeferred();
  const harness = await startAudioCaptureHarness(t, {
    captureStop() {
      flushStarted.resolve();
      return flushGate.promise;
    }
  });

  const stop = harness.trainer.stopRecording();
  await flushStarted.promise;
  harness.trainer.pauseRecording();
  assert.equal(harness.trainer.isPaused, false);
  await harness.handlers.onChunk({
    sessionId: harness.sessionId,
    sequence: 0,
    sampleRateHz: 16000,
    channels: 1,
    format: 'f32',
    frames: 17,
    samples: new Float32Array(17)
  });
  flushGate.resolve();
  await stop;

  assert.equal(harness.calls.feedAudio, 1);
  assert.equal(harness.calls.stopASR, 1);
});

test('an older session stop operation cannot mask stopping the active session', async (t) => {
  const harness = await startAudioCaptureHarness(t);
  const oldStop = createDeferred();
  harness.trainer.recordingStopOperation = {
    sessionId: 'old-session',
    feedTracker: null,
    promise: oldStop.promise
  };

  const activeStop = harness.trainer.stopRecording();
  assert.notEqual(activeStop, oldStop.promise);
  await activeStop;
  assert.equal(harness.calls.captureStop, 1);
  assert.equal(harness.calls.stopASR, 1);
  oldStop.resolve();
});

test('a successful first recording restores Start and Paste after normal stop', async (t) => {
  const harness = await startAudioCaptureHarness(t);

  await harness.trainer.stopRecording();

  assert.equal(harness.trainer.btnStart.disabled, false);
  assert.equal(harness.trainer.btnPaste.disabled, false);
  assert.equal(harness.trainer.btnStart.classList.contains('hidden'), false);
});

test('pasted analysis is single-flight while the first draft is pending', async (t) => {
  const analysis = createDeferred();
  let analysisCalls = 0;
  const testDocument = {
    activeElement: null,
    createTextNode: text => ({ textContent: text }),
    createElement(tagName) {
      const element = createElement(tagName);
      element.ownerDocument = testDocument;
      return element;
    }
  };
  global.document = testDocument;
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => { analysisCalls += 1; return analysis.promise; }
    }
  };
  t.after(() => {
    analysis.resolve({ totalWords: 2, fillers: [], hedges: [], vagueWords: [] });
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.fullText = '';
  trainer.pasteTextarea.value = '第一份。';
  trainer.requestRealtimeFeedback = () => {};
  const first = trainer.analyzePastedText();
  await new Promise(resolve => setImmediate(resolve));

  trainer.pasteTextarea.value = '第二份。';
  await trainer.analyzePastedText();

  assert.equal(analysisCalls, 1);
  assert.equal(trainer.fullText, '第一份。');
  analysis.resolve({ totalWords: 2, fillers: [], hedges: [], vagueWords: [] });
  await first;
});

test('clear invalidates ownership of an older pasted analysis', async (t) => {
  const analysis = createDeferred();
  const testDocument = {
    activeElement: null,
    createTextNode: text => ({ textContent: text }),
    createElement(tagName) {
      const element = createElement(tagName);
      element.ownerDocument = testDocument;
      return element;
    }
  };
  global.document = testDocument;
  global.window = {
    confirm: () => true,
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => analysis.promise
    }
  };
  t.after(() => {
    analysis.resolve({ totalWords: 99, fillers: [], hedges: [], vagueWords: [] });
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.fullText = '';
  trainer.pasteTextarea.value = '旧分析。';
  trainer.requestRealtimeFeedback = () => {};
  const pending = trainer.analyzePastedText();
  await new Promise(resolve => setImmediate(resolve));

  trainer.clearAll();
  analysis.resolve({ totalWords: 99, fillers: [], hedges: [], vagueWords: [] });
  await pending;

  assert.equal(trainer.fullText, '');
  assert.equal(trainer.stats.totalWords, 0);
  assert.equal(trainer.btnReport.classList.contains('hidden'), true);
});

test('all main modals share focus restore, Escape, and Tab trapping', () => {
  const opener = { focused: false, focus() { this.focused = true; } };
  const first = { focused: false, focus() { this.focused = true; } };
  const last = { focused: false, focus() { this.focused = true; } };
  const modal = createElement();
  modal.querySelectorAll = () => [first, last];
  global.document = { activeElement: opener };
  const trainer = createTrainer();

  trainer.openModal(modal, first);
  global.document.activeElement = last;
  let prevented = false;
  trainer.handleModalKeydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(first.focused, true);

  trainer.handleModalKeydown({ key: 'Escape', preventDefault() {} });
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(opener.focused, true);
  delete global.document;
});

test('copy rejection and saveFile success false are visible', async (t) => {
  const originalNavigator = global.navigator;
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error('denied'); } } }
  });
  global.window = { api: { saveFile: async () => ({ success: false, error: '磁盘不可写' }) } };
  t.after(() => {
    Object.defineProperty(global, 'navigator', { configurable: true, value: originalNavigator });
    delete global.window;
  });
  const messages = [];
  const trainer = createTrainer();
  trainer.showUserMessage = message => messages.push(message);

  await trainer.copyOriginalText();
  await trainer.saveOriginalText();

  assert.deepEqual(messages, ['复制失败，请重试', '未保存原文：磁盘不可写']);
});

test('first recording waits for policy acknowledgement before ASR or microphone startup', async (t) => {
  const acknowledgement = createDeferred();
  const order = [];
  const audio = createAudioCaptureFactoryFake({
    start: async () => {
      order.push('microphone');
      return { requestedSampleRateHz: 16000, contextSampleRateHz: 16000, trackSampleRateHz: 48000 };
    }
  });
  global.document = { createElement };
  global.window = {
    api: {
      getRecordingPolicy: async () => ({ acknowledged: false }),
      acknowledgeRecordingPolicy: async () => {
        order.push('ack');
        return { success: true, acknowledged: true };
      },
      cancelLLMRequests: async () => ({ success: true }),
      startASR: async ({ sessionId }) => {
        order.push('asr');
        return { ok: true, events: [{ type: 'ready', sessionId, sequence: 0 }] };
      }
    }
  };
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.fullText = '';
  trainer.recordingPolicyAcknowledged = false;
  trainer.audioCaptureFactory = audio.factory;
  trainer.waitForRecordingPolicyDecision = () => acknowledgement.promise;
  t.after(() => {
    acknowledgement.resolve(false);
    clearInterval(trainer.timerInterval);
    delete global.document;
    delete global.window;
  });

  const starting = trainer.startRecording();
  await flushMicrotasks();
  const beforeDecision = order.slice();
  acknowledgement.resolve(true);
  await starting;

  assert.deepEqual(beforeDecision, []);
  assert.deepEqual(order, ['ack', 'asr', 'microphone']);
});

test('captured PCM is appended before ASR enqueue and only accepted samples carry local audioEndMs', async () => {
  const order = [];
  const trainer = createTrainer();
  activateAsrSession(trainer);
  trainer.recordingPcm = {
    durationMs: 125,
    append(samples) {
      order.push(['append', Array.from(samples)]);
      return { acceptedFrames: 2, limitReached: false };
    }
  };
  trainer.recordingSessionId = 'session-a';
  trainer.audioFeedTracker = {
    sessionId: 'session-a',
    queue: {
      enqueue(item) {
        order.push(['enqueue', Array.from(item.samples), item.audioEndMs]);
        return true;
      }
    }
  };

  await trainer.handleCapturedChunk(audioChunk('session-a', new Float32Array([0.1, 0.2, 0.3])));

  assert.deepEqual(order, [
    ['append', [0.10000000149011612, 0.20000000298023224, 0.30000001192092896]],
    ['enqueue', [0.10000000149011612, 0.20000000298023224], 125]
  ]);
});

test('a delayed final uses the producing queue item audio end instead of later captured duration', async (t) => {
  const firstFeed = createDeferred();
  const feedCommands = [];
  global.window = {
    api: {
      feedAudio(command) {
        feedCommands.push(command);
        return feedCommands.length === 1 ? firstFeed.promise : Promise.resolve({ ok: true, events: [] });
      },
      analyzeText: async () => ({ totalWords: 2, fillers: [], hedges: [], vagueWords: [] })
    }
  };
  t.after(() => {
    firstFeed.resolve({ ok: true, events: [] });
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.fullText = '';
  trainer.sentences = [];
  trainer.pendingSegments = [];
  trainer.recordingSessionId = 'session-a';
  trainer.recordingPcm = fakeRecorder({ durationMs: 0 });
  activateAsrSession(trainer);
  trainer.audioFeedTracker = trainer.createAudioFeedTracker('session-a');

  void trainer.handleCapturedChunk(audioChunk('session-a', new Float32Array(16000)));
  await flushMicrotasks();
  void trainer.handleCapturedChunk({ ...audioChunk('session-a', new Float32Array(16000)), sequence: 1 });
  firstFeed.resolve({
    ok: true,
    events: [{ type: 'final', sessionId: 'session-a', sequence: 1, text: '第一段' }]
  });
  await trainer.audioFeedTracker.queue.drain();

  assert.equal(trainer.recordingPcm.durationMs, 2000);
  assert.equal(trainer.pendingSegments[0].endMs, 1000);
  assert.deepEqual(feedCommands.map(command => Object.keys(command).sort()), [
    ['samples', 'sequence', 'sessionId'],
    ['samples', 'sequence', 'sessionId']
  ]);
});

test('a chunk reaching the configured frame limit triggers one owned normal stop', async () => {
  const trainer = createTrainer();
  activateAsrSession(trainer);
  trainer.recordingSessionId = 'session-a';
  trainer.recordingPcm = createPcmWavRecorder({ sampleRateHz: 16000, maxFrames: 4 });
  trainer.recordingPcm.append(new Float32Array([0.1, 0.2]));
  trainer.audioFeedTracker = {
    sessionId: 'session-a',
    queue: {
      enqueue(item) {
        assert.equal(item.samples.length, 2);
        assert.equal(item.audioEndMs, 0.25);
        return true;
      }
    }
  };
  trainer.stopCalls = 0;
  trainer.stopRecording = async () => { trainer.stopCalls += 1; };

  await trainer.handleCapturedChunk(audioChunk('session-a', new Float32Array([0.3, 0.4, 0.5])));
  await flushTimers();

  assert.equal(trainer.stopCalls, 1);
  assert.equal(trainer.trainingStatus.textContent, '已达到20分钟上限，正在结束录音…');
});

test('normal stop creates and selects a complete WAV training record', async (t) => {
  const createdUrls = [];
  global.document = { createElement };
  global.window = {
    URL: {
      createObjectURL(blob) {
        assert.equal(blob.type, 'audio/wav');
        const url = `blob:${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      },
      revokeObjectURL() {}
    },
    api: {
      stopASR: async () => stopEnvelope('session-a', '完成文本'),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => ({ totalWords: 4, fillers: [], hedges: [], vagueWords: [] })
    }
  };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.fullText = '';
  trainer.sentences = [];
  activateAsrSession(trainer);
  trainer.beginRecordingBuffer('session-a');
  trainer.recordingPcm = fakeRecorder({ durationMs: 1500 });

  await trainer.stopRecording();

  const record = trainer.trainingRecords.selected();
  assert.equal(createdUrls.length, 1);
  assert.equal(record.audioUrl, 'blob:1');
  assert.equal(record.durationMs, 1500);
  assert.equal(record.fullText, '完成文本');
  assert.equal(record.playbackAnalysis, null);
  assert.equal(record.segments[0].endMs, 1500);
  assert.equal(record.segments[0].localAnalysis.totalWords, 4);
  assert.equal(trainer.viewingTrainingRecordId, record.id);
});

test('failed record insertion revokes its newly-created URL exactly once', (t) => {
  const revoked = [];
  global.document = { createElement };
  global.window = {
    URL: {
      createObjectURL: () => 'blob:failed',
      revokeObjectURL: url => revoked.push(url)
    },
    api: { cancelLLMRequests: async () => ({ success: true }) }
  };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.showUserMessage = () => {};
  trainer.trainingRecords = {
    add() { throw new Error('store unavailable'); },
    clear() {}
  };
  trainer.beginRecordingBuffer('session-failed');
  trainer.recordingPcm = fakeRecorder({ durationMs: 500 });

  assert.equal(trainer.finalizeTrainingRecord(), null);
  trainer.disposeTrainingRecords();

  assert.deepEqual(revoked, ['blob:failed']);
  assert.equal(trainer.recordingPcm, null);
});

test('six completed renderer records retain five and revoke the first URL once', (t) => {
  const revoked = [];
  let nextUrl = 0;
  global.document = { createElement };
  global.window = {
    URL: {
      createObjectURL: () => `blob:${++nextUrl}`,
      revokeObjectURL: url => revoked.push(url)
    },
    api: { cancelLLMRequests: async () => ({ success: true }) }
  };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.trainingRecords = createTrainingRecordStore({
    maxRecords: 5,
    revokeObjectURL: global.window.URL.revokeObjectURL
  });
  for (let index = 1; index <= 6; index += 1) {
    trainer.beginRecordingBuffer(`session-${index}`);
    trainer.recordingPcm = fakeRecorder({ durationMs: index * 1000 });
    trainer.fullText = `文本${index}`;
    trainer.pendingSegments = [];
    trainer.finalizeTrainingRecord();
  }

  assert.deepEqual(trainer.trainingRecords.list().map(record => record.audioUrl), [
    'blob:2', 'blob:3', 'blob:4', 'blob:5', 'blob:6'
  ]);
  assert.deepEqual(revoked, ['blob:1']);
});

test('failed microphone startup preserves completed records without replacement confirmation', async (t) => {
  const record = {
    id: 'record-existing', createdAt: new Date().toISOString(), durationMs: 1000,
    audioUrl: 'blob:existing', segments: [], stats: {}, fullText: '已完成内容', playbackAnalysis: null
  };
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.trainingRecords = createTrainingRecordStore();
  trainer.trainingRecords.add(record);
  trainer.viewingTrainingRecordId = record.id;
  trainer.fullText = record.fullText;
  trainer.audioCaptureFactory = createAudioCaptureFactoryFake({
    start: async () => { throw new Error('permission denied'); }
  }).factory;
  global.document = { createElement };
  global.window = {
    confirm: () => assert.fail('completed records must not use replacement confirmation'),
    api: {
      getRecordingPolicy: async () => ({ acknowledged: true }),
      cancelLLMRequests: async () => ({ success: true }),
      startASR: async ({ sessionId }) => ({ ok: true, events: [{ type: 'ready', sessionId, sequence: 0 }] }),
      cancelASR: async () => ({ ok: true, events: [] })
    }
  };
  t.after(() => {
    delete global.document;
    delete global.window;
  });

  await trainer.startRecording();

  assert.deepEqual(trainer.trainingRecords.list(), [record]);
  assert.equal(trainer.trainingRecords.selected(), record);
  assert.equal(trainer.viewingTrainingRecordId, record.id);
  assert.equal(trainer.fullText, '已完成内容');
});

test('clear in completed-record mode removes only the selected record and revokes its URL once', (t) => {
  const revoked = [];
  global.document = { createElement };
  global.window = { api: { cancelLLMRequests: async () => ({ success: true }) } };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.trainingRecords = createTrainingRecordStore({ revokeObjectURL: url => revoked.push(url) });
  trainer.trainingRecords.add({ id: 'r1', audioUrl: 'blob:1', fullText: '一', segments: [], stats: {}, durationMs: 1, createdAt: new Date().toISOString() });
  trainer.trainingRecords.add({ id: 'r2', audioUrl: 'blob:2', fullText: '二', segments: [], stats: {}, durationMs: 1, createdAt: new Date().toISOString() });
  trainer.selectTrainingRecord('r1');

  assert.equal(trainer.clearAll(), true);
  assert.deepEqual(trainer.trainingRecords.list().map(record => record.id), ['r2']);
  assert.deepEqual(revoked, ['blob:1']);
  assert.equal(trainer.viewingTrainingRecordId, 'r2');
});

function retainedRecord(number) {
  return {
    id: `retained-${number}`,
    createdAt: `2026-09-01T0${number}:00:00.000Z`,
    durationMs: number * 1000,
    audioUrl: `blob:retained-${number}`,
    segments: [{
      id: 'segment-1', text: `记录${number}`, startMs: 0, endMs: number * 1000, localAnalysis: null
    }],
    stats: { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 3, duration: number },
    fullText: `记录${number}`,
    playbackAnalysis: null
  };
}

function preloadFiveRetainedRecords(trainer, revoked) {
  trainer.trainingRecords = createTrainingRecordStore({ revokeObjectURL: url => revoked.push(url) });
  for (let number = 1; number <= 5; number += 1) {
    trainer.trainingRecords.add(retainedRecord(number));
  }
  return trainer.trainingRecords.list().map(record => ({ id: record.id, audioUrl: record.audioUrl }));
}

for (const failure of [
  {
    name: 'rejection',
    stopASR: async () => { throw new Error('tail transport unavailable'); },
    expectedError: '语音识别停止失败: tail transport unavailable'
  },
  {
    name: 'unsuccessful envelope',
    stopASR: async () => ({
      ok: false,
      error: { code: 'asr-stop-failed', message: 'sanitized tail failure' }
    }),
    expectedError: '语音识别停止失败: sanitized tail failure'
  }
]) {
  test(`ASR stop ${failure.name} discards the active buffer without evicting retained records`, async (t) => {
    const revoked = [];
    const created = [];
    const shownErrors = [];
    const harness = await startAudioCaptureHarness(t, { stopASR: failure.stopASR });
    harness.trainer.showError = message => shownErrors.push(message);
    window.URL = {
      createObjectURL(blob) {
        created.push(blob);
        return 'blob:must-not-exist';
      },
      revokeObjectURL: url => revoked.push(url)
    };
    const before = preloadFiveRetainedRecords(harness.trainer, revoked);

    await harness.trainer.stopRecording();

    assert.deepEqual(
      harness.trainer.trainingRecords.list().map(record => ({ id: record.id, audioUrl: record.audioUrl })),
      before
    );
    assert.deepEqual(created, []);
    assert.deepEqual(revoked, []);
    assert.equal(harness.trainer.viewingTrainingRecordId, 'retained-5');
    assert.equal(harness.trainer.recordingPcm, null);
    assert.ok(shownErrors.includes(failure.expectedError));
    assert.notEqual(harness.trainer.trainingStatus.textContent, '本次训练已结束');
  });
}

test('missing recording policy capability fails closed before ASR or microphone startup', async (t) => {
  const order = [];
  const audio = createAudioCaptureFactoryFake({
    start: async () => { order.push('microphone'); }
  });
  global.document = { createElement };
  global.window = {
    api: {
      cancelLLMRequests: async () => ({ success: true }),
      startASR: async ({ sessionId }) => {
        order.push('asr');
        return { ok: true, events: [{ type: 'ready', sessionId, sequence: 0 }] };
      }
    }
  };
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.fullText = '';
  trainer.recordingPolicyAcknowledged = false;
  trainer.audioCaptureFactory = audio.factory;
  t.after(() => {
    clearInterval(trainer.timerInterval);
    delete global.document;
    delete global.window;
  });

  await trainer.startRecording();

  assert.deepEqual(order, []);
  assert.equal(trainer.isRecording, false);
});

test('recording policy persistence failure fails closed before ASR or microphone startup', async (t) => {
  const order = [];
  const audio = createAudioCaptureFactoryFake({
    start: async () => { order.push('microphone'); }
  });
  global.document = { createElement };
  global.window = {
    api: {
      getRecordingPolicy: async () => ({ acknowledged: false }),
      acknowledgeRecordingPolicy: async () => ({
        success: false,
        acknowledged: false,
        error: 'policy save unavailable'
      }),
      cancelLLMRequests: async () => ({ success: true }),
      startASR: async ({ sessionId }) => {
        order.push('asr');
        return { ok: true, events: [{ type: 'ready', sessionId, sequence: 0 }] };
      }
    }
  };
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.fullText = '';
  trainer.recordingPolicyAcknowledged = false;
  trainer.audioCaptureFactory = audio.factory;
  trainer.waitForRecordingPolicyDecision = async () => true;
  t.after(() => {
    clearInterval(trainer.timerInterval);
    delete global.document;
    delete global.window;
  });

  await trainer.startRecording();

  assert.deepEqual(order, []);
  assert.equal(trainer.isRecording, false);
  assert.equal(trainer.userMessageText.textContent, '无法开始录制：policy save unavailable');
});

test('limit overrun failure invalidates ownership before deferred normal stop can run', async (t) => {
  const firstFeed = createDeferred();
  const shownErrors = [];
  const cancelCommands = [];
  global.window = {
    api: {
      feedAudio: () => firstFeed.promise,
      cancelASR(command) {
        cancelCommands.push(command);
        return Promise.resolve({ ok: true, events: [] });
      }
    }
  };
  t.after(() => {
    firstFeed.resolve({ ok: true, events: [] });
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.fullText = '';
  trainer.sentences = [];
  trainer.showError = message => shownErrors.push(message);
  activateAsrSession(trainer);
  trainer.recordingSessionId = 'session-a';
  trainer.recordingPcm = createPcmWavRecorder({ sampleRateHz: 16000, maxFrames: 4 });
  trainer.recordingPcm.append(new Float32Array([0.1, 0.2]));
  trainer.audioFeedTracker = trainer.createAudioFeedTracker('session-a');
  for (let sequence = 0; sequence < 10; sequence += 1) {
    trainer.audioFeedTracker.queue.enqueue({
      sequence,
      samples: new Float32Array([0.1]),
      audioEndMs: sequence + 1
    });
  }
  let normalStopCalls = 0;
  trainer.stopRecording = () => {
    normalStopCalls += 1;
    trainer.trainingStatus.textContent = '本次训练已结束';
    return Promise.resolve();
  };

  await trainer.handleCapturedChunk({
    ...audioChunk('session-a', new Float32Array([0.3, 0.4, 0.5])),
    sequence: 10
  });
  await flushMicrotasks();
  await flushMicrotasks();
  await flushTimers();

  assert.equal(normalStopCalls, 0);
  assert.deepEqual(cancelCommands, [{ sessionId: 'session-a' }]);
  assert.deepEqual(shownErrors, ['语音识别处理失败，录音已停止，请重新开始']);
  assert.equal(trainer.asrEventState.activeSessionId, null);
  assert.equal(trainer.recordingPcm, null);
  assert.notEqual(trainer.trainingStatus.textContent, '本次训练已结束');
});

test('stopRecording is an inert no-op without an active owned session', async (t) => {
  global.document = { createElement };
  global.window = { api: { cancelLLMRequests: async () => ({ success: true }) } };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.isRecording = false;
  trainer.trainingStatus.textContent = '准备就绪';

  const result = await trainer.stopRecording();

  assert.equal(result, false);
  assert.equal(trainer.recordingStopOperation, null);
  assert.equal(trainer.trainingStatus.textContent, '准备就绪');
});

test('stopRecording is inert while ASR is active but the recording buffer is not owned yet', async (t) => {
  let stopCalls = 0;
  global.document = { createElement };
  global.window = {
    api: {
      stopASR: async () => { stopCalls += 1; return stopEnvelope('session-a', ''); },
      cancelLLMRequests: async () => ({ success: true })
    }
  };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();
  trainer.isRecording = false;
  activateAsrSession(trainer);
  trainer.recordingSessionId = null;
  trainer.recordingPcm = null;
  trainer.trainingStatus.textContent = '正在准备语音识别，首次运行可能需要数分钟';

  const result = await trainer.stopRecording();

  assert.equal(result, false);
  assert.equal(stopCalls, 0);
  assert.equal(trainer.recordingStopOperation, null);
  assert.equal(trainer.trainingStatus.textContent, '正在准备语音识别，首次运行可能需要数分钟');
});

test('limit chunk feed rejection wins before its deferred normal stop', async (t) => {
  const cancelCommands = [];
  const stopCommands = [];
  const shownErrors = [];
  global.window = {
    api: {
      feedAudio: async () => { throw new Error('same-chunk feed rejected'); },
      cancelASR(command) {
        cancelCommands.push(command);
        return Promise.resolve({ ok: true, events: [] });
      },
      stopASR(command) {
        stopCommands.push(command);
        return Promise.resolve(stopEnvelope(command.sessionId, 'must not finalize'));
      }
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();
  trainer.fullText = '';
  trainer.sentences = [];
  trainer.showError = message => shownErrors.push(message);
  activateAsrSession(trainer);
  trainer.recordingSessionId = 'session-a';
  trainer.recordingPcm = createPcmWavRecorder({ sampleRateHz: 16000, maxFrames: 4 });
  trainer.recordingPcm.append(new Float32Array([0.1, 0.2]));
  trainer.audioFeedTracker = trainer.createAudioFeedTracker('session-a');
  const originalStopRecording = trainer.stopRecording.bind(trainer);
  let normalStopCalls = 0;
  trainer.stopRecording = () => {
    normalStopCalls += 1;
    return originalStopRecording();
  };

  await trainer.handleCapturedChunk({
    ...audioChunk('session-a', new Float32Array([0.3, 0.4, 0.5])),
    sequence: 0
  });
  await flushMicrotasks();
  await flushMicrotasks();
  await flushTimers();

  assert.equal(normalStopCalls, 0);
  assert.deepEqual(cancelCommands, [{ sessionId: 'session-a' }]);
  assert.deepEqual(stopCommands, []);
  assert.deepEqual(shownErrors, ['语音识别处理失败，录音已停止，请重新开始']);
  assert.equal(trainer.recordingPcm, null);
  assert.equal(trainer.trainingRecords, undefined);
  assert.notEqual(trainer.trainingStatus.textContent, '本次训练已结束');
});
