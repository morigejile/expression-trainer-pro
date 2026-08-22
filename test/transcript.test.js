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
  global.document = { createElement };
  global.window = {
    api: {
      stopASR: async () => ({ success: true, finalText: '尾部文本' }),
      cancelLLMRequests: async () => ({ success: true }),
      analyzeText: async () => ({
        totalWords: 4,
        fillers: [],
        hedges: [],
        vagueWords: []
      }),
      getFinalReport: async (payload) => {
        reportPayload = payload;
        return { success: false, error: 'offline test double' };
      }
    }
  };
  t.after(() => {
    delete global.document;
    delete global.window;
  });
  const trainer = createTrainer();

  await trainer.stopRecording();
  await new Promise(resolve => setImmediate(resolve));
  await trainer.generateReport();

  assert.equal(trainer.fullText, '已经确认尾部文本');
  assert.deepEqual(trainer.sentences, ['已经确认', '尾部文本']);
  assert.equal(trainer.stats.totalWords, 8);
  assert.equal(reportPayload.fullText, '已经确认尾部文本');
  assert.equal(reportPayload.stats.totalWords, 8);
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
