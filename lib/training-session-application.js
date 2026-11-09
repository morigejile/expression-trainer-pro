'use strict';

const {openTrainingSessionStore} = require('./training-session-store');
const {MAX_DURATION_MS, requireId, sessionError} = require('./training-session-data');
const {loadTrainingSetup, saveTrainingSetup} = require('./training-setup-store');

const MESSAGES = {
  INVALID_SESSION: '训练记录请求无效，请重试。',
  SESSION_NOT_FOUND: '训练记录不存在或已删除。',
  SESSION_BUSY: '训练记录正在保存或删除，请稍后重试。',
  FINALIZATION_FAILED: '训练保存失败，请保留当前录音并重试。',
  DELETION_FAILED: '训练记录尚未完全删除，请重试删除。',
  AUDIO_UNAVAILABLE: '录音不可播放，文件可能缺失、损坏或已删除。',
  RESULT_STALE: '分析结果使用的逐字稿版本已失效。',
  COMPARISON_STALE: '本次对比的原始快照已失效，请返回训练历史重新选择。',
  SETUP_UNAVAILABLE: '上次训练配置暂时无法恢复，可以重新填写或直接开始。',
  UNSUPPORTED_SCHEMA: '训练数据来自更新版本，请使用兼容的应用版本打开。',
  INVALID_STORAGE_PATH: '训练存储目录不可用，请检查本地存储后重启应用。',
  STORAGE_UNAVAILABLE: '训练存储不可用，请检查本地存储后重启应用。',
  STORAGE_OPERATION_FAILED: '训练记录操作失败，请重试。',
  timeout: '分析等待超时，已保存的训练保持不变，可稍后重试。',
  cancelled: '分析已取消，已保存的训练保持不变。',
  STORAGE_CLOSING: '应用正在退出，无法接受新的训练记录操作。',
  STORAGE_SHUTDOWN_TIMEOUT: '等待训练存储结束超时，未确认保存完成的数据将在下次启动时检查。'
};

function failure(error, fallback, identity = {}) {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : fallback;
  return {...identity, ok: false, error: {code, message: MESSAGES[code]}};
}

function identityOf(command) {
  const identity = {requestId: null};
  try { identity.requestId = requireId(command?.requestId); } catch { /* Invalid values are never echoed. */ }
  try { identity.sessionId = requireId(command?.sessionId); } catch { /* Create/list have no session ID. */ }
  return identity;
}

function validate(operation, command) {
  const fields = {
    create: ['requestId', 'input'], finalize: ['requestId', 'sessionId', 'input'],
    list: ['requestId', 'limit', 'offset'], get: ['requestId', 'sessionId'], getSetup: ['requestId'], practiceHistory:['requestId','sessionId','reportId'],
    compare: ['requestId', 'sessionIds', 'snapshots'],
    delete: ['requestId', 'sessionId'], readAudio: ['requestId', 'sessionId'],
    analyze: ['requestId','sessionId','retry','trigger'], cancelAnalysis:['requestId','sessionId'],
    appendResult: ['requestId', 'sessionId', 'input'], interrupt: ['requestId', 'sessionId', 'input']
  };
  const invalid = () => { throw sessionError('INVALID_SESSION', 'Invalid command'); };
  if (!Object.hasOwn(fields, operation) || !command || typeof command !== 'object' || Array.isArray(command)
      || Object.keys(command).some(key => !fields[operation].includes(key))) invalid();
  requireId(command.requestId);
  if (!['create', 'list', 'compare', 'getSetup'].includes(operation)) requireId(command.sessionId);
  if (operation === 'practiceHistory' && Object.hasOwn(command,'reportId')) requireId(command.reportId);
  if (operation === 'compare') {
    if (!Array.isArray(command.sessionIds) || command.sessionIds.length !== 2 || new Set(command.sessionIds).size !== 2) invalid();
    command.sessionIds.forEach(requireId);
    if (command.snapshots !== undefined) {
      if (!Array.isArray(command.snapshots) || command.snapshots.length !== 2) invalid();
      const seen = new Set();
      for (const pin of command.snapshots) {
        if (!pin || typeof pin !== 'object' || Array.isArray(pin) ||
            Object.keys(pin).some(key => !['sessionId','inputRevision','reportId'].includes(key)) ||
            !command.sessionIds.includes(pin.sessionId) || seen.has(pin.sessionId) ||
            !(pin.inputRevision === null || (Number.isSafeInteger(pin.inputRevision) && pin.inputRevision >= 1))) invalid();
        if (pin.reportId !== null) requireId(pin.reportId);
        seen.add(pin.sessionId);
      }
    }
  }
  if (['create', 'finalize', 'appendResult'].includes(operation)) {
    if (!command.input || typeof command.input !== 'object' || Array.isArray(command.input)) invalid();
  }
  if (operation === 'create' && Object.hasOwn(command.input,'practice')) invalid();
  if (operation === 'analyze' && command.retry !== undefined && typeof command.retry !== 'boolean') invalid();
  if (operation === 'analyze' && command.trigger !== undefined && !['manual','automatic'].includes(command.trigger)) invalid();
  if (operation === 'appendResult' && !['metrics','report','playback'].includes(command.input.kind)) invalid();
  if (operation === 'interrupt' && command.input !== undefined &&
      (!command.input || typeof command.input !== 'object' || Array.isArray(command.input) ||
        Object.keys(command.input).some(key => !['timing','dataQuality'].includes(key)))) invalid();
  if (operation === 'list') {
    const {limit = 100, offset = 0} = command;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(offset) || offset < 0) invalid();
  }
  // Bound completed WAV transfer before the store copies/validates it. Live PCM stays on the ASR path.
  if (operation === 'finalize' && command.input.audio !== undefined
      && (!(command.input.audio instanceof Uint8Array) || command.input.audio.byteLength > 44 + MAX_DURATION_MS * 32)) invalid();
}

