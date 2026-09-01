const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createRequestCoordinator,
  runCoordinatedRequest,
  sendFeedback,
  sendReport,
  sendPlaybackAnalysis,
  testConnection
} = require('../lib/ai-feedback');

const OPENAI_SETTINGS = {
  provider: 'openai',
  apiKey: 'sk-test-secret',
  model: 'gpt-test'
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error('unexpected global fetch in fake-fetch test');
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}

function abortableFetch() {
  return async (url, options) => new Promise((resolve, reject) => {
    const rejectAborted = () => {
      const error = new Error('fetch aborted');
      error.name = 'AbortError';
      reject(error);
    };

    if (options.signal.aborted) {
      rejectAborted();
      return;
    }

    options.signal.addEventListener('abort', rejectAborted, { once: true });
  });
}

test('successful feedback passes an AbortSignal and returns content', async () => {
  let receivedSignal;
  const fetchImpl = async (url, options) => {
    receivedSignal = options.signal;
    return jsonResponse({
      choices: [{ message: { content: '说结论' } }]
    });
  };

  const feedback = await sendFeedback('这是一段待分析的表达', OPENAI_SETTINGS, null, {
    fetchImpl,
    timeoutMs: 50
  });

  assert.equal(feedback, '说结论');
  assert.equal(receivedSignal instanceof AbortSignal, true);
});

test('missing API key fails before any network request', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return jsonResponse({ choices: [{ message: { content: 'unexpected' } }] });
  };

  await assert.rejects(
    sendFeedback('文本', { ...OPENAI_SETTINGS, apiKey: '' }, null, { fetchImpl }),
    { message: '请先配置 API Key' }
  );
  assert.equal(called, false);
});

test('rate limiting produces a stable error without exposing response data', async () => {
  const sensitiveBody = `Authorization: Bearer ${OPENAI_SETTINGS.apiKey}`;
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    async json() {
      return { error: sensitiveBody };
    },
    async text() {
      return sensitiveBody;
    }
  });

  await assert.rejects(
    sendFeedback('文本', OPENAI_SETTINGS, null, { fetchImpl }),
    (error) => {
      assert.equal(error.message, '大模型请求过于频繁，请稍后重试');
      assert.equal(error.message.includes(OPENAI_SETTINGS.apiKey), false);
      assert.equal(error.message.includes('Authorization'), false);
      return true;
    }
  );
});

test('other HTTP failures expose only the status code', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 503,
    async text() {
      return `upstream secret ${OPENAI_SETTINGS.apiKey}`;
    }
  });

  await assert.rejects(
    sendFeedback('文本', OPENAI_SETTINGS, null, { fetchImpl }),
    { message: '大模型服务请求失败（HTTP 503）' }
  );
});

test('invalid JSON produces a stable error', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      throw new SyntaxError(`bad payload ${OPENAI_SETTINGS.apiKey}`);
    }
  });

  await assert.rejects(
    sendFeedback('文本', OPENAI_SETTINGS, null, { fetchImpl }),
    { message: '大模型返回了无效 JSON' }
  );
});

