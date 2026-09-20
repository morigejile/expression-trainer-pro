(function(root, factory) {
  const context = typeof module !== 'undefined' && module.exports ? require('../shared/training-context') : root.TrainingContext;
  const frameworks = typeof module !== 'undefined' && module.exports ? require('../shared/training-frameworks') : root.TrainingFrameworks;
  const api = factory(context,frameworks);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrainingSetup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(context,frameworks) {
  'use strict';
  const {normalizeTrainingContext,normalizeTrainingPrompt,getPromptParts,formatTrainingContext,MAX_PROMPT_LENGTH} = context;
  const {getFramework,getPromptOptions} = frameworks;
  function createTrainingSetup({api,document}) {
    const byId = id => document.getElementById(id);
    const view = document.defaultView;
    const settings = byId('training-settings'), anchor = byId('training-settings-anchor'), capsules = byId('training-capsules');
    const picker = byId('training-picker'), title = byId('training-picker-title'), hint = byId('training-picker-hint'), content = byId('training-picker-content');
    const label = byId('training-context-label'), status = byId('training-context-status'), focus = byId('training-practice-focus');
    const buttons = {framework:byId('training-framework'),topic:byId('training-topic'),scenario:byId('training-scenario')};
    const names = {framework:'表达框架',topic:'主题',scenario:'场景'};
    let draft = normalizeTrainingContext(), dirty = false, locked = false;
    let practiceRequest = null, practiceLabel = '', active = null, custom = null, invalidCustom = false;
    let collapseTimer = null, keyboardMode = false, pickerView = null;
    const isOpen = () => picker.matches(':popover-open');
    const short = text => text.replace(/\s+/g,' ').trim().slice(0,12) + (text.trim().length > 12 ? '…' : '');
    function reveal(value) {
      clearTimeout(collapseTimer);
      const shown = Boolean(value && !locked);
      capsules.hidden = !shown;
      anchor.setAttribute('aria-expanded',String(shown));
    }
    function queueCollapse() {
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(() => {
        if (!isOpen() && !settings.matches(':hover') && !(keyboardMode && settings.contains(document.activeElement))) reveal(false);
      },280);
    }
    function render() {
      label.textContent = formatTrainingContext(draft);
      const definition = getFramework(draft.framework,draft.frameworkDefinitionVersion);
      buttons.framework.textContent = definition?.label || '自由表达';
      const parts = getPromptParts(draft.trainingPrompt);
      for (const kind of ['topic','scenario']) {
        const value = parts[kind];
        const preset = value && getPromptOptions(kind).find(item => item.text === value.text);
        buttons[kind].textContent = value ? `${names[kind]} · ${preset?.label || short(value.text)}` : `${names[kind]} · 可选`;
        buttons[kind].title = value?.text || `选择${names[kind]}，也可以不设置`;
      }
      for (const [kind,button] of Object.entries(buttons)) {
        button.disabled = locked;
        button.setAttribute('aria-label',`${names[kind]}：${button.textContent}`);
      }
      anchor.disabled = locked;
      focus.hidden = !practiceRequest;
      focus.textContent = practiceRequest ? `本次练习：${practiceLabel}（${{sentence:'句子',segment:'片段',full:'完整表达'}[practiceRequest.scope]}）。若已启用 AI 诊断，会使用本轮与上一轮转写比较这个目标，原始录音留在本机。` : '';
    }
    function setPart(kind,value) {
      const parts = getPromptParts(draft.trainingPrompt);
      parts[kind] = value;
      draft.trainingPrompt = normalizeTrainingPrompt({schemaVersion:2,...parts});
      dirty = true; status.textContent = ''; render();
    }
    function positionPicker() {
      if (!active || !isOpen()) return;
      const rect = buttons[active].getBoundingClientRect();
      const margin = 16, gap = 8;
      picker.style.maxHeight = `${view.innerHeight - margin * 2}px`;
      const box = picker.getBoundingClientRect();
      const below = view.innerHeight - rect.bottom - margin, above = rect.top - margin;
      const down = below >= box.height + gap || below >= above;
      picker.style.maxHeight = `${Math.max(40,(down ? below : above) - gap)}px`;
      const height = picker.getBoundingClientRect().height;
      picker.style.left = `${Math.max(margin,Math.min(rect.left + rect.width / 2 - box.width / 2,view.innerWidth - box.width - margin))}px`;
      picker.style.top = `${Math.max(margin,down ? rect.bottom + gap : rect.top - gap - height)}px`;
    }
    function node(tag,text,className) {
      const element = document.createElement(tag);
      if (text != null) element.textContent = text;
      if (className) element.className = className;
      return element;
    }
    function action(text,callback,className = 'picker-action') {
      const button = node('button',text,className); button.type = 'button';
      button.addEventListener('click',() => { if (!locked) callback(); });
      return button;
    }
    function closePicker(restoreFocus = true) {
      const source = active && buttons[active];
      if (isOpen()) picker.hidePopover();
      if (restoreFocus) source?.focus({preventScroll:true});
      queueCollapse();
    }
    function showHelp(option) {
      pickerView = 'help';
      custom = null;
      title.textContent = option.label;
      hint.textContent = option.purpose || (active === 'framework' ? '不限定表达结构，按自己的方式说。' : names[active]);
      content.replaceChildren();
      if (option.structure) content.append(node('p',option.structure,'picker-structure'));
      if (option.guidance || option.text) content.append(node('p',option.guidance || option.text,'picker-description'));
      if (option.example) content.append(node('blockquote',option.example,'picker-example'));
      const back = action('← 返回选项',showList); back.dataset.setupBack = '';
      content.append(back); positionPicker(); title.focus({preventScroll:true});
    }
    function showCustom() {
      pickerView = 'custom';
      const kind = active;
      custom = {kind,original:getPromptParts(draft.trainingPrompt)[kind]}; invalidCustom = false;
      title.textContent = `自定义${names[kind]}`;
      hint.textContent = kind === 'topic' ? '这次想讲什么？' : '向谁、在什么情况下表达？';
      content.replaceChildren();
      const input = node('textarea'); input.id = 'training-custom-text'; input.rows = 4; input.maxLength = MAX_PROMPT_LENGTH;
      input.value = custom.original?.text || ''; input.setAttribute('aria-label',`自定义${names[kind]}`);
      const done = action('完成',() => closePicker(),'picker-action picker-primary'); done.dataset.setupDone = '';
      input.addEventListener('input',() => {
        if (locked || custom?.kind !== kind) return;
        try { setPart(kind,input.value.trim() ? {source:'user',text:input.value} : null); invalidCustom = false; }
        catch { invalidCustom = true; status.textContent = `${names[kind]}最多 ${MAX_PROMPT_LENGTH} 个字符`; }
        done.disabled = invalidCustom;
      });
      const cancel = action('取消',() => {
        setPart(kind,custom.original); invalidCustom = false; closePicker();
      }); cancel.dataset.setupCancel = '';
      const actions = node('div',null,'picker-actions'); actions.append(cancel,done);
      content.append(input,node('p',`留空则不设置${names[kind]}。`,'training-picker-hint'),actions);
      positionPicker(); input.focus({preventScroll:true});
    }
    function showList() {
      pickerView = 'list';
      custom = null; invalidCustom = false;
      title.textContent = names[active];
      hint.textContent = active === 'framework' ? '按名字选择，点问号了解框架。' : active === 'topic' ? '这次讲什么？可以不设置。' : '向谁、在什么情况下表达？可以不设置。';
      content.replaceChildren();
      const options = active === 'framework' ? [{id:'free',label:'自由表达'},...['prep','star','pyramid'].map(id => getFramework(id))]
        : [{id:'none',label:`不设${names[active]}`},...getPromptOptions(active)];
      const selected = active === 'framework' ? draft.framework || 'free' : getPromptParts(draft.trainingPrompt)[active];
      const list = node('ul',null,'picker-options');
      for (const option of options) {
        const chosen = active === 'framework' ? selected === option.id : selected ? selected.text === option.text : option.id === 'none';
        const row = node('li',null,'picker-option');
        const select = action(option.label,() => {
          if (active === 'framework') {
            const definition = getFramework(option.id);
            draft = {...draft,trainingMode:definition ? 'structured' : 'free',framework:definition?.id || null,frameworkDefinitionVersion:definition?.version || null};
            dirty = true; status.textContent = ''; render();
          } else setPart(active,option.id === 'none' ? null : {source:'bank',text:option.text});
          closePicker();
        },'picker-option-select');
        select.dataset.setupSelect = option.id; select.setAttribute('aria-pressed',String(chosen));
        if (chosen) select.append(node('span','✓','picker-check'));
        row.append(select);
        if (option.id !== 'none') {
          const help = action('?',() => showHelp(option),'picker-help');
          help.dataset.setupHelp = option.id; help.setAttribute('aria-label',`了解${option.label}`); row.append(help);
        }
        list.append(row);
      }
      content.append(list);
      if (active !== 'framework') {
        const customButton = action(`＋ 自定义${names[active]}…`,showCustom); customButton.dataset.setupCustom = '';
        content.append(customButton);
      }
      positionPicker(); title.focus({preventScroll:true});
    }
    function openPicker(kind) {
      if (locked) return;
      active = kind; reveal(true);
      for (const [name,button] of Object.entries(buttons)) button.setAttribute('aria-expanded',String(name === kind));
      showList();
      if (!isOpen()) picker.showPopover();
      positionPicker(); title.focus({preventScroll:true});
    }
    for (const [kind,button] of Object.entries(buttons)) button.addEventListener('click',() => openPicker(kind));
    anchor.addEventListener('click',() => reveal(true));
    settings.addEventListener('pointerenter',() => reveal(true));
    settings.addEventListener('pointerleave',queueCollapse);
    settings.addEventListener('focusin',() => reveal(true));
    settings.addEventListener('focusout',queueCollapse);
    byId('training-picker-close').addEventListener('click',() => closePicker());
    picker.addEventListener('keydown',event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker(); }
    });
    picker.addEventListener('toggle',event => {
      if (event.newState !== 'closed' || isOpen()) return;
      if (invalidCustom && custom) { setPart(custom.kind,custom.original); invalidCustom = false; }
      custom = null; active = null;
      for (const button of Object.values(buttons)) button.setAttribute('aria-expanded','false');
      queueCollapse();
    });
    document.addEventListener('pointerdown',() => { keyboardMode = false; });
    document.addEventListener('keydown',event => {
      if (event.key === 'Tab') keyboardMode = true;
      if (event.key === 'Escape' && !isOpen()) reveal(false);
    });
    document.addEventListener('focusin',event => {
      if (isOpen() && !picker.contains(event.target) && !settings.contains(event.target)) closePicker(false);
    });
    view.addEventListener('resize',positionPicker);
    render(); reveal(false);
    const ready = (async () => {
      try {
        const result = await api.getTrainingSetup({requestId:globalThis.crypto.randomUUID()});
        if (!result?.ok) throw new Error('Setup unavailable');
        const restored = normalizeTrainingContext(result.value);
        if (!dirty) {
          draft = restored; render();
          if (isOpen() && custom) {
            custom.original = getPromptParts(draft.trainingPrompt)[custom.kind];
            byId('training-custom-text').value = custom.original?.text || '';
          } else if (isOpen() && pickerView === 'list') showList();
        }
      } catch { status.textContent = '上次训练配置暂时无法恢复，可以重新选择或直接开始。'; }
    })();
    return {
      ready,
      snapshot() {
        if (invalidCustom) throw Object.assign(new Error('Invalid training context'),{code:'INVALID_SESSION'});
        return {...normalizeTrainingContext(draft),...(practiceRequest ? {practiceRequest:structuredClone(practiceRequest)} : {})};
      },
      clearPractice() { practiceRequest = null; practiceLabel = ''; closePicker(false); reveal(false); render(); },
      configure(value,practice = {}) {
        if (locked) return false;
        closePicker(false); draft = normalizeTrainingContext(value); dirty = true;
        practiceRequest = practice.practiceRequest ? structuredClone(practice.practiceRequest) : null;
        practiceLabel = practice.practiceLabel || ''; status.textContent = ''; invalidCustom = false;
        render(); reveal(false); return true;
      },
      lock(value) { locked = Boolean(value); if (locked) { closePicker(false); reveal(false); } render(); },
      started(session) {
        draft = normalizeTrainingContext(session); dirty = false;
        status.textContent = session?.setupSaved === false ? '本次训练可继续，但未能记住配置；下次请重新选择。' : '';
        render();
      }
    };
  }
  return {createTrainingSetup};
});
