const test = require('node:test');
const assert = require('node:assert/strict');

global.document = { addEventListener() {} };
const { mergeFinalText, ExpressionTrainer } = require('../src/app');
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
    replaceChildren() {}
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
      stopASR: async () => ({ success: true, finalText: '尾部文本' }),
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
      stopASR: async () => ({ success: true, finalText: '尾部文本' }),
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
      stopASR: async () => ({ success: true, finalText: '尾部文本' }),
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
      stopASR: async () => ({ success: true, finalText: '尾部文本' }),
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
      stopASR: async () => ({ success: true, finalText: ' \n\t ' }),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => {
        throw new Error('blank final text must not be analyzed');
      }
    }
  };
  t.after(() => { delete global.window; });
  const trainer = createTrainer();

  await trainer.stopRecording();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(trainer.fullText, '已经确认');
  assert.deepEqual(trainer.sentences, ['已经确认']);
  assert.equal(trainer.stats.totalWords, 4);
});