function createTrainingSessionApplication({root, openStore = openTrainingSessionStore, shutdownTimeoutMs = 5000, sourceSnapshot,analysisOptions}) {
  let store;
  let analyzer;
  let closing = false;
  let closePromise;
  const pending = new Set();
  const comparisons = new Set();
  const ready = Promise.resolve().then(() => openStore({root})).then(value => {
    store = value;
    if (analysisOptions) analyzer = require('./session-analysis').createSessionAnalysis({store,...analysisOptions});
    return {ok: true};
  }, error => failure(error, 'STORAGE_UNAVAILABLE'));

  function execute(operation, command) {
    const identity = identityOf(command);
    if (closing) return Promise.resolve(failure(null, 'STORAGE_CLOSING', identity));
    try { validate(operation, command); }
    catch (error) { return Promise.resolve(failure(error, 'INVALID_SESSION', identity)); }
    const work = (async () => {
      const startup = await ready;
      if (!startup.ok) return {...identity, ...startup};
      try {
        let value;
        let setupSaved;
        switch (operation) {
          case 'create': {
            const practice = command.input.practiceRequest == null ? null
              : await require('./practice-chain').createPractice(store,command.input.practiceRequest);
            value = await store.create({...command.input,practice,...(sourceSnapshot ? {sourceSnapshot:sourceSnapshot()} : {})});
            try { saveTrainingSetup(root, value); setupSaved = true; } catch { setupSaved = false; }
            break;
          }
          case 'getSetup': value = loadTrainingSetup(root); break;
          case 'practiceHistory': value = await require('./practice-chain').practiceHistory(store,command.sessionId,command.reportId); break;
          case 'finalize': {
            const prior = analyzer ? await store.get(command.sessionId) : null;
            value = await store.finalize(command.sessionId, command.input);
            if (analyzer && prior?.status !== 'completed') void analyzer.start(command.sessionId,{fresh:true,trigger:'automatic'}).catch(() => {});
            break;
          }
          case 'list': value = await store.list({limit: command.limit, offset: command.offset}); break;
          case 'get': value = await store.get(command.sessionId); break;
          case 'compare': {
            const read = {ids:[...command.sessionIds],invalidated:false};
            comparisons.add(read);
            try {
              const sessions = await Promise.all(read.ids.map(id => store.get(id)));
              if (read.invalidated) throw sessionError('SESSION_NOT_FOUND','Comparison input deleted');
              value = require('./session-comparison').compareSessions(sessions,command.snapshots);
            } finally { comparisons.delete(read); }
            break;
          }
          case 'delete':
            for (const read of comparisons) if (read.ids.includes(command.sessionId)) read.invalidated = true;
            analyzer?.cancel(command.sessionId); await store.delete(command.sessionId); value = null; break;
          case 'readAudio': value = await store.readAudio(command.sessionId); break;
          case 'appendResult': value = await store.appendResult(command.sessionId, command.input); break;
          case 'interrupt': value = await store.interrupt(command.sessionId, command.input); break;
          case 'analyze':
            if (!analyzer) throw sessionError('STORAGE_UNAVAILABLE','Analysis is unavailable');
            value = await analyzer.start(command.sessionId,{retry:command.retry,trigger:command.trigger || 'manual'}); break;
          case 'cancelAnalysis': analyzer?.cancel(command.sessionId); value = null; break;
        }
        return {...identity, ...(operation === 'create' ? {sessionId: value.id, setupSaved} : {}), ok: true, value};
      } catch (error) { return failure(error, 'STORAGE_OPERATION_FAILED', identity); }
    })();
    pending.add(work);
    void work.then(() => pending.delete(work), () => pending.delete(work));
    return work;
  }

  function close() {
    if (closePromise) return closePromise;
    closing = true;
    const draining = (async () => {
      await ready;
      await analyzer?.close();
      await Promise.allSettled([...pending]);
      store?.close();
      return {ok: true};
    })().catch(error => failure(error, 'STORAGE_OPERATION_FAILED'));
    let timer;
    closePromise = Promise.race([
      draining,
      new Promise(resolve => {
        timer = setTimeout(() => resolve(failure(null, 'STORAGE_SHUTDOWN_TIMEOUT')), shutdownTimeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
    // On timeout Main may quit; do not close a database still in use. Recovery handles interrupted writes.
    return closePromise;
  }

  return {ready, execute, close};
}

module.exports = {createTrainingSessionApplication};
