(function(root) {
  'use strict';
  function createFlowView(document) {
    const byId = id => document.getElementById(id);
    const homes = new Map();
    const move = (id,target) => {
      const node = byId(id), parent = byId(target);
      if (!node || !parent) return;
      if (!homes.has(node)) {
        const marker = document.createComment(id);node.before(marker);homes.set(node,marker);
      }
      parent.append(node);
    };
    let layoutKey;
    let reportId;
    function preparation({asr,microphone,message}) {
      const loading=!['ready','failed'].includes(asr);
      const blocked=loading || asr === 'failed' || ['denied','unavailable'].includes(microphone);
      byId('preflight-notice').hidden=asr !== 'failed' && !['denied','unavailable'].includes(microphone);
      byId('preflight-title').textContent=loading ? '正在检查录音准备' : asr === 'failed'
        ? '语音识别模型尚未就绪' : microphone === 'denied' ? '尚未允许使用麦克风' : '暂时找不到可用的麦克风';
      byId('preflight-description').textContent=message;
      byId('btn-open-asr-settings').hidden=asr !== 'failed';
      byId('btn-recheck-preparation').disabled=loading;
      byId('btn-start').disabled=blocked;
      byId('training-status').classList.toggle('visually-hidden',blocked);
    }
    byId('sound-bars').replaceChildren();
    for (let i=0;i<23;i++) byId('sound-bars').append(document.createElement('i'));
    function show(screen,state = 'preparing',record) {
      const frozen = ['training','report','history','comparison'].includes(screen);
      byId('legacy-styles').disabled = frozen;
      byId('frozen-styles').disabled = !frozen;
      byId('frozen-report-styles').disabled = !frozen || screen === 'training';
      document.body.classList.toggle('beo',frozen);
      document.body.classList.toggle('concept',frozen);
      document.body.dataset.frozenUi = frozen ? screen : '';
      byId('frozen-report').classList.toggle('target-report',screen==='report' && Boolean(record?.practice));
      const key = `${frozen}:${screen}:${state}`;
      if (key !== layoutKey) {
        for (const [node,marker] of homes) marker.after(node);
        if (screen === 'training') {
          move('training-setup-title','prepare-caption');
          move('training-settings','prepare-context-slot');
          move('training-picker','main-workspace');
          move('btn-start','prepare-ring');
          move('countdown-display','prepare-ring');
          move('btn-cancel-countdown','prepare-object');
          move('training-practice-focus','preparation-notes');
          move('training-context-status','preparation-notes');
          move('subtitle-scroll','recording-stage');
          move('timer','transport-time');
          for (const id of ['btn-pause','btn-resume','btn-stop']) move(id,'transport-actions');
          move('training-status',state === 'processing' ? 'processing-status-detail' : 'preparation-notes');
          move('btn-leave-processing','processing-actions');move('btn-cancel-processing','processing-actions');
        } else if (frozen) {
          move('subtitle-scroll','report-transcript');move('playback-controls','report-audio');
          move('report-header','frozen-report-heading');move('report-ai-section','frozen-findings');
          move('btn-report-back','frozen-report-context');move('record-save-state','report-persistence-state');
          move('report-analysis-actions','report-summary-copy');
          move('panel-left','report-local-statistics');move('panel-right','report-playback-analysis');
        }
        layoutKey=key;
      }
      byId('btn-history').setAttribute('aria-current',screen === 'history' ? 'page' : 'false');
      byId('frozen-recording').classList.toggle('is-paused',state === 'paused');
      byId('recording-state-label').textContent=state === 'paused' ? '已暂停' : '录音中';
      byId('report-header').querySelector('h1').textContent=frozen && screen === 'report' ? '这一次表达。' : '训练报告';
      if (record && frozen && screen === 'report') root.FrozenReport.present(document,record);
      if (frozen && screen === 'report' && record?.id !== reportId) {
        byId('report-materials').open=false;byId('report-information').open=false;reportId=record?.id;
      }
      alignHeader();
      // Enabled stylesheets settle after the current navigation turn. The
      // window may be hidden/minimized, where animation frames are suspended.
      document.defaultView.setTimeout(alignHeader,0);
    }
    // The frozen preview aligns the glyph and History to the content edges.
    function alignHeader() {
      const brand=byId('btn-home'), history=byId('btn-history'), menu=document.querySelector('.topbar .utility-menu');
      brand.style.transform=history.style.transform='none';
      menu.style.transform='translateY(-50%)';
      const active=document.querySelector('body[data-frozen-ui="training"] :is(#frozen-preparing,#frozen-recording,#frozen-processing):not([hidden]) .session-heading');
      const heading=document.body.dataset.frozenUi === 'report' ? byId('frozen-report-heading')
        : ['recording','paused'].includes(document.body.dataset.trainingState) ? byId('frozen-recording').querySelector('.session-heading')
          : document.body.dataset.trainingState === 'processing' ? byId('frozen-processing').querySelector('.session-heading') : active;
      if (!heading || !document.body.dataset.frozenUi) return;
      const bounds=heading.getBoundingClientRect(), css=document.defaultView.getComputedStyle(heading);
      brand.style.transform=`translateX(${bounds.left+parseFloat(css.paddingLeft)-brand.querySelector('.brand-mark').getBoundingClientRect().left}px)`;
      history.style.transform=`translateX(${bounds.right-parseFloat(css.paddingRight)-history.getBoundingClientRect().right}px)`;
      const right=history.getBoundingClientRect().right, menuBounds=menu.getBoundingClientRect();
      if (menuBounds.left<right+8 || menuBounds.right>document.body.clientWidth) {
        const available=document.body.clientWidth-right;
        const left=available>=menuBounds.width ? right+Math.min(37,available-menuBounds.width)
          : right-history.getBoundingClientRect().width-18-menuBounds.width;
        menu.style.transform=`translateY(-50%) translateX(${left-menuBounds.left}px)`;
      }
    }
    document.defaultView.addEventListener('resize',alignHeader);
    document.fonts.ready.then(alignHeader);
    show('training');
    return {show,preparation};
  }
  root.FrozenFlowView={createFlowView};
})(typeof globalThis !== 'undefined' ? globalThis : this);
