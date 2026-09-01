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
const CONFIG_ERROR_CODES = new Set([
  'missing-api-key',
  'missing-endpoint',
  'missing-model',
  'invalid-endpoint',
  'invalid-provider',
  'unauthorized'
]);

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
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.lastFeedbackText = '';
    this.lastReport = '';
    this.reportRequestPending = false;
    this.pasteAnalysisPending = false;
    this.pasteAnalysisGeneration = 0;
    this.llmGeneration = 0;
    this.userMessageRequiresSettings = false;
    this.activeModal = null;
    this.modalOpener = null;
    this.asrEventState = createAsrEventState();
    this.asrStartAttempt = null;
    this.asrGeneration = 0;
    this.recordingPolicyAcknowledged = false;
    this.recordingPolicyDecision = null;
    this.recordingPcm = null;
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

    this.initElements();
    this.bindEvents();
    void this.refreshLlmProfileOptions();
  }

  initElements() {
    this.btnStart = document.getElementById('btn-start');
    this.btnStartLabel = this.btnStart.querySelector('.btn-label');
    this.btnPaste = document.getElementById('btn-paste');
    this.btnPause = document.getElementById('btn-pause');
    this.btnResume = document.getElementById('btn-resume');
    this.btnStop = document.getElementById('btn-stop');
    this.btnStopLabel = this.btnStop.querySelector('.btn-label');
    this.btnReport = document.getElementById('btn-report');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnHelp = document.getElementById('btn-help');
    this.btnDiagnostics = document.getElementById('btn-diagnostics');
    this.btnCloseReport = document.getElementById('btn-close-report');
    this.btnClosePaste = document.getElementById('btn-close-paste');
    this.btnAnalyzePaste = document.getElementById('btn-analyze-paste');
    this.btnCopyText = document.getElementById('btn-copy-text');
    this.btnSaveText = document.getElementById('btn-save-text');
    this.btnClear = document.getElementById('btn-clear');
    this.btnCopyReport = document.getElementById('btn-copy-report');
    this.pasteModal = document.getElementById('paste-modal');
    this.pasteTextarea = document.getElementById('paste-textarea');
    this.timer = document.getElementById('timer');
    this.subtitleScroll = document.getElementById('subtitle-scroll');
    this.subtitleContainer = document.getElementById('subtitle-container');
    this.feedbackContent = document.getElementById('feedback-content');
    this.reportModal = document.getElementById('report-modal');
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
    this.btnRecordingPolicyConfirm = document.getElementById('btn-recording-policy-confirm');
    this.btnRecordingPolicyCancel = document.getElementById('btn-recording-policy-cancel');
    this.trainingRecordSelect = document.getElementById('training-record-select');
    this.playbackControls = document.getElementById('playback-controls');
    this.audioPlayer = document.getElementById('recording-player');
    this.playbackModel = document.getElementById('playback-model');
    this.btnReanalyze = document.getElementById('btn-reanalyze');
    this.statFillers = document.getElementById('stat-fillers');
    this.statHedges = document.getElementById('stat-hedges');
    this.statVague = document.getElementById('stat-vague');
    this.statDensity = document.getElementById('stat-density');
  }

  bindEvents() {
    this.btnStart.addEventListener('click', () => this.startRecording());
    this.btnPaste.addEventListener('click', () => this.openPasteModal());
    this.btnPause.addEventListener('click', () => this.pauseRecording());
    this.btnResume.addEventListener('click', () => this.resumeRecording());
    this.btnStop.addEventListener('click', () => this.stopRecording());
    this.btnReport.addEventListener('click', () => this.generateReport());
    this.btnSettings.addEventListener('click', () => window.api.openSettings());
    this.userMessageAction.addEventListener('click', () => window.api.openSettings());
    this.userMessageClose.addEventListener('click', () => this.hideUserMessage());
    window.api.onLlmProviderSettingsChanged?.(() => this.handleLlmProviderSettingsChanged());
    this.btnHelp.addEventListener('click', () => this.openHelpModal());
    this.btnDiagnostics.addEventListener('click', () => this.exportDiagnostics());
    this.btnCloseHelp.addEventListener('click', () => this.closeModal(this.helpModal));
    this.btnHelpDiagnostics.addEventListener('click', () => this.exportDiagnostics(this.btnHelpDiagnostics));
    this.btnOpenFeedbackDocument.addEventListener('click', () => this.openFeedbackDocument());
    document.getElementById('btn-prompt-editor').addEventListener('click', () => window.api.openPromptEditor());
    this.btnCloseReport.addEventListener('click', () => this.closeModal(this.reportModal));
    this.btnCopyReport.addEventListener('click', () => {
      const reportText = this.reportBody.innerText;
      navigator.clipboard.writeText(reportText).then(() => {
        this.btnCopyReport.textContent = '✅ 已复制';
        setTimeout(() => { this.btnCopyReport.textContent = '📋 复制全文'; }, 2000);
      }).catch(() => this.showUserMessage('复制报告失败，请重试'));
    });
    this.btnClosePaste.addEventListener('click', () => this.closeModal(this.pasteModal));
    this.btnAnalyzePaste.addEventListener('click', () => this.analyzePastedText());
    this.btnCopyText.addEventListener('click', () => this.copyOriginalText());
    this.btnSaveText.addEventListener('click', () => this.saveOriginalText());
    this.btnClear.addEventListener('click', () => this.clearAll());
    this.btnRecordingPolicyConfirm.addEventListener('click', () => this.resolveRecordingPolicyDecision(true));
    this.btnRecordingPolicyCancel.addEventListener('click', () => this.resolveRecordingPolicyDecision(false));
    this.trainingRecordSelect.addEventListener('change', event => this.selectTrainingRecord(event.target.value));
    this.audioPlayer.addEventListener('timeupdate', () => this.handlePlaybackTimeUpdate());
    this.playbackModel.addEventListener('change', event => { void this.selectPlaybackProfile(event.target.value); });
    this.btnReanalyze.addEventListener('click', () => { void this.analyzeSelectedRecording(); });
    window.addEventListener?.('beforeunload', () => this.disposeTrainingRecords());
    document.addEventListener('keydown', event => this.handleModalKeydown(event));
    document.addEventListener('keydown', event => this.handleGlobalKeydown(event));
  }

  async exportDiagnostics(triggerButton = this.btnDiagnostics) {
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

  openHelpModal() {
    this.feedbackLinkError.textContent = '';
    this.openModal(this.helpModal, this.btnCloseHelp);
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

  async ensureRecordingPolicyAcknowledged() {
    if (this.recordingPolicyAcknowledged) return true;
    if (typeof window.api.getRecordingPolicy !== 'function') {
      throw new Error('录音保留策略不可用');
    }
    const policy = await window.api.getRecordingPolicy();
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
    if (this.asrStartAttempt) {
      this.showUserMessage('录制正在启动，请稍候');
      return;
    }
    if (this.pasteAnalysisPending) {
      this.showUserMessage('逐字稿正在分析，请稍候');
      return;
    }
    this.playbackAnalysisGeneration += 1;
    this.btnReanalyze.disabled = false;
    this.trainingStatus.textContent = '正在准备语音识别，首次运行可能需要数分钟';
    this.btnStart.disabled = true;
    this.btnPaste.disabled = true;
    const startAttempt = {};
    this.asrStartAttempt = startAttempt;
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
        this.showError(`麦克风访问失败: ${err.message}`);
        this.asrStartAttempt = null;
        this.finishTrainingPreparation();
      }
      return;
    }

    this.asrStartAttempt = null;

    this.isRecording = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.fullText = '';
    this.sentences = [];
    this.viewingTrainingRecordId = null;
    this.trainingRecordSelect?.classList.add('hidden');
    this.refreshPlaybackControls();
    this.lastFeedbackText = '';
    this.resetStats();
    this.subtitleContainer.replaceChildren();

    // UI
    this.btnStart.classList.add('hidden');
    this.btnPause.classList.remove('hidden');
    this.btnStop.classList.remove('hidden');
    this.btnReport.classList.add('hidden');
    this.btnCopyText.classList.add('hidden');
    this.btnSaveText.classList.add('hidden');
    this.btnClear.classList.add('hidden');
    this.btnResume.classList.add('hidden');
    this.timer.classList.add('active');
    this.trainingStatus.textContent = '正在录音';
    this.btnPaste.disabled = true;

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
    this.btnStart.disabled = false;
    this.btnPaste.disabled = false;
    this.btnReport.classList.add('hidden');
    this.btnCopyText.classList.add('hidden');
    this.btnSaveText.classList.add('hidden');
    this.btnClear.classList.add('hidden');
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
        maxRecords: 5,
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
    this.recordingCreatedAt = new Date().toISOString();
    this.recordingPcm = createPcmWavRecorder({ sampleRateHz: 16000, maxFrames: 19_200_000 });
    this.pendingSegments = [];
    this.limitStopPromise = null;
    return this.recordingPcm;
  }

  discardRecordingBuffer(expectedSessionId) {
    if (expectedSessionId && this.recordingSessionId !== expectedSessionId) return false;
    this.recordingPcm?.clear?.();
    this.recordingPcm = null;
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
    const result = this.recordingPcm.append(chunk.samples);
    const acceptedSamples = result.acceptedFrames === chunk.samples.length
      ? chunk.samples
      : chunk.samples.slice(0, result.acceptedFrames);
    return {
      acceptedSamples,
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
        audioEndMs: appended.audioEndMs
      });
    }
    if (appended.limitReached && !this.limitStopPromise) {
      const limitSessionId = sessionId;
      this.trainingStatus.textContent = '已达到20分钟上限，正在结束录音…';
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
      send: async ({ sequence, samples, audioEndMs }) => {
        const response = await window.api.feedAudio({ sessionId, sequence, samples });
        if (!response || response.ok !== true) {
          const error = new Error(response?.error?.message || 'ASR feed failed');
          error.code = response?.error?.code || 'asr-feed-failed';
          throw error;
        }
        await this.processASRResponse(
          response,
          '语音识别处理失败',
          '语音识别结果处理失败',
          () => this.asrEventState.activeSessionId === sessionId,
          audioEndMs
        );
      },
      onFailure: () => {
        this.lastAudioFeedMetrics = queue.snapshot();
        return this.failActiveRecording(sessionId);
      }
    });
    return { sessionId, queue };
  }

  failActiveRecording(sessionId) {
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
    this.discardRecordingBuffer(sessionId);
    this.teardownRecordingCapture();
    this.trainingStatus.textContent = '语音识别处理失败，录音已停止，请重新开始';
    const retainedRecord = this.trainingRecords?.selected();
    if (retainedRecord) this.selectTrainingRecord(retainedRecord.id);
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
    this.trainingStatus.textContent = '正在结束并整理尾部文字…';
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
      this.btnStop.disabled = false;
      this.btnPause.disabled = false;
      this.btnResume.disabled = false;
      this.btnStart.disabled = false;
      this.btnPaste.disabled = false;
    }
  }

  async finishOwnedAsrStopAndUi(sessionId) {
    const durationMs = this.recordingSessionId === sessionId && this.recordingPcm
      ? this.recordingPcm.durationMs
      : 0;
    let tailSucceeded = false;
    let tailErrorMessage = null;
    try {
      if (sessionId) {
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
        let totalPaused = this.pausedTime;
        if (this.pauseStart) totalPaused += Date.now() - this.pauseStart;
        this.stats.duration = durationMs > 0
          ? Math.floor(durationMs / 1000)
          : Math.floor((Date.now() - this.startTime - totalPaused) / 1000);
        if (tailSucceeded && this.recordingSessionId === sessionId) {
          this.finalizeTrainingRecord();
        } else if (this.recordingSessionId === sessionId) {
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
          this.btnCopyText.classList.remove('hidden');
          this.btnSaveText.classList.remove('hidden');
          this.btnClear.classList.remove('hidden');
        }
      }
    }
    return tailSucceeded;
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
      const filtered = filterAsrEvent(this.asrEventState, event);
      this.asrEventState = filtered.state;
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
        const endMs = Math.max(previousEndMs, Math.min(atMs, this.recordingPcm.durationMs));
        segment = {
          id: `segment-${this.pendingSegments.length + 1}`,
          text,
          startMs: previousEndMs,
          endMs,
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

      // 每30字触发一次AI反馈（语境化精准词建议）
      if (this.fullText.length - this.lastFeedbackText.length >= 30) {
        this.requestRealtimeFeedback();
      }
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
    if (this.stats.totalWords > 0) {
      const density = ((this.stats.totalWords - this.stats.fillers - this.stats.hedges) / this.stats.totalWords * 100).toFixed(0);
      this.statDensity.textContent = density + '%';
    }
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
    if (result.success && result.feedback) {
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

  async generateReport() {
    if (this.pasteAnalysisPending) {
      this.showUserMessage('逐字稿统计尚未完成，请稍候');
      return;
    }
    if (this.reportRequestPending) {
      this.showUserMessage('报告正在生成，请稍候');
      return;
    }
    if (!this.fullText.trim()) {
      this.showUserMessage('暂无可生成报告的训练内容');
      return;
    }
    this.reportRequestPending = true;
    this.btnReport.disabled = true;
    const generation = this.llmGeneration;
    const loading = document.createElement('p');
    loading.style.textAlign = 'center';
    loading.style.color = '#666';
    loading.style.padding = '40px';
    loading.textContent = '正在生成报告...';
    this.reportBody.replaceChildren(loading);
    this.openModal(this.reportModal, this.btnCloseReport);

    try {
      let result;
      try {
        result = await window.api.getFinalReport({
          fullText: this.fullText,
          stats: this.stats
        });
      } catch {
        result = { success: false, error: '报告请求失败，请重试', errorCode: 'generic' };
      }

      if (generation !== this.llmGeneration) return;
      if (result.success) {
        this.lastReport = result.report;
        this.renderReport(result.report);
      } else if (result.errorCode !== 'cancelled') {
        const message = `生成报告失败：${result.error || '未知错误'}`;
        const error = document.createElement('p');
        error.style.color = '#ff6b6b';
        error.textContent = message;
        const retryButton = document.createElement('button');
        retryButton.className = 'btn-report-retry';
        retryButton.textContent = '重试生成';
        retryButton.addEventListener('click', () => this.generateReport());
        this.reportBody.replaceChildren(error, retryButton);
        this.showUserMessage(message, {
          openSettings: CONFIG_ERROR_CODES.has(result.errorCode)
        });
      }
    } finally {
      this.reportRequestPending = false;
      this.btnReport.disabled = this.pasteAnalysisPending;
    }
  }

  renderReport(report) {
    const actions = document.createElement('div');
    actions.style.textAlign = 'right';
    actions.style.marginBottom = '12px';

    const saveButton = document.createElement('button');
    saveButton.id = 'btn-save-report';
    saveButton.style.background = '#E5007E';
    saveButton.style.color = '#fff';
    saveButton.style.border = 'none';
    saveButton.style.borderRadius = '6px';
    saveButton.style.padding = '8px 14px';
    saveButton.style.fontSize = '12px';
    saveButton.style.cursor = 'pointer';
    saveButton.textContent = '💾 保存为 Markdown';
    saveButton.addEventListener('click', () => this.saveReport());
    actions.appendChild(saveButton);

    const reportContent = document.createElement('div');
    reportContent.className = 'report-content';
    renderReportContent(reportContent, report);
    this.reportBody.replaceChildren(actions, reportContent);
  }

  async saveReport() {
    if (!this.lastReport) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练报告\n\n**日期**: ${dateStr}  \n**时长**: ${this.stats.duration}秒  \n**总字数**: ${this.stats.totalWords}  \n\n---\n\n## 完整原文\n\n${this.fullText}\n\n---\n\n${this.lastReport}`;
    const filename = `表达训练-${dateStr}-${timeStr}.md`;

    try {
      const result = await window.api.saveFile(markdown, filename);
      if (result.success) {
        const btn = document.getElementById('btn-save-report');
        btn.textContent = '✓ 已保存';
        btn.style.background = '#333';
        setTimeout(() => { btn.textContent = '💾 保存为 Markdown'; btn.style.background = '#E5007E'; }, 2000);
      } else {
        this.showUserMessage(`未保存报告：${result.error || '保存操作未完成'}`);
      }
    } catch (e) {
      this.showUserMessage(`保存报告失败：${e.message || '请重试'}`);
    }
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
    this.stats = { fillers: 0, hedges: 0, vagueWords: 0, totalWords: 0, duration: 0 };
    this.updateStatsDisplay();
    this.feedbackContent.replaceChildren();
    this.feedbackStatus.textContent = '本地分析可用；AI 建议约每新增 30 字生成';
  }

  advanceLLMGeneration() {
    this.llmGeneration = (this.llmGeneration ?? 0) + 1;
    return this.llmGeneration;
  }

  showError(msg) {
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
      this.feedbackStatus.textContent = '本地分析可用；AI 建议将在后续表达中生成';
    }
    return summary;
  }

  setPasteAnalysisPending(pending) {
    this.pasteAnalysisPending = pending;
    this.btnAnalyzePaste.disabled = pending;
    this.btnAnalyzePaste.textContent = pending ? '分析中...' : '开始分析';
    this.btnReport.disabled = pending || this.reportRequestPending;
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
    this.trainingStatus.textContent = '准备就绪';
    this.btnStart.disabled = false;
    this.btnPaste.disabled = false;
  }

  finalizeTrainingRecord() {
    const recorder = this.recordingPcm;
    if (!recorder) return null;
    const durationMs = recorder.durationMs;
    const segments = this.pendingSegments;
    const finalSegment = segments.at(-1);
    if (finalSegment) finalSegment.endMs = Math.max(finalSegment.endMs, durationMs);
    let audioUrl = null;
    let record;
    try {
      const blob = recorder.finish(window.Blob || globalThis.Blob);
      audioUrl = this.getObjectUrlApi().createObjectURL(blob);
      record = {
        id: `record-${this.recordingSessionId}`,
        createdAt: this.recordingCreatedAt || new Date().toISOString(),
        durationMs,
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
      void this.analyzeSelectedRecording({automatic: true});
    } catch (error) {
      this.showUserMessage(`训练记录显示失败：${error.message}`);
    }
    return record;
  }

  refreshTrainingRecordSelect() {
    if (!this.trainingRecordSelect) return;
    const records = this.getTrainingRecordStore().list();
    const options = records.map(record => {
      const option = document.createElement('option');
      option.value = record.id;
      option.textContent = formatRecordLabel(record);
      return option;
    });
    this.trainingRecordSelect.replaceChildren(...options);
    this.trainingRecordSelect.value = this.viewingTrainingRecordId || '';
    this.trainingRecordSelect.classList.toggle('hidden', records.length === 0 || !this.viewingTrainingRecordId);
  }

  selectTrainingRecord(recordId) {
    const record = this.getTrainingRecordStore().select(recordId);
    if (!record) return null;
    if (this.viewingTrainingRecordId !== record.id) {
      this.playbackAnalysisGeneration += 1;
      this.btnReanalyze.disabled = false;
    }
    this.viewingTrainingRecordId = record.id;
    this.refreshPlaybackControls();
    return record;
  }

  refreshPlaybackControls() {
    const record = this.trainingRecords?.selected() ?? null;
    if (!record || record.id !== this.viewingTrainingRecordId) {
      this.playbackSegmentId = null;
      this.playbackControls?.classList.add('hidden');
      if (this.audioPlayer) this.audioPlayer.src = '';
      return null;
    }

    this.playbackControls?.classList.remove('hidden');
    if (this.audioPlayer && this.audioPlayer.src !== record.audioUrl) {
      this.audioPlayer.src = record.audioUrl;
    }
    this.fullText = record.fullText;
    this.sentences = record.segments.map(segment => segment.text);
    this.stats = { ...record.stats };
    this.lastFeedbackText = '';
    this.subtitleContainer.replaceChildren();
    for (const segment of record.segments) {
      const line = document.createElement('div');
      line.className = 'subtitle-line';
      line.dataset.segmentId = segment.id;
      renderHighlightedText(line, segment.text);
      this.subtitleContainer.appendChild(line);
    }
    this.updateStatsDisplay();
    const totalSeconds = Math.max(0, Math.floor(record.durationMs / 1000));
    this.timer.textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
    this.btnReport.classList.toggle('hidden', !record.fullText.trim());
    this.btnCopyText.classList.toggle('hidden', !record.fullText.trim());
    this.btnSaveText.classList.toggle('hidden', !record.fullText.trim());
    this.btnClear.classList.remove('hidden');
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

  async analyzeSelectedRecording({automatic = false} = {}) {
    const record = this.trainingRecords?.selected() ?? null;
    const viewingRecordId = this.viewingTrainingRecordId;
    if (!record || record.id !== viewingRecordId) return false;
    const generation = ++this.playbackAnalysisGeneration;
    const recordId = record.id;
    const ownsAnalysis = () => generation === this.playbackAnalysisGeneration
      && this.trainingRecords?.selected()?.id === recordId
      && this.viewingTrainingRecordId === viewingRecordId;
    this.btnReanalyze.disabled = true;
    this.feedbackStatus.textContent = automatic ? '正在生成首次回放分析…' : '正在重新分析录音…';
    try {
      let pendingProfileRefresh = this.playbackProfileRefreshPromise
        || (!this.playbackProfileSummary?.activeProfileId ? this.refreshLlmProfileOptions() : null);
      while (pendingProfileRefresh) {
        await pendingProfileRefresh;
        if (!ownsAnalysis()) return false;
        const currentProfileRefresh = this.playbackProfileRefreshPromise;
        if (!currentProfileRefresh || currentProfileRefresh === pendingProfileRefresh) break;
        pendingProfileRefresh = currentProfileRefresh;
      }
      const profileId = this.playbackProfileSummary?.activeProfileId;
      if (!profileId) {
        if (ownsAnalysis()) this.feedbackStatus.textContent = '没有可用的分析模型';
        return false;
      }
      const segments = record.segments.map(({id, text, startMs, endMs}) => ({id, text, startMs, endMs}));
      let response;
      try {
        response = await window.api.analyzePlayback({profileId, segments});
      } catch (error) {
        response = {success: false, error: error?.message || '回放分析失败，请重试'};
      }
      if (!ownsAnalysis()) return false;
      if (!response?.success) {
        this.feedbackStatus.textContent = response?.error || '回放分析失败，请重试';
        return false;
      }
      const updated = this.trainingRecords.replace(recordId, current => ({
        ...current,
        playbackAnalysis: response.analysis
      }));
      if (updated) this.renderPlaybackAnalysis(updated, this.playbackSegmentId);
      return Boolean(updated);
    } finally {
      if (ownsAnalysis()) this.btnReanalyze.disabled = false;
    }
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

  removeSelectedTrainingRecord() {
    const recordId = this.viewingTrainingRecordId;
    if (!recordId) return null;
    const removed = this.getTrainingRecordStore().remove(recordId);
    if (!removed) return null;
    this.playbackAnalysisGeneration += 1;
    this.advanceLLMGeneration();
    try {
      const cancellation = window.api.cancelLLMRequests();
      cancellation?.catch?.(() => {});
    } catch {}
    const next = this.getTrainingRecordStore().selected();
    if (next) {
      this.selectTrainingRecord(next.id);
    } else {
      this.viewingTrainingRecordId = null;
      this.fullText = '';
      this.sentences = [];
      this.lastFeedbackText = '';
      this.lastReport = '';
      const hint = document.createElement('div');
      hint.className = 'subtitle-line hint';
      hint.textContent = '点击下方按钮开始说话';
      this.subtitleContainer.replaceChildren(hint);
      this.resetStats();
      this.timer.textContent = '00:00';
      this.btnReport.classList.add('hidden');
      this.btnCopyText.classList.add('hidden');
      this.btnSaveText.classList.add('hidden');
      this.btnClear.classList.add('hidden');
      this.refreshTrainingRecordSelect();
      this.refreshPlaybackControls();
    }
    return removed;
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

  // ===== 复制 & 保存原文 & 清空 =====

  async copyOriginalText() {
    if (!this.fullText.trim()) return;
    try {
      await navigator.clipboard.writeText(this.fullText);
      this.btnCopyText.textContent = '✓ 已复制';
      setTimeout(() => { this.btnCopyText.textContent = '📋 复制'; }, 1500);
    } catch {
      this.showUserMessage('复制失败，请重试');
    }
  }

  async saveOriginalText() {
    if (!this.fullText.trim()) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '');
    const markdown = `# 表达训练原文\n\n**日期**: ${dateStr}\n\n---\n\n${this.fullText}`;
    const filename = `原文-${dateStr}-${timeStr}.md`;

    try {
      const result = await window.api.saveFile(markdown, filename);
      if (result.success) {
        this.btnSaveText.textContent = '✓ 已保存';
        setTimeout(() => { this.btnSaveText.textContent = '💾 保存'; }, 2000);
      } else {
        this.showUserMessage(`未保存原文：${result.error || '保存操作未完成'}`);
      }
    } catch (e) {
      this.showUserMessage(`保存原文失败：${e.message || '请重试'}`);
    }
  }

  clearAll() {
    const sessionId = this.asrEventState.activeSessionId;
    if (!this.isRecording && !this.asrStartAttempt && !sessionId && this.viewingTrainingRecordId) {
      this.removeSelectedTrainingRecord();
      return true;
    }
    const isIdleContent = !this.isRecording && !this.asrStartAttempt && !sessionId && this.fullText.trim();
    if (isIdleContent && !window.confirm('清空后当前内容将无法恢复，是否继续？')) return false;
    this.pasteAnalysisGeneration = (this.pasteAnalysisGeneration ?? 0) + 1;
    this.setPasteAnalysisPending(false);
    this.asrStartAttempt = null;
    this.finishTrainingPreparation();
    this.asrGeneration = (this.asrGeneration ?? 0) + 1;
    this.audioFeedTracker?.queue.cancel();
    this.audioFeedTracker = null;
    this.discardRecordingBuffer(sessionId);
    if (sessionId) {
      this.asrEventState = invalidateAsrSession(this.asrEventState);
    }
    this.teardownRecordingCapture();
    this.advanceLLMGeneration();
    if (sessionId) {
      void this.cancelActiveAsrSession(sessionId, () => false);
    }
    try {
      const cancellation = window.api.cancelLLMRequests();
      if (cancellation?.catch) cancellation.catch(() => {});
    } catch {}
    this.fullText = '';
    this.sentences = [];
    this.lastFeedbackText = '';
    this.lastReport = '';
    const hint = document.createElement('div');
    hint.className = 'subtitle-line hint';
    hint.textContent = '点击下方按钮开始说话';
    this.subtitleContainer.replaceChildren(hint);
    this.feedbackContent.replaceChildren();
    this.resetStats();
    this.timer.textContent = '00:00';
    this.timer.classList.remove('active');
    this.btnReport.classList.add('hidden');
    this.btnCopyText.classList.add('hidden');
    this.btnSaveText.classList.add('hidden');
    this.btnClear.classList.add('hidden');
    this.reportModal.classList.add('hidden');
    this.btnReport.disabled = false;
    return true;
  }

  // ===== 粘贴逐字稿分析 =====

  openPasteModal() {
    if (this.pasteAnalysisPending) {
      this.showUserMessage('逐字稿正在分析，请稍候');
      return;
    }
    if (this.isRecording || this.asrStartAttempt) {
      this.showUserMessage('请先结束当前录制，再导入逐字稿');
      return;
    }
    this.openModal(this.pasteModal, this.pasteTextarea);
  }

  async analyzePastedText() {
    if (this.pasteAnalysisPending) {
      this.showUserMessage('逐字稿正在分析，请稍候');
      return;
    }
    const text = this.pasteTextarea.value.trim();
    if (!text) {
      this.showUserMessage('请先粘贴需要分析的逐字稿');
      return;
    }
    if (this.isRecording || this.asrStartAttempt) {
      this.showUserMessage('请先结束当前录制，再导入逐字稿');
      return;
    }
    if (!this.viewingTrainingRecordId
        && this.fullText.trim()
        && text !== this.fullText.trim()
        && !window.confirm('分析新逐字稿将替换当前内容，是否继续？')) {
      return;
    }

    const generation = (this.pasteAnalysisGeneration ?? 0) + 1;
    this.pasteAnalysisGeneration = generation;
    this.setPasteAnalysisPending(true);
    const ownsAnalysis = () => this.pasteAnalysisGeneration === generation;

    try {
      this.advanceLLMGeneration();
      try {
        await window.api.cancelLLMRequests();
      } catch {
        if (ownsAnalysis()) this.showUserMessage('无法开始逐字稿分析，请重试');
        return;
      }
      if (!ownsAnalysis()) return;

      // 关闭粘贴弹窗
      this.closeModal(this.pasteModal);
      this.pasteTextarea.value = '';
      this.viewingTrainingRecordId = null;
      this.trainingRecordSelect?.classList.add('hidden');
      this.playbackAnalysisGeneration += 1;
      this.btnReanalyze.disabled = false;
      this.refreshPlaybackControls();

      // 把文本显示到字幕区（高亮标记）
      this.subtitleContainer.replaceChildren();
      this.fullText = text;
      this.lastFeedbackText = '';
      this.resetStats();

      // 按句号/问号/感叹号/换行分句
      const sentences = text.split(/(?<=[。！？\n])/g).filter(s => s.trim());
      this.sentences = sentences;

      for (const sentence of sentences) {
        const line = document.createElement('div');
        line.className = 'subtitle-line';
        renderHighlightedText(line, sentence.trim());
        this.subtitleContainer.appendChild(line);

        // 词库分析
        const analysis = await window.api.analyzeText(sentence);
        if (!ownsAnalysis()) return;
        if (analysis) {
          this.stats.fillers += analysis.fillers.length;
          this.stats.hedges += analysis.hedges.length;
          this.stats.vagueWords += analysis.vagueWords.length;
          this.stats.totalWords += analysis.totalWords;
        }
      }

      this.stats.duration = 0; // 粘贴模式没有时长
      this.updateStatsDisplay();

      // 显示操作按钮
      this.btnReport.classList.remove('hidden');
      this.btnCopyText.classList.remove('hidden');
      this.btnSaveText.classList.remove('hidden');
      this.btnClear.classList.remove('hidden');

      // 请求AI语境化反馈
      this.requestRealtimeFeedback();
    } finally {
      if (ownsAnalysis()) this.setPasteAnalysisPending(false);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mergeFinalText, ExpressionTrainer };
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => { new ExpressionTrainer(); });
}
