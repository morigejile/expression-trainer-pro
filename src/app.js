// 宇宙无敌表达训练系统

function mergeFinalText(fullText, finalText) {
  const currentText = typeof fullText === 'string' ? fullText : '';
  const candidateText = typeof finalText === 'string' ? finalText.trim() : '';

  if (!candidateText) {
    return { fullText: currentText, appendedText: '' };
  }

  return {
    fullText: currentText + candidateText,
    appendedText: candidateText
  };
}

// 片段时间轴必须是严格递增的整毫秒区间：录音尾块通常不足一整块，
// durationMs 会带小数，直接用会被 analyze-playback 的输入校验整体拒绝。
function toSegmentEndMs(previousEndMs, candidateMs) {
  const candidate = Number.isFinite(candidateMs) ? Math.round(candidateMs) : previousEndMs;
  return Math.max(previousEndMs + 1, candidate);
}

const SafeRendering = typeof module !== 'undefined' && module.exports
  ? require('./safe-rendering')
  : window.SafeRendering;
const { renderHighlightedText, renderReportContent } = SafeRendering;
const AsrEventState = typeof module !== 'undefined' && module.exports
  ? require('./asr-event-state')
  : window.AsrEventState;
const {
  beginAsrSession,
  createAsrEventState,
  filterAsrEvent,
  invalidateAsrSession
} = AsrEventState;
const AudioCapture = typeof module !== 'undefined' && module.exports
  ? require('./audio-capture')
  : window.AudioCapture;
const { createAudioCapture } = AudioCapture;
const AudioFeedQueue = typeof module !== 'undefined' && module.exports
  ? require('./audio-feed-queue')
  : window.AudioFeedQueue;
const { createAudioFeedQueue } = AudioFeedQueue;
const PcmWav = typeof module !== 'undefined' && module.exports
  ? require('./pcm-wav')
  : window.PcmWav;
const { createPcmWavRecorder } = PcmWav;
const TrainingRecords = typeof module !== 'undefined' && module.exports
  ? require('./training-records')
  : window.TrainingRecords;
const { createTrainingRecordStore, findSegmentAtTime, formatRecordLabel } = TrainingRecords;
const SupportLinks = typeof module !== 'undefined' && module.exports
  ? require('../shared/support-links')
  : window.SupportLinks;
const { FEEDBACK_DOCUMENT_URL } = SupportLinks;
const TextStatistics = typeof module !== 'undefined' && module.exports
  ? require('../shared/text-statistics')
  : window.TextStatistics;
const { analysisCharacterCounts, densityPercent, hasDuration, formatDuration } = TextStatistics;
const CONFIG_ERROR_CODES = new Set([
  'missing-api-key',
  'missing-endpoint',
  'missing-model',
  'invalid-endpoint',
  'invalid-provider',
  'unauthorized'
]);
const ASR_LOADING_MESSAGE = '语音模型加载中，预计数秒至数分钟（首次安装可能更久）；本次启动只需加载一次。';

const Persistence = typeof module !== 'undefined' && module.exports ? require('./training-persistence') : window.TrainingPersistence;
const StructuredReport = typeof module !== 'undefined' && module.exports ? require('./structured-report') : window.StructuredReport;
const SessionComparison = typeof module !== 'undefined' && module.exports ? require('./comparison') : window.SessionComparison;
const TrainingSetup = typeof module !== 'undefined' && module.exports ? require('./training-setup') : window.TrainingSetup;
const TrainingContext = typeof module !== 'undefined' && module.exports ? require('../shared/training-context') : window.TrainingContext;
const {checkMicrophoneReadiness} = typeof module !== 'undefined' && module.exports ? require('./microphone-readiness') : window.MicrophoneReadiness;

class ExpressionTrainer {
  constructor({ audioCaptureFactory = createAudioCapture } = {}) {
    this.audioCaptureFactory = audioCaptureFactory;
    this.audioCapture = null;
    this.audioCaptureStopPromise = null;
    this.audioFeedTracker = null;
    this.recordingStopOperation = null;
    this.lastAudioCaptureRates = null;
    this.lastAudioFeedMetrics = null;
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.pausedTime = 0;
    this.pauseStart = null;
    this.timerInterval = null;
    this.fullText = '';
    this.sentences = [];
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0, excludedCharacters: 0, hedgeCharacters: 0 };
    this.lastFeedbackText = '';
    this.llmGeneration = 0;
    this.userMessageRequiresSettings = false;
    this.activeModal = null;
    this.modalOpener = null;
    this.firstRunHelpOpen = false;
    this.firstRunRecordingPolicyPending = true;
    this.firstRunRecordingPolicyRunning = false;
    this.asrEventState = createAsrEventState();
    this.asrStartAttempt = null;
    this.asrPreparationState = 'idle';
    this.asrGeneration = 0;
    this.recordingPolicyAcknowledged = false;
    this.recordingPolicyDecision = null;
    this.recordingPcm = null;
    this.recordingAsrSampleCursor = 0;
    this.recordingSessionId = null;
    this.recordingCreatedAt = null;
    this.pendingSegments = [];
    this.limitStopPromise = null;
    this.trainingRecords = null;
    this.viewingTrainingRecordId = null;
    this.playbackProfileSummary = {activeProfileId: null, profiles: []};
    this.playbackProfileRefreshGeneration = 0;
    this.playbackProfileRefreshPromise = null;
    this.playbackAnalysisGeneration = 0;
    this.playbackSegmentId = null;

