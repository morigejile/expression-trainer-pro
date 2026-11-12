(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrainingContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const {getFramework,getBankTopicTitle} = typeof module !== 'undefined' && module.exports ? require('./training-frameworks') : globalThis.TrainingFrameworks;
  const MAX_PROMPT_LENGTH = 2000;
  function normalizeTrainingPrompt(prompt) {
    const invalid = () => { throw Object.assign(new Error('Invalid training context'), {code:'INVALID_SESSION'}); };
    if (prompt == null) return null;
    if (typeof prompt !== 'object' || Array.isArray(prompt)) invalid();
    function part(value, legacy = false) {
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some(key => !(legacy ? ['source','kind','text'] : ['source','text']).includes(key)) ||
          !['user','bank','generated'].includes(value.source) || typeof value.text !== 'string' ||
          !value.text.trim() || value.text.length > MAX_PROMPT_LENGTH) invalid();
      return {source:value.source,text:value.text};
    }
    if (Object.hasOwn(prompt,'schemaVersion')) {
      if (prompt.schemaVersion !== 2 || Object.keys(prompt).length !== 3 ||
          !Object.hasOwn(prompt,'topic') || !Object.hasOwn(prompt,'scenario')) invalid();
      const topic = prompt.topic === null ? null : part(prompt.topic);
      const scenario = prompt.scenario === null ? null : part(prompt.scenario);
      return topic || scenario ? {schemaVersion:2,topic,scenario} : null;
    }
    const value = part(prompt,true);
    if (!['topic','scenario'].includes(prompt.kind)) invalid();
    return {source:value.source,kind:prompt.kind,text:value.text};
  }
  function getPromptParts(prompt) {
    const value = normalizeTrainingPrompt(prompt);
    if (value?.schemaVersion === 2) return {topic:value.topic,scenario:value.scenario};
    return {topic:value?.kind === 'topic' ? {source:value.source,text:value.text} : null,
      scenario:value?.kind === 'scenario' ? {source:value.source,text:value.text} : null};
  }
  function normalizeTrainingContext(input = {}) {
    const invalid = () => { throw Object.assign(new Error('Invalid training context'), {code:'INVALID_SESSION'}); };
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
    const trainingMode = input.trainingMode ?? 'free';
    if (!['free','structured'].includes(trainingMode)) invalid();
    if (trainingMode === 'free' && (input.framework != null || input.frameworkDefinitionVersion != null)) invalid();
    if (trainingMode === 'structured' && (typeof input.frameworkDefinitionVersion !== 'string' ||
        !getFramework(input.framework,input.frameworkDefinitionVersion))) invalid();
    const prompt = normalizeTrainingPrompt(input.trainingPrompt);
    return {trainingMode, framework:trainingMode === 'free' ? null : input.framework,
      frameworkDefinitionVersion:trainingMode === 'free' ? null : input.frameworkDefinitionVersion,
      trainingPrompt:prompt};
  }
  function formatTrainingContext(context) {
    const mode = context?.trainingMode === 'structured'
      ? ({prep:'PREP', star:'STAR', pyramid:'金字塔'}[context.framework] || '结构化表达') : '自由表达';
    const prompt = context?.trainingPrompt;
    if (prompt?.schemaVersion === 2) return [mode,prompt.topic && `主题：${prompt.topic.text}`,
      prompt.scenario && `场景：${prompt.scenario.text}`].filter(Boolean).join(' · ');
    return prompt ? `${mode} · ${prompt.kind === 'scenario' ? '场景' : '主题'}：${prompt.text}` : mode;
  }
  function normalizePracticeTitle(value) {
    if (typeof value !== 'string') return null;
    const title = value.trim();
    return title.length > 0 && title.length <= 40 && !/[\r\n\u2028\u2029]/u.test(title) ? title : null;
  }
  function getPracticeTitle(record) {
    const prompt = record.trainingPrompt;
    const topic = prompt?.schemaVersion === 2 ? prompt.topic : prompt?.kind === 'topic' ? prompt : null;
    if (topic?.text) {
      return (topic.source === 'bank' ? getBankTopicTitle(topic.text) : null) ?? topic.text;
    }
    const projected = normalizePracticeTitle(record.practiceTitle);
    if (projected) return projected;
    for (const run of record.results || []) {
      if (run.kind !== 'diagnosis' || run.status !== 'completed') continue;
      const title = normalizePracticeTitle(run.value?.practiceTitle);
      if (title) return title;
    }
    return '未命名练习';
  }
  return {MAX_PROMPT_LENGTH, normalizeTrainingContext, normalizeTrainingPrompt, getPromptParts, formatTrainingContext,
    getPracticeTitle, normalizePracticeTitle};
});
