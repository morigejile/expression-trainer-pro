'use strict';

const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {createDefaultCustomPrompt} = require('../lib/custom-prompt-config');
const {createDefaultSettings} = require('../lib/settings-config');

const PROCESS_TIMEOUT_MS = 5 * 60_000;
const HEADLESS_SWITCHES = ['--headless', '--disable-gpu', '--no-sandbox'];
const DATA_TOKEN = 'pkg04-preserve-data';

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
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

async function runProcess(executable, args, {env = process.env, marker, allowFailure = false} = {}) {
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
  }, PROCESS_TIMEOUT_MS);

  try {
    const {code, signal} = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => resolve({code: exitCode, signal: exitSignal}));
    });
    const diagnostics = `code=${code} signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    assert.equal(timedOut, false, `Process timed out\n${diagnostics}`);
    if (!allowFailure) assert.equal(code, 0, `Process failed\n${diagnostics}`);
    if (marker) assert.match(stdout, new RegExp(`^${marker}\\r?$`, 'm'), `Missing ${marker}\n${diagnostics}`);
    return {code, stdout, stderr};
  } finally {
    clearTimeout(timer);
    stopProcessTree(child);
  }
}

function seedUserData(userDataPath) {
  const settings = createDefaultSettings();
  settings.providers.deepseek.model = DATA_TOKEN;
  const customPrompt = createDefaultCustomPrompt();
  customPrompt.customRules = DATA_TOKEN;
  const files = new Map([
    [path.join(userDataPath, 'settings.json'), Buffer.from(JSON.stringify(settings, null, 2))],
    [path.join(userDataPath, 'custom-prompt.json'), Buffer.from(JSON.stringify(customPrompt, null, 2))],
    [path.join(userDataPath, 'models', 'pkg04-preserve.marker'), Buffer.from(DATA_TOKEN)]
  ]);
  for (const [filePath, bytes] of files) {
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    fs.writeFileSync(filePath, bytes, {flag: 'wx'});
  }
  return files;
}

function assertUserDataUnchanged(files) {
  for (const [filePath, expected] of files) {
    assert.deepEqual(fs.readFileSync(filePath), expected, `User data changed: ${filePath}`);
  }
}

function assertCurrentRelease(installRoot, version) {
  const releasesPath = path.join(installRoot, 'packages', 'RELEASES');
  const releases = fs.readFileSync(releasesPath, 'utf8');
  assert.match(releases, new RegExp(`ExpressionTrainer-${version.replaceAll('.', '\\.')}-(?:delta|full)\\.nupkg`));
  return releases.trim();
}

async function main() {
  assert.equal(process.platform, 'win32', 'Upgrade smoke supports the Tier 1 Windows target only');
  const baselineSetup = argumentValue('--baseline-setup');
  assert.ok(baselineSetup && path.isAbsolute(baselineSetup), '--baseline-setup must be an absolute path');
  assert.equal(fs.existsSync(baselineSetup), true, `Baseline Setup is missing: ${baselineSetup}`);

  const localAppData = process.env.LOCALAPPDATA;
  assert.ok(localAppData && path.isAbsolute(localAppData), 'LOCALAPPDATA must be absolute');
  const installRoot = path.join(localAppData, 'ExpressionTrainer');
  assert.equal(fs.existsSync(installRoot), false, `Refusing to replace existing install: ${installRoot}`);
  assert.equal(path.dirname(installRoot), path.resolve(localAppData), 'Install root escaped LOCALAPPDATA');
  const userDataPath = fs.mkdtempSync(path.join(localAppData, 'ExpressionTrainer-PKG04-Data-'));
  const upgradeSetup = findFile(path.resolve('out', 'make'), 'ExpressionTrainerSetup.exe');
  let installStarted = false;
  let uninstalled = false;

  try {
    console.log(`PKG04_BASELINE_INSTALL_START ${baselineSetup}`);
    installStarted = true;
    await runProcess(baselineSetup, ['--silent']);
    assert.equal(fs.existsSync(path.join(installRoot, 'app-1.0.0', 'ExpressionTrainer.exe')), true, 'Baseline executable is missing');
    console.log('PKG04_BASELINE_INSTALL_OK');

    const userDataFiles = seedUserData(userDataPath);
    console.log(`PKG04_UPGRADE_START ${upgradeSetup}`);
    await runProcess(upgradeSetup, ['--silent']);
    const upgradedExecutable = path.join(installRoot, 'app-1.0.1', 'ExpressionTrainer.exe');
    assert.equal(fs.existsSync(upgradedExecutable), true, 'Upgraded executable is missing');
    console.log(`PKG04_UPGRADE_RELEASE ${assertCurrentRelease(installRoot, '1.0.1')}`);

    await runProcess(
      upgradedExecutable,
      [...HEADLESS_SWITCHES, '--smoke-test'],
      {
        env: {...process.env, EXPRESSION_TRAINER_SMOKE_USER_DATA: userDataPath},
        marker: 'ELECTRON_SMOKE_OK'
      }
    );
    assertUserDataUnchanged(userDataFiles);
    console.log('PKG04_UPGRADE_DATA_OK');

    console.log('PKG04_DOWNGRADE_ATTEMPT_START');
    const downgrade = await runProcess(baselineSetup, ['--silent'], {allowFailure: true});
    console.log(`PKG04_DOWNGRADE_ATTEMPT_EXIT ${downgrade.code}`);
    console.log(`PKG04_OLD_FULL_SETUP_DOWNGRADE ${assertCurrentRelease(installRoot, '1.0.0')}`);
    assertUserDataUnchanged(userDataFiles);

    console.log('PKG04_RESTORE_CURRENT_START');
    await runProcess(upgradeSetup, ['--silent']);
    console.log(`PKG04_RESTORE_CURRENT_OK ${assertCurrentRelease(installRoot, '1.0.1')}`);
    assert.equal(fs.existsSync(upgradedExecutable), true, 'Restored current executable is missing');
    assertUserDataUnchanged(userDataFiles);

    const updater = path.join(installRoot, 'Update.exe');
    console.log('PKG04_UNINSTALL_START');
    await runProcess(updater, ['--uninstall', '-s']);
    uninstalled = true;
    for (let attempt = 0; attempt < 20 && fs.existsSync(upgradedExecutable); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(fs.existsSync(upgradedExecutable), false, 'Squirrel uninstall left the product executable');
    assertUserDataUnchanged(userDataFiles);
    console.log('PKG04_UNINSTALL_PRESERVED_USER_DATA');
    console.log('UPGRADE_UNINSTALL_SMOKE_OK');
  } finally {
    let cleanupError = null;
    const updater = path.join(installRoot, 'Update.exe');
    if (installStarted && !uninstalled && fs.existsSync(updater)) {
      try { await runProcess(updater, ['--uninstall', '-s']); } catch (error) { cleanupError = error; }
    }
    try { fs.rmSync(installRoot, {recursive: true, force: true}); } catch (error) { cleanupError ||= error; }
    try { fs.rmSync(userDataPath, {recursive: true, force: true}); } catch (error) { cleanupError ||= error; }
    console.log('PKG04_CLEANUP_OK');
    if (cleanupError) throw cleanupError;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {assertCurrentRelease, assertUserDataUnchanged, seedUserData};