test('timeout while reading JSON reports timeout instead of invalid JSON', async () => {
  const fetchImpl = async (url, options) => ({
    ok: true,
    status: 200,
    async json() {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('body read aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
  });

  await assert.rejects(
    sendFeedback('文本', OPENAI_SETTINGS, null, { fetchImpl, timeoutMs: 5 }),
    { message: '大模型请求超时，请稍后重试' }
  );
});

test('cancellation while reading JSON reports cancellation instead of invalid JSON', async () => {
  const controller = new AbortController();
  let bodyReadStarted;
  const readingBody = new Promise((resolve) => {
    bodyReadStarted = resolve;
  });
  const fetchImpl = async (url, options) => ({
    ok: true,
    status: 200,
    async json() {
      bodyReadStarted();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('body read aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
  });

  const request = sendFeedback('文本', OPENAI_SETTINGS, null, {
    fetchImpl,
    timeoutMs: 1000,
    signal: controller.signal
  });
  await readingBody;
  controller.abort();

  await assert.rejects(request, { message: '大模型请求已取消' });
});

for (const [name, payload] of [
  ['missing choices', {}],
  ['empty choices', { choices: [] }],
  ['missing message', { choices: [{}] }],
  ['missing content', { choices: [{ message: {} }] }],
  ['non-string content', { choices: [{ message: { content: 42 } }] }]
]) {
  test(`${name} produces a stable invalid-response error`, async () => {
    const fetchImpl = async () => jsonResponse(payload);

    await assert.rejects(
      sendFeedback('文本', OPENAI_SETTINGS, null, { fetchImpl }),
      { message: '大模型响应结构无效' }
    );
  });
}

test('timeout aborts the fetch and reports a stable timeout error', async () => {
  await assert.rejects(
    sendFeedback('文本', OPENAI_SETTINGS, null, {
      fetchImpl: abortableFetch(),
      timeoutMs: 10
    }),
    { message: '大模型请求超时，请稍后重试' }
  );
});

test('external cancellation aborts the fetch and reports cancellation', async () => {
  const controller = new AbortController();
  const request = sendFeedback('文本', OPENAI_SETTINGS, null, {
    fetchImpl: abortableFetch(),
    timeoutMs: 1000,
    signal: controller.signal
  });

  controller.abort();

  await assert.rejects(request, { message: '大模型请求已取消' });
});

test('timeout suppresses a late success from a fetch that ignores abort', async () => {
  const fetchImpl = async () => new Promise((resolve) => {
    setTimeout(() => {
      resolve(jsonResponse({ choices: [{ message: { content: '迟到成功' } }] }));
    }, 20);
  });

  await assert.rejects(
    sendFeedback('文本', OPENAI_SETTINGS, null, { fetchImpl, timeoutMs: 5 }),
    { message: '大模型请求超时，请稍后重试' }
  );
});

test('connection cancellation suppresses a late success from a fetch that ignores abort', async () => {
  const controller = new AbortController();
  let resolveFetch;
  const pending = testConnection(OPENAI_SETTINGS, {
    signal: controller.signal,
    timeoutMs: 1000,
    fetchImpl: async () => new Promise((resolve) => {
      resolveFetch = resolve;
    })
  });

  controller.abort();
  resolveFetch(jsonResponse({ choices: [{ message: { content: 'OK' } }] }));

  assert.deepEqual(await pending, {
    success: false,
    error: '大模型请求已取消',
    errorCode: 'cancelled'
  });
});

test('unknown fetch errors are generalized without leaking credentials', async () => {
  const fetchImpl = async () => {
    throw new Error(`Authorization: Bearer ${OPENAI_SETTINGS.apiKey}; full sensitive body`);
  };

  await assert.rejects(
    sendFeedback('文本', OPENAI_SETTINGS, null, { fetchImpl }),
    (error) => {
      assert.equal(error.message, '无法连接大模型服务，请稍后重试');
      assert.equal(error.message.includes(OPENAI_SETTINGS.apiKey), false);
      assert.equal(error.message.includes('Authorization'), false);
      assert.equal(error.message.includes('sensitive body'), false);
      return true;
    }
  );
});

test('connection testing uses the same response validation', async () => {
  const result = await testConnection(OPENAI_SETTINGS, {
    fetchImpl: async () => jsonResponse({ choices: [{}] }),
    timeoutMs: 50
  });

  assert.deepEqual(result, {
    success: false,
    error: '大模型响应结构无效',
    errorCode: 'invalid-response'
  });
});

test('connection testing generalizes an unknown provider without fetching', async () => {
  let called = false;
  const result = await testConnection(
    { provider: `Authorization Bearer ${OPENAI_SETTINGS.apiKey}` },
    {
      fetchImpl: async () => {
        called = true;
        return jsonResponse({ choices: [{ message: { content: 'OK' } }] });
      }
    }
  );

  assert.deepEqual(result, {
    success: false,
    error: '大模型配置不受支持',
    errorCode: 'invalid-provider'
  });
  assert.equal(called, false);
});

test('request coordinator supersedes matching work and cancels a renderer session', () => {
  const coordinator = createRequestCoordinator();
  const firstRealtime = coordinator.begin(7, 'realtime');
  const report = coordinator.begin(7, 'report');
  const nextRealtime = coordinator.begin(7, 'realtime');

  assert.equal(firstRealtime.signal.aborted, true);
  assert.equal(report.signal.aborted, false);
  assert.equal(nextRealtime.signal.aborted, false);

  coordinator.cancelAll(7);

  assert.equal(report.signal.aborted, true);
  assert.equal(nextRealtime.signal.aborted, true);
});

test('coordinated request returns a named success result', async () => {
  const coordinator = createRequestCoordinator();

  const result = await runCoordinatedRequest(
    coordinator,
    7,
    'realtime',
    'feedback',
    async (signal) => {
      assert.equal(signal instanceof AbortSignal, true);
      return '说结论';
    }
  );

  assert.deepEqual(result, { success: true, feedback: '说结论' });
});

test('coordinated request returns a safe cancellation result', async () => {
  const coordinator = createRequestCoordinator();
  const pending = runCoordinatedRequest(
    coordinator,
    7,
    'realtime',
    'feedback',
    (signal) => sendFeedback('文本', OPENAI_SETTINGS, null, {
      fetchImpl: abortableFetch(),
      timeoutMs: 1000,
      signal
    })
  );

  coordinator.cancelAll(7);

  assert.deepEqual(await pending, {
    success: false,
    error: '大模型请求已取消',
    errorCode: 'cancelled'
  });
});

test('coordinated request suppresses a late result after session cancellation', async () => {
  const coordinator = createRequestCoordinator();
  let resolveRequest;
  const pending = runCoordinatedRequest(
    coordinator,
    7,
    'realtime',
    'feedback',
    async () => new Promise((resolve) => {
      resolveRequest = resolve;
    })
  );

  coordinator.cancelAll(7);
  resolveRequest('迟到结果');

  assert.deepEqual(await pending, {
    success: false,
    error: '大模型请求已取消',
    errorCode: 'cancelled'
  });
});

test('coordinated request generalizes unexpected failures', async () => {
  const coordinator = createRequestCoordinator();

  const result = await runCoordinatedRequest(
    coordinator,
    7,
    'report',
    'report',
    async () => {
      throw new Error(`Authorization: Bearer ${OPENAI_SETTINGS.apiKey}`);
    }
  );

  assert.deepEqual(result, {
    success: false,
    error: '大模型请求失败，请稍后重试',
    errorCode: 'generic'
  });
});

test('connection testing rejects a missing model before fetching', async () => {
  let called = false;
  const result = await testConnection(
    {
      provider: 'custom',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      customModel: ''
    },
    { fetchImpl: async () => { called = true; } }
  );

  assert.deepEqual(result, {
    success: false,
    error: '请先配置模型名称',
    errorCode: 'missing-model'
  });
  assert.equal(called, false);
});

test('connection testing rejects an invalid custom endpoint before fetching', async () => {
  let called = false;
  const result = await testConnection(
    {
      provider: 'custom',
      apiKey: 'test-key',
      baseUrl: 'not-a-url',
      customModel: 'test-model'
    },
    { fetchImpl: async () => { called = true; } }
  );

  assert.deepEqual(result, {
    success: false,
    error: '大模型接口地址格式无效',
    errorCode: 'invalid-endpoint'
  });
  assert.equal(called, false);
});

test('custom endpoint appends the chat path before query parameters', async () => {
  let requestedEndpoint;
  const result = await testConnection(
    {
      provider: 'custom',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/openai?api-version=2026-08-31#local-fragment',
      customModel: 'test-model'
    },
    {
      fetchImpl: async (endpoint) => {
        requestedEndpoint = endpoint;
        return jsonResponse({ choices: [{ message: { content: 'OK' } }] });
      }
    }
  );

  assert.deepEqual(result, { success: true });
  assert.equal(
    requestedEndpoint,
    'https://example.test/openai/chat/completions?api-version=2026-08-31'
  );
});

test('report failures do not mutate local analysis input', async () => {
  const stats = {
    duration: 12,
    totalWords: 8,
    fillers: 1,
    hedges: 1,
    vagueWords: 2
  };
  const snapshot = structuredClone(stats);

  await assert.rejects(
    sendReport('嗯我觉得很好', stats, OPENAI_SETTINGS, null, {
      fetchImpl: async () => jsonResponse({}, 429)
    }),
    { message: '大模型请求过于频繁，请稍后重试' }
  );

  assert.deepEqual(stats, snapshot);
});

test('playback analysis uses the structured prompt, lower temperature, and strict response parser', async () => {
  let request;
  const segments = [{id: 's1', text: '我觉得这个方案很好。', startMs: 0, endMs: 1200}];

  const result = await sendPlaybackAnalysis(segments, OPENAI_SETTINGS, null, {
    fetchImpl: async (url, options) => {
      request = JSON.parse(options.body);
      return jsonResponse({
        choices: [{message: {content: '{"items":[{"segmentId":"s1","advice":"先给结论，再补充原因。"}]}'}}]
      });
    }
  });

  assert.deepEqual(result, [{segmentId: 's1', advice: '先给结论，再补充原因。'}]);
  assert.equal(request.max_tokens, 4096);
  assert.equal(request.temperature, 0.2);
  assert.match(request.system ? request.system : request.messages[0].content, /segmentId/);
});

test('playback analysis rejects a model response that does not reference an input segment', async () => {
  await assert.rejects(
    sendPlaybackAnalysis([{id: 's1', text: '文本', startMs: 0, endMs: 1000}], OPENAI_SETTINGS, null, {
      fetchImpl: async () => jsonResponse({
        choices: [{message: {content: '{"items":[{"segmentId":"other","advice":"建议"}]}'}}]
      })
    }),
    error => error.code === 'invalid-response'
  );
});

test('coordinated playback analysis returns a safe invalid-response result', async () => {
  const result = await runCoordinatedRequest(
    createRequestCoordinator(),
    7,
    'playback',
    'analysis',
    signal => sendPlaybackAnalysis([{id: 's1', text: '文本', startMs: 0, endMs: 1000}], OPENAI_SETTINGS, null, {
      signal,
      fetchImpl: async () => jsonResponse({
        choices: [{message: {content: '{"items":[{"segmentId":"missing","advice":"建议"}]}'}}]
      })
    })
  );

  assert.deepEqual(result, {
    success: false,
    error: '大模型响应结构无效',
    errorCode: 'invalid-response'
  });
});
