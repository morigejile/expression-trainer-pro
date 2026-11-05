'use strict';

const MAX_TEXT_LENGTH = 200_000;

function invalid(message) {
  const error = new TypeError(message);
  error.code = 'invalid-ipc-input';
  throw error;
}

function requireBoundedText(value, {label = 'text', maximumLength = MAX_TEXT_LENGTH} = {}) {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
  if (value.length > maximumLength) invalid(`${label} exceeds ${maximumLength} characters`);
  return value;
}

module.exports = {
  MAX_TEXT_LENGTH,
  requireBoundedText
};
