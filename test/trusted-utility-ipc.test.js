'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {loadLlmProviderSettings, saveLlmProviderSettings} = require('../lib/llm-provider-store');
const {createCustomPromptStore} = require('../lib/custom-prompt-store');
const {createRequestCoordinator} = require('../lib/ai-feedback');
const {FEEDBACK_DOCUMENT_URL} = require('../shared/support-links');
const {testSecretStorage} = require('./helpers/secret-storage');
const mainUrl = 'file:///D:/app/src/index.html';

function profile(id = 'editor') {
  return {id, name: id, provider: 'custom', hasApiKey: false, credential:{action:'replace',value:'test-key'}, model: 'test-model', ollamaUrl: '',
    baseUrl: 'https://fixture.invalid/v1', customModel: 'test-model', autoDiagnosisEnabled: false};
}
function settings(profiles = [profile()]) {
  return {schemaVersion: 3, activeProfileId: profiles[0]?.id || null, profiles};
}
function fixture(t, overrides = {}) {
  const {registerTrustedUtilityIpc} = require('../lib/trusted-utility-ipc');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utility-ipc-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const frame = {url: mainUrl};
  const contents = {id: 7, mainFrame: frame, isDestroyed: () => false};
  const handlers = new Map();
  const effects = {opens: [], broadcasts: 0, connections: [], links: [], exports: []};
  const promptStore = createCustomPromptStore();
  const storeOptions={secretStorage:testSecretStorage()};
  registerTrustedUtilityIpc({ipcMain: {handle: (name, handler) => handlers.set(name, handler)},
    getMainWebContents: () => contents, mainUrl,
    openUtility: value => effects.opens.push(value), getAppInfo: () => ({name: '表达训练', version: '1.0.1'}),
    loadSettings: () => loadLlmProviderSettings(root,storeOptions), saveSettings: value => saveLlmProviderSettings(root,value,storeOptions),
    publishSettings: () => effects.broadcasts++, loadPrompt: () => promptStore.load(root),
    savePrompt: value => promptStore.save(root, value), requests: createRequestCoordinator(),
    testConnection: async (value, options) => {effects.connections.push({value, options}); return {success: true};},
    exportDiagnostics: async value => {effects.exports.push(value); return {success: true};},
    openSupportLink: async value => {effects.links.push(value); return {success: true};}, ...overrides});
  return {root, effects, handlers, frame, contents, event: {sender: contents, senderFrame: frame},
    call: (name, value) => handlers.get(name)({sender: contents, senderFrame: frame}, value)};
}

test('Utility commands accept only the current Main document and reject same-URL child frames, other windows, and query URLs', async t => {
  const f = fixture(t);
  const commands = {'get-app-info': undefined, 'open-settings': undefined,
    'get-llm-provider-settings': undefined, 'save-llm-provider-settings': settings(), 'get-custom-prompt': undefined,
    'save-custom-prompt': {schemaVersion: 2, goals: '', styleRef: ''},
    'test-llm-connection': settings(), 'cancel-llm-requests': undefined, 'export-diagnostics': undefined,
    'open-support-link': FEEDBACK_DOCUMENT_URL};
  for (const event of [{sender: {}, senderFrame: f.frame}, {sender: f.contents, senderFrame: {url: mainUrl}},
    {sender: f.contents}, {}, null]) {
    for (const [channel, value] of Object.entries(commands)) {
      assert.equal((await f.handlers.get(channel)(event, value)).errorCode, 'forbidden', channel);
    }
  }
  for (const url of ['https://fixture.invalid', `${mainUrl}?surface=settings`, 'file:///D:/app/other.html']) {
    f.frame.url = url;
    assert.equal((await f.call('get-llm-provider-settings')).errorCode, 'forbidden');
  }
  f.frame.url = `${mainUrl}#report`;
  assert.deepEqual(await f.call('get-app-info'), {name: '表达训练', version: '1.0.1'});
  f.contents.isDestroyed = () => true;
  assert.equal((await f.call('get-app-info')).errorCode, 'forbidden');
  assert.deepEqual(f.effects, {opens: [], broadcasts: 0, connections: [], links: [], exports: []});
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('official manual links open only after a trusted explicit request; lookalikes and altered links are rejected',async t=>{
 const f=fixture(t),{DEEPSEEK_GUIDE_URLS}=require('../shared/support-links');
 assert.ok(Array.isArray(DEEPSEEK_GUIDE_URLS));
 assert.deepEqual(f.effects.links,[]);
 for(const url of DEEPSEEK_GUIDE_URLS){
  assert.equal((await f.call('open-support-link',url)).success,true);
  assert.equal((await f.call('open-support-link',url+'?tracking=unexpected')).success,false);
 }
 assert.deepEqual(f.effects.links,DEEPSEEK_GUIDE_URLS);
});

test('settings open in the main Utility and narrow preload notifications unsubscribe', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.call('open-settings'), {success: true});
  assert.deepEqual(f.effects.opens, [{surface: 'settings', page: 'ai'}]);
  let api;
  const listeners = new Map();
  const removed = [];
  const invocations = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8'), {
    require: () => ({contextBridge: {exposeInMainWorld: (name, value) => {api = value;}},
      ipcRenderer: {on: (channel, listener) => listeners.set(channel, listener),
        removeListener: (channel, listener) => removed.push([channel, listener]),
        invoke: (channel, value) => {invocations.push([channel, value]);}, send: () => {}}})});
  const payloads = [];
  const unsubscribe = api.onUtilityOpen(value => payloads.push(value));
  const notification = {surface: 'settings', page: 'ai'};
  listeners.get('utility-open')({sender: 'private-electron-event'}, notification);
  assert.deepEqual(payloads, [notification]);
  unsubscribe();
  assert.deepEqual(removed, [['utility-open', listeners.get('utility-open')]]);
  api.getAppInfo();
  assert.deepEqual(invocations, [['get-app-info', undefined]]);
});

