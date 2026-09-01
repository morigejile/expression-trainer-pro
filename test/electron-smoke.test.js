const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SUCCESS_MARKER = 'ELECTRON_SMOKE_OK';
const PROCESS_TIMEOUT_MS = 30_000;
const HEADLESS_SWITCHES = ['--headless', '--disable-gpu', '--no-sandbox'];

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
    if (result.status !== 0) child.kill('SIGKILL');
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

function diagnostics(stdout, stderr, code, signal) {
  return [
    `exit code: ${code}`,
    `signal: ${signal}`,
    `stdout:\n${stdout || '<empty>'}`,
    `stderr:\n${stderr || '<empty>'}`
  ].join('\n');
}

test('real Electron covers core flows and offline 16/44.1/48 kHz buffer graph adaptation', {
  timeout: PROCESS_TIMEOUT_MS + 15_000
}, async () => {
  const projectRoot = path.resolve(__dirname, '..');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-smoke-'));
  const electronExecutable = require('electron');
  const env = {
    ...process.env,
    EXPRESSION_TRAINER_SMOKE_USER_DATA: userDataPath
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronExecutable, [...HEADLESS_SWITCHES, projectRoot, '--smoke-test'], {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const timeout = setTimeout(() => {
    timedOut = true;
    stopProcessTree(child);
  }, PROCESS_TIMEOUT_MS);

  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => {
        resolve({ code: exitCode, signal: exitSignal });
      });
    });
    const details = diagnostics(stdout, stderr, code, signal);

    assert.equal(timedOut, false, `Electron smoke exceeded ${PROCESS_TIMEOUT_MS}ms\n${details}`);
    assert.equal(code, 0, `Electron smoke exited unsuccessfully\n${details}`);
    assert.match(stdout, new RegExp(`^${SUCCESS_MARKER}\\r?$`, 'm'), `Missing success marker\n${details}`);
  } finally {
    clearTimeout(timeout);
    stopProcessTree(child);
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    }
  }
});
