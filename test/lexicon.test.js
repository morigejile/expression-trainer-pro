const { before, test } = require('node:test');
const assert = require('node:assert/strict');

const { loadLexicon, analyzeText, FILLER_WORDS } = require('../lib/lexicon');

before(() => {
  loadLexicon();
});

test('empty input produces no analysis', () => {
  for (const input of [undefined, null, '', ' \t\n']) {
    assert.equal(analyzeText(input), null);
  }
});

test('recognized phrases are classified at token positions', () => {
  const result = analyzeText('嗯我觉得这个方案很好');

  assert.equal(result.totalWords, 6);
  assert.deepEqual(result.fillers, [
    { word: '嗯', position: 0 },
    { word: '这个', position: 2 }
  ]);
  assert.deepEqual(result.hedges, [
    { word: '我觉得', position: 1 }
  ]);
  assert.deepEqual(result.vagueWords, [
    {
      word: '很好',
      position: 5,
      alternatives: ['出色', '精彩', '优秀', '惊艳', '完美', '理想']
    }
  ]);
});

test('emotion words include deterministic lexicon metadata', () => {
  const result = analyzeText('欣喜');

  assert.deepEqual(result.emotionWords, [
    {
      word: '欣喜',
      position: 0,
      category: '喜',
      subcategory: 'PA',
      intensity: 8,
      polarity: 'positive'
    }
  ]);
});

test('density reflects filler and hedge token ratios', () => {
  const cases = [
    { input: '今天天气晴', totalWords: 5, density: 100 },
    { input: '嗯我觉得这个方案很好', totalWords: 6, density: 50 },
    { input: '嗯然后就是', totalWords: 3, density: 0 }
  ];

  for (const { input, totalWords, density } of cases) {
    const result = analyzeText(input);
    assert.equal(result.totalWords, totalWords, input);
    assert.equal(result.density, density, input);
  }
});

test('suggestions follow vague-word and repetition thresholds', () => {
  const cases = [
    { input: '嗯然后', suggestions: [] },
    { input: '我觉得', suggestions: [] },
    {
      input: '很好',
      suggestions: [
        {
          type: 'vague',
          original: '很好',
          alternatives: ['出色', '精彩', '优秀'],
          message: '「很好」→ 试试更精准的：出色、精彩、优秀'
        }
      ]
    },
    {
      input: '嗯然后就是',
      suggestions: [
        {
          type: 'filler',
          message: '填充词偏多（3次）：嗯、然后、就是。试试用停顿替代'
        }
      ]
    },
    {
      input: '我觉得可能',
      suggestions: [
        {
          type: 'hedge',
          message: '犹豫表达较多（2次）。试试把「我觉得」改成直接陈述'
        }
      ]
    }
  ];

  for (const { input, suggestions } of cases) {
    assert.deepEqual(analyzeText(input).suggestions, suggestions, input);
  }
});

test('custom words participate in local filler statistics without changing global rules', () => {
  const result = analyzeText('这个属于是确实不错', {extraFillers: ['属于是', '确实', '属于是']});

  assert.deepEqual(result.fillers.map(({word}) => word), ['这个', '属于是', '确实']);
  assert.equal(FILLER_WORDS.includes('属于是'), false);
});