test('Utility saves use existing durable profile and prompt stores, preserving identity-change auto revocation', async t => {
  const f = fixture(t);
  const original = settings(); original.profiles[0].autoDiagnosisEnabled = true;
  assert.deepEqual(await f.call('save-llm-provider-settings', original), {success: true});
  const edited = await f.call('get-llm-provider-settings');
  edited.profiles[0].customModel = 'another-model';
  assert.equal((await f.call('save-llm-provider-settings', edited)).success, true);
  assert.equal((await f.call('get-llm-provider-settings')).profiles[0].autoDiagnosisEnabled, false);
  assert.equal(f.effects.broadcasts, 2);
  const prompt = {schemaVersion: 2, goals: '表达清楚', styleRef: '简明'};
  assert.deepEqual(await f.call('save-custom-prompt', prompt), {success: true});
  assert.deepEqual(await f.call('get-custom-prompt'), prompt);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'custom-prompt.json'), 'utf8')), prompt);
});

test('migrated maximum-length instructions can still be edited and saved through Utility',async t=>{
  const f=fixture(t),file=path.join(f.root,'custom-prompt.json');
  fs.writeFileSync(file,JSON.stringify({schemaVersion:1,goals:'甲'.repeat(20000),
    customRules:'乙'.repeat(20000),styleRef:'简'.repeat(20000),customWords:'行动'}));
  const prompt=await f.call('get-custom-prompt');
  assert.equal(prompt.schemaVersion,2);assert.equal(prompt.goals.length,40002);
  assert.deepEqual(Object.keys(prompt).sort(),['goals','schemaVersion','styleRef']);
  assert.deepEqual(await f.call('save-custom-prompt',prompt),{success:true});
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),prompt);
});

