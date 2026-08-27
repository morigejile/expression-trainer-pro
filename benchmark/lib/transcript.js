function normalizeTranscript(text) {
  if (typeof text !== 'string') {
    throw new TypeError('transcript must be a string');
  }

  return Array.from(text.normalize('NFKC').toLowerCase())
    .filter((character) => !/[\p{White_Space}\p{Punctuation}]/u.test(character));
}

module.exports = { normalizeTranscript };
