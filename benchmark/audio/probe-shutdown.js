function createProbeShutdownCoordinator({
  sendShutdown,
  closeWindow,
  quit,
  cleanupHandlers,
  setTimer,
  clearTimer,
  acknowledgementTimeoutMs = 1000
}) {
  let timer;
  let requested = false;
  let finished = false;
  let requestedExitCode;

  function finish(exitCode, clearPendingTimer) {
    if (finished) return;
    finished = true;
    if (clearPendingTimer && timer !== undefined) clearTimer(timer);
    cleanupHandlers();
    closeWindow();
    quit(exitCode);
  }

  return {
    request(exitCode) {
      if (requested || finished) return;
      requested = true;
      requestedExitCode = exitCode;
      sendShutdown();
      timer = setTimer(() => finish(requestedExitCode, false), acknowledgementTimeoutMs);
    },
    acknowledge() {
      if (!requested || finished) return;
      finish(requestedExitCode, true);
    },
    isFinished() {
      return finished;
    }
  };
}

module.exports = { createProbeShutdownCoordinator };
