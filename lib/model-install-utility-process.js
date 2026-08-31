'use strict';

const {net} = require('electron');
const registry = require('../models/registry.json');
const {resolveManagedAsrOptions} = require('./asr-utility-config');
const {createModelManager} = require('./model-manager');

const channel = process.parentPort;
if (!channel) throw new Error('Model install utility requires an Electron parent port');

const options = resolveManagedAsrOptions(process.argv, registry);
const manager = createModelManager({
  userDataPath: options.userDataPath,
  modelRoot: options.modelRoot,
  appVersion: options.appVersion,
  registry,
  fetchImpl: (...args) => net.fetch(...args)
});
let installation = null;

channel.on('message', event => {
  const message = event?.data ?? event;
  if (message?.command === 'cancel') {
    installation?.abort(Object.assign(new Error('Model install cancelled'), {code: 'asr-model-install-cancelled'}));
    channel.postMessage({id: message.id, ok: true});
    return;
  }
  if (message?.command !== 'install' || installation) return;
  installation = new AbortController();
  manager.install(options.modelId, {
    activate: false,
    signal: installation.signal,
    onProgress(progress) { channel.postMessage({type: 'progress', progress}); }
  }).then(() => {
    channel.postMessage({id: message.id, ok: true});
  }).catch(error => {
    const cancelled = installation.signal.aborted;
    channel.postMessage({
      id: message.id,
      ok: false,
      error: {
        code: cancelled ? 'asr-model-install-cancelled' : 'asr-model-install-failed',
        message: cancelled ? 'ASR model install cancelled' : 'ASR model install failed'
      }
    });
  }).finally(() => setImmediate(() => process.exit(0)));
});
