const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { RESULT_MARKER, parseProbeOutput } = require('./probe-result');

const PROCESS_TIMEOUT_MS = 60_000;

function stopProcessTree(child, {
  platform = process.platform,
  spawnSyncProcess = spawnSync
} = {}) {
  if (!child || !child.pid || child.exitCode !== null) return;

  if (platform === 'win32') {
    const result = spawnSyncProcess('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
    if (result.status !== 0 && typeof child.kill === 'function') child.kill('SIGKILL');
  } else if (typeof child.kill === 'function') {
    child.kill('SIGKILL');
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

function runProbe({
  electronExecutable = require('electron'),
  spawnProcess = spawn,
  timeoutMs = PROCESS_TIMEOUT_MS
} = {}) {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const child = spawnProcess(electronExecutable, [path.join(__dirname, 'probe-main.js')], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      stopProcessTree(child);
      finish(() => reject(new Error(`Audio baseline probe timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    child.once('error', error => {
      finish(() => reject(error));
    });
    child.once('close', (code, signal) => {
      const details = diagnostics(stdout, stderr, code, signal);
      finish(() => {
        if (code !== 0) {
          reject(new Error(`Audio baseline probe exited unsuccessfully\n${details}`));
          return;
        }
        try {
          resolve(parseProbeOutput(stdout));
        } catch (error) {
          reject(new Error(`Audio baseline probe emitted invalid evidence: ${error.message}\n${details}`));
        }
      });
    });
  }).finally(() => stopProcessTree(child));
}

if (require.main === module) {
  runProbe()
    .then(result => {
      console.log(`${RESULT_MARKER} ${JSON.stringify(result)}`);
    })
    .catch(error => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}

module.exports = { PROCESS_TIMEOUT_MS, runProbe, stopProcessTree };
