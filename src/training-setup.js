(function(root, factory) {
  const context = typeof module !== 'undefined' && module.exports ? require('../shared/training-context') : root.TrainingContext;
  const frameworks = typeof module !== 'undefined' && module.exports ? require('../shared/training-frameworks') : root.TrainingFrameworks;
  const api = factory(context,frameworks);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrainingSetup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(context,frameworks) {
  'use strict';
  const {normalizeTrainingContext,normalizeTrainingPrompt,getPromptParts,MAX_PROMPT_LENGTH} = context;
  const {getFramework,getPromptOptions} = frameworks;
  // Preparation copy only. Shared framework definitions also feed analysis inputs.
  const frameworkHelp = {
    free: {
      purpose:'不预设结构，按自己的思路说。',
      guidance:'可以从一个想法或一件经历开始，逐步把意思讲清楚。'
    },
    prep: {
      purpose:'适合表达观点、判断或建议。',
      guidance:'先说观点，再解释理由、举例支持，最后回到观点。',
      example:['观点：我建议每周安排一天不开会。','理由：连续时间更有利于专注。','例子：上周没有会议的上午，我完成了一直拖延的方案。','收束：可以先试行一个月，再看效果。']
    },
    star: {
      purpose:'适合讲述经历，说明自己做了什么。',
      guidance:'简要交代情境与任务，重点讲自己的行动，再说明结果或收获。',
      example:['情境：小组汇报前，负责汇总的同学临时请假。','任务：我需要整理材料，按时完成汇报。','行动：我确认了重点，统一材料，并和同伴演练。','结果：汇报按时完成，也让我认识到提前共享材料的重要性。']
    },
    pyramid: {
      purpose:'适合汇报、提案和说明复杂问题。',
      guidance:'先给核心结论，再分组展开要点，用事实逐层支撑。',
      example:['结论：建议将活动推迟一周，补齐人员和场地准备。','人员准备：两位主讲人尚未确认时间。','场地准备：设备还需要一次测试。']
    }
  };
  function createTrainingSetup({api,document}) {
    const byId = id => document.getElementById(id);
    const view = document.defaultView;
    const settings = byId('training-settings'), anchor = byId('training-settings-anchor'), capsules = byId('training-capsules');
    const picker = byId('training-picker'), title = byId('training-picker-title'), hint = byId('training-picker-hint'), content = byId('training-picker-content');
    const pickerActions = byId('training-picker-actions');
    const closeButton = byId('training-picker-close');
    const status = byId('training-context-status'), focus = byId('training-practice-focus');
    const buttons = {framework:byId('training-framework'),topic:byId('training-topic'),scenario:byId('training-scenario')};
    const names = {framework:'表达框架',topic:'主题',scenario:'场景'};
    let draft = normalizeTrainingContext(), dirty = false, locked = false;
    let practiceRequest = null, practiceLabel = '', practiceRecommendation='', active = null, custom = null, invalidCustom = false;
    let collapseTimer = null, keyboardMode = false, pickerView = null;
    let helpReturn = null;
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
      focus.textContent = practiceRequest ? `${practiceLabel}${practiceRecommendation?`\n${practiceRecommendation}`:''}\n围绕这个目标，重新讲完整表达。\n使用 AI 分析时，会使用本轮与上一轮转写比较这个目标，原始录音留在本机。` : '';
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
    function setPickerView(value) {
      pickerView = value;
      picker.dataset.view = value === 'help' ? `${active}-help` : value;
      closeButton.setAttribute('aria-label',value === 'help'
        ? `返回${active === 'framework' ? '框架' : names[active]}选择列表` : `关闭${names[active]}选项`);
    }
    function dismissPicker() {
      if (pickerView !== 'help') return closePicker();
      const previous = helpReturn;
      showList();
      content.scrollTop = previous?.scrollTop || 0;
      if (previous) content.querySelector(`[data-setup-help="${previous.id}"]`)?.focus({preventScroll:true});
    }
    function showHelp(option) {
      helpReturn = {id:option.id,scrollTop:content.scrollTop};
      setPickerView('help');
      custom = null;
      title.textContent = option.label;
      hint.hidden = false;
      hint.textContent = active === 'framework' ? frameworkHelp[option.id].purpose : option.purpose || names[active];
      content.replaceChildren();
      pickerActions.replaceChildren();
      if (active === 'framework') {
        const copy = frameworkHelp[option.id];
        content.append(node('p',copy.guidance,'picker-description'));
        if (copy.example) {
          content.append(node('p','例如','picker-example-caption'));
          const example = node('div',null,'picker-example');
          for (const line of copy.example) example.append(node('p',line));
          content.append(example,node('p','示例供参考，不必逐项照念。','picker-example-note'));
        }
        positionPicker(); title.focus({preventScroll:true}); return;
      }
      if (option.structure) content.append(node('p',option.structure,'picker-structure'));
      if (option.guidance || option.text) content.append(node('p',option.guidance || option.text,'picker-description'));
      if (option.example) content.append(node('blockquote',option.example,'picker-example'));
      positionPicker(); title.focus({preventScroll:true});
    }
    function showCustom() {
      setPickerView('custom');
      hint.hidden = false;
      const kind = active;
      custom = {kind,original:getPromptParts(draft.trainingPrompt)[kind]}; invalidCustom = false;
      title.textContent = `自定义${names[kind]}`;
      hint.textContent = kind === 'topic' ? '这次想讲什么？' : '向谁、在什么情况下表达？';
      content.replaceChildren();
      pickerActions.replaceChildren();
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
      content.append(input,node('p',`留空则不设置${names[kind]}。`,'training-picker-hint'));
      pickerActions.append(actions);
      positionPicker(); input.focus({preventScroll:true});
    }
    function showList() {
      setPickerView('list');
      helpReturn = null;
      hint.hidden = false;
      custom = null; invalidCustom = false;
      title.textContent = names[active];
      hint.textContent = active === 'framework' ? '选择这次表达的组织方式，点问号查看说明。' : active === 'topic' ? '这次讲什么？可以不设置。' : '向谁、在什么情况下表达？可以不设置。';
      content.replaceChildren();
      pickerActions.replaceChildren();
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
    closeButton.addEventListener('click',dismissPicker);
    picker.addEventListener('keydown',event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissPicker(); }
    });
    picker.addEventListener('toggle',event => {
      if (event.newState !== 'closed' || isOpen()) return;
      if (invalidCustom && custom) { setPart(custom.kind,custom.original); invalidCustom = false; }
      custom = null; active = null;
      helpReturn = null;
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
      clearPractice() { practiceRequest = null; practiceLabel = '';practiceRecommendation=''; closePicker(false); reveal(false); render(); },
      configure(value,practice = {}) {
        if (locked) return false;
        closePicker(false); draft = normalizeTrainingContext(value); dirty = true;
        practiceRequest = practice.practiceRequest ? structuredClone(practice.practiceRequest) : null;
        practiceLabel = practice.practiceLabel || ''; status.textContent = ''; invalidCustom = false;
        practiceRecommendation=practice.practiceRecommendation || '';
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
