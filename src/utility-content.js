(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UtilityContent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const questions = [
    {title: '怎样比较两次训练？', group: 'report', answer: '在训练历史中勾选两条记录，点击对比。较早的一次作为基线。对比读取已有结果，不会重新调用 AI。'},
    {title: '针对性练习后，先看哪里？', group: 'report', answer: '先看顶部的本轮目标反馈，再展开上一轮与本轮的证据。完整报告和其他建议仍可继续查看。'},
    {title: '第一次怎么开始练习？', group: 'start', searchOnly: true, answer: '在准备页点击开始，主题、场景和框架都可选。首次录音先阅读数据说明，确认后再授权麦克风。录音中可以暂停、继续或结束。'},
    {title: '没有配置 AI，还能使用吗？', group: 'start', answer: '可以录音、转写、回放，查看本地统计和历史。AI 分析需要有效配置；保存不依赖 AI 分析成功。'},
    {title: '为什么录音时没有字幕？', group: 'start', answer: '是否提供实时字幕取决于当前语音识别模型：流式识别模型会在录音中显示字幕，结束后转写模型会在录音结束后生成转写。可在语音识别设置中查看当前模型并按需选择。', action: 'speech'},
    {title: '主题、框架和练习目标有什么区别？', group: 'report', answer: '主题是讲什么，场景是对谁、在什么情境下讲，框架是如何组织表达。练习目标来自你选定的具体问题；分析偏好则是长期关注点。'},
    {title: '为什么没有分数或雷达图？', group: 'report', answer: '评分维度尚未完成校准，暂不提供分数或雷达图。可以先看结论、原文依据和练习建议。'},
    {title: '分析失败，会丢掉录音吗？', group: 'report', answer: '若界面已确认训练保存，录音和已有结果仍可查看，也可以重试分析。若提示保存失败，需要先处理保存问题。'},
    {title: '打开历史记录会再次调用 AI 吗？', group: 'report', answer: '不会。历史报告读取已保存的结果。更改模型或服务不会重算；只有主动分析才会生成新结果。'},
    {title: '两次训练一定能比较吗？', group: 'report', answer: '练习范围、指标或证据不一致时，报告会说明限制。针对性练习与上一轮比较；上一轮缺失时，会显示缺失状态。'},
    {title: '远程 AI 分析会发送哪些内容？', group: 'privacy', answer: '手动分析或已开启的自动分析，只发送完成分析所必需的本次转写及片段引用、相关证据、语音区间和音频时长等时间信息、停顿及质量状态、确定性指标、分析指令，以及原训练方式、所选框架、可选主题和场景。针对性练习仅补充所选目标、范围和必要的上一轮转写与训练上下文。原始音频、密钥和无关历史不进入分析内容；远程服务按其接口使用配置凭据完成认证。'},
    {title: 'AI 数据说明需要每次确认吗？', group: 'privacy', answer: '首次实际使用 AI 分析时，在报告内统一告知本地与远程分析及必要的数据范围。自动分析已开启时先保存训练并进入报告，确认后才分析；自动分析关闭时，只在首次主动分析时告知。取消或关闭不执行本次分析，也不记为完成告知。确认状态保存在本机，重启仍有效；已覆盖范围未实质扩大时，再次分析或更换服务、模型、地址及本地/远程切换不重复弹窗。此前仅覆盖本地分析时，首次远程分析前补充告知；发送范围实质扩大时重新告知。完成告知不自动开启任何配置的自动分析。'},
    {title: '怎样判断 AI 是否在本机运行？', group: 'privacy', answer: '查看配置中的实际服务地址。localhost、127.0.0.1 和 ::1 是本机回环地址；局域网或互联网地址属于远程服务。Ollama 也以实际地址为准。', action: 'ai'},
    {title: '密钥怎样保存？', group: 'privacy', answer: 'API 密钥当前以明文保存在本机配置文件中，尚未使用系统安全凭据存储；遮盖显示不等于加密保存。远程服务按接口使用密钥认证，密钥不进入训练分析内容。'},
    {title: '怎样删除训练数据？', group: 'privacy', answer: '在训练历史中选中需要删除的记录并确认。删除仅移除选中记录的录音、转写和已有结果，不会连带删除其他训练或后续练习。来源记录删除后，后续练习仍保留，相关对比会说明上一轮缺失。'},
    {title: '麦克风不可用怎么办？', group: 'feedback', answer: '检查系统麦克风权限、设备连接和是否被其他应用占用，再回到准备页重试。应用使用系统默认输入设备；更换设备请在系统设置中操作。'},
    {title: '模型下载失败怎么办？', group: 'feedback', answer: '检查网络和可用磁盘空间，再到语音识别设置重试。下载或校验失败时，之前可用的模型仍会保留。', action: 'speech'},
    {title: 'AI 连接失败怎么办？', group: 'feedback', answer: '检查正在使用的配置、模型名称、地址和密钥。测试成功后仍需保存配置，并按需开启自动分析。保存服务、模型或地址的变更会关闭该配置的自动分析，需要重新明确开启；已覆盖的数据范围无需再次告知。', action: 'ai'}
  ];

  function element(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function button(document, text, dataKey, dataValue, callback, className) {
    const node = element(document, 'button', className, text);
    node.type = 'button';
    node.dataset[dataKey] = dataValue;
    node.disabled = typeof callback !== 'function';
    node.addEventListener('click', () => { if (!node.disabled) return callback(); });
    return node;
  }

  function faq(document, parent, question, options, fullAnswer = false) {
    const detail = element(document, fullAnswer ? 'section' : 'details', fullAnswer ? `faq ${question.group === 'feedback' ? 'feedback-faq' : 'quick-start-faq'}` : 'faq');
    detail.appendChild(element(document, fullAnswer ? 'h3' : 'summary', null, question.title));
    const body = element(document, 'div');
    body.appendChild(element(document, 'p', null, question.answer));
    if (question.action) body.appendChild(button(document, '打开相关设置 →', 'setting', question.action,
      typeof options.onSettings === 'function' ? () => options.onSettings(question.action) : null));
    detail.appendChild(body); parent.appendChild(detail);
  }

  function groupedQuestions(document, parent, page, options) {
    for (const question of questions) if (question.group === page && !question.searchOnly) faq(document, parent, question, options, page === 'start' || page === 'feedback');
  }

  function facts(document, parent, rows) {
    const list = element(document, 'dl', 'help-facts');
    for (const [title, description] of rows) {
      const row = element(document, 'div');
      row.appendChild(element(document, 'dt', null, title));
      row.appendChild(element(document, 'dd', null, description));
      list.appendChild(row);
    }
    parent.appendChild(list);
  }

  function start(document, parent, options) {
    const steps = element(document, 'ol', 'steps');
    for (const [title, description] of [
      ['开始一次表达', '点击首页的 start。框架、主题和场景都可跳过；首次录音按提示确认说明并授权麦克风，倒计时后开始。录音中可以暂停、继续或结束。'],
      ['查看本次记录', '结束后查看转写、录音和本地统计。配置 AI 后，可选择自动分析或在报告中手动分析。'],
      ['回看，或继续练习', '在 history 中查看已保存记录。报告提供具体建议时，可以从建议进入下一轮针对性练习。']
    ]) {
      const item = element(document, 'li'), body = element(document, 'div');
      body.appendChild(element(document, 'h3', null, title));
      body.appendChild(element(document, 'p', null, description));
      item.appendChild(body); steps.appendChild(item);
    }
    parent.appendChild(steps);
    parent.appendChild(element(document, 'h2', 'help-section-title', '常见问题'));
    groupedQuestions(document, parent, 'start', options);
  }

  function report(document, parent, options) {
    facts(document, parent, [
      ['先看结论', '了解这次表达的重点，找到一个值得改善的问题。'],
      ['再看依据', '结合原话、解释和改进示例理解问题，示例仅供参考。'],
      ['继续练习', '从具体问题进入下一轮，带着一个目标继续练。']
    ]);
    parent.appendChild(element(document, 'h2', 'help-section-title', '报告与练习'));
    groupedQuestions(document, parent, 'report', options);
    parent.appendChild(element(document, 'p', 'hint help-note', '转写和时间标记是复盘线索，请结合原话、来源与语境判断。'));
  }

  function privacy(document, parent, options) {
    facts(document, parent, [
      ['本机保存', '录音、逐字稿、训练记录和分析结果由应用自动保存，保存完成后可从训练历史查看。删除只影响明确选中的记录。'],
      ['远程分析', '首次实际使用 AI 时在报告内说明数据范围，已覆盖范围不重复弹窗。自动分析默认关闭；原始音频不发送给远程 AI。']
    ]);
    parent.appendChild(element(document, 'h2', 'help-section-title', '数据使用说明'));
    groupedQuestions(document, parent, 'privacy', options);
    const link = button(document, 'AI 服务设置 ', 'setting', 'ai',
      typeof options.onSettings === 'function' ? () => options.onSettings('ai') : null, 'help-link help-footer-link');
    const arrow = element(document, 'span', null, '→'); arrow.setAttribute('aria-hidden', 'true'); link.appendChild(arrow);
    parent.appendChild(link);
  }

  function feedback(document, parent, options) {
    groupedQuestions(document, parent, 'feedback', options);
    const section = element(document, 'section', 'diagnostic');
    const title = element(document, 'div', 'section-title');
    title.appendChild(element(document, 'h2', null, '问题反馈')); section.appendChild(title);
    const info = options.appInfo;
    if (info && typeof info === 'object') {
      const version = typeof info.version === 'string' ? info.version : typeof info.appVersion === 'string' ? info.appVersion : null;
      const platform = typeof info.platform === 'string' ? info.platform : null;
      if (version || platform) {
        const row = element(document, 'div', 'check-row');
        row.appendChild(element(document, 'span', null, '应用版本'));
        row.appendChild(element(document, 'span', null, [version, platform].filter(Boolean).join(' · ')));
        section.appendChild(row);
      }
    }
    section.appendChild(element(document, 'p', 'hint', '诊断信息不包含逐字转写、音频、密钥、绝对路径或完整错误堆栈。可先导出脱敏诊断 JSON，再将问题与复现步骤补充到反馈文档。'));
    const actions = element(document, 'div', 'action-row');
    actions.appendChild(button(document, '导出诊断信息', 'export', '', options.onExport));
    actions.appendChild(button(document, '打开问题和建议文档', 'feedback', '', options.onFeedback));
    section.appendChild(actions);
    const status = element(document, 'p', 'hint'); status.id = 'utility-feedback-status'; status.setAttribute('role', 'status');
    section.appendChild(status); parent.appendChild(section);
    parent.appendChild(element(document, 'p', 'hint', '导出诊断和打开反馈文档均由你主动操作，不会自动提交反馈。'));
  }

  function help(document, parent, page, options = {}) {
    parent.replaceChildren();
    const selected = ['start', 'report', 'privacy', 'feedback'].includes(page) ? page : 'start';
    const results = element(document, 'div'); results.id = 'help-results';
    let searchInput = null;
    function search(query) {
      // Quick Start always shows its steps and FAQ, including after stale queries.
      const normalized = selected === 'start' ? '' : String(query ?? '').trim().toLowerCase();
      results.replaceChildren();
      if (!normalized) { ({start, report, privacy, feedback})[selected](document, results, options); return; }
      const matches = questions.filter(question => (question.title + question.answer).toLowerCase().includes(normalized));
      results.appendChild(element(document, 'p', 'help-filter-meta', `搜索结果 · ${matches.length} 项`));
      for (const question of matches) faq(document, results, question, options, selected === 'feedback');
      if (!matches.length) {
        results.appendChild(element(document, 'p', 'intro', '没有找到匹配内容。试试“录音”“AI”或“隐私”。'));
        results.appendChild(button(document, '前往问题与反馈', 'help', 'feedback',
          typeof options.onHelp === 'function' ? () => options.onHelp('feedback') : null));
      }
    }
    parent.appendChild(results); search('');
    return {searchInput, results, search};
  }

  const actionLabels = Object.freeze({install: '安装', retry: '重试', reinstall: '重新安装', cancel: '取消安装', switch: '使用'});
  const statusLabels = Object.freeze({'not-installed': '未安装', installing: '安装中', installed: '已安装', corrupt: '模型文件损坏', failed: '安装失败', unavailable: '状态不可用'});

  function downloadSize(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return '下载大小未知';
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
  }

  function progress(document, parent, model, task) {
    if (task?.status !== 'running' || task.modelId !== model.modelId) return;
    const row = element(document, 'div', 'install-progress');
    const meter = element(document, 'progress');
    meter.setAttribute('max', '100'); meter.setAttribute('aria-label', `${model.displayName} 安装进度`);
    const phase = {downloading: '下载中', verifying: '校验中', installing: '安装中'}[task.phase] || '安装中';
    const knownTotal = task.phase === 'downloading' && Number.isSafeInteger(task.totalBytes) && task.totalBytes > 0
      && Number.isSafeInteger(task.receivedBytes) && task.receivedBytes >= 0 && task.receivedBytes <= task.totalBytes;
    let label = phase;
    if (knownTotal) {
      const percent = Math.floor(task.receivedBytes / task.totalBytes * 100);
      meter.setAttribute('value', String(percent)); label = `${percent}% · ${phase}`;
    }
    row.appendChild(meter); row.appendChild(element(document, 'span', null, label)); parent.appendChild(row);
  }

  function modelRow(document, parent, model, state, options) {
    const card = element(document, 'article', 'speech-model'); card.dataset.modelId = model.modelId;
    const top = element(document, 'div', 'speech-model-top'), info = element(document, 'div');
    info.appendChild(element(document, 'h3', null, model.displayName));
    const mode = model.mode === 'streaming' ? '实时字幕 · 最长 20 分钟'
      : model.mode === 'utterance' ? '结束后转写 · 无实时字幕 · 最长 5 分钟' : '字幕方式未知';
    info.appendChild(element(document, 'p', null, `${mode} · ${downloadSize(model.downloadBytes)}${model.builtIn ? ' · 安装包内置' : ''}`));
    top.appendChild(info);
    const effective = model.modelId === state.effectiveModelId;
    const available = effective && state.serviceStatus === 'ready' && model.status === 'installed';
    if (available) {
      const badge = element(document, 'span', 'active-status');
      const dot = element(document, 'i'); dot.setAttribute('aria-hidden', 'true'); badge.appendChild(dot);
      badge.appendChild(element(document, 'span', null, '使用中')); top.appendChild(badge);
    } else if (Object.hasOwn(actionLabels, model.action)) {
      const action = button(document, actionLabels[model.action], 'modelAction', model.action,
        typeof options.onAction === 'function' ? () => options.onAction(model.modelId, model.action) : null);
      action.dataset.modelId = model.modelId; action.disabled = action.disabled || Boolean(options.busy); top.appendChild(action);
    }
    card.appendChild(top);
    if (!available) card.appendChild(element(document, 'small', null, effective && state.serviceStatus !== 'ready'
      ? state.serviceStatus === 'switching' ? '正在切换模型' : '语音识别当前不可用'
      : statusLabels[model.status] || '状态不可用'));
    if (model.modelId === state.selectedModelId && model.modelId !== state.effectiveModelId) card.appendChild(element(document, 'small', null, '已选择，当前尚未生效'));
    progress(document, card, model, state.installTask); parent.appendChild(card);
  }

  function renderSpeech(document, parent, state, options = {}) {
    parent.replaceChildren();
    parent.appendChild(element(document, 'p', 'settings-intro', '语音识别在本机运行；模型决定支持的语言和字幕方式。'));
    if (!state || !Array.isArray(state.models)) {
      parent.appendChild(element(document, 'p', 'empty-settings', '尚未取得模型状态，请稍后重试。')); return;
    }
    const current = state.models.find(model => model.modelId === state.effectiveModelId);
    const selected = state.models.find(model => model.modelId === state.selectedModelId);
    if (state.overrideModelId) parent.appendChild(element(document, 'p', 'hint', `本次启动使用命令行覆盖；持久选择：${selected?.displayName || state.selectedModelId || '尚未选择'}。`));
    else if (selected && selected.modelId !== state.effectiveModelId) parent.appendChild(element(document, 'p', 'hint', `持久选择：${selected.displayName}；当前尚未生效。`));
    for (const [title, models, className] of [
      ['当前使用', current ? [current] : [], 'settings-group first-group'],
      ['其他模型', state.models.filter(model => model.modelId !== state.effectiveModelId), 'settings-group']
    ]) {
      const section = element(document, 'section', className), heading = element(document, 'header', 'settings-section-head');
      heading.appendChild(element(document, 'h2', null, title)); section.appendChild(heading);
      if (!models.length) section.appendChild(element(document, 'p', 'empty-settings', title === '当前使用'
        ? '尚无正在使用的模型。请安装可用模型并选择使用。' : '没有其他可管理的模型。'));
      for (const model of models) modelRow(document, section, model, state, options);
      parent.appendChild(section);
    }
    if (state.activeSession) parent.appendChild(element(document, 'p', 'hint', '请先结束当前录音，再切换语音识别模型。'));
    parent.appendChild(button(document, '模型或麦克风遇到问题 →', 'help', 'feedback',
      typeof options.onHelp === 'function' ? () => options.onHelp('feedback') : null, 'settings-help-link'));
  }

  return Object.freeze({help, renderSpeech});
});