test('typed bounded invalid Utility parameters are rejected before writes, testing, links, or diagnostics', async t => {
  const f = fixture(t);
  const badSettings = [null, [], {}, {...settings(), privatePath: 'secret'}, {...settings(), schemaVersion: 4},
    settings([{...profile(), apiKey: 5}]), settings([{...profile(), credential:{action:'replace',value:5}}]), settings([{...profile(), id: 'x'.repeat(129)}]),
    settings([{...profile(), provider: 'unknown'}]), settings([{...profile(), autoDiagnosisEnabled: 'true'}]),
    settings([{...profile(), credential:{action:'replace',value:'x'.repeat(16385)}}]), settings([profile(), profile()]),
    {...settings(), activeProfileId: 'missing'}];
  for (const channel of ['save-llm-provider-settings', 'test-llm-connection']) {
    for (const value of badSettings) assert.equal((await f.call(channel, value)).errorCode, 'invalid-ipc-input', channel);
  }
  const prompt = {schemaVersion: 2, goals: '', styleRef: ''};
  for (const value of [null, {}, {...prompt, schemaVersion: 1}, {...prompt, goals: []}, {...prompt, unknown: ''},
    {...prompt, goals: 'x'.repeat(40003)}, {...prompt, styleRef:'x'.repeat(20001)},
    {...prompt, customWords:''}, {...prompt, customRules:''}]) {
    assert.equal((await f.call('save-custom-prompt', value)).errorCode, 'invalid-ipc-input');
  }
  for (const name of ['get-app-info', 'open-settings', 'get-llm-provider-settings',
    'get-custom-prompt', 'cancel-llm-requests']) {
    assert.equal((await f.call(name, {})).errorCode, 'invalid-ipc-input');
  }
  for (const value of [[], {}, {requestedSampleRateHz: 16000, contextSampleRateHz: 48000, trackSampleRateHz: 48000, key: 'secret'},
    {requestedSampleRateHz: 0, contextSampleRateHz: null, trackSampleRateHz: null}]) {
    assert.equal((await f.call('export-diagnostics', value)).errorCode, 'invalid-ipc-input');
  }
  for (const value of [null, `${FEEDBACK_DOCUMENT_URL}?x=1`, 'https://docs.qq.com/sheet/another']) {
    assert.equal((await f.call('open-support-link', value)).success, false);
  }
  assert.deepEqual(f.effects, {opens: [], broadcasts: 0, connections: [], links: [], exports: []});
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('connection testing uses the exact selected editor draft without persisting or triggering training analysis', async t => {
  const f = fixture(t);
  await f.call('save-llm-provider-settings', settings([profile('saved')]));
  const file = path.join(f.root, 'llm-provider-settings.json');
  const before = fs.readFileSync(file, 'utf8');
  const draft = {...profile('draft'), credential:{action:'replace',value:'draft-key'}, model: 'draft-model', customModel: 'draft-model',
    baseUrl: 'http://localhost:9999/v1'};
  assert.deepEqual(await f.call('test-llm-connection', {schemaVersion: 3, activeProfileId: 'draft', profiles: [profile('other'), draft]}),
    {success: true});
  const {hasApiKey,credential,...expected}=draft;
  assert.deepEqual(f.effects.connections[0].value, {...expected,apiKey:'draft-key'});
  assert.equal(f.effects.connections[0].options.signal instanceof AbortSignal, true);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(f.effects.broadcasts, 1);
  const unselected = {schemaVersion: 3, activeProfileId: null, profiles: [draft]};
  assert.equal((await f.call('test-llm-connection', unselected)).success, false);
  assert.equal(f.effects.connections.length, 1);
});

test('Utility failures use safe envelopes and never expose private endpoint, key, or filesystem text', async t => {
  const secretError = Object.assign(new Error('PRIVATE_ENDPOINT PRIVATE_KEY PRIVATE_PATH'), {code: 'unsupported-schema-version'});
  const f = fixture(t, {loadSettings: () => {throw secretError;}, saveSettings: () => {throw secretError;},
    loadPrompt: () => {throw secretError;}, savePrompt: () => {throw secretError;},
    testConnection: async () => {throw secretError;}, exportDiagnostics: async () => {throw secretError;},
    openSupportLink: async () => {throw secretError;}});
  const prompt = {schemaVersion: 2, goals: '', styleRef: ''};
  for (const [channel, value] of [['get-llm-provider-settings'], ['save-llm-provider-settings', settings()],
    ['get-custom-prompt'], ['save-custom-prompt', prompt],
    ['test-llm-connection', settings()], ['export-diagnostics'], ['open-support-link', FEEDBACK_DOCUMENT_URL]]) {
    const result = await f.call(channel, value);
    assert.equal(result.success, false, channel);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ENDPOINT|PRIVATE_KEY|PRIVATE_PATH/);
  }
  const returned = fixture(t, {testConnection: async () => ({success: false, error: secretError.message, errorCode: 'unauthorized'})});
  const result = await returned.call('test-llm-connection', settings());
  assert.equal(result.errorCode, 'unauthorized');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ENDPOINT|PRIVATE_KEY|PRIVATE_PATH/);
});

test('support links retain the exact whitelist and diagnostics permit only bounded audio rates', async t => {
  const f = fixture(t);
  const rates = {requestedSampleRateHz: 16000, contextSampleRateHz: 48000, trackSampleRateHz: null};
  assert.equal((await f.call('export-diagnostics', rates)).success, true);
  assert.equal((await f.call('export-diagnostics')).success, true);
  assert.equal((await f.call('open-support-link', FEEDBACK_DOCUMENT_URL)).success, true);
  assert.deepEqual(f.effects.exports, [rates, undefined]);
  assert.deepEqual(f.effects.links, [FEEDBACK_DOCUMENT_URL]);
});
