// 宇宙无敌表达训练系统 V2

function mergeFinalText(fullText, finalText) {
  const currentText = typeof fullText === 'string' ? fullText : '';
  const candidateText = typeof finalText === 'string' ? finalText.trim() : '';

  if (!candidateText || currentText.endsWith(candidateText)) {
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

class ExpressionTrainer {
  constructor({ audioCaptureFactory = createAudioCapture } = {}) {
    this.audioCaptureFactory = audioCaptureFactory;
    this.audioCapture = null;
    this.audioCaptureStopPromise = null;
    this.audioFeedTracker = null;
    this.recordingStopOperation = null;
    this.lastAudioCaptureRates = null;
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
    this.llmGeneration = 0;
    this.asrEventState = createAsrEventState();
    this.asrStartAttempt = null;
    this.asrGeneration = 0;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.btnStart = document.getElementById('btn-start');
    this.btnPaste = document.getElementById('btn-paste');
    this.btnPause = document.getElementById('btn-pause');
    this.btnResume = document.getElementById('btn-resume');
    this.btnStop = document.getElementById('btn-stop');
    this.btnReport = document.getElementById('btn-report');
    this.btnSettings = document.getElementById('btn-settings');
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
    document.getElementById('btn-prompt-editor').addEventListener('click', () => window.api.openPromptEditor());
    this.btnCloseReport.addEventListener('click', () => this.reportModal.classList.add('hidden'));
    this.btnCopyReport.addEventListener('click', () => {
      const reportText = this.reportBody.innerText;
      navigator.clipboard.writeText(reportText).then(() => {
        this.btnCopyReport.textContent = '✅ 已复制';
        setTimeout(() => { this.btnCopyReport.textContent = '📋 复制全文'; }, 2000);
      });
    });
    this.btnClosePaste.addEventListener('click', () => this.pasteModal.classList.add('hidden'));
    this.btnAnalyzePaste.addEventListener('click', () => this.analyzePastedText());
    this.btnCopyText.addEventListener('click', () => this.copyOriginalText());
    this.btnSaveText.addEventListener('click', () => this.saveOriginalText());
    this.btnClear.addEventListener('click', () => this.clearAll());
  }

  // ===== 录制控制 =====

  async startRecording() {
    const startAttempt = {};
    this.asrStartAttempt = startAttempt;
    this.asrGeneration = (this.asrGeneration ?? 0) + 1;
    const replacedSessionId = this.asrEventState.activeSessionId;
    if (replacedSessionId) {
      this.audioFeedTracker = null;
      void this.releaseAudioCapture({ flush: false }).catch(() => {});
      this.cancelActiveAsrSession(replacedSessionId, () => false);
    }
    this.advanceLLMGeneration();
    await window.api.cancelLLMRequests();
    if (this.asrStartAttempt !== startAttempt) return;

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
      } else if (startResponse?.ok) {
        await this.cancelActiveAsrSession(sessionId, () => false);
      }
      return;
    }

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
      this.audioFeedTracker = { sessionId, pending: new Set() };
    } catch (err) {
      if (ownsSession()
          && err?.code === 'unsupported-audio-context-rate'
          && err.audioRates) {
        this.lastAudioCaptureRates = err.audioRates;
      }
      this.audioFeedTracker = null;
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

    this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    this.audioCapture.setEnabled(true);
  }

  pauseRecording() {
    if (this.recordingStopOperation?.sessionId === this.asrEventState.activeSessionId) return;
    this.isPaused = true;
    this.audioCapture?.setEnabled(false);
    this.pauseStart = Date.now();
    this.btnPause.classList.add('hidden');
    this.btnResume.classList.remove('hidden');
    this.timer.classList.remove('active');
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

  handleCapturedChunk(chunk) {
    const { sessionId, sequence, samples } = chunk;
    const tracker = this.audioFeedTracker;
    const stoppingOwned = this.recordingStopOperation?.sessionId === sessionId
      && this.recordingStopOperation.feedTracker === tracker;
    if (!this.isRecording
        || (this.isPaused && !stoppingOwned)
        || this.asrEventState.activeSessionId !== sessionId) return Promise.resolve();
    if (!tracker || tracker.sessionId !== sessionId) return Promise.resolve();

    let operation;
    operation = (async () => {
      try {
        const response = await window.api.feedAudio({ sessionId, sequence, samples });
        if (!response || response.ok !== true) {
          await this.failActiveRecording(sessionId);
          return;
        }
        await this.processASRResponse(
          response,
          '语音识别处理失败',
          '语音识别结果处理失败',
          () => this.asrEventState.activeSessionId === sessionId
        );
      } catch {
        await this.failActiveRecording(sessionId);
      } finally {
        tracker.pending.delete(operation);
      }
    })();
    tracker.pending.add(operation);
    return operation;
  }

  failActiveRecording(sessionId) {
    if (this.asrEventState.activeSessionId !== sessionId) return Promise.resolve(false);

    this.asrStartAttempt = null;
    this.asrGeneration = (this.asrGeneration ?? 0) + 1;
    this.asrEventState = invalidateAsrSession(this.asrEventState);
    this.advanceLLMGeneration();
    this.audioFeedTracker = null;
    this.teardownRecordingCapture();
    this.showError('语音识别处理失败，录音已停止，请重新开始');
    return this.cancelActiveAsrSession(sessionId, () => false).then(() => true);
  }

  stopRecording() {
    const activeSessionId = this.asrEventState.activeSessionId;
    if (this.recordingStopOperation?.sessionId === activeSessionId) {
      return this.recordingStopOperation.promise;
    }
    const operation = {
      sessionId: activeSessionId,
      feedTracker: this.audioFeedTracker,
      promise: null
    };
    this.recordingStopOperation = operation;
    operation.promise = this.completeRecordingStop(operation);
    return operation.promise;
  }

  async completeRecordingStop(operation) {
    const { sessionId, feedTracker } = operation;
    this.advanceLLMGeneration();
    try {
      await this.releaseAudioCapture({ flush: true });
      if (feedTracker?.sessionId === sessionId) {
        await Promise.all([...feedTracker.pending]);
      }
      if (this.asrEventState.activeSessionId !== sessionId) return;
      this.audioFeedTracker = null;
      await this.finishOwnedAsrStopAndUi(sessionId);
    } catch {
      await this.failActiveRecording(sessionId);
    } finally {
      if (this.recordingStopOperation === operation) {
        this.recordingStopOperation = null;
      }
    }
  }

  async finishOwnedAsrStopAndUi(sessionId) {
    try {
      if (sessionId) {
        const stopResponse = await window.api.stopASR({ sessionId });
        await this.processASRResponse(
          stopResponse,
          '语音识别停止失败',
          '尾部文本分析失败',
          () => this.asrEventState.activeSessionId === sessionId
        );
      }
    } catch (error) {
      if (this.asrEventState.activeSessionId === sessionId) {
        this.showError(`语音识别停止失败: ${error.message}`);
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
        this.stats.duration = Math.floor((Date.now() - this.startTime - totalPaused) / 1000);

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
  }

  // ===== ASR结果处理 =====

  async processASRResponse(
    response,
    commandErrorPrefix,
    resultErrorPrefix = '语音识别结果处理失败',
    canApplySideEffects = () => true
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
    for (const event of events) {
      const filtered = filterAsrEvent(this.asrEventState, event);
      this.asrEventState = filtered.state;
      if (filtered.effect?.type === 'result') {
        const resultGeneration = this.asrGeneration;
        const resultSessionId = event.sessionId;
        try {
          await this.handleASRResult(filtered.effect.result, resultGeneration);
        } catch (error) {
          if (resultGeneration === this.asrGeneration
              && this.asrEventState.activeSessionId === resultSessionId
              && canApplySideEffects()) {
            this.showError(`${resultErrorPrefix}: ${error.message}`);
          }
        }
      } else if (filtered.effect?.type === 'error') {
        if (canApplySideEffects()) {
          this.showError(`语音识别错误: ${filtered.effect.message}`);
        }
      }
    }
    return true;
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

  handleASRResult({ text, isFinal }, resultGeneration = this.asrGeneration) {
    let analysisPromise;
    if (isFinal) {
      const merged = mergeFinalText(this.fullText, text);
      if (!merged.appendedText) return;

      text = merged.appendedText;
      this.fullText = merged.fullText;
      this.sentences.push(text);
      analysisPromise = this.analyzeCurrentSentence(text, resultGeneration);

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
    const result = await window.api.getRealtimeFeedback(this.fullText);
    if (generation !== this.llmGeneration) return;
    if (result.success && result.feedback) {
      const lines = result.feedback.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        const type = this.classifyFeedback(line.trim());
        this.addFeedbackItem(line.trim(), type);
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
    const existing = Array.from(this.feedbackContent.children).slice(0, 3);
    if (existing.some(el => el.textContent === text)) return;

    const item = document.createElement('div');
    item.className = `feedback-item type-${type}`;
    item.textContent = text;
    this.feedbackContent.insertBefore(item, this.feedbackContent.firstChild);
    while (this.feedbackContent.children.length > 12) {
      this.feedbackContent.removeChild(this.feedbackContent.lastChild);
    }
  }

  // ===== 报告 =====

  async generateReport() {
    const generation = this.llmGeneration;
    const loading = document.createElement('p');
    loading.style.textAlign = 'center';
    loading.style.color = '#666';
    loading.style.padding = '40px';
    loading.textContent = '正在生成报告...';
    this.reportBody.replaceChildren(loading);
    this.reportModal.classList.remove('hidden');

    const result = await window.api.getFinalReport({
      fullText: this.fullText,
      stats: this.stats
    });

    if (generation !== this.llmGeneration) return;
    if (result.success) {
      this.lastReport = result.report;
      this.renderReport(result.report);
    } else {
      const error = document.createElement('p');
      error.style.color = '#ff6b6b';
      error.textContent = `生成失败: ${result.error}`;
      this.reportBody.replaceChildren(error);
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
      }
    } catch (e) {
      alert('保存失败: ' + e.message);
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

  // ===== 复制 & 保存原文 & 清空 =====

  copyOriginalText() {
    if (!this.fullText.trim()) return;
    navigator.clipboard.writeText(this.fullText).then(() => {
      this.btnCopyText.textContent = '✓ 已复制';
      setTimeout(() => { this.btnCopyText.textContent = '📋 复制'; }, 1500);
    });
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
      }
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  clearAll() {
    const sessionId = this.asrEventState.activeSessionId;
    this.asrStartAttempt = null;
    this.asrGeneration = (this.asrGeneration ?? 0) + 1;
    this.audioFeedTracker = null;
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
  }

  // ===== 粘贴逐字稿分析 =====

  openPasteModal() {
    this.pasteTextarea.value = '';
    this.pasteModal.classList.remove('hidden');
    this.pasteTextarea.focus();
  }

  async analyzePastedText() {
    const text = this.pasteTextarea.value.trim();
    if (!text) return;

    this.advanceLLMGeneration();
    await window.api.cancelLLMRequests();

    // 关闭粘贴弹窗
    this.pasteModal.classList.add('hidden');

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
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mergeFinalText, ExpressionTrainer };
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => { new ExpressionTrainer(); });
}
