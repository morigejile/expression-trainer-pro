'use strict';

const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  verifyBundledDefaultArchive,
  verifyInstalledBundledDefault
} = require('./bundled-default-qualification');
const catalog = require('../models/registry.json');

const PROCESS_TIMEOUT_MS = 45 * 60_000;
const HEADLESS_SWITCHES = ['--headless', '--disable-gpu', '--no-sandbox'];

function findPackagedExecutable(root) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift();
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'make') pending.push(candidate);
      if (entry.isFile() && entry.name === 'ExpressionTrainer.exe') return candidate;
    }
  }
  throw new Error(`ExpressionTrainer.exe not found below ${root}`);
}

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true
  });
  if (result.status !== 0) child.kill('SIGKILL');
}

async function runOfflineSmoke(executable, userDataPath) {
  const child = spawn(executable, [...HEADLESS_SWITCHES, '--bundled-default-smoke-test'], {
    env: {...process.env, EXPRESSION_TRAINER_SMOKE_USER_DATA: userDataPath},
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
  }, PROCESS_TIMEOUT_MS);
  try {
    const {code, signal} = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => resolve({code: exitCode, signal: exitSignal}));
    });
    const diagnostics = `code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    assert.equal(timedOut, false, `Bundled-default smoke timed out\n${diagnostics}`);
    assert.equal(code, 0, `Bundled-default smoke failed\n${diagnostics}`);
    assert.match(stdout, /^BUNDLED_DEFAULT_SMOKE_OK\r?$/m, `Missing bundled-default marker\n${diagnostics}`);
  } finally {
    clearTimeout(timer);
    stopProcessTree(child);
  }
}

async function main() {
  assert.equal(process.platform, 'win32', 'Bundled-default smoke supports the Tier 1 Windows target only');
  const packageRoot = path.resolve(process.argv[2] || 'out');
  const executable = findPackagedExecutable(packageRoot);
  const resourcesPath = path.join(path.dirname(executable), 'resources');
  const bundled = await verifyBundledDefaultArchive({resourcesPath, catalog});
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-bundled-default-'));
  try {
    const firstStarted = Date.now();
    await runOfflineSmoke(executable, userDataPath);
    const firstElapsedMs = Date.now() - firstStarted;
    const installed = await verifyInstalledBundledDefault({userDataPath, catalog});

    const secondStarted = Date.now();
    await runOfflineSmoke(executable, userDataPath);
    const secondElapsedMs = Date.now() - secondStarted;
    await verifyInstalledBundledDefault({userDataPath, catalog});

    console.log(JSON.stringify({
      executable,
      archivePath: bundled.archivePath,
      modelPath: installed.modelPath,
      firstElapsedMs,
      secondElapsedMs
    }));
    console.log('BUNDLED_DEFAULT_PACKAGE_SMOKE_OK');
  } finally {
    fs.rmSync(userDataPath, {recursive: true, force: true});
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
