/**
 * AI反馈模块 - 支持多后端
 * 支持 DeepSeek / OpenAI / Ollama / 自定义 OpenAI 兼容接口
 */

const { getRealtimePrompt, getReportPrompt } = require('./prompts');

// 各后端的 API 配置
const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions'
};

const REQUEST_TIMEOUTS = {
  connection: 10000,
  realtime: 15000,
  report: 60000
};

const ERROR_MESSAGES = {
  missingApiKey: '请先配置 API Key',
  missingEndpoint: '请先配置大模型接口地址',
  timeout: '大模型请求超时，请稍后重试',
  cancelled: '大模型请求已取消',
  rateLimited: '大模型请求过于频繁，请稍后重试',
  unauthorized: 'API Key 无效或无权限',
  invalidJson: '大模型返回了无效 JSON',
  invalidResponse: '大模型响应结构无效',
  network: '无法连接大模型服务，请稍后重试',
  generic: '大模型请求失败，请稍后重试'
};

class LLMRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LLMRequestError';
    this.code = code;
  }
}

function toSafeErrorMessage(error) {
  return error instanceof LLMRequestError
    ? error.message
    : ERROR_MESSAGES.generic;
}

function createRequestCoordinator() {
  const activeRequests = new Map();

  function begin(ownerId, requestType) {
    const key = `${ownerId}:${requestType}`;
    const previous = activeRequests.get(key);
    if (previous) previous.controller.abort();

    const request = {
      ownerId,
      controller: new AbortController()
    };
    activeRequests.set(key, request);

    return {
      signal: request.controller.signal,
      finish() {
        if (activeRequests.get(key) === request) {
          activeRequests.delete(key);
        }
      }
    };
  }

  function cancelAll(ownerId) {
    for (const [key, request] of activeRequests) {
      if (request.ownerId === ownerId) {
        request.controller.abort();
        activeRequests.delete(key);
      }
    }
  }

  return { begin, cancelAll };
}

async function runCoordinatedRequest(
  coordinator,
  ownerId,
  requestType,
  resultKey,
  requestFactory
) {
  const request = coordinator.begin(ownerId, requestType);
  try {
    const value = await requestFactory(request.signal);
    if (request.signal.aborted) {
      throw new LLMRequestError('cancelled', ERROR_MESSAGES.cancelled);
    }
    return { success: true, [resultKey]: value };
  } catch (error) {
    return { success: false, error: toSafeErrorMessage(error) };
  } finally {
    request.finish();
  }
}

/**
 * 发送请求到 OpenAI 兼容接口
 */
async function callAPI(endpoint, apiKey, model, messages, maxTokens = 200, options = {}) {
  if (!endpoint || !endpoint.trim()) {
    throw new LLMRequestError('missing-endpoint', ERROR_MESSAGES.missingEndpoint);
  }
  if (!apiKey || !apiKey.trim()) {
    throw new LLMRequestError('missing-api-key', ERROR_MESSAGES.missingApiKey);
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs;
  const externalSignal = options.signal;
  const controller = new AbortController();
  let timedOut = false;

  const cancelRequest = () => controller.abort();
  if (externalSignal?.aborted) {
    throw new LLMRequestError('cancelled', ERROR_MESSAGES.cancelled);
  }
  externalSignal?.addEventListener('abort', cancelRequest, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new LLMRequestError('rate-limited', ERROR_MESSAGES.rateLimited);
      }
      if (response.status === 401 || response.status === 403) {
        throw new LLMRequestError('unauthorized', ERROR_MESSAGES.unauthorized);
      }
      throw new LLMRequestError(
        'http-error',
        `大模型服务请求失败（HTTP ${response.status}）`
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      if (timedOut) {
        throw new LLMRequestError('timeout', ERROR_MESSAGES.timeout);
      }
      if (externalSignal?.aborted || controller.signal.aborted) {
        throw new LLMRequestError('cancelled', ERROR_MESSAGES.cancelled);
      }
      throw new LLMRequestError('invalid-json', ERROR_MESSAGES.invalidJson);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new LLMRequestError('invalid-response', ERROR_MESSAGES.invalidResponse);
    }

    if (timedOut) {
      throw new LLMRequestError('timeout', ERROR_MESSAGES.timeout);
    }
    if (externalSignal?.aborted) {
      throw new LLMRequestError('cancelled', ERROR_MESSAGES.cancelled);
    }

    return content;
  } catch (error) {
    if (error instanceof LLMRequestError) throw error;
    if (timedOut) {
      throw new LLMRequestError('timeout', ERROR_MESSAGES.timeout);
    }
    if (externalSignal?.aborted || controller.signal.aborted) {
      throw new LLMRequestError('cancelled', ERROR_MESSAGES.cancelled);
    }
    throw new LLMRequestError('network', ERROR_MESSAGES.network);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', cancelRequest);
  }
}

