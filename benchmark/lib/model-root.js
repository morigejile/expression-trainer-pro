'use strict';

const fs = require('node:fs');
const path = require('node:path');

function realpath(value) {
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function canonicalizeModelRoot(modelRoot) {
  if (typeof modelRoot !== 'string' || modelRoot.trim() === '') {
    throw new Error('modelRoot must be a non-empty path');
  }

  const canonicalRoot = realpath(path.resolve(modelRoot));
  if (!fs.statSync(canonicalRoot).isDirectory()) {
    throw new Error(`modelRoot is not a directory: ${modelRoot}`);
  }
  return canonicalRoot;
}

function canonicalizeTarget(target) {
  const missingParts = [];
  let existingPath = path.resolve(target);
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) {
      throw new Error(`Unable to resolve model path: ${target}`);
    }
    missingParts.unshift(path.basename(existingPath));
    existingPath = parent;
  }
  return path.join(realpath(existingPath), ...missingParts);
}

function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) {
    throw new Error(`Model path must be a relative path: ${relativePath}`);
  }
  if (relativePath.split(/[\\/]+/).includes('..')) {
    throw new Error(`Model path escapes canonical model root: ${relativePath}`);
  }
}

function resolveModelPath(modelRoot, relativePath) {
  const canonicalRoot = canonicalizeModelRoot(modelRoot);
  assertSafeRelativePath(relativePath);
  const canonicalTarget = canonicalizeTarget(path.resolve(canonicalRoot, relativePath));
  if (!isPathInside(canonicalRoot, canonicalTarget)) {
    throw new Error(`Model path escapes canonical model root: ${relativePath}`);
  }
  return canonicalTarget;
}

function redactModelPath(value, modelRoot) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    return value;
  }
  try {
    const canonicalRoot = canonicalizeModelRoot(modelRoot);
    const canonicalTarget = canonicalizeTarget(value);
    if (!isPathInside(canonicalRoot, canonicalTarget)) return value;
    const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
    resolveModelPath(modelRoot, canonicalRelative);
    return `<model-root>${canonicalRelative ? `${path.sep}${canonicalRelative}` : ''}`;
  } catch {
    return value;
  }
}

module.exports = {
  canonicalizeModelRoot,
  isPathInside,
  redactModelPath,
  resolveModelPath,
};
