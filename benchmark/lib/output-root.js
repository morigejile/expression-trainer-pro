const fs = require('node:fs/promises');
const path = require('node:path');
const { reserveRunDirectory } = require('./results');

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function canonicalizeWithExistingAncestor(targetPath) {
  const absoluteTarget = path.resolve(targetPath);
  let ancestor = absoluteTarget;
  const suffix = [];
  while (true) {
    try {
      await fs.lstat(ancestor);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error(`Unable to locate an existing ancestor for ${targetPath}`);
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
  return path.resolve(await fs.realpath(ancestor), ...suffix);
}

async function prepareOutputRoot({ datasetRoot, outputRoot }) {
  const canonicalDatasetRoot = await fs.realpath(datasetRoot);
  const prospectiveOutputRoot = await canonicalizeWithExistingAncestor(outputRoot);
  if (isPathInside(canonicalDatasetRoot, prospectiveOutputRoot)) {
    throw new Error('outputRoot must not resolve inside datasetRoot');
  }
  await fs.mkdir(outputRoot, { recursive: true });
  const canonicalOutputRoot = await fs.realpath(outputRoot);
  if (isPathInside(canonicalDatasetRoot, canonicalOutputRoot)) {
    throw new Error('outputRoot must not resolve inside datasetRoot');
  }
  return canonicalOutputRoot;
}

async function reserveSafeRunDirectory({ datasetRoot, outputRoot, runId }) {
  const canonicalDatasetRoot = await fs.realpath(datasetRoot);
  const canonicalOutputRoot = await fs.realpath(outputRoot);
  if (isPathInside(canonicalDatasetRoot, canonicalOutputRoot)) {
    throw new Error('outputRoot must not resolve inside datasetRoot');
  }
  const reservation = await reserveRunDirectory(path.join(canonicalOutputRoot, runId));
  const canonicalRunDir = await fs.realpath(reservation.runDir);
  if (isPathInside(canonicalDatasetRoot, canonicalRunDir) || !isPathInside(canonicalOutputRoot, canonicalRunDir)) {
    throw new Error('reserved run directory escaped canonical outputRoot');
  }
  return { ...reservation, runDir: canonicalRunDir };
}

async function acquireFormalRunLock(outputRoot) {
  const lockPath = path.join(outputRoot, '.benchmark-formal.lock');
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`formal benchmark lock already exists: ${lockPath}; stale locks require explicit operator removal`);
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
  } catch (error) {
    await handle.close();
    await fs.rm(lockPath, { force: true });
    throw error;
  }
  return async () => {
    await handle.close();
    await fs.rm(lockPath, { force: true });
  };
}

module.exports = { acquireFormalRunLock, canonicalizeWithExistingAncestor, isPathInside, prepareOutputRoot, reserveSafeRunDirectory };
