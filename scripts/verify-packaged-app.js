'use strict';

const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {assertOrdinaryPackageModelFree} = require('../lib/package-boundary');

const PROCESS_TIMEOUT_MS = 45_000;
const HEADLESS_SWITCHES = ['--headless', '--disable-gpu', '--no-sandbox'];
const NATIVE_FILES = [
  'sherpa-onnx.node',
  'onnxruntime.dll',
  'onnxruntime_providers_shared.dll',
  'sherpa-onnx-c-api.dll',
  'sherpa-onnx-cxx-api.dll'
];

function findPackagedExecutable(root) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift();
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
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

async function runSmoke(executable, args, marker, userDataPath) {
  const child = spawn(executable, args, {
    env: {...process.env, EXPRESSION_TRAINER_SMOKE_USER_DATA: userDataPath},
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
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
    assert.equal(timedOut, false, `Packaged smoke timed out\n${diagnostics}`);
    assert.equal(code, 0, `Packaged smoke failed\n${diagnostics}`);
    assert.match(stdout, new RegExp(`^${marker}\\r?$`, 'm'), `Missing ${marker}\n${diagnostics}`);
  } finally {
    clearTimeout(timer);
    stopProcessTree(child);
  }
}

async function main() {
  assert.equal(process.platform, 'win32', 'Packaged smoke currently supports the Tier 1 Windows target only');
  const packageRoot = path.resolve(process.argv[2] || 'out');
  const executable = findPackagedExecutable(packageRoot);
  const resources = path.join(path.dirname(executable), 'resources');
  assertOrdinaryPackageModelFree(resources);
  const nativeRoot = path.join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'sherpa-onnx-win-x64'
  );
  for (const filename of NATIVE_FILES) {
    assert.equal(fs.existsSync(path.join(nativeRoot, filename)), true, `Missing unpacked ${filename}`);
  }

  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-packaged-smoke-'));
  try {
    await runSmoke(
      executable,
      [...HEADLESS_SWITCHES, '--smoke-test'],
      'ELECTRON_SMOKE_OK',
      userDataPath
    );
    await runSmoke(
      executable,
      [...HEADLESS_SWITCHES, '--native-addon-smoke-test'],
      'SHERPA_NATIVE_SMOKE_OK',
      userDataPath
    );
    assert.equal(
      fs.existsSync(path.join(userDataPath, 'models')),
      false,
      'Packaged smoke must not download or create managed models'
    );
  } finally {
    fs.rmSync(userDataPath, {recursive: true, force: true});
  }

  console.log('PACKAGED_APP_SMOKE_OK');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
