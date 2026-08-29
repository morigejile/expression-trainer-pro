'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function atomicWriteJsonSync(filePath, value, {fsImpl = fs, randomUUID = crypto.randomUUID} = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('JSON target must be an absolute path');
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;

  fsImpl.mkdirSync(directory, {recursive: true});
  try {
    descriptor = fsImpl.openSync(temporaryPath, 'wx', 0o600);
    fsImpl.writeFileSync(descriptor, serialized, 'utf8');
    fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = undefined;
    fsImpl.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fsImpl.closeSync(descriptor); } catch {}
    }
    try { fsImpl.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

module.exports = {atomicWriteJsonSync};
