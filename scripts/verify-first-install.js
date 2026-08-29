'use strict';

const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const MODEL_TIMEOUT_MS = 45 * 60_000;
const HEADLESS_SWITCHES = ['--headless', '--disable-gpu', '--no-sandbox'];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findFile(root, filename) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift();
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      if (entry.isFile() && entry.name === filename) return candidate;
    }
  }
  throw new Error(`${filename} not found below ${root}`);
}

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true
  });
  if (result.status !== 0) child.kill('SIGKILL');
}

async function runProcess(executable, args, {env = process.env, marker, timeoutMs}) {
  const child = spawn(executable, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
  const timer = setTimeout(() => {
    timedOut = true;
    stopProcessTree(child);
  }, timeoutMs);

  try {
    const {code, signal} = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => resolve({code: exitCode, signal: exitSignal}));
    });
    const diagnostics = `code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    assert.equal(timedOut, false, `Process timed out\n${diagnostics}`);
    assert.equal(code, 0, `Process failed\n${diagnostics}`);
    if (marker) {
      assert.match(stdout, new RegExp(`^${marker}\\r?$`, 'm'), `Missing ${marker}\n${diagnostics}`);
    }
  } finally {
    clearTimeout(timer);
    stopProcessTree(child);
  }
}

async function main() {
  assert.equal(process.platform, 'win32', 'First-install smoke supports the Tier 1 Windows target only');
  const localAppData = process.env.LOCALAPPDATA;
  assert.ok(localAppData && path.isAbsolute(localAppData), 'LOCALAPPDATA must be absolute');
  const installRoot = path.join(localAppData, 'ExpressionTrainer');
  assert.equal(fs.existsSync(installRoot), false, `Refusing to replace existing install: ${installRoot}`);
  assert.equal(path.dirname(installRoot), path.resolve(localAppData), 'Install root escaped LOCALAPPDATA');
  const modelUserData = fs.mkdtempSync(path.join(localAppData, 'ExpressionTrainer-PKG03-Smoke-'));
  let setupStarted = false;
  try {
    const setup = findFile(path.resolve('out', 'make'), 'ExpressionTrainerSetup.exe');
    console.log(`PKG03_INSTALL_START ${setup}`);
    const installStarted = Date.now();
    setupStarted = true;
    await runProcess(setup, ['--silent'], {timeoutMs: INSTALL_TIMEOUT_MS});
    const executable = path.join(installRoot, 'app-1.0.0', 'ExpressionTrainer.exe');
    assert.equal(fs.existsSync(executable), true, 'Installed version executable is missing');
    assert.equal(fs.existsSync(path.join(installRoot, 'Update.exe')), true, 'Installed Update.exe is missing');
    console.log(`PKG03_INSTALL_OK ${Date.now() - installStarted}ms ${executable}`);

    const baseEnv = {
      ...process.env,
      EXPRESSION_TRAINER_SMOKE_USER_DATA: modelUserData
    };
    console.log(`PKG03_MODEL_ONLINE_START ${modelUserData}`);
    const onlineStarted = Date.now();
    await runProcess(
      executable,
      [...HEADLESS_SWITCHES, '--managed-model-smoke-test'],
      {env: baseEnv, marker: 'MANAGED_MODEL_SMOKE_ONLINE_OK', timeoutMs: MODEL_TIMEOUT_MS}
    );
    console.log(`PKG03_MODEL_ONLINE_OK ${Date.now() - onlineStarted}ms`);

    console.log('PKG03_MODEL_OFFLINE_START');
    const offlineStarted = Date.now();
    await runProcess(
      executable,
      [...HEADLESS_SWITCHES, '--managed-model-smoke-test'],
      {
        env: {...baseEnv, EXPRESSION_TRAINER_MODEL_SMOKE_OFFLINE: '1'},
        marker: 'MANAGED_MODEL_SMOKE_OFFLINE_OK',
        timeoutMs: MODEL_TIMEOUT_MS
      }
    );
    console.log(`PKG03_MODEL_OFFLINE_OK ${Date.now() - offlineStarted}ms`);

    const activePointer = path.join(
      modelUserData,
      'models',
      'active',
      'paraformer-bilingual-zh-en.json'
    );
    assert.equal(fs.existsSync(activePointer), true, 'Managed model active pointer is missing');
    console.log(JSON.stringify({installRoot, executable, modelUserData, activePointer}));
    console.log('FIRST_INSTALL_SMOKE_OK');
  } finally {
    let cleanupError = null;
    const updater = path.join(installRoot, 'Update.exe');
    if (setupStarted && fs.existsSync(updater)) {
      console.log('PKG03_UNINSTALL_START');
      try {
        await runProcess(updater, ['--uninstall', '-s'], {timeoutMs: INSTALL_TIMEOUT_MS});
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      if (fs.existsSync(installRoot)) {
        const installedExecutable = path.join(installRoot, 'app-1.0.0', 'ExpressionTrainer.exe');
        for (let attempt = 0; attempt < 20 && fs.existsSync(installedExecutable); attempt += 1) {
          await delay(250);
        }
        if (!cleanupError) {
          assert.equal(fs.existsSync(installedExecutable), false, 'Squirrel uninstall left the product executable');
        }
        fs.rmSync(installRoot, {recursive: true, force: true});
      }
    } catch (error) {
      cleanupError ||= error;
    }
    try {
      fs.rmSync(modelUserData, {recursive: true, force: true});
    } catch (error) {
      cleanupError ||= error;
    }
    console.log('PKG03_CLEANUP_OK');
    if (cleanupError) throw cleanupError;
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