    this.persistence = Persistence.createTrainingPersistence({api:window.api,onChange:record => this.renderRecordStatus(record)});
    this.currentScreen = 'training';
    this.microphoneState = 'checking';
    this.historyOffset = 0;
    this.initElements();
    this.trainingSetup = TrainingSetup.createTrainingSetup({api:window.api,document});
    this.comparison = SessionComparison.createComparisonController({trainer:this,api:window.api,document});
    this.bindEvents();
    if (!this.showFirstRunHelp()) void this.showFirstRunRecordingPolicy();
    void this.prepareSpeechModel();
    void this.preflightMicrophone();
    void this.refreshLlmProfileOptions();
  }

  initElements() {
    this.btnStart = document.getElementById('btn-start');
    this.btnStartLabel = this.btnStart.querySelector('.btn-label');
    this.btnPause = document.getElementById('btn-pause');
    this.btnResume = document.getElementById('btn-resume');
    this.btnStop = document.getElementById('btn-stop');
    this.btnStopLabel = this.btnStop.querySelector('.btn-label');
    this.btnCancelProcessing = document.getElementById('btn-cancel-processing');
    this.btnLeaveProcessing = document.getElementById('btn-leave-processing');
    this.btnReport = document.getElementById('btn-report');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnHelp = document.getElementById('btn-help');
    this.timer = document.getElementById('timer');
    this.subtitleScroll = document.getElementById('subtitle-scroll');
    this.subtitleContainer = document.getElementById('subtitle-container');
    this.feedbackContent = document.getElementById('feedback-content');
    this.reportBody = document.getElementById('report-body');
    this.userMessage = document.getElementById('user-message');
    this.userMessageText = document.getElementById('user-message-text');
    this.userMessageAction = document.getElementById('user-message-action');
    this.userMessageClose = document.getElementById('user-message-close');
    this.trainingStatus = document.getElementById('training-status');
    this.feedbackStatus = document.getElementById('feedback-status');
    this.helpModal = document.getElementById('help-modal');
    this.btnCloseHelp = document.getElementById('btn-close-help');
    this.btnHelpDiagnostics = document.getElementById('btn-help-diagnostics');
    this.btnOpenFeedbackDocument = document.getElementById('btn-open-feedback-document');
    this.feedbackLinkError = document.getElementById('feedback-link-error');
    this.recordingPolicyModal = document.getElementById('recording-policy-modal');
    this.btnCloseRecordingPolicy = document.getElementById('btn-close-recording-policy');
    this.btnRecordingPolicyConfirm = document.getElementById('btn-recording-policy-confirm');
    this.btnRecordingPolicyCancel = document.getElementById('btn-recording-policy-cancel');
    this.playbackControls = document.getElementById('playback-controls');
    this.audioPlayer = document.getElementById('recording-player');
    this.playbackModel = document.getElementById('playback-model');
    this.btnReanalyze = document.getElementById('btn-reanalyze');
    this.reportAiStatus = document.getElementById('report-ai-status');
    this.recordIdentity = document.getElementById('record-identity');
    this.recordSaveStatus = document.getElementById('record-save-status');
    this.retrySave = document.getElementById('btn-retry-save');
    this.historyList = document.getElementById('history-list');
    this.historyStatus = document.getElementById('history-status');
    this.historyMore = document.getElementById('btn-history-more');
    this.reportBack = document.getElementById('btn-report-back');
    this.statFillers = document.getElementById('stat-fillers');
    this.statHedges = document.getElementById('stat-hedges');
    this.statVague = document.getElementById('stat-vague');
    this.statDensity = document.getElementById('stat-density');
  }

  bindEvents() {
    this.btnCancelProcessing?.addEventListener('click',() => {void this.cancelProcessing();});
    this.btnLeaveProcessing?.addEventListener('click',() => {void this.leaveProcessing();});
    document.getElementById('btn-home')?.addEventListener('click', () => this.showTraining());
    document.getElementById('btn-history')?.addEventListener('click', () => this.showHistory());
    document.getElementById('btn-history-start')?.addEventListener('click', () => this.showTraining());
    this.historyMore?.addEventListener('click', () => this.loadHistory(true));
    this.reportBack?.addEventListener('click', () => this.reportSource === 'comparison'
      ? this.comparison.restore() : this.reportSource === 'practice' && this.practiceReturn
        ? this.openHistoryRecord(this.practiceReturn.id,{reportId:this.practiceReturn.reportId,source:this.practiceReturn.source,
          returnTo:this.practiceReturn.returnTo}) : this.showHistory({restore:true}));
    this.retrySave?.addEventListener('click', () => this.retryTrainingSave());
    this.btnStart.addEventListener('click', () => this.startRecording());
    this.btnPause.addEventListener('click', () => this.pauseRecording());
    this.btnResume.addEventListener('click', () => this.resumeRecording());
    this.btnStop.addEventListener('click', () => this.stopRecording());
    this.btnReport.addEventListener('click', () => this.generateReport());
    this.btnSettings.addEventListener('click', () => {
      document.querySelector('.utility-menu')?.removeAttribute('open');
      if (this.activeModal) this.closeModal(this.activeModal);
      window.api.openSettings();
    });
    this.userMessageAction.addEventListener('click', () => window.api.openSettings());
    this.userMessageClose.addEventListener('click', () => this.hideUserMessage());
    window.api.onLlmProviderSettingsChanged?.(() => this.handleLlmProviderSettingsChanged());
    this.btnHelp.addEventListener('click', () => this.openHelpModal());
    this.btnCloseHelp.addEventListener('click', () => this.closeModal(this.helpModal));
    this.btnHelpDiagnostics.addEventListener('click', () => this.exportDiagnostics(this.btnHelpDiagnostics));
    this.btnOpenFeedbackDocument.addEventListener('click', () => this.openFeedbackDocument());
    this.btnRecordingPolicyConfirm.addEventListener('click', () => this.resolveRecordingPolicyDecision(true));
    this.btnRecordingPolicyCancel.addEventListener('click', () => this.resolveRecordingPolicyDecision(false));
    this.btnCloseRecordingPolicy.addEventListener('click', () => this.resolveRecordingPolicyDecision(false));
    this.audioPlayer.addEventListener('timeupdate', () => this.handlePlaybackTimeUpdate());
    this.playbackModel.addEventListener('change', event => { void this.selectPlaybackProfile(event.target.value); });
    this.btnReanalyze.addEventListener('click', () => { void this.analyzeSelectedRecording(); });
    window.addEventListener?.('beforeunload', () => this.disposeTrainingRecords());
    window.api.onPrepareTrainingClose?.(async () => {
      let ready = false;
      try { ready = await this.prepareTrainingClose(); } catch { this.showUserMessage('退出前保存未完成，请重试。'); }
      window.api.finishTrainingClose(ready);
    });
    document.addEventListener('keydown', event => this.handleModalKeydown(event));
    document.addEventListener('keydown', event => this.handleGlobalKeydown(event));
  }

  async exportDiagnostics(triggerButton = this.btnHelpDiagnostics) {
    const original = triggerButton.textContent;
    try {
      const result = await window.api.exportDiagnostics(this.lastAudioCaptureRates);
      if (!result?.success) return;
      triggerButton.textContent = '✓ 已导出';
      setTimeout(() => { triggerButton.textContent = original; }, 2000);
    } catch (error) {
      alert(`导出诊断失败: ${error.message}`);
    }
  }

  showFirstRunHelp() {
    try {
      if (window.localStorage.getItem('expression-trainer.help-seen') === '1') return false;
    } catch {}
    this.firstRunHelpOpen = true;
    this.openHelpModal();
    return true;
  }

  openHelpModal() {
    document.querySelector?.('.utility-menu')?.removeAttribute('open');
    this.feedbackLinkError.textContent = '';
    this.openModal(this.helpModal, this.btnCloseHelp);
    this.modalOpener = document.querySelector?.('.utility-menu summary') || this.modalOpener;
  }

  async openFeedbackDocument() {
    this.feedbackLinkError.textContent = '';
    try {
      const result = await window.api.openSupportLink(FEEDBACK_DOCUMENT_URL);
      if (!result?.success) {
        this.feedbackLinkError.textContent = result?.error || '无法打开问题和建议文档';
      }
    } catch (error) {
      this.feedbackLinkError.textContent = error.message;
    }
  }

  // ===== 录制控制 =====

  async prepareSpeechModel() {
    if (this.asrPreparationState === 'loading' || this.asrPreparationState === 'ready') return;
    this.asrPreparationState = 'loading';
    this.finishTrainingPreparation();
    try {
      const result = await window.api.prepareASR();
      this.asrPreparationState = result?.ok ? 'ready' : 'failed';
    } catch {
      this.asrPreparationState = 'failed';
    }
    this.btnStart.disabled = false;
    this.btnStartLabel.textContent = this.asrPreparationState === 'failed' ? '重试加载' : '开始表达';
    if (!this.fullText.trim() && !this.isRecording && !this.asrStartAttempt) {
      this.finishTrainingPreparation();
    }
  }

  async preflightMicrophone() {
    const generation = this.microphonePreflightGeneration = (this.microphonePreflightGeneration || 0) + 1;
    const state = await checkMicrophoneReadiness(globalThis.navigator);
    if (generation !== this.microphonePreflightGeneration) return this.microphoneState;
    this.microphoneState = state;
    if (!this.isRecording && !this.asrStartAttempt && !this.recordingStopOperation) this.finishTrainingPreparation();
    return this.microphoneState;
  }

  async showFirstRunRecordingPolicy() {
    if (!this.firstRunRecordingPolicyPending || this.firstRunRecordingPolicyRunning || this.activeModal) return;
    try {
      if (window.localStorage.getItem('expression-trainer.recording-policy-seen') === '1') {
        this.firstRunRecordingPolicyPending = false;
        return;
      }
    } catch {}
    this.firstRunRecordingPolicyRunning = true;
    try {
      const policy = await window.api.getRecordingPolicy();
      // 读取期间用户可能重新打开帮助页；等该弹窗关闭后再继续。
      if (this.activeModal) return;
      this.firstRunRecordingPolicyPending = false;
      await this.ensureRecordingPolicyAcknowledged(policy);
      try {
        window.localStorage.setItem('expression-trainer.recording-policy-seen', '1');
      } catch {}
    } catch (error) {
      this.firstRunRecordingPolicyPending = false;
      this.showUserMessage(`录音保存说明未完成：${error.message}`);
    } finally {
      this.firstRunRecordingPolicyRunning = false;
    }
  }

  async ensureRecordingPolicyAcknowledged(policy) {
    if (this.recordingPolicyAcknowledged) return true;
    if (policy === undefined) {
      if (typeof window.api.getRecordingPolicy !== 'function') {
        throw new Error('录音保留策略不可用');
      }
      policy = await window.api.getRecordingPolicy();
    }
    if (policy?.acknowledged) {
      this.recordingPolicyAcknowledged = true;
      return true;
    }
    const accepted = await this.waitForRecordingPolicyDecision();
    if (!accepted) return false;
    if (typeof window.api.acknowledgeRecordingPolicy !== 'function') {
      throw new Error('录音保留策略确认不可用');
    }
    const result = await window.api.acknowledgeRecordingPolicy();
    if (!result?.success || result.acknowledged !== true) {
      throw new Error(result?.error || '无法保存录音保留策略确认');
    }
    this.recordingPolicyAcknowledged = true;
    return true;
  }

  waitForRecordingPolicyDecision() {
    if (this.recordingPolicyDecision) return this.recordingPolicyDecision.promise;
    let resolveDecision;
    const promise = new Promise(resolve => { resolveDecision = resolve; });
    this.recordingPolicyDecision = { promise, resolve: resolveDecision };
    this.openModal(this.recordingPolicyModal, this.btnRecordingPolicyConfirm);
    return promise;
  }

  resolveRecordingPolicyDecision(accepted) {
    const decision = this.recordingPolicyDecision;
    if (!decision) return;
    this.recordingPolicyDecision = null;
    this.closeModal(this.recordingPolicyModal);
    decision.resolve(Boolean(accepted));
  }

  async startRecording() {
    if (this.closing) return;
    if (this.asrPreparationState !== 'ready') {
      if (this.asrPreparationState !== 'loading') await this.prepareSpeechModel();
      return;
    }
    if (this.firstRunHelpOpen || this.firstRunRecordingPolicyPending || this.firstRunRecordingPolicyRunning) return;
    if (this.asrStartAttempt) {
      this.showUserMessage('录制正在启动，请稍候');
      return;
    }
    this.playbackAnalysisGeneration += 1;
    this.btnReanalyze.disabled = false;
    this.trainingStatus.textContent = '正在启动录制…';
    this.btnStart.disabled = true;
    const startAttempt = {};
    this.asrStartAttempt = startAttempt;
    this.trainingSetup?.lock(true);
    await this.trainingSetup?.ready;
    if (this.asrStartAttempt !== startAttempt) return;
    try { startAttempt.context = this.trainingSetup?.snapshot() || TrainingContext.normalizeTrainingContext(); }
    catch {
      this.asrStartAttempt = null;
      this.finishTrainingPreparation();
      this.showUserMessage('请检查主题或场景，最多可填写 2000 个字符。');
      return;
    }
    let policyAccepted;
    try {
      policyAccepted = await this.ensureRecordingPolicyAcknowledged();
    } catch (error) {
      if (this.asrStartAttempt === startAttempt) {
        this.asrStartAttempt = null;
        this.showUserMessage(`无法开始录制：${error.message}`);
        this.finishTrainingPreparation();
      }
      return;
    }
    if (!policyAccepted || this.asrStartAttempt !== startAttempt) {
      if (this.asrStartAttempt === startAttempt) this.asrStartAttempt = null;
      this.finishTrainingPreparation();
      return;
    }
    const microphone = await this.preflightMicrophone();
    if (this.asrStartAttempt !== startAttempt) return;
    if (microphone === 'denied' || microphone === 'unavailable') {
      this.asrStartAttempt = null;
      this.finishTrainingPreparation();
      this.showUserMessage(microphone === 'denied' ? '麦克风权限被拒绝，请在系统隐私设置中允许使用后重试。' : '未检测到麦克风，请连接输入设备后重试。');
      return;
    }
    if (!this.isRecording
        && !this.viewingTrainingRecordId
        && this.fullText.trim()
        && !window.confirm('开始新录制将替换当前内容，是否继续？')) {
      this.asrStartAttempt = null;
      this.finishTrainingPreparation();
      return;
    }
    this.asrGeneration = (this.asrGeneration ?? 0) + 1;
    const replacedSessionId = this.asrEventState.activeSessionId;
    if (replacedSessionId) {
      this.audioFeedTracker?.queue.cancel();
      this.audioFeedTracker = null;
      void this.releaseAudioCapture({ flush: false }).catch(() => {});
      this.cancelActiveAsrSession(replacedSessionId, () => false);
    }
    this.advanceLLMGeneration();
    try {
      await window.api.cancelLLMRequests();
    } catch {
      if (this.asrStartAttempt === startAttempt) {
        this.asrStartAttempt = null;
        this.showError('录制启动失败: 无法准备大模型请求');
        this.finishTrainingPreparation();
      }
      return;
    }
    if (this.asrStartAttempt !== startAttempt) {
      if (!this.asrStartAttempt) this.finishTrainingPreparation();
      return;
    }

    const sessionId = globalThis.crypto.randomUUID();
    this.asrEventState = beginAsrSession(this.asrEventState, sessionId);
    const ownsSession = () => this.asrStartAttempt === startAttempt
      && this.asrEventState.activeSessionId === sessionId;

    let startResponse;
    try {
      startResponse = await window.api.startASR({ sessionId, sampleRateHz: 16000 });
    } catch (error) {
      if (ownsSession()) {
        this.asrEventState = invalidateAsrSession(this.asrEventState);
        this.showError(`语音识别启动失败: ${error.message}`);
        this.asrStartAttempt = null;
        this.finishTrainingPreparation();
      }
      return;
    }
    await this.processASRResponse(
      startResponse,
      '语音识别启动失败',
      '语音识别结果处理失败',
      ownsSession
    );
    if (!startResponse?.ok || !ownsSession()) {
      if (this.asrEventState.activeSessionId === sessionId) {
        this.asrEventState = invalidateAsrSession(this.asrEventState);
      }
      if (this.asrStartAttempt === startAttempt) {
        this.asrStartAttempt = null;
        this.finishTrainingPreparation();
      } else if (startResponse?.ok) {
        await this.cancelActiveAsrSession(sessionId, () => false);
      }
      return;
    }

    const tracker = this.createAudioFeedTracker(sessionId);
    this.audioFeedTracker = tracker;
    this.beginRecordingBuffer(sessionId);
    const audioCapture = this.audioCaptureFactory();
    this.audioCapture = audioCapture;
    try {
      const rates = await audioCapture.start({
        sessionId,
        onChunk: chunk => this.handleCapturedChunk(chunk),
        onError: () => { void this.failActiveRecording(sessionId); }
      });
      if (!ownsSession()) {
        await audioCapture.stop({ flush: false });
        await this.cancelActiveAsrSession(sessionId, () => false);
        return;
      }
      this.lastAudioCaptureRates = rates;
    } catch (err) {
      if (ownsSession()
          && err?.code === 'unsupported-audio-context-rate'
          && err.audioRates) {
        this.lastAudioCaptureRates = err.audioRates;
      }
      tracker.queue.cancel();
      if (this.audioFeedTracker === tracker) this.audioFeedTracker = null;
      this.discardRecordingBuffer(sessionId);
      try {
        if (this.audioCapture === audioCapture) {
          await this.releaseAudioCapture({ flush: false });
        } else {
          await audioCapture.stop({ flush: false });
        }
      } catch {}
      const failureOwned = ownsSession();
      await this.cancelActiveAsrSession(
        sessionId,
        () => failureOwned && this.asrStartAttempt === startAttempt
      );
      if (failureOwned && this.asrStartAttempt === startAttempt) {
        this.showUserMessage(`麦克风访问失败: ${err.message}`);
        this.asrStartAttempt = null;
        this.finishTrainingPreparation();
      }
      return;
    }

    let durableSession = null;
    if (this.persistence) {
      try { durableSession = await this.persistence.start({createdAt:new Date().toISOString(),source:'microphone',...startAttempt.context}); }
      catch (error) {
        tracker.queue.cancel();
        this.audioFeedTracker = null;
        await this.releaseAudioCapture({flush:false});
        this.discardRecordingBuffer(sessionId);
        await this.cancelActiveAsrSession(sessionId, () => false);
        this.asrStartAttempt = null;
        this.finishTrainingPreparation();
        this.showUserMessage(error.message); return;
      }
    }
    if (!ownsSession()) {
      if (durableSession) await this.persistence.interrupt(durableSession.id);
      return;
    }
    this.durableSession = durableSession;
    this.trainingSetup?.started(durableSession || startAttempt.context);
    this.asrStartAttempt = null;

    this.isRecording = true;
    this.setScreen('training', 'recording');
    this.isPaused = false;
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.fullText = '';
    this.sentences = [];
    this.viewingTrainingRecordId = null;
    this.refreshPlaybackControls();
    this.lastFeedbackText = '';
    this.resetStats();
    this.subtitleContainer.replaceChildren();

    // UI
    this.btnStart.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.btnStop.classList.remove('hidden');
    this.btnReport.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.timer.classList.add('active');
    this.trainingStatus.textContent = this.recordingAsrCapabilities?.recognitionMode === 'utterance'
      ? '正在录音；结束后生成文字，最长5分钟' : '正在录音';

    this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    this.audioCapture.setEnabled(true);
    this.btnStart.disabled = false;
  }

  pauseRecording() {
    if (this.recordingStopOperation?.sessionId === this.asrEventState.activeSessionId) return;
    this.isPaused = true;
    this.audioCapture?.setEnabled(false);
    this.pauseStart = Date.now();
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.remove('hidden');
    this.timer.classList.remove('active');
    this.trainingStatus.textContent = '录音已暂停';
  }

  resumeRecording() {
    if (this.recordingStopOperation?.sessionId === this.asrEventState.activeSessionId) return;
    this.isPaused = false;
    this.audioCapture?.setEnabled(true);
    this.pausedTime += Date.now() - this.pauseStart;
    this.pauseStart = null;
    this.btnResume.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.timer.classList.add('active');
    this.trainingStatus.textContent = '正在录音';
  }

  teardownRecordingCapture() {
    void this.releaseAudioCapture({ flush: false }).catch(() => {});

    clearInterval(this.timerInterval);
    this.timerInterval = null;
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.pausedTime = 0;
    this.pauseStart = null;

    this.btnStop.classList.add('hidden');
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.btnStart.classList.remove('hidden');
    this.btnStart.disabled = this.asrPreparationState === 'loading';
    this.btnReport.classList.add('hidden');
    this.timer.classList.remove('active');
  }

  releaseAudioCapture(options) {
    const capture = this.audioCapture;
    if (!capture) return this.audioCaptureStopPromise ?? Promise.resolve();
    this.audioCapture = null;
    try {
      this.audioCaptureStopPromise = Promise.resolve(capture.stop(options));
    } catch (error) {
      this.audioCaptureStopPromise = Promise.reject(error);
    }
    return this.audioCaptureStopPromise;
  }

  getTrainingRecordStore() {
    if (!this.trainingRecords) {
      this.trainingRecords = createTrainingRecordStore({
        maxRecords: Number.MAX_SAFE_INTEGER,
        revokeObjectURL: url => this.getObjectUrlApi().revokeObjectURL(url)
      });
    }
    return this.trainingRecords;
  }

  getObjectUrlApi() {
    return window.URL || globalThis.URL;
  }

  beginRecordingBuffer(sessionId) {
    this.discardRecordingBuffer();
    this.recordingSessionId = sessionId;
    this.durableSession = null;
    this.recordingCreatedAt = new Date().toISOString();
    this.recordingPcm = createPcmWavRecorder({ sampleRateHz: 16000,
      maxFrames:this.recordingAsrCapabilities?.recognitionMode === 'utterance' ? 4_800_000 : 19_200_000 });
    this.recordingAsrSampleCursor = 0;
    this.pendingSegments = [];
    this.limitStopPromise = null;
    this.recordingAcceptedSampleCount = null;
    this.recordingDataQuality = ['timing-unavailable'];
    this.recordingQualityEvents = [];
    return this.recordingPcm;
  }

  recordingTimingSnapshot(failureCode) {
    const dataQuality = [...(this.recordingDataQuality || ['timing-unavailable'])];
    if (this.pendingSegments?.some(segment => segment.timingSource === 'estimated')) dataQuality.push('timing-estimated');
    if (failureCode) dataQuality.push(failureCode === 'audio-overrun' ? 'audio-overrun' : 'asr-error');
    return {timing:{schemaVersion:1, sampleRateHz:16000,
      capturedSampleCount:this.recordingPcm?.frameCount ?? 0,
      asrAcceptedSampleCount:this.recordingAcceptedSampleCount ?? null,
      ...(this.recordingQualityEvents?.length ? {qualityEvents:this.recordingQualityEvents.map(event => ({...event}))} : {}),
      capabilities:{audioTimeline:true, speechSegments:false, tokenTimestamps:false}},
    dataQuality:[...new Set(dataQuality)]};
  }

  discardRecordingBuffer(expectedSessionId) {
    if (expectedSessionId && this.recordingSessionId !== expectedSessionId) return false;
    this.recordingPcm?.clear?.();
    this.recordingPcm = null;
    this.recordingAsrSampleCursor = 0;
    this.recordingSessionId = null;
    this.recordingCreatedAt = null;
    this.pendingSegments = [];
    this.limitStopPromise = null;
    return true;
  }

  appendRecordingChunk(chunk) {
    if (!this.recordingPcm || this.recordingSessionId !== chunk.sessionId) {
      return { acceptedSamples: null, audioEndMs: 0, limitReached: false };
    }
    const absoluteSampleStart = this.recordingAsrSampleCursor;
    const result = this.recordingPcm.append(chunk.samples);
    const acceptedSamples = result.acceptedFrames === chunk.samples.length
      ? chunk.samples
      : chunk.samples.slice(0, result.acceptedFrames);
    this.recordingAsrSampleCursor += acceptedSamples.length;
    return {
      acceptedSamples,
      absoluteSampleStart,
      audioEndMs: this.recordingPcm.durationMs,
      limitReached: result.limitReached
    };
  }

  handleCapturedChunk(chunk) {
    const { sessionId } = chunk;
    const tracker = this.audioFeedTracker;
    const stoppingOwned = this.recordingStopOperation?.sessionId === sessionId
      && this.recordingStopOperation.feedTracker === tracker;
    if (!this.isRecording
        || (this.isPaused && !stoppingOwned)
        || this.asrEventState.activeSessionId !== sessionId) return Promise.resolve();
    if (!tracker || tracker.sessionId !== sessionId) return Promise.resolve();
    const appended = this.appendRecordingChunk(chunk);
    let enqueued = false;
    if (appended.acceptedSamples?.length) {
      enqueued = tracker.queue.enqueue({
        ...chunk,
         frames: appended.acceptedSamples.length,
         samples: appended.acceptedSamples,
          absoluteSampleStart: appended.absoluteSampleStart,
        audioEndMs: appended.audioEndMs
      });
    }
    if (appended.limitReached && !this.limitStopPromise) {
      const limitSessionId = sessionId;
      this.trainingStatus.textContent = this.recordingAsrCapabilities?.recognitionMode === 'utterance'
        ? '已达到5分钟上限，正在结束录音并转写…' : '已达到20分钟上限，正在结束录音…';
      this.limitStopPromise = new Promise(resolve => setTimeout(resolve, 0)).then(() => {
        if (!this.isRecording
            || this.asrEventState.activeSessionId !== limitSessionId
            || this.recordingSessionId !== limitSessionId) return false;
        return this.stopRecording();
      });
    }
    return Promise.resolve(enqueued);
  }

  createAudioFeedTracker(sessionId) {
    const queue = createAudioFeedQueue({
      maxChunks: 10,
      send: async ({ sequence, samples, audioEndMs, absoluteSampleStart }) => {
        const response = await window.api.feedAudio({sessionId, sequence, absoluteSampleStart, samples});
        if (!response || response.ok !== true) {
          const error = new Error(response?.error?.message || 'ASR feed failed');
          error.code = response?.error?.code || 'asr-feed-failed';
          throw error;
        }
        const succeeded = await this.processASRResponse(
          response,
          '语音识别处理失败',
          '语音识别结果处理失败',
          () => this.asrEventState.activeSessionId === sessionId,
          audioEndMs
        );
        if (!succeeded) throw Object.assign(new Error('ASR feed failed'), {code:'asr-feed-failed'});
      },
      onFailure: error => {
        this.lastAudioFeedMetrics = queue.snapshot();
        if (error?.code === 'audio-overrun') this.recordingQualityEvents?.push({code:'audio-overrun',
          startSample:error.affectedRange?.startSample ?? null,endSample:error.affectedRange?.endSample ?? null});
        return this.failActiveRecording(sessionId, error?.code);
      }
    });
    return { sessionId, queue };
  }

  failActiveRecording(sessionId, failureCode = 'asr-error') {
    if (this.asrEventState.activeSessionId !== sessionId) return Promise.resolve(false);

    this.asrStartAttempt = null;
    this.asrGeneration = (this.asrGeneration ?? 0) + 1;
    this.asrEventState = invalidateAsrSession(this.asrEventState);
    this.advanceLLMGeneration();
    if (this.audioFeedTracker?.sessionId === sessionId) {
      this.lastAudioFeedMetrics = this.audioFeedTracker.queue.snapshot();
    }
    this.audioFeedTracker?.queue.cancel();
    this.audioFeedTracker = null;
    if (this.durableSession && this.persistence) void this.persistence.interrupt(
      this.durableSession.id, this.recordingTimingSnapshot(failureCode)).catch(() => {});
    this.discardRecordingBuffer(sessionId);
    this.teardownRecordingCapture();
    this.trainingStatus.textContent = '语音识别处理失败，录音已停止，请重新开始';
    const retainedRecord = this.trainingRecords?.selected();
    if (retainedRecord) this.selectTrainingRecord(retainedRecord.id);
    // A stop operation owns its final navigation; an active-capture failure must
    // restore editable preparation itself, without replacing the error message.
    if (!this.recordingStopOperation) this.setScreen('training');
    this.showError('语音识别处理失败，录音已停止，请重新开始');
    return this.cancelActiveAsrSession(sessionId, () => false).then(() => true);
  }

  stopRecording() {
    const activeSessionId = this.asrEventState.activeSessionId;
    const ownsRecording = Boolean(activeSessionId)
      && this.isRecording
      && this.recordingSessionId === activeSessionId
      && Boolean(this.recordingPcm);
    if (!ownsRecording) return Promise.resolve(false);
    if (this.recordingStopOperation?.sessionId === activeSessionId) {
      return this.recordingStopOperation.promise;
    }
    const operation = {
      sessionId: activeSessionId,
      feedTracker: this.audioFeedTracker,
      promise: null
    };
    this.setScreen('training', 'processing');
    this.processingRecordId = null;
    if (this.btnLeaveProcessing) this.btnLeaveProcessing.disabled = true;
    this.trainingStatus.textContent = this.recordingAsrCapabilities?.recognitionMode === 'utterance'
      ? '正在转写整段录音；较长录音可能需要一分钟以上，可以取消并保留录音。' : '正在结束并整理尾部文字…';
    this.btnStop.disabled = true;
    this.btnPause.disabled = true;
    this.btnResume.disabled = true;
    this.recordingStopOperation = operation;
    operation.promise = this.completeRecordingStop(operation);
    return operation.promise;
  }

  async completeRecordingStop(operation) {
    const { sessionId, feedTracker } = operation;
    let completedNormally = false;
    this.advanceLLMGeneration();
    try {
      await this.releaseAudioCapture({ flush: true });
      if (feedTracker?.sessionId === sessionId) {
        feedTracker.queue.close();
        await feedTracker.queue.drain();
        this.lastAudioFeedMetrics = feedTracker.queue.snapshot();
      }
      if (this.asrEventState.activeSessionId !== sessionId) return;
      this.audioFeedTracker = null;
      completedNormally = await this.finishOwnedAsrStopAndUi(sessionId);
    } catch {
      await this.failActiveRecording(sessionId);
    } finally {
      if (this.recordingStopOperation === operation) {
        this.recordingStopOperation = null;
      }
      if (completedNormally) this.trainingStatus.textContent = '本次训练已结束';
      if (!operation.left) {
        if (completedNormally) this.setScreen('report');
        else this.setScreen('training');
      } else this.setScreen(this.currentScreen);
      this.processingRecordId = null;
      this.btnStop.disabled = false;
      this.btnPause.disabled = false;
      this.btnResume.disabled = false;
      this.btnStart.disabled = false;
    }
  }

  async finishOwnedAsrStopAndUi(sessionId) {
    const durationMs = this.recordingSessionId === sessionId && this.recordingPcm
      ? this.recordingPcm.durationMs
      : 0;
    let tailSucceeded = false;
    let savedFailedTranscription = false;
    let tailErrorMessage = null;
    try {
      if (sessionId && this.recordingStopOperation?.cancelled) {
        // Capture and queued feeds are drained before invalidating the decoder.
        await window.api.cancelASR({sessionId});
      } else if (sessionId) {
        if (this.recordingStopOperation) this.recordingStopOperation.asrStopping = true;
        const stopResponse = await window.api.stopASR({ sessionId });
        tailSucceeded = await this.processASRResponse(
          stopResponse,
          '语音识别停止失败',
          '尾部文本分析失败',
          () => stopResponse?.ok === true && this.asrEventState.activeSessionId === sessionId,
          durationMs
        );
        if (!tailSucceeded) {
          const message = typeof stopResponse?.error?.message === 'string'
            ? stopResponse.error.message
            : '未知错误';
          tailErrorMessage = `语音识别停止失败: ${message}`;
        }
      }
    } catch (error) {
      if (this.asrEventState.activeSessionId === sessionId) {
        tailErrorMessage = `语音识别停止失败: ${error.message}`;
      }
    } finally {
      if (this.asrEventState.activeSessionId === sessionId) {
        this.asrEventState = invalidateAsrSession(this.asrEventState);
      }
      this.advanceLLMGeneration();
      try {
        await window.api.cancelLLMRequests();
      } catch (error) {
        this.showError(`取消大模型请求失败: ${error.message}`);
      } finally {
        this.isRecording = false;
        this.isPaused = false;

        clearInterval(this.timerInterval);
        this.stats.duration = hasDuration(durationMs) ? durationMs / 1000 : 0;
        if (this.recordingSessionId === sessionId && (tailSucceeded ||
            ((this.recordingAsrCapabilities?.recognitionMode === 'utterance' || this.recordingStopOperation?.cancelled)
              && this.recordingPcm?.frameCount > 0))) {
          const completed = this.finalizeTrainingRecord(tailSucceeded ? null : 'asr-error');
          savedFailedTranscription = !tailSucceeded && Boolean(completed);
          if (completed?.savePromise) await completed.savePromise;
          if (completed?.factsSaved && typeof window.api.analyzeTrainingSession === 'function') {
            this.processingRecordId = completed.id;
            if (this.btnLeaveProcessing) this.btnLeaveProcessing.disabled = false;
            if (this.recordingStopOperation?.cancelled) {
              await window.api.cancelTrainingAnalysis({requestId:globalThis.crypto.randomUUID(),sessionId:completed.id});
              // A cancelled job can finish before this continuation. Read saved
              // results without accidentally starting a replacement job.
              await this.refreshTrainingRecord(completed);
            } else {
              this.trainingStatus.textContent = tailSucceeded ? '训练已保存，正在整理语音证据和诊断…' : '转写未完成，录音已保存，正在整理可用证据…';
              await this.awaitTrainingAnalysis(completed);
            }
          }
          if (completed && !this.recordingStopOperation?.left) this.showRecord(completed);
        } else if (this.recordingSessionId === sessionId) {
          if (this.durableSession && this.persistence) await this.persistence.interrupt(
            this.durableSession.id, this.recordingTimingSnapshot('asr-error'));
          this.discardRecordingBuffer(sessionId);
          const retainedRecord = this.trainingRecords?.selected();
          if (retainedRecord) this.selectTrainingRecord(retainedRecord.id);
          this.trainingStatus.textContent = '语音识别处理失败，录音已停止，请重新开始';
          if (tailErrorMessage) this.showError(tailErrorMessage);
        }

        // UI：显示生成报告按钮，可翻阅字幕
        this.btnStop.classList.add('hidden');
        this.btnPause.classList.add('hidden');
        this.btnResume.classList.add('hidden');
        this.btnStart.classList.remove('hidden');
        this.timer.classList.remove('active');

        if (this.fullText.trim()) {
          this.btnReport.classList.remove('hidden');
        }
      }
    }
    return tailSucceeded || savedFailedTranscription;
  }

  // ===== ASR结果处理 =====

  async processASRResponse(
    response,
    commandErrorPrefix,
    resultErrorPrefix = '语音识别结果处理失败',
    canApplySideEffects = () => true,
    atMs = this.recordingPcm?.durationMs ?? 0
  ) {
    if (!response || response.ok !== true) {
      const message = typeof response?.error?.message === 'string'
        ? response.error.message
        : '未知错误';
      if (canApplySideEffects()) {
        this.showError(`${commandErrorPrefix}: ${message}`);
      }
      return false;
    }

    const events = Array.isArray(response.events) ? response.events : [];
    let hasAcceptedError = false;
    for (const event of events) {
      // Validate optional current-adapter cursor fields before advancing eventSequence.
      // Legacy/test envelopes without these fields remain explicitly unknown.
      if (event && this.recordingSessionId === event.sessionId) {
        const captured = this.recordingPcm?.frameCount ?? 0;
        const lastAccepted = this.recordingAcceptedSampleCount ?? 0;
        const end = event.type === 'stopped' ? event.finalAcceptedSampleCursor : event.acceptedSampleEnd;
        if (end !== undefined && (!Number.isSafeInteger(end) || end < lastAccepted || end > captured)) continue;
        if ((event.acceptedSampleStart !== undefined || event.acceptedSampleEnd !== undefined) &&
            (!Number.isSafeInteger(event.acceptedSampleStart) || event.acceptedSampleStart < lastAccepted ||
              !Number.isSafeInteger(event.acceptedSampleEnd) || event.acceptedSampleStart > event.acceptedSampleEnd)) continue;
        const quality = event.type === 'quality-event' ? [event] : event.qualityEvents || [];
        if (!Array.isArray(quality) || quality.length > 100 || quality.some(item =>
          !item || !['timing-unavailable','timing-estimated','audio-overrun','audio-discontinuity','asr-error'].includes(item.code) ||
          (!(item.startSample === null && item.endSample === null) &&
            (!Number.isSafeInteger(item.startSample) || !Number.isSafeInteger(item.endSample) ||
             item.startSample < 0 || item.endSample < item.startSample || item.endSample > captured)))) continue;
      }
      const filtered = filterAsrEvent(this.asrEventState, event);
      this.asrEventState = filtered.state;
      if (filtered.effect?.type === 'ready') this.recordingAsrCapabilities = event.capabilities || null;
      if (filtered.effect && this.recordingSessionId === event.sessionId) {
        const quality = event.type === 'quality-event' ? [event] : event.qualityEvents || [];
        this.recordingQualityEvents ||= [];
        for (const {code,startSample,endSample} of quality) {
          if (this.recordingQualityEvents.length < 100) this.recordingQualityEvents.push({code,startSample,endSample});
        }
        // Transport acceptance is an audio cursor, never the lexical interval of event.text.
        const accepted = event.type === 'stopped' ? event.finalAcceptedSampleCursor : event.acceptedSampleEnd;
        const captured = this.recordingPcm?.frameCount ?? 0;
        if (Number.isSafeInteger(accepted) && accepted >= (this.recordingAcceptedSampleCount ?? 0) && accepted <= captured) {
          this.recordingAcceptedSampleCount = accepted;
        }
      }
      if (filtered.effect?.type === 'result') {
        const resultGeneration = this.asrGeneration;
        const resultSessionId = event.sessionId;
        try {
          await this.handleASRResult(filtered.effect.result, resultGeneration, atMs);
        } catch (error) {
          if (resultGeneration === this.asrGeneration
              && this.asrEventState.activeSessionId === resultSessionId
              && canApplySideEffects()) {
            this.showError(`${resultErrorPrefix}: ${error.message}`);
          }
        }
      } else if (filtered.effect?.type === 'error') {
        hasAcceptedError = true;
        if (canApplySideEffects()) {
          this.showError(`语音识别错误: ${filtered.effect.message}`);
        }
      }
    }
    return !hasAcceptedError;
  }

  async cancelActiveAsrSession(
    expectedSessionId = this.asrEventState.activeSessionId,
    canApplySideEffects = () => true
  ) {
    if (!expectedSessionId) return;
    if (this.asrEventState.activeSessionId === expectedSessionId) {
      this.asrEventState = invalidateAsrSession(this.asrEventState);
    }
    try {
      const response = await window.api.cancelASR({ sessionId: expectedSessionId });
      await this.processASRResponse(
        response,
        '语音识别取消失败',
        '语音识别结果处理失败',
        canApplySideEffects
      );
    } catch (error) {
      if (canApplySideEffects()) {
        this.showError(`语音识别取消失败: ${error.message}`);
      }
    }
  }

  handleASRResult(
    { text, isFinal },
    resultGeneration = this.asrGeneration,
    atMs = this.recordingPcm?.durationMs ?? 0
  ) {
    let analysisPromise;
    if (isFinal) {
      const merged = mergeFinalText(this.fullText, text);
      if (!merged.appendedText) return;

      text = merged.appendedText;
      this.fullText = merged.fullText;
      this.sentences.push(text);
      let segment = null;
      let ownedSegments = null;
      if (this.recordingPcm && Array.isArray(this.pendingSegments)) {
        const previousEndMs = this.pendingSegments.at(-1)?.endMs ?? 0;
        const endMs = toSegmentEndMs(previousEndMs, Math.min(atMs, this.recordingPcm.durationMs));
        segment = {
          id: `segment-${this.pendingSegments.length + 1}`,
          text,
          startMs: previousEndMs,
          endMs,
          startSample: null,
          endSample: null,
          timingSource: 'estimated',
          timingVersion: 'renderer-final-boundary-v1',
          localAnalysis: null
        };
        this.pendingSegments.push(segment);
        ownedSegments = this.pendingSegments;
      }
      analysisPromise = Promise.resolve(this.analyzeCurrentSentence(text, resultGeneration))
        .then(analysis => {
          if (segment
              && resultGeneration === this.asrGeneration
              && this.pendingSegments === ownedSegments
              && ownedSegments.includes(segment)) {
            segment.localAnalysis = analysis ?? null;
          }
          return analysis;
        });

      // M2: training-time feedback uses local rules; structured AI runs after saving.
    }
    this.renderSubtitle(text, isFinal);
    return analysisPromise;
  }

  renderSubtitle(currentText, isFinal) {
    if (isFinal) {
      // 移除interim
      const interim = this.subtitleContainer.querySelector('.interim-line');
      if (interim) interim.remove();

      // 旧行变灰
      this.subtitleContainer.querySelectorAll('.subtitle-line:not(.old)').forEach(el => {
        el.classList.add('old');
      });

      // 新行
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      renderHighlightedText(line, currentText);
      this.subtitleContainer.appendChild(line);
    } else {
      let interim = this.subtitleContainer.querySelector('.interim-line');
      if (!interim) {
        interim = document.createElement('div');
        interim.className = 'subtitle-line interim-line';
        this.subtitleContainer.appendChild(interim);
      }
      interim.textContent = currentText;
    }

    // 自动滚到底
    this.subtitleScroll.scrollTop = this.subtitleScroll.scrollHeight;
  }

  // ===== 分析 =====

  async analyzeCurrentSentence(text, resultGeneration = this.asrGeneration) {
    const analysis = await window.api.analyzeText(text);
    if (resultGeneration !== this.asrGeneration) return;
    if (analysis) {
      this.stats.fillers += analysis.fillers.length;
      this.stats.hedges += analysis.hedges.length;
      this.stats.vagueWords += analysis.vagueWords.length;
      this.stats.totalWords += analysis.totalWords;
      const {excludedCharacters, hedgeCharacters} = analysisCharacterCounts(analysis);
      this.stats.excludedCharacters += excludedCharacters;
      this.stats.hedgeCharacters += hedgeCharacters;
      this.updateStatsDisplay();
      // 碰到笼统词 → 立刻在反馈栏弹出替换建议
      if (analysis.vagueWords && analysis.vagueWords.length > 0) {
        analysis.vagueWords.forEach(item => {
          const alts = item.alternatives.slice(0, 3).join(' / ');
          this.addFeedbackItem(`「${item.word}」→ ${alts}`, 'vague');
        });
      }
      // 碰到填充词 → 弹提醒
      if (analysis.fillers && analysis.fillers.length >= 2) {
        const uniqueFillers = [...new Set(analysis.fillers.map(f => f.word))].slice(0, 3);
        this.addFeedbackItem(`填充词：${uniqueFillers.join('、')}——试试停顿`, 'filler');
      }
      // 碰到犹豫词 → 弹提醒
      if (analysis.hedges && analysis.hedges.length >= 1) {
        const uniqueHedges = [...new Set(analysis.hedges.map(h => h.word))].slice(0, 2);
        this.addFeedbackItem(`「${uniqueHedges.join('」「')}」→ 直接说`, 'hedge');
      }
    }
    return analysis;
  }

  updateStatsDisplay() {
    this.statFillers.textContent = this.stats.fillers;
    this.statHedges.textContent = this.stats.hedges;
    this.statVague.textContent = this.stats.vagueWords;
    const density = densityPercent(this.stats.totalWords, this.stats.excludedCharacters);
    this.statDensity.textContent = density === null ? '--' : `${density}%`;
  }

  // ===== 实时反馈 =====

  async requestRealtimeFeedback() {
    const generation = this.llmGeneration;
    this.lastFeedbackText = this.fullText;
    this.feedbackStatus.textContent = '本地分析正常，AI 建议生成中…';
    let result;
    try {
      result = await window.api.getRealtimeFeedback(this.fullText);
    } catch {
      result = { success: false, error: '实时反馈请求失败，请重试', errorCode: 'generic' };
    }
    if (generation !== this.llmGeneration) return;
    if (result.success && result.feedback === '') {
      this.feedbackStatus.textContent = '内容为空：暂无建议';
    } else if (result.success && result.feedback) {
      this.feedbackStatus.textContent = '本地分析正常，AI 建议已更新';
      const lines = result.feedback.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        const type = this.classifyFeedback(line.trim());
        this.addFeedbackItem(line.trim(), type);
      });
    } else if (result.errorCode !== 'cancelled') {
      this.feedbackStatus.textContent = '本地分析正常，AI 建议暂不可用';
      this.showUserMessage(`实时反馈失败：${result.error || '未知错误'}`, {
        openSettings: CONFIG_ERROR_CODES.has(result.errorCode)
      });
    }
  }

  classifyFeedback(text) {
    if (text === '✓' || text.includes('✓')) return 'good';
    // 填充词相关
    const fillerKeywords = ['嗯','啊','呃','那个','就是','然后','这个','对吧','是吧','反正','基本上','所以说'];
    if (fillerKeywords.some(w => text.includes(`「${w}」`))) return 'filler';
    // 犹豫词相关
    const hedgeKeywords = ['可能','也许','大概','应该','我觉得','好像','似乎','感觉','或许'];
    if (hedgeKeywords.some(w => text.includes(`「${w}」`))) return 'hedge';
    // 其他精准词替换
    if (text.includes('→')) return 'vague';
    return 'ai';
  }

  addFeedbackItem(text, type = 'ai') {
    // 去重：如果前3条已经有相同内容，跳过
    const existing = Array.from(this.feedbackContent.children).slice(-3);
    if (existing.some(el => el.textContent === text)) return;

    const item = document.createElement('div');
    item.className = `feedback-item type-${type}`;
    item.textContent = text;
    this.feedbackContent.appendChild(item);
    while (this.feedbackContent.children.length > 12) {
      this.feedbackContent.removeChild(this.feedbackContent.firstChild);
    }
    this.feedbackContent.scrollTop = this.feedbackContent.scrollHeight;
  }

  // ===== 报告 =====

  async cancelProcessing() {
    if (this.recordingStopOperation) this.recordingStopOperation.cancelled = true;
    if (this.processingRecordId) {
      await window.api.cancelTrainingAnalysis({requestId:globalThis.crypto.randomUUID(),sessionId:this.processingRecordId});
    } else if (this.recordingStopOperation?.asrStopping) {
      await window.api.cancelASR({sessionId:this.recordingStopOperation.sessionId});
    }
  }

  async leaveProcessing() {
    if (!this.processingRecordId || !this.recordingStopOperation) return;
    this.recordingStopOperation.left = true;
    this.setScreen('history');
    await this.loadHistory();
  }

  async awaitTrainingAnalysis(record,retry = false,framework) {
    if (record.reportPending) return false;
    record.reportPending=true;
    if (this.viewingTrainingRecordId===record.id) this.btnReport.disabled=true;
    try {
      const result=await window.api.analyzeTrainingSession({requestId:globalThis.crypto.randomUUID(),sessionId:record.id,retry,
        ...(framework ? {framework} : {})});
      if (!result?.ok) throw new Error(result?.error?.message || '分析暂不可用，可重试；已保存训练保持不变。');
      return await this.refreshTrainingRecord(record);
    } catch (error) {
      if (this.viewingTrainingRecordId===record.id) this.reportAiStatus.textContent=error.message;
      return false;
    } finally {
      record.reportPending=false;
      if (this.viewingTrainingRecordId===record.id) this.btnReport.disabled=false;
    }
  }

  async refreshTrainingRecord(record) {
    const saved=await window.api.getTrainingSession({requestId:globalThis.crypto.randomUUID(),sessionId:record.id}).catch(()=>null);
    if (record.deleted || this.deletedSessionIds?.has(record.id) || !saved?.ok || !saved.value) return false;
    const retained={audioUrl:record.audioUrl};
    if (record.pendingResults?.length || ['saving','failed'].includes(record.saveState)) {
      for (const key of ['saveState','saveError','stats','metricsAvailable','segments','report','reportStatus','playbackAnalysis','playbackStatus']) {
        retained[key]=record[key];
      }
    }
    Object.assign(record,Persistence.sessionToRecord(saved.value),retained);
    if (this.viewingTrainingRecordId===record.id && this.currentScreen==='report') {
      this.renderCurrentReport(record);
      this.renderRecordStatus(record);
    }
    return true;
  }

  retryTrainingSave() {
    const record = this.trainingRecords?.selected();
    if (this.closing || !record || !this.persistence) return Promise.resolve(false);
    return this.trackAnalysis(async () => {
      const saved = await this.persistence.save(record);
      if (!saved || !record.factsSaved || record.deleted || this.deletedSessionIds?.has(record.id)) return false;
      // Main starts analysis when finalization succeeds. Join that job (or its
      // saved snapshot), then refresh only the original record and current view.
      if (typeof window.api.analyzeTrainingSession === 'function') return this.awaitTrainingAnalysis(record);
      return true;
    });
  }

  renderCurrentReport(record) {
    this.reportCleanup?.();this.reportCleanup = null;
    if (record.structuredReport) {
      this.reportCleanup = StructuredReport.renderStructuredReport(this.reportBody,record.structuredReport,{segments:record.segments,record,api:window.api,
        onEvidence:ref => this.focusReportEvidence(record,ref),
        onPractice:(finding,scope,continueChain = false) => {
          const practiceRequest = {sessionId:record.id,reportId:record.structuredReport.snapshot.id,
            findingId:continueChain ? null : finding.id,scope,continueChain};
          this.showTraining();
          this.trainingSetup.configure(record,{practiceRequest,practiceLabel:finding.observation});
        },
        onOpen:(id,reportId) => this.openHistoryRecord(id,{reportId,returnTo:{id:record.id,
          reportId:record.structuredReport.snapshot.id,source:this.reportSource,returnTo:this.practiceReturn}}),
        onReanalyze:framework => this.trackAnalysis(() => this.awaitTrainingAnalysis(record,true,framework)),
        onFramework:framework => {
          const definition = TrainingFrameworks.getFramework(framework);
          if (!definition) return;
          this.showTraining();
          this.trainingSetup.configure({...record,trainingMode:'structured',framework,frameworkDefinitionVersion:definition.version});
        }});
      this.reportAiStatus.textContent=record.dataQuality?.includes('asr-error') ? '转写未完成，已保存录音及可用证据；可改选模型进行新训练。' : '';
      this.btnReport.querySelector?.('.btn-label') && (this.btnReport.querySelector('.btn-label').textContent='重试诊断');
    } else this.renderReport(record.report || '训练已保存；暂无结构化诊断，可在设置中启用自动诊断后重试。');
  }

  focusReportEvidence(record,ref) {
    if (ref.startsWith('metric:')) {document.getElementById(ref)?.scrollIntoView({block:'center',behavior:'smooth'});return;}
    const segment=record.segments.find(item=>item.id===ref);
    const speech=record.structuredReport?.evidenceRun?.value?.segments?.find(item=>item.id===ref);
    const startMs=segment?.startMs ?? (speech ? speech.startSample/16 : null);
    if (startMs !== null && Number.isFinite(startMs) && record.audioUrl) {
      this.audioPlayer.currentTime=startMs/1000;
      this.audioPlayer.focus?.();
    }
    if (segment) this.reportAiStatus.textContent=`原文证据：${segment.text}${segment.timingSource==='estimated'?'（播放位置为估计）':''}`;
  }

  generateReport() { return this.closing ? Promise.resolve(false) : this.trackAnalysis(() => this.generateReportForRecord()); }

  async generateReportForRecord() {
    const record = this.trainingRecords?.selected();
    if (record?.factsSaved && typeof window.api.analyzeTrainingSession==='function') return this.awaitTrainingAnalysis(record,true);
    if (!record || !record.fullText.trim()) {
      this.showUserMessage('暂无可分析的逐字稿'); return false;
    }
    if (record.metricsAvailable === false) { this.showUserMessage('这条记录缺少已保存的本地统计，无法生成原有 AI 报告；逐字稿和音频仍可查看。'); return false; }
    if (record.reportPending) return false;
    record.reportPending = true;
    this.btnReport.disabled = true;
    this.reportAiStatus && (this.reportAiStatus.textContent = '正在生成 AI 报告…');
    try {
      let response;
      try { response = await window.api.getFinalReport({fullText:record.fullText,stats:record.stats}); }
      catch { response = {success:false,error:'报告请求失败，请重试'}; }
      if (record.deleted) return false;
      if (response.success) record.report = response.report;
      record.reportStatus = response.success ? 'completed' : 'failed';
      if (this.persistence) await this.persistence.append(record, {
        kind:'report',status:record.reportStatus,value:response.success ? response.report : {error:response.error || '分析失败'},
        createdAt:response.createdAt || new Date().toISOString(),provenance:response.provenance || {},
        definitionVersion:'report-v1',analyzerVersion:'ai-feedback-v1'
      });
      if (this.viewingTrainingRecordId === record.id && this.currentScreen === 'report') {
        this.renderReport(record.report || '尚未生成 AI 报告。');
        this.reportAiStatus && (this.reportAiStatus.textContent = response.success ? '' : '生成失败，可重试；已有内容仍可查看。');
        if (!response.success) this.showUserMessage(response.error || '报告生成失败，请重试', {openSettings:CONFIG_ERROR_CODES.has(response.errorCode)});
      }
      return response.success;
    } finally {
      record.reportPending = false;
      if (this.viewingTrainingRecordId === record.id) this.btnReport.disabled = false;
    }
  }

  renderReport(report) {
    renderReportContent(this.reportBody, report);
  }

  // ===== 工具 =====

  updateTimer() {
    let totalPaused = this.pausedTime;
    if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
    const elapsed = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    this.timer.textContent = `${minutes}:${seconds}`;
  }

  resetStats() {
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0, excludedCharacters: 0, hedgeCharacters: 0 };
    this.updateStatsDisplay();
    this.feedbackContent.replaceChildren();
    this.feedbackStatus.textContent = '训练中使用本地规则；结束后按设置自动生成 AI 诊断';
  }

  advanceLLMGeneration() {
    this.llmGeneration = (this.llmGeneration ?? 0) + 1;
    return this.llmGeneration;
  }

  showError(msg) {
    if (this.currentScreen === 'training' && !this.isRecording) this.showUserMessage(msg);
    const line = document.createElement('div');
    line.className = 'subtitle-line';
    line.style.color = '#ff6b6b';
    line.textContent = msg;
    this.subtitleContainer.appendChild(line);
  }

  showUserMessage(message, { openSettings = false } = {}) {
    this.userMessageText.textContent = message;
    this.userMessageRequiresSettings = openSettings;
    this.userMessageAction.classList.toggle('hidden', !openSettings);
    this.userMessage.classList.remove('hidden');
  }

  hideUserMessage() {
    this.userMessageRequiresSettings = false;
    this.userMessageAction.classList.add('hidden');
    this.userMessage.classList.add('hidden');
  }

  async handleLlmProviderSettingsChanged() {
    const dismissedConfigurationMessage = this.userMessageRequiresSettings;
    if (dismissedConfigurationMessage) this.hideUserMessage();
    const summary = await this.refreshLlmProfileOptions({supersede: true});
    if (!summary) return null;
    const record = this.trainingRecords?.selected();
    if (record?.id === this.viewingTrainingRecordId) {
      this.renderPlaybackAnalysis(record, this.playbackSegmentId);
    } else if (dismissedConfigurationMessage) {
      this.feedbackStatus.textContent = '训练中使用本地规则；结束后按设置自动生成 AI 诊断';
    }
    return summary;
  }

  openModal(modal, initialFocus) {
    this.modalOpener = document.activeElement;
    this.activeModal = modal;
    modal.classList.remove('hidden');
    initialFocus?.focus();
  }

  closeModal(modal) {
    modal.classList.add('hidden');
    if (this.activeModal === modal) this.activeModal = null;
    const opener = this.modalOpener;
    this.modalOpener = null;
    opener?.focus();
    if (modal === this.helpModal && this.firstRunHelpOpen) {
      this.firstRunHelpOpen = false;
      try {
        window.localStorage.setItem('expression-trainer.help-seen', '1');
      } catch {}
    }
    if (!this.firstRunHelpOpen) void this.showFirstRunRecordingPolicy();
  }

  handleModalKeydown(event) {
    const modal = this.activeModal;
    if (!modal || modal.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (modal === this.recordingPolicyModal && this.recordingPolicyDecision) {
        this.resolveRecordingPolicyDecision(false);
        return;
      }
      this.closeModal(modal);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(modal.querySelectorAll(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  finishTrainingPreparation() {
    this.trainingSetup?.lock(this.currentScreen !== 'training' || this.isRecording || this.asrStartAttempt || this.recordingStopOperation);
    if (this.trainingStatus.dataset) this.trainingStatus.dataset.microphoneState = this.microphoneState || 'unknown';
    const loading = this.asrPreparationState === 'loading';
    this.trainingStatus.textContent = loading ? ASR_LOADING_MESSAGE
      : this.asrPreparationState === 'failed' ? '语音模型加载失败，请重试加载或检查设置'
      : this.microphoneState === 'denied' ? '麦克风权限被拒绝，请在系统隐私设置中允许后重试'
      : this.microphoneState === 'unavailable' ? '未检测到麦克风，请连接后重试'
      : this.microphoneState === 'ready' ? '准备就绪' : '语音模型已就绪；开始时检查麦克风权限';
    this.btnStart.disabled = loading;
  }

  setScreen(screen, state = 'preparing') {
    if (screen !== 'report') {this.reportCleanup?.();this.reportCleanup = null;}
    this.currentScreen = screen;
    this.navigationGeneration = (this.navigationGeneration || 0) + 1;
    if (document.body?.dataset) {
      document.body.dataset.screen = screen;
      document.body.dataset.trainingState = state;
    }
    const busy = this.isRecording || this.asrStartAttempt || this.recordingStopOperation;
    this.trainingSetup?.lock(screen !== 'training' || state !== 'preparing' || busy);
    for (const name of ['btn-home','btn-history']) {
      const button = document.getElementById?.(name);
      if (button) button.disabled = Boolean(busy);
    }
  }

  showTraining() {
    if (this.isRecording || this.asrStartAttempt || this.recordingStopOperation) return;
    this.comparison?.leave(true);
    this.audioPlayer?.pause?.();
    this.viewingTrainingRecordId = null;
    this.releaseSavedRecordCache();
    this.fullText = '';
    this.setScreen('training');
    this.trainingSetup?.clearPractice();
    this.finishTrainingPreparation();
    const area = document.querySelector('.main-area');
    if (area) area.scrollTop = 0;
    document.getElementById('training-setup-title')?.focus({preventScroll:true});
  }

  showRecord(record, source = null) {
    this.reportSource = source;
    this.selectTrainingRecord(record.id);
    this.setScreen('report');
    this.reportBack?.classList.toggle('hidden', !['history','comparison','practice'].includes(source));
    if (this.reportBack) this.reportBack.textContent = source === 'comparison' ? '← 返回对比' : source === 'practice' ? '← 返回本轮报告' : '← 训练历史';
    if (!record.structuredReport) this.reportAiStatus && (this.reportAiStatus.textContent = record.reportStatus === 'failed' ? '上次 AI 报告生成失败，可重试；已有结果保留。' : '');
    const structuredAnalysis = record.factsSaved && typeof window.api.analyzeTrainingSession === 'function';
    this.btnReport.disabled = Boolean(record.reportPending) || !record.fullText.trim() ||
      (!structuredAnalysis && record.metricsAvailable === false);
    this.btnReanalyze.disabled = Boolean(record.playbackPending);
  }

  renderRecordStatus(record) {
    if (this.viewingTrainingRecordId !== record.id || !this.recordSaveStatus) return;
    this.recordIdentity.textContent = `${new Date(record.createdAt).toLocaleString()} · ${Math.round(record.durationMs / 1000)} 秒 · ${TrainingContext.formatTrainingContext(record)}`;
    const states = {saving:'正在保存…',saved:'这次训练已经保存',failed:record.factsSaved ? '训练已保存，部分分析结果保存失败，请重试。' : '训练保存失败，请重试；关闭应用将丢失未保存内容。',incomplete:'这条记录未完成或已损坏，现有可读内容仍可查看。'};
    const audio = record.audioState === 'missing' ? '音频缺失，无法播放。' : record.audioState === 'corrupt' ? '音频损坏，无法播放。' : '';
    this.recordSaveStatus.textContent = [states[record.saveState] || '记录状态未知',audio,record.resultIntegrity === 'corrupt' ? '部分分析结果损坏。' : '', record.metricsAvailable === false ? '本地统计未保存，无法生成原有 AI 报告。' : '', record.segments.length ? '片段时间为估计值。' : ''].filter(Boolean).join(' ');
    this.recordSaveStatus.setAttribute?.('role',record.saveState === 'failed' ? 'alert' : 'status');
    this.retrySave?.classList.toggle('hidden',record.saveState !== 'failed');
    if (this.retrySave) this.retrySave.disabled = record.saveState === 'saving';
  }

  async showHistory({restore = false} = {}) {
    if (this.isRecording || this.asrStartAttempt || this.recordingStopOperation) return;
    this.comparison?.leave(!restore);
    this.audioPlayer?.pause?.();
    this.releaseSavedRecordCache();
    this.setScreen('history');
    if (restore && this.historyList?.children.length) {
      const area = document.getElementById('history-screen');
      area.scrollTop = this.historyScroll || 0;
      if (this.historyReturnFocus) document.getElementById(this.historyReturnFocus)?.focus({preventScroll:true});
      else this.historyList.querySelector(`[data-record-id="${this.historyOpenedId}"]`)?.focus({preventScroll:true});
      return;
    }
    await this.loadHistory();
  }

  async loadHistory(more = false) {
    if (this.historyLoading) return;
    this.historyLoading = true;
    this.historyStatus.textContent = '正在读取训练历史…';
    this.historyMore.disabled = true;
    if (!more) { this.historyOffset = 0; this.historyList.replaceChildren(); }
    try {
      const response = await window.api.listTrainingSessions({requestId:globalThis.crypto.randomUUID(),limit:50,offset:this.historyOffset});
      if (!response?.ok) throw new Error(response?.error?.message || '无法读取训练历史');
      for (const item of response.value) {
        const row = document.createElement('div'); row.className = 'history-row';
        this.comparison?.addChoice(row,item);
        const open = document.createElement('button'); open.className = 'history-row-main'; open.dataset.recordId = item.id;
        const state = item.deletionPending ? '删除未完成' : ({completed:'已保存',incomplete:'未完成',corrupt:'记录损坏',recording:'录音中',finalizing:'保存中'}[item.status] || item.status);
        open.textContent = `${new Date(item.createdAt).toLocaleString()} · ${Math.round((item.durationMs || 0)/1000)} 秒 · ${TrainingContext.formatTrainingContext(item)} · ${state}${item.summary ? '\n'+item.summary : ''}`;
        open.addEventListener('click',() => this.openHistoryRecord(item.id));
        const remove = document.createElement('button'); remove.className = 'history-row-actions'; remove.textContent = item.deletionPending ? '重试删除' : '删除';
        remove.addEventListener('click',() => this.deleteHistoryRecord(item.id));
        row.appendChild(open); row.appendChild(remove); this.historyList.appendChild(row);
      }
      this.historyOffset += response.value.length;
      this.comparison?.syncSelection();
      this.historyStatus.textContent = this.historyOffset ? '' : '暂无训练记录。完成一次表达后会自动保存在这里。';
      this.historyMore.classList.toggle('hidden',response.value.length < 50);
      document.getElementById('btn-history-start')?.classList.toggle('hidden',this.historyOffset > 0);
    } catch (error) {
      this.historyStatus.textContent = error.message;
      this.historyMore.textContent = '重试读取'; this.historyMore.classList.remove('hidden');
    } finally { this.historyLoading = false; this.historyMore.disabled = false; }
  }

  async openHistoryRecord(id,{reportId = null,returnTo = null,source = 'history'} = {}) {
    const navigation = this.navigationGeneration;
    this.historyScroll = document.getElementById('history-screen')?.scrollTop || 0;
    this.historyOpenedId = id;
    this.historyReturnFocus = null;
    try {
      let record = this.getTrainingRecordStore().list().find(item => item.id === id);
      if (!record || record.saveState === 'saved') {
        const response = await window.api.getTrainingSession({requestId:globalThis.crypto.randomUUID(),sessionId:id});
        if (!response?.ok || !response.value) throw new Error(response?.error?.message || '记录不存在，请刷新历史');
        if (this.navigationGeneration !== navigation || this.deletedSessionIds?.has(id)) return;
        const fresh = Persistence.sessionToRecord(response.value);
        // Keep in-flight results attached to the same object, independently of this view.
        if (record?.reportPending || record?.playbackPending) Object.assign(record,{audioState:fresh.audioState});
        else { this.getTrainingRecordStore().remove(id); record = fresh; this.getTrainingRecordStore().add(record); }
        if (record.audioState === 'available' && !record.audioUrl) {
          const audio = await window.api.readTrainingAudio({requestId:globalThis.crypto.randomUUID(),sessionId:id});
          if (this.navigationGeneration !== navigation || this.deletedSessionIds?.has(id)) { this.getTrainingRecordStore().remove(id); return; }
          if (audio?.ok) record.audioUrl = this.getObjectUrlApi().createObjectURL(new (window.Blob || globalThis.Blob)([audio.value],{type:'audio/wav'}));
          else record.audioState = 'missing';
        }
      }
      if (this.navigationGeneration !== navigation || this.deletedSessionIds?.has(id)) return;
      if (reportId) {
        const pinned = StructuredReport.selectStructuredReport(record.results,{snapshotId:reportId});
        if (!pinned) throw new Error('这轮报告暂不可用，原录音仍可从历史查看。');
        record.structuredReport = pinned;
      }
      this.practiceReturn = returnTo;
      this.showRecord(record,returnTo ? 'practice' : source);
    } catch (error) {
      this.historyStatus.textContent = error.message;
      if (this.currentScreen !== 'history') this.showUserMessage(error.message);
    }
  }

  async deleteHistoryRecord(id) {
    if (!window.confirm('删除这次训练的录音、逐字稿和分析结果？此操作无法撤销。')) return;
    const response = await window.api.deleteTrainingSession({requestId:globalThis.crypto.randomUUID(),sessionId:id}).catch(() => null);
    if (!response?.ok) { this.historyStatus.textContent = response?.error?.message || '删除失败，请重试'; return; }
    this.deletedSessionIds ||= new Set();
    this.deletedSessionIds.add(id);
    this.comparison?.remove(id);
    this.navigationGeneration = (this.navigationGeneration || 0) + 1;
    const record = this.getTrainingRecordStore().list().find(item => item.id === id);
    if (record) record.deleted = true;
    this.getTrainingRecordStore().remove(id);
    if (this.viewingTrainingRecordId === id) this.viewingTrainingRecordId = null;
    await this.loadHistory();
  }

  releaseSavedRecordCache() {
    for (const record of this.getTrainingRecordStore().list()) {
      if (record.saveState === 'saved' && !record.reportPending && !record.playbackPending) {
        this.getTrainingRecordStore().remove(record.id);
      }
    }
  }

  trackAnalysis(action) {
    this.pendingAnalysis ||= new Set();
    const work = action();
    this.pendingAnalysis.add(work);
    void work.finally(() => this.pendingAnalysis.delete(work)).catch(() => {});
    return work;
  }

  async prepareTrainingClose() {
    if (this.closing) return false;
    this.closing = true;
    let ready = false;
    try {
      if (this.asrStartAttempt) { this.showUserMessage('录音正在启动，请稍候再退出。'); return false; }
      if (this.processingRecordId) await window.api.cancelTrainingAnalysis?.({requestId:globalThis.crypto.randomUUID(),sessionId:this.processingRecordId});
      if (this.recordingStopOperation) await this.recordingStopOperation.promise;
      else if (this.isRecording) await this.stopRecording();
      await window.api.cancelLLMRequests();
      await Promise.allSettled([...(this.pendingAnalysis || [])]);
      await this.persistence?.drain();
      ready = !this.getTrainingRecordStore().list().some(record => record.saveState === 'failed')
        || window.confirm('部分训练或分析结果尚未保存，退出会丢失未保存内容。仍要退出吗？');
      return ready;
    } finally {
      if (!ready) this.closing = false;
    }
  }

  finalizeTrainingRecord(failureCode = null) {
    const recorder = this.recordingPcm;
    if (!recorder) return null;
    const durationMs = recorder.durationMs;
    const segments = this.pendingSegments;
    const finalSegment = segments.at(-1);
    if (finalSegment && (!finalSegment.timingSource || finalSegment.timingSource === 'estimated')) {
      finalSegment.endMs = toSegmentEndMs(finalSegment.startMs, Math.max(finalSegment.endMs, durationMs));
    }
    let audioUrl = null;
    let record;
    try {
      const blob = recorder.finish(window.Blob || globalThis.Blob);
      audioUrl = this.getObjectUrlApi().createObjectURL(blob);
      record = {
        id: this.durableSession?.id || `record-${this.recordingSessionId}`,
        ...TrainingContext.normalizeTrainingContext(this.durableSession || {}),
        practice:this.durableSession?.practice ?? null,
        completedAt: new Date().toISOString(),
        audioBlob: blob,
        saveState: 'saving',
        createdAt: this.durableSession?.createdAt || this.recordingCreatedAt || new Date().toISOString(),
        durationMs,
        ...this.recordingTimingSnapshot(failureCode),
        audioUrl,
        segments,
        stats: { ...this.stats },
        fullText: this.fullText,
        playbackAnalysis: null
      };
      this.getTrainingRecordStore().add(record);
    } catch (error) {
      if (audioUrl) this.getObjectUrlApi().revokeObjectURL(audioUrl);
      this.discardRecordingBuffer();
      this.showUserMessage(`录音回放生成失败：${error.message}`);
      return null;
    }
    this.recordingPcm = null;
    this.recordingSessionId = null;
    this.recordingCreatedAt = null;
    this.pendingSegments = [];
    this.limitStopPromise = null;
    try {
      this.selectTrainingRecord(record.id);
      if (this.persistence) record.savePromise = this.persistence.save(record);
    } catch (error) {
      this.showUserMessage(`训练记录显示失败：${error.message}`);
    }
    return record;
  }

  refreshTrainingRecordSelect() {}

  selectTrainingRecord(recordId) {
    const record = this.getTrainingRecordStore().select(recordId);
    if (!record) return null;
    this.viewingTrainingRecordId = record.id;
    this.refreshPlaybackControls();
    this.renderRecordStatus(record);
    this.renderCurrentReport(record);
    return record;
  }

  refreshPlaybackControls() {
    const record = this.trainingRecords?.selected() ?? null;
    if (!record || record.id !== this.viewingTrainingRecordId) {
      this.playbackSegmentId = null;
      this.playbackControls?.classList.add('hidden');
      if (this.audioPlayer) {
        // src='' 会被解析成页面自身的 URL，媒体元素会去加载 index.html 并报错
        this.audioPlayer.removeAttribute('src');
        this.audioPlayer.load?.();
      }
      return null;
    }

    this.playbackControls?.classList.remove('hidden');
    if (this.audioPlayer && record.audioUrl && this.audioPlayer.src !== record.audioUrl) this.audioPlayer.src = record.audioUrl;
    if (!record.audioUrl) { this.audioPlayer?.removeAttribute('src'); this.audioPlayer?.load?.(); }
    this.fullText = record.fullText;
    this.sentences = record.segments.map(segment => segment.text);
    this.stats = { ...record.stats };
    this.lastFeedbackText = '';
    this.subtitleContainer.replaceChildren();
    if (!record.segments.length && record.fullText) {
      const text = document.createElement('div'); text.className = 'subtitle-line'; text.textContent = record.fullText; this.subtitleContainer.appendChild(text);
    }
    for (const segment of record.segments) {
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.dataset.segmentId = segment.id;
      renderHighlightedText(line, segment.text);
      this.subtitleContainer.appendChild(line);
    }
    this.updateStatsDisplay();
    if (record.metricsAvailable === false) for (const stat of [this.statFillers,this.statHedges,this.statVague,this.statDensity]) stat.textContent = '不可用';
    const totalSeconds = Math.max(0, Math.floor(record.durationMs / 1000));
    this.timer.textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
    this.btnReport.classList.toggle('hidden', !record.fullText.trim());
    this.refreshTrainingRecordSelect();
    void this.loadLlmProfileOptions(this.playbackProfileSummary);
    this.playbackSegmentId = null;
    const initialSegment = findSegmentAtTime(record.segments, 0);
    if (initialSegment) {
      this.playbackSegmentId = initialSegment.id;
      this.renderPlaybackSegment(initialSegment.id);
    } else {
      this.renderPlaybackAnalysis(record, null);
    }
    return record;
  }

  togglePlayback() {
    const record = this.trainingRecords?.selected() ?? null;
    if (!record || record.id !== this.viewingTrainingRecordId || !record.audioUrl || !this.audioPlayer) return false;
    if (this.audioPlayer.paused) {
      const playing = this.audioPlayer.play();
      playing?.catch?.(() => this.showUserMessage('录音播放失败，请重试'));
    } else {
      this.audioPlayer.pause();
    }
    return true;
  }

  handlePlaybackTimeUpdate() {
    const record = this.trainingRecords?.selected() ?? null;
    if (!record || record.id !== this.viewingTrainingRecordId || !this.audioPlayer) return;
    const segment = findSegmentAtTime(record.segments, this.audioPlayer.currentTime * 1000);
    const segmentId = segment?.id ?? null;
    if (segmentId === this.playbackSegmentId) return;
    this.playbackSegmentId = segmentId;
    this.renderPlaybackSegment(segmentId);
  }

  renderPlaybackSegment(segmentId) {
    const record = this.trainingRecords?.selected() ?? null;
    if (!record || record.id !== this.viewingTrainingRecordId) return;
    let currentLine = null;
    for (const line of this.subtitleContainer.querySelectorAll('[data-segment-id]')) {
      const isCurrent = line.dataset.segmentId === segmentId;
      line.classList.toggle('playback-current', isCurrent);
      if (isCurrent) currentLine = line;
    }
    currentLine?.scrollIntoView({block: 'nearest'});
    this.renderPlaybackAnalysis(record, segmentId);
  }

  renderPlaybackAnalysis(record, segmentId) {
    const analysis = record.playbackAnalysis;
    if (!analysis) {
      this.feedbackStatus.textContent = '尚未生成回放分析';
      this.feedbackContent.textContent = '';
      return;
    }
    const model = analysis.profile?.model || '未知模型';
    this.feedbackStatus.textContent = `回放分析 · ${model}`;
    const item = analysis.items?.find(candidate => candidate.segmentId === segmentId);
    this.feedbackContent.textContent = item?.advice || '该片段暂无特别建议';
  }

  async loadLlmProfileOptions(summary, {isCurrent = () => true} = {}) {
    try {
      const nextSummary = summary?.profiles
        ? summary
        : await window.api.getLlmProfileSummaries();
      if (!isCurrent()) return null;
      if (!nextSummary || !Array.isArray(nextSummary.profiles)) return null;
      this.playbackProfileSummary = nextSummary;
      if (this.playbackModel) {
        const options = nextSummary.profiles.map(profile => {
          const option = document.createElement('option');
          option.value = profile.id;
          option.textContent = profile.model;
          return option;
        });
        this.playbackModel.replaceChildren(...options);
        this.playbackModel.value = nextSummary.activeProfileId || '';
      }
      return nextSummary;
    } catch (error) {
      if (isCurrent() && this.viewingTrainingRecordId) {
        this.feedbackStatus.textContent = error?.message || '无法加载分析模型';
      }
      return null;
    }
  }

  refreshLlmProfileOptions({supersede = false} = {}) {
    if (!supersede && this.playbackProfileRefreshPromise) {
      return this.playbackProfileRefreshPromise;
    }
    const refreshGeneration = (this.playbackProfileRefreshGeneration ?? 0) + 1;
    this.playbackProfileRefreshGeneration = refreshGeneration;
    const refreshPromise = this.loadLlmProfileOptions(undefined, {
      isCurrent: () => refreshGeneration === this.playbackProfileRefreshGeneration
    });
    this.playbackProfileRefreshPromise = refreshPromise;
    void refreshPromise.finally(() => {
      if (this.playbackProfileRefreshPromise === refreshPromise) {
        this.playbackProfileRefreshPromise = null;
      }
    });
    return refreshPromise;
  }

  async selectPlaybackProfile(profileId) {
    if (!profileId) return false;
    const previousActiveProfileId = this.playbackProfileSummary?.activeProfileId || '';
    const restoreSelection = async () => {
      const refreshed = await this.refreshLlmProfileOptions({supersede: true});
      if (!refreshed && this.playbackModel) this.playbackModel.value = previousActiveProfileId;
    };
    try {
      const response = await window.api.selectLlmProfile(profileId);
      if (!response?.success) {
        await restoreSelection();
        this.feedbackStatus.textContent = response?.error || '无法切换分析模型';
        return false;
      }
      this.playbackProfileRefreshGeneration = (this.playbackProfileRefreshGeneration ?? 0) + 1;
      this.playbackProfileRefreshPromise = null;
      await this.loadLlmProfileOptions(response.summary);
      const record = this.trainingRecords?.selected();
      if (record?.id === this.viewingTrainingRecordId) {
        this.renderPlaybackAnalysis(record, this.playbackSegmentId);
      }
      return true;
    } catch (error) {
      await restoreSelection();
      this.feedbackStatus.textContent = error?.message || '无法切换分析模型';
      return false;
    }
  }

  analyzeSelectedRecording() { return this.closing ? Promise.resolve(false) : this.trackAnalysis(() => this.analyzeRecordingForRecord()); }

  async analyzeRecordingForRecord() {
    const record = this.trainingRecords?.selected();
    if (!record || record.playbackPending) return false;
    if (!record.segments.length || record.segments.some(s => !Number.isInteger(s.startMs) || !Number.isInteger(s.endMs) || s.endMs <= s.startMs)) {
      this.feedbackStatus.textContent = '没有可分析的有效片段时间，仍可查看逐字稿。'; return false;
    }
    record.playbackPending = true;
    this.btnReanalyze.disabled = true;
    try {
      let refresh = this.playbackProfileRefreshPromise || this.refreshLlmProfileOptions();
      while (refresh) {
        await refresh;
        const latest = this.playbackProfileRefreshPromise;
        if (!latest || latest === refresh) break;
        refresh = latest;
      }
      if (record.deleted) return false;
      const profileId = this.playbackProfileSummary?.activeProfileId;
      if (!profileId) { this.showUserMessage('请先配置分析模型',{openSettings:true}); return false; }
      this.feedbackStatus.textContent = '正在分析回放…';
      let response;
      try { response = await window.api.analyzePlayback({profileId,segments:record.segments.map(({id,text,startMs,endMs}) => ({id,text,startMs,endMs}))}); }
      catch { response = {success:false,error:'回放分析失败，请重试'}; }
      if (record.deleted) return false;
      if (response.success) record.playbackAnalysis = response.analysis;
      record.playbackStatus = response.success ? 'completed' : 'failed';
      if (this.persistence) await this.persistence.append(record, {
        kind:'playback',status:record.playbackStatus,value:response.success ? response.analysis : {error:response.error || '分析失败'},
        createdAt:response.createdAt || new Date().toISOString(),provenance:response.provenance || {},
        definitionVersion:'playback-v1',analyzerVersion:'ai-feedback-v1'
      });
      if (this.viewingTrainingRecordId === record.id && this.currentScreen === 'report') {
        this.renderPlaybackAnalysis(record,this.playbackSegmentId);
        if (!response.success) this.feedbackStatus.textContent = '回放分析失败，可重试；已有分析保留。';
      }
      return response.success;
    } finally { record.playbackPending = false; if (this.viewingTrainingRecordId === record.id) this.btnReanalyze.disabled = false; }
  }

  handleGlobalKeydown(event) {
    if (event.code !== 'Space' || event.repeat || event.defaultPrevented) return;
    const visibleModal = (this.activeModal && !this.activeModal.classList.contains('hidden'))
      || document.querySelector?.('.modal:not(.hidden)');
    if (visibleModal) return;
    if (event.target?.closest?.('input, textarea, select, button, audio, [contenteditable="true"]')) return;
    if (this.isRecording) {
      event.preventDefault();
      if (this.isPaused) this.resumeRecording();
      else this.pauseRecording();
      return;
    }
    const record = this.trainingRecords?.selected() ?? null;
    if (!record || record.id !== this.viewingTrainingRecordId || !record.audioUrl) return;
    event.preventDefault();
    this.togglePlayback();
  }

  disposeTrainingRecords() {
    this.advanceLLMGeneration();
    this.playbackAnalysisGeneration += 1;
    try {
      const cancellation = window.api.cancelLLMRequests();
      cancellation?.catch?.(() => {});
    } catch {}
    this.trainingRecords?.clear();
    this.discardRecordingBuffer();
    this.viewingTrainingRecordId = null;
  }

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mergeFinalText, toSegmentEndMs, ExpressionTrainer };
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => { new ExpressionTrainer(); });
}
