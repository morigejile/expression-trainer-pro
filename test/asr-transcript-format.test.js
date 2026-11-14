'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {formatChineseNumbers, createTranscriptFormatter, withFormattedAsrFinals} = require('../lib/asr-transcript-format');

test('formats exact Chinese quantities, decimals, percentages and years', () => {
  const cases = [
    ['宽度六英里，深度一百英尺，年龄十一岁', '宽度6英里，深度100英尺，年龄11岁'],
    ['二零二六年十一月十四日，温度负三点一四度', '2026年11月14日，温度-3.14度'],
    ['成功率百分之九十九点五，收费一万零二十五元', '成功率99.5%，收费10025元'],
    ['一千零二十元，两百元，两万三千元，零元', '1020元，200元，23000元，0元'],
    ['到场三个人，已经做了三次，读数是零点零五', '到场3个人，已经做了3次，读数是0.05'],
    ['运了一百零二千克，走了十千米', '运了102千克，走了10千米'],
    ['允许误差正负三点五度', '允许误差±3.5度']
  ];
  for (const [input, expected] of cases) assert.equal(formatChineseNumbers(input), expected, input);
});

test('leaves approximate figures, idioms, ambiguous time and existing digits intact', () => {
  const text = '我我觉得嗯一起出发一个劲地说一心一意，十三四岁、三五天、十几岁、几十块钱、一百二元、一百多元、百分之三十多；三点五分，单号零零一二，十二生肖，一元化，已经有6英里和3.14米。';
  assert.equal(formatChineseNumbers(text), text);
  assert.equal(formatChineseNumbers('2千元，百分之九十5，五点三十分，百分之一百一'), '2千元，百分之九十5，五点三十分，百分之一百一');
  assert.equal(formatChineseNumbers('一点一滴记下来，三点五我们开会，我十分感谢'), '一点一滴记下来，三点五我们开会，我十分感谢');
  assert.equal(formatChineseNumbers('他们是一条心，我一年级了，开始三次元建模，做事一条一条来，使用一键三连'), '他们是一条心，我一年级了，开始三次元建模，做事一条一条来，使用一键三连');
  assert.equal(formatChineseNumbers('六个多月，七岁左右，二十来公里，十多万个人'), '六个多月，七岁左右，二十来公里，十多万个人');
  assert.equal(formatChineseNumbers('昨晚十一点零五秒表停了，市场增长百分之二十七成'), '昨晚十一点零五秒表停了，市场增长百分之二十七成');
  assert.equal(formatChineseNumbers('放在百分之三十六吨的那一栏'), '放在百分之三十六吨的那一栏');
});

function modelFixture({getActive, install, addPunct, canDownload, reportError} = {}) {
  return createTranscriptFormatter({
    manager: {getActive, install}, canDownload, reportError,
    loadSherpa: () => ({OfflinePunctuation: class {
      constructor({model}) { assert.equal(model.ctTransformer, 'verified.onnx'); }
      addPunct(text) { return addPunct(text); }
    }})
  });
}

const active = {files: [{role: 'model', path: 'verified.onnx'}]};

test('adds punctuation with the verified cached model and falls back if it edits words', async () => {
  let output = '我我觉得嗯，宽度可达六英里。';
  const formatter = modelFixture({getActive: async () => active, install: assert.fail, addPunct: () => output});
  await formatter.prepare();
  assert.equal(formatter.format('我我觉得嗯宽度可达六英里'), '我我觉得嗯，宽度可达6英里。');
  output = '我觉得宽度可达六英里。';
  assert.equal(formatter.format('我我觉得嗯宽度可达六英里'), '我我觉得嗯宽度可达6英里');
  output = '宽度3，.14英里。';
  assert.equal(formatter.format('宽度3.14英里'), '宽度3.14英里');
});

test('missing model downloads in the background, deduplicates and retries after failure', async () => {
  let release;
  let installs = 0;
  const failures = [];
  const formatter = modelFixture({
    getActive: async () => null,
    install: async () => {
      installs += 1;
      if (installs === 1) throw new Error('offline');
      return new Promise(resolve => { release = resolve; });
    },
    reportError: error => failures.push(error.message),
    addPunct: text => `${text}。`
  });
  await formatter.prepare();
  await new Promise(setImmediate);
  assert.deepEqual(failures, ['offline']);
  await Promise.all([formatter.prepare(), formatter.prepare()]);
  assert.equal(installs, 2);
  assert.equal(formatter.format('六英里'), '6英里');
  release(active);
  await new Promise(setImmediate);
  assert.equal(formatter.format('六英里'), '6英里。');
});

test('offline preparation skips the download and dispose aborts an outstanding install', async () => {
  const offline = modelFixture({getActive: async () => null, install: assert.fail, canDownload: false});
  await offline.prepare();
  assert.equal(offline.format('六英里'), '6英里');
  let signal;
  const online = modelFixture({getActive: async () => null, install: async (_id, options) => {
    signal = options.signal;
    await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
  }});
  await online.prepare();
  await online.dispose();
  assert.equal(signal.aborted, true);
});

test('formats endpoint and stop finals while preserving partials and event metadata', async () => {
  const partial = {type: 'partial', text: '六英里', sequence: 1};
  const endpoint = {type: 'final', text: '六英里', sequence: 2, acceptedSampleEnd: 16000};
  const tail = {type: 'final', text: '一百英尺', sequence: 3, timingSource: 'unavailable'};
  const stopped = {type: 'stopped', sequence: 4};
  let feed = partial;
  const provider = withFormattedAsrFinals({
    async initialize() {}, async start() {}, async feed() { return feed; },
    async stop() { return [tail, stopped]; }, async cancel() { return [stopped]; }, async dispose() {}
  }, modelFixture({getActive: async () => active, addPunct: text => `${text}。`}));
  await provider.initialize();
  await provider.start({sessionId: 's'});
  assert.equal(await provider.feed(), partial);
  feed = endpoint;
  assert.deepEqual(await provider.feed(), {...endpoint, text: '6英里。'});
  assert.deepEqual(await provider.stop(), [{...tail, text: '100英尺。'}, stopped]);
  assert.deepEqual(await provider.cancel(), [stopped]);
});
