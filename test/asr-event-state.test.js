const test = require('node:test');
const assert = require('node:assert/strict');

const {
  beginAsrSession,
  createAsrEventState,
  filterAsrEvent,
  invalidateAsrSession
} = require('../src/asr-event-state');

function consume(state, event) {
  return filterAsrEvent(state, event);
}

test('matching monotonic partial and final events map to transcript results', () => {
  let state = beginAsrSession(createAsrEventState(), 'session-a');

  let filtered = consume(state, {
    type: 'ready',
    sessionId: 'session-a',
    sequence: 0
  });
  state = filtered.state;
  assert.deepEqual(filtered.effect, { type: 'ready' });

  filtered = consume(state, {
    type: 'partial',
    sessionId: 'session-a',
    sequence: 1,
    text: '草稿'
  });
  state = filtered.state;
  assert.deepEqual(filtered.effect, {
    type: 'result',
    result: { text: '草稿', isFinal: false }
  });

  filtered = consume(state, {
    type: 'final',
    sessionId: 'session-a',
    sequence: 2,
    text: '定稿'
  });
  assert.deepEqual(filtered.effect, {
    type: 'result',
    result: { text: '定稿', isFinal: true }
  });
  assert.deepEqual(filtered.state, {
    activeSessionId: 'session-a',
    lastEventSequence: 2
  });
});

test('stale, duplicate, and non-monotonic events are ignored without advancing state', () => {
  let state = beginAsrSession(createAsrEventState(), 'session-a');
  state = consume(state, {
    type: 'ready', sessionId: 'session-a', sequence: 0
  }).state;
  state = consume(state, {
    type: 'partial', sessionId: 'session-a', sequence: 3, text: '最新'
  }).state;

  for (const event of [
    { type: 'final', sessionId: 'session-old', sequence: 4, text: '旧会话' },
    { type: 'final', sessionId: 'session-a', sequence: 3, text: '重复' },
    { type: 'partial', sessionId: 'session-a', sequence: 2, text: '倒序' }
  ]) {
    const filtered = consume(state, event);
    assert.equal(filtered.effect, null);
    assert.equal(filtered.state, state);
  }
});

test('error is displayable text and stopped completes the active lifecycle', () => {
  let state = beginAsrSession(createAsrEventState(), 'session-a');
  let filtered = consume(state, {
    type: 'error',
    sessionId: 'session-a',
    sequence: 0,
    code: 'decode-failed',
    message: '<img src=x onerror=evil()>解码失败'
  });
  state = filtered.state;
  assert.deepEqual(filtered.effect, {
    type: 'error',
    code: 'decode-failed',
    message: '<img src=x onerror=evil()>解码失败'
  });

  filtered = consume(state, {
    type: 'stopped',
    sessionId: 'session-a',
    sequence: 1
  });
  assert.deepEqual(filtered.effect, { type: 'stopped' });
  assert.deepEqual(filtered.state, createAsrEventState());

  filtered = consume(filtered.state, {
    type: 'final',
    sessionId: 'session-a',
    sequence: 2,
    text: '迟到文本'
  });
  assert.equal(filtered.effect, null);
});

test('clear and replacement sessions invalidate all earlier-session events', () => {
  const initial = beginAsrSession(createAsrEventState(), 'session-a');
  const cleared = invalidateAsrSession(initial);
  assert.equal(consume(cleared, {
    type: 'final', sessionId: 'session-a', sequence: 0, text: '清空后迟到'
  }).effect, null);

  const replacement = beginAsrSession(initial, 'session-b');
  assert.equal(consume(replacement, {
    type: 'final', sessionId: 'session-a', sequence: 0, text: '旧会话迟到'
  }).effect, null);
  assert.deepEqual(consume(replacement, {
    type: 'partial', sessionId: 'session-b', sequence: 0, text: '新会话'
  }).effect, {
    type: 'result',
    result: { text: '新会话', isFinal: false }
  });
});
