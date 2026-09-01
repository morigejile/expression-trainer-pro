const test = require('node:test');
const assert = require('node:assert/strict');

const {getReportPrompt} = require('../lib/prompts');

test('report prompt requests one personalized encouragement instead of the fixed mascot greeting', () => {
  const prompt = getReportPrompt('我介绍了新项目的进展和风险。', {
    duration: 30,
    totalWords: 15,
    fillers: 0,
    hedges: 0,
    vagueWords: 0
  });

  assert.doesNotMatch(prompt.system, /宇宙无敌少女收到你的/);
  assert.match(prompt.system, /个性化鼓励彩蛋/);
  assert.match(prompt.system, /15.{0,6}35个中文字符/);
  assert.match(prompt.system, /第一行/);
});
