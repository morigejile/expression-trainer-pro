'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../models/registry.json');
const {createAsrModelManagementRouter} = require('../lib/asr-model-management');
const content = require('../src/utility-content');

class Element {
  constructor(document, tag = 'div') {
    this.ownerDocument = document; this.tagName = tag.toUpperCase(); this.children = [];
    this.dataset = {}; this.listeners = new Map(); this.attributes = {}; this.className = '';
    this._text = ''; this.open = false; this.disabled = false; this.value = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { assert.fail('HTML parsing is forbidden'); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(key, handler) { this.listeners.set(key, handler); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector) {
    return this.all().filter(child => {
      const data = selector.match(/\[data-([a-z-]+)(?:="([^"]*)")?\]/);
      if (data) {
        const key = data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return Object.hasOwn(child.dataset, key) && (data[2] === undefined || child.dataset[key] === data[2]);
      }
      if (selector.startsWith('#')) return child.id === selector.slice(1);
      return selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector.toUpperCase();
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
class Document { createElement(tag) { return new Element(this, tag); } }
function view() { const document = new Document(); return {document, parent: document.createElement('main')}; }
function help(fixture, page, options) {
  assert.equal(typeof content.help, 'function', 'UtilityContent.help must render the Help surface');
  return content.help(fixture.document, fixture.parent, page, options);
}
function speech(fixture, state, options) {
  assert.equal(typeof content.renderSpeech, 'function', 'UtilityContent.renderSpeech must render the model DTO');
  return content.renderSpeech(fixture.document, fixture.parent, state, options);
}
function click(element) { assert.ok(element, 'action is rendered'); return element.listeners.get('click')(); }
const SMALL = 'zipformer-small-ctc-zh-int8-2025-04-01';
const LARGE = registry.defaultModelId;
const SENSE = 'sensevoice-small-int8-2024-07-17';
async function modelState({installed = [LARGE], service = {}, task = {}, catalog = registry} = {}) {
  const router = createAsrModelManagementRouter({
    catalog,
    modelManager: {async getActive(modelId) {
      if (installed[modelId] instanceof Error) throw installed[modelId];
      return Array.isArray(installed) ? installed.includes(modelId) : installed[modelId];
    }},
    modelService: {
      snapshot: () => ({status: 'ready', selectedModelId: LARGE, effectiveModelId: LARGE, overrideModelId: null, activeSession: false, ...service}),
      async switchModel() {}
    },
    installTask: {
      snapshot: () => ({status: 'idle', modelId: null, phase: null, receivedBytes: 0, totalBytes: null, errorCode: null, ...task}),
      async start() {}, async cancel() {}
    }
  });
  const result = await router.getModelState(); assert.equal(result.ok, true); return result.state;
}

test('quick-start shows all steps and FAQs without search', () => {
  const fixture = view();
  help(fixture, 'start');
  assert.equal(fixture.parent.querySelector('#help-search'), null);
  assert.equal(fixture.parent.querySelector('.help-search'), null);
  assert.equal(fixture.parent.querySelectorAll('.steps').length, 1);
  assert.equal(fixture.parent.querySelectorAll('.faq').length, 2);
  assert.doesNotMatch(fixture.parent.textContent, /搜索结果|没有找到/);
});

test('quick-start describes optional AI and renders two full answers without disclosure controls', () => {
  const fixture=view(),settings=[];
  help(fixture,'start',{onSettings:page=>settings.push(page)});
  const text=fixture.parent.textContent;
  assert.match(text,/开始一次表达.*点击首页的 start/);assert.match(text,/倒计时后开始/);
  assert.match(text,/查看本次记录.*转写、录音和本地统计/);
  assert.match(text,/配置 AI 后.*自动分析.*报告中手动分析/);
  assert.match(text,/回看，或继续练习.*history.*报告提供具体建议时/);
  assert.match(text,/录音、转写、回放.*本地统计和历史/);
  assert.match(text,/保存不依赖 AI 分析成功/);
  assert.match(text,/实时字幕取决于.*语音识别模型.*流式.*结束后转写/);
  assert.equal(fixture.parent.querySelectorAll('.quick-start-faq').length,2);
  assert.equal(fixture.parent.querySelectorAll('details').length,0);
  assert.equal(fixture.parent.querySelectorAll('summary').length,0);
  click(fixture.parent.querySelector('[data-setting="speech"]'));assert.deepEqual(settings,['speech']);
  help(fixture,'report');assert.ok(fixture.parent.querySelectorAll('details').length>0);
  assert.equal(fixture.parent.querySelectorAll('.quick-start-faq').length,0);
});

test('Help navigation replaces each page with its own full content', () => {
  const fixture = view();
  for (const page of ['report', 'privacy', 'feedback', 'report']) {
    help(fixture, page);
    assert.equal(fixture.parent.querySelector('#help-search'), null);
    assert.equal(fixture.parent.querySelectorAll('#help-results').length, 1);
    assert.equal(fixture.parent.querySelectorAll('.steps').length, 0);
    assert.doesNotMatch(fixture.parent.textContent, /搜索结果|没有找到|第一次怎么开始练习/);
    if (page === 'report') assert.match(fixture.parent.textContent, /怎样比较两次训练/);
    if (page === 'privacy') assert.match(fixture.parent.textContent, /原始音频/);
    if (page === 'feedback') assert.equal(fixture.parent.querySelectorAll('.feedback-faq').length, 3);
  }
});

test('privacy keeps the actual disclosure, credential and selected-record deletion boundaries', () => {
  const fixture = view(); const settings = [];
  help(fixture, 'privacy', {onSettings: page => settings.push(page)});
  const text = fixture.parent.textContent;
  assert.match(text, /Report|报告内/);
  assert.match(text, /相关证据.*时间.*指标.*分析指令.*训练方式.*框架.*主题.*场景/);
  assert.match(text, /必要的上一轮转写.*上下文/);
  assert.match(text, /原始音频.*密钥.*无关历史.*不进入分析内容/);
  assert.match(text, /接口.*配置凭据.*认证/);
  assert.match(text, /127\.0\.0\.1.*::1/);
  assert.match(text, /明文.*配置文件|配置文件.*明文/);
  assert.match(text, /遮盖.*不等于.*加密/);
  assert.match(text, /不自动开启.*自动分析/);
  assert.match(text, /选中.*录音.*转写.*结果/);
  assert.match(text, /不.*连带删除|不.*级联删除/);
  assert.doesNotMatch(text, /此预览|模拟|重新转写/);
  assert.equal(fixture.parent.querySelectorAll('.help-facts').length, 1);
  assert.equal(fixture.parent.querySelectorAll('.faq').every(node => node.children[0].tagName === 'SUMMARY'), true);
  assert.deepEqual(settings, []);
  click(fixture.parent.querySelector('.help-footer-link')); assert.deepEqual(settings, ['ai']);
});

test('feedback and export invoke only the explicit Help actions and render app info as text', () => {
  const fixture = view(); const calls = []; const hostile = '<img src=x onerror=alert(1)>';
  help(fixture, 'feedback', {
    appInfo: {version: hostile, platform: 'Windows'},
    onFeedback: () => calls.push('feedback'), onExport: () => calls.push('export'),
    onSettings: page => calls.push(page)
  });
  assert.deepEqual(calls, []);
  assert.equal(fixture.parent.querySelectorAll('img').length, 0);
  assert.ok(fixture.parent.textContent.includes(hostile));
  assert.match(fixture.parent.textContent, /诊断.*不包含.*转写.*音频.*密钥.*绝对路径.*错误堆栈/);
  assert.doesNotMatch(fixture.parent.textContent, /检查成功|已导出|已发送|此预览|模拟/);
  click(fixture.parent.querySelector('[data-export]'));
  click(fixture.parent.querySelector('[data-feedback]'));
  click(fixture.parent.querySelector('[data-setting="speech"]'));
  assert.deepEqual(calls, ['export', 'feedback', 'speech']);
  help(fixture, 'report');
  assert.equal(fixture.parent.querySelectorAll('[data-export]').length, 0);
  assert.equal(fixture.parent.querySelectorAll('[data-feedback]').length, 0);
  assert.equal(fixture.parent.querySelectorAll('.help-facts').length, 1);
});

test('feedback shows all three original answers and their settings actions without disclosures',()=>{
  const fixture=view(),actions=[];
  help(fixture,'feedback',{onSettings:page=>actions.push(page),appInfo:{version:'1.0.1'}});
  assert.doesNotMatch(fixture.parent.textContent,/找到遇到的问题，按提示检查/);
  assert.equal(fixture.parent.querySelectorAll('details').length,0);assert.equal(fixture.parent.querySelectorAll('summary').length,0);
  assert.equal(fixture.parent.querySelectorAll('.feedback-faq').length,3);
  assert.match(fixture.parent.textContent,/系统默认输入设备/);assert.match(fixture.parent.textContent,/之前可用的模型仍会保留/);
  assert.match(fixture.parent.textContent,/测试成功后仍需保存配置/);assert.match(fixture.parent.textContent,/1\.0\.1/);
  click(fixture.parent.querySelector('[data-setting="speech"]'));assert.deepEqual(actions,['speech']);
  assert.ok(fixture.parent.querySelector('[data-export]'));
  help(fixture,'privacy');assert.ok(fixture.parent.querySelectorAll('details').length>0);
});

test('speech uses the actual Catalog DTO, distinguishes utterance mode and dispatches its exact model action', async () => {
  const fixture = view(); const calls = []; const state = await modelState({installed: [LARGE, SENSE]});
  speech(fixture, state, {onAction: (modelId, action) => calls.push([modelId, action])});
  const cards = fixture.parent.querySelectorAll('.speech-model'); assert.equal(cards.length, 4);
  const sense = cards.find(card => card.dataset.modelId === SENSE);
  assert.match(sense.textContent, /结束后转写.*无实时字幕/);
  assert.match(sense.querySelector('p').textContent, /^结束后转写/);
  assert.match(cards.find(card => card.dataset.modelId === LARGE).textContent, /实时字幕/);
  const button = sense.querySelector('[data-model-action="switch"]'); assert.equal(button.dataset.modelId, SENSE);
  click(button); assert.deepEqual(calls, [[SENSE, 'switch']]);
  click(fixture.parent.querySelector('[data-model-action="install"]'));
  assert.deepEqual(calls[1], ['paraformer-bilingual-zh-en', 'install']);
});

test('speech displays effective override separately from the persistent selected model and unavailable service', async () => {
  const fixture = view();
  const state = await modelState({installed: [LARGE, SENSE], service: {effectiveModelId: SENSE, overrideModelId: SENSE}});
  speech(fixture, state);
  assert.match(fixture.parent.textContent, /命令行.*覆盖/);
  assert.match(fixture.parent.textContent, /持久选择.*Zipformer Large/);
  assert.equal(fixture.parent.querySelectorAll('.active-status').length, 1);
  assert.equal(fixture.parent.querySelectorAll('.speech-model').find(card => card.dataset.modelId === SENSE).querySelector('.active-status').textContent, '使用中');
  assert.equal(fixture.parent.querySelectorAll('[data-model-action="switch"]').length, 0);
  speech(fixture, await modelState({service: {status: 'unavailable'}}));
  assert.equal(fixture.parent.querySelectorAll('.active-status').length, 0);
  assert.match(fixture.parent.textContent, /当前不可用/);
});

test('speech renders reliable download progress and leaves unknown totals and verification indeterminate', async () => {
  const fixture = view();
  const running = {status: 'running', modelId: SMALL, phase: 'downloading', receivedBytes: 50, totalBytes: 200};
  speech(fixture, await modelState({task: running}));
  let progress = fixture.parent.querySelector('progress');
  assert.equal(progress.attributes.value, '25'); assert.equal(progress.attributes.max, '100');
  assert.match(fixture.parent.querySelector('.install-progress').textContent, /25%.*下载/);
  for (const task of [
    {...running, totalBytes: null}, {...running, totalBytes: 0}, {...running, totalBytes: Infinity},
    {...running, totalBytes: 40}, {...running, totalBytes: 2.5}, {...running, phase: 'verifying'}
  ]) {
    speech(fixture, await modelState({task})); progress = fixture.parent.querySelector('progress');
    assert.equal(Object.hasOwn(progress.attributes, 'value'), false);
    assert.doesNotMatch(fixture.parent.querySelector('.install-progress').textContent, /%/);
  }
});

test('speech uses retry, reinstall and cancel supplied by real state and busy prevents duplicate dispatch', async () => {
  const fixture = view(); const actions = [];
  const corrupt = Object.assign(new Error('corrupt'), {code: 'asr-model-corrupt'});
  speech(fixture, await modelState({installed: {[LARGE]: true, [SMALL]: corrupt}}), {onAction: (id, action) => actions.push([id, action])});
  click(fixture.parent.querySelector('[data-model-action="reinstall"]')); assert.deepEqual(actions, [[SMALL, 'reinstall']]);
  speech(fixture, await modelState({task: {status: 'failed', modelId: SMALL}}), {onAction: (id, action) => actions.push([id, action])});
  click(fixture.parent.querySelector('[data-model-action="retry"]')); assert.deepEqual(actions[1], [SMALL, 'retry']);
  speech(fixture, await modelState({task: {status: 'running', modelId: SMALL}}), {onAction: (id, action) => actions.push([id, action]), busy: true});
  const cancel = fixture.parent.querySelector('[data-model-action="cancel"]'); assert.equal(cancel.disabled, true);
  click(cancel); assert.equal(actions.length, 2);
  speech(fixture, await modelState({task: {status: 'running', modelId: SMALL}}), {onAction: (id, action) => actions.push([id, action])});
  click(fixture.parent.querySelector('[data-model-action="cancel"]')); assert.deepEqual(actions[2], [SMALL, 'cancel']);
});

test('speech never inserts model content as HTML or invents unsupported actions or a ready state', async () => {
  const fixture = view(); const hostile = '<img src=x onerror=alert(1)>';
  const catalog = {...registry, models: registry.models.map(model => model.modelId === LARGE ? {...model, displayName: hostile, description: hostile} : model)};
  const actual = await modelState({catalog});
  const state = {...actual, models: actual.models.map(model => ({...model, action: 'delete'}))};
  speech(fixture, state);
  assert.ok(fixture.parent.textContent.includes(hostile)); assert.equal(fixture.parent.querySelectorAll('img').length, 0);
  assert.equal(fixture.parent.querySelectorAll('[data-model-action]').length, 0);
  speech(fixture, null); assert.equal(fixture.parent.querySelectorAll('.active-status').length, 0);
  assert.match(fixture.parent.textContent, /尚未取得模型状态/);
});
