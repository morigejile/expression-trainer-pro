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
      if (!['training','report','history','comparison'].includes(screen)) throw new Error(`Unknown screen: ${screen}`);
      byId('frozen-report-styles').disabled = screen === 'training';
      document.body.classList.add('beo');
      document.body.classList.add('concept');
      document.body.dataset.frozenUi = screen;
      byId('frozen-report').classList.toggle('target-report',screen==='report' && Boolean(record?.practice));
      const key = `${screen}:${state}`;
      if (key !== layoutKey) {
        for (const [node,marker] of homes) marker.after(node);
        if (screen === 'training') {
          move('training-setup-title','prepare-caption');
          move('training-settings','prepare-context-slot');
          move('training-picker','main-workspace');
          move('btn-start','prepare-ring');
          move('countdown-display','prepare-ring');
          move('btn-cancel-countdown','prepare-auxiliary');
          move('training-practice-focus','preparation-notes');
          move('training-context-status','preparation-notes');
          move('subtitle-scroll','recording-stage');
          for (const id of ['btn-pause','btn-resume','btn-stop']) move(id,'transport-actions');
          move('training-status',state === 'processing' ? 'processing-status-detail' : 'preparation-notes');
          move('btn-leave-processing','processing-actions');move('btn-cancel-processing','processing-actions');
        } else {
          move('playback-controls','report-audio');
          move('report-header','frozen-report-heading');move('report-ai-section','frozen-findings');
          move('btn-report-back','report-header');move('record-save-state','report-persistence-state');
          move('report-analysis-actions','report-summary-copy');
        }
        layoutKey=key;
      }
      byId('btn-history').setAttribute('aria-current',screen === 'history' ? 'page' : 'false');
      byId('frozen-recording').classList.toggle('is-paused',state === 'paused');
      byId('recording-state-label').textContent=state === 'paused' ? '已暂停' : '录音中';
      if (record && screen === 'report') root.FrozenReport.present(document,record);
      if (screen === 'report' && record?.id !== reportId) {
        byId('report-materials').open=false;byId('report-information').open=false;reportId=record?.id;
      }
    }
    show('training');
    return {show,preparation};
  }
  root.FrozenFlowView={createFlowView};
})(typeof globalThis !== 'undefined' ? globalThis : this);
