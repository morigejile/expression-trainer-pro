'use strict';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatSafeError(error, {secrets = [], maximumLength = 2048} = {}) {
  let output = error instanceof Error
    ? (error.stack || `${error.name}: ${error.message}`)
    : String(error ?? 'Unknown error');

  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) {
      output = output.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
    }
  }

  output = output
    .replace(/authorization\s*:\s*bearer\s+[^\s;,]+/gi, 'Authorization: [REDACTED]')
    .replace(/bearer\s+[^\s;,]+/gi, '[REDACTED]')
    .replace(/api[-_ ]?key["']?\s*[:=]\s*["']?[^\s"',;]+/gi, 'apiKey=[REDACTED]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[REDACTED]');

  return output.slice(0, maximumLength);
}

module.exports = {formatSafeError};