/**
 * 获取endpoint和配置
 */
function getProviderConfig(settings) {
  const { provider, apiKey, model, ollamaUrl, baseUrl, customModel } = settings;

  switch (provider) {
    case 'openai':
      return {
        endpoint: PROVIDER_ENDPOINTS.openai,
        apiKey,
        model: model || 'gpt-4o-mini'
      };
    case 'deepseek':
      return {
        endpoint: PROVIDER_ENDPOINTS.deepseek,
        apiKey,
        model: model || 'deepseek-chat'
      };
    case 'ollama':
      return {
        endpoint: `${ollamaUrl || 'http://localhost:11434'}/v1/chat/completions`,
        apiKey: 'ollama', // Ollama 不需要真实key但接口需要这个字段
        model: model || 'qwen2.5:7b'
      };
    case 'custom':
      // 用户输入 BASE URL，自动追加 /chat/completions
      const base = (baseUrl || '').replace(/\/+$/, '');
      const endpoint = base ? `${base}/chat/completions` : '';
      return {
        endpoint,
        apiKey: apiKey || '',
        model: customModel || model || ''
      };
    default:
      throw new Error(`未知的 provider: ${provider}`);
  }
}

/**
 * 发送实时反馈请求
 * @param {string} text - 当前累积文本
 * @param {Object} settings - 用户设置
 * @returns {string} 反馈HTML
 */
async function sendFeedback(text, settings, customPrompt, options = {}) {
  const config = getProviderConfig(settings);
  const prompt = getRealtimePrompt(text, null, customPrompt);

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 150, {
    ...options,
    timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUTS.realtime
  });
  return result;
}

/**
 * 发送结束报告请求
 * @param {string} fullText - 完整文本
 * @param {Object} stats - 统计数据
 * @param {Object} settings - 用户设置
 * @returns {string} 报告文本
 */
async function sendReport(fullText, stats, settings, customPrompt, options = {}) {
  const config = getProviderConfig(settings);
  const prompt = getReportPrompt(fullText, stats, customPrompt);

  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const result = await callAPI(config.endpoint, config.apiKey, config.model, messages, 8192, {
    ...options,
    timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUTS.report
  });
  return result;
}

/**
 * 将AI返回的纯文本反馈格式化为HTML
 */
function formatFeedback(text) {
  // 简单处理：检测是否包含建议标记
  let html = text
    .replace(/→/g, '<span class="suggestion"> → </span>')
    .replace(/⚠️/g, '<span class="issue">⚠️</span>')
    .replace(/✓/g, '<span class="suggestion">✓</span>')
    .replace(/\n/g, '<br>');

  return html;
}

/**
 * 测试 LLM 连通性
 * 发送一条极简请求验证配置是否可用
 */
async function testConnection(settings, options = {}) {
  try {
    const config = getProviderConfig(settings);
    if (!config.endpoint) {
      return { success: false, error: '端点地址未配置' };
    }

    const messages = [
      { role: 'user', content: 'OK' }
    ];

    await callAPI(config.endpoint, config.apiKey, config.model, messages, 2, {
      ...options,
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUTS.connection
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: toSafeErrorMessage(error) };
  }
}

module.exports = {
  createRequestCoordinator,
  runCoordinatedRequest,
  sendFeedback,
  sendReport,
  testConnection,
  toSafeErrorMessage
};
