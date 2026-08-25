'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { parsePcmWav, validateGovernedPcmMetadata } = require('./dataset-manifest');
const { canonicalizeExternalRoot, readStableFile, resolveContained } = require('./assisted-review-storage');
const { validateAlias } = require('./assisted-review-audit');

const SESSION_MAX_AGE_SECONDS = 300;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TRANSCRIPT_CODE_POINTS = 4096;
const MAX_AUDIO_BYTES = (192000 * 2 * 2 * 600) + 44;
const OPAQUE_ID = /^[a-z0-9][a-z0-9-]{2,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(left);
  const b = Buffer.isBuffer(right) ? right : Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookie(header) {
  if (typeof header !== 'string' || header === '') return null;
  const values = header.split(';').map((part) => part.trim()).filter(Boolean);
  if (values.length !== 1) return null;
  const match = /^review_session=([a-f0-9]{64})$/.exec(values[0]);
  return match ? match[1] : null;
}

function renderReviewPage(csrf) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'assisted-review', 'review-ui.html'), 'utf8');
  return template.replace('%%CSRF_TOKEN%%', csrf);
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
  };
}

function writeResponse(response, status, body, headers = {}) {
  response.writeHead(status, { ...securityHeaders(), ...headers });
  response.end(body);
}

function writeError(response, status) {
  writeResponse(response, status, JSON.stringify({ error: 'request-rejected' }), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > MAX_BODY_BYTES) return reject(new Error('body too large'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('malformed JSON')); }
    });
    request.on('error', () => reject(new Error('request failed')));
  });
}

function validateIdentity(identity) {
  if (!isPlainObject(identity)) throw new Error('session identity is invalid');
  validateAlias(identity.alias);
  if (identity.role !== 'primary' && identity.role !== 'secondary') throw new Error('session identity is invalid');
  return Object.freeze({ alias: identity.alias, role: identity.role });
}

function bindingFor(candidate, candidateId) {
  if (!isPlainObject(candidate) || candidate.candidateId !== candidateId || !isPlainObject(candidate.binding)) throw new Error('candidate is invalid');
  const binding = candidate.binding;
  if (binding.candidateId !== candidateId || !SHA256.test(binding.bindingSha256) || !SHA256.test(binding.audioSha256)
    || typeof binding.audioFile !== 'string' || !Number.isInteger(binding.sampleRateHz) || !Number.isInteger(binding.channels) || !Number.isInteger(binding.durationMs)) {
    throw new Error('candidate binding is invalid');
  }
  validateGovernedPcmMetadata(binding);
  return binding;
}

function readBoundAudio(datasetRoot, candidate, candidateId) {
  const binding = bindingFor(candidate, candidateId);
  const audioPath = resolveContained(datasetRoot, binding.audioFile, { mustExist: true });
  if (fs.statSync(audioPath).size > MAX_AUDIO_BYTES) throw new Error('audio file is too large');
  const bytes = readStableFile(audioPath, datasetRoot);
  const recheckedBytes = readStableFile(audioPath, datasetRoot);
  if (!safeEqual(bytes, recheckedBytes)) throw new Error('audio changed while reading');
  if (!safeEqual(crypto.createHash('sha256').update(bytes).digest('hex'), binding.audioSha256)) throw new Error('audio hash changed');
  const metadata = parsePcmWav(bytes);
  validateGovernedPcmMetadata(metadata);
  if (metadata.sampleRateHz !== binding.sampleRateHz || metadata.channels !== binding.channels || metadata.durationMs !== binding.durationMs) throw new Error('audio metadata changed');
  return bytes;
}

function createReviewServer({ datasetRoot, reviewStore, tokenBytes = crypto.randomBytes(32), port = 0 } = {}) {
  if (!Buffer.isBuffer(tokenBytes) || tokenBytes.length !== 32) return Promise.reject(new Error('tokenBytes must be exactly 32 bytes'));
  if (!isPlainObject(reviewStore) || typeof reviewStore.getSessionIdentity !== 'function' || typeof reviewStore.getCandidate !== 'function'
    || typeof reviewStore.commitPrimaryTranscript !== 'function' || typeof reviewStore.commitTransition !== 'function') {
    return Promise.reject(new Error('reviewStore is invalid'));
  }
  const root = canonicalizeExternalRoot(datasetRoot);
  const identity = validateIdentity(reviewStore.getSessionIdentity());
  const exchangeToken = Buffer.from(tokenBytes);
  const sessions = new Map();
  let tokenUsed = false;
  let expectedHost = null;

  function currentSession(request) {
    const value = parseCookie(request.headers.cookie);
    if (!value) return null;
    const session = sessions.get(value);
    if (!session || session.expiresAt <= Date.now()) { sessions.delete(value); return null; }
    return session;
  }

  function candidateFromPath(url, suffix = '') {
    const prefix = '/api/candidates/';
    if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return null;
    const encoded = url.pathname.slice(prefix.length, suffix ? -suffix.length : undefined);
    if (!OPAQUE_ID.test(encoded)) return null;
    return encoded;
  }

  const server = http.createServer(async (request, response) => { try {
    if (request.headers.host !== expectedHost) return writeError(response, 400);
    let url;
    try { url = new URL(request.url, `http://${expectedHost}`); } catch { return writeError(response, 400); }
    const candidateId = candidateFromPath(url);
    const audioId = candidateFromPath(url, '/audio');
    const transitionId = candidateFromPath(url, '/transitions');
    const allowedMethod = url.pathname === '/' || url.pathname === '/review' || url.pathname === '/review-ui.js' || candidateId || audioId ? 'GET' : transitionId ? 'POST' : null;
    if (allowedMethod && request.method !== allowedMethod) return writeResponse(response, 405, JSON.stringify({ error: 'request-rejected' }), { Allow: allowedMethod, 'Content-Type': 'application/json; charset=utf-8' });
    if (request.method === 'GET' && url.pathname === '/') {
      const supplied = url.searchParams.get('token');
      if (tokenUsed || url.searchParams.size !== 1 || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !safeEqual(Buffer.from(supplied, 'hex'), exchangeToken)) return writeError(response, 404);
      tokenUsed = true;
      const sessionId = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionId, { csrf: crypto.randomBytes(32).toString('hex'), expiresAt: Date.now() + (SESSION_MAX_AGE_SECONDS * 1000) });
      return writeResponse(response, 302, '', { Location: '/review', 'Set-Cookie': `review_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}` });
    }
    if (request.method === 'GET' && url.pathname === '/review') {
      const session = currentSession(request);
      if (!session) return writeError(response, 403);
      return writeResponse(response, 200, renderReviewPage(session.csrf), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (request.method === 'GET' && url.pathname === '/review-ui.js') {
      const session = currentSession(request);
      if (!session) return writeError(response, 403);
      const script = fs.readFileSync(path.join(__dirname, '..', 'assisted-review', 'review-ui.js'), 'utf8');
      return writeResponse(response, 200, script, { 'Content-Type': 'application/javascript; charset=utf-8' });
    }
    if (request.method === 'GET' && candidateId) {
      if (url.search) return writeError(response, 404);
      if (!currentSession(request)) return writeError(response, 403);
      const candidate = reviewStore.getCandidate(candidateId);
      if (!candidate) return writeError(response, 404);
      return writeResponse(response, 200, JSON.stringify(candidate), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    if (request.method === 'GET' && audioId) {
      if (url.search) return writeError(response, 404);
      if (!currentSession(request)) return writeError(response, 403);
      try {
        const candidate = reviewStore.getCandidate(audioId);
        if (!candidate) return writeError(response, 404);
        const bytes = readBoundAudio(root, candidate, audioId);
        return writeResponse(response, 200, bytes, { 'Content-Type': 'audio/wav', 'Content-Length': bytes.length });
      } catch { return writeError(response, 409); }
    }
    if (request.method === 'POST' && transitionId) {
      const session = currentSession(request);
      if (!session || request.headers.origin !== `http://${expectedHost}` || request.headers['content-type'] !== 'application/json' || typeof request.headers['x-csrf-token'] !== 'string' || !safeEqual(request.headers['x-csrf-token'], session.csrf)) return writeError(response, 403);
      let body;
      try { body = await readJsonBody(request); } catch { return writeError(response, 400); }
      if (!hasExactKeys(body, ['action', 'payload', 'expectedRevision']) || typeof body.action !== 'string' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) return writeError(response, 400);
      const candidate = reviewStore.getCandidate(transitionId);
      if (!candidate) return writeError(response, 404);
      let binding;
      try { binding = bindingFor(candidate, transitionId); } catch { return writeError(response, 409); }
      try {
        if (currentSession(request) !== session) return writeError(response, 403);
        readBoundAudio(root, candidate, transitionId);
        if (currentSession(request) !== session) return writeError(response, 403);
        let state;
        if (body.action === 'record-primary-transcript') {
          if (identity.role !== 'primary' || !hasExactKeys(body.payload, ['transcriptText']) || typeof body.payload.transcriptText !== 'string') return writeError(response, 400);
          const text = body.payload.transcriptText;
          const transcriptLength = Array.from(text).length;
          if (text.trim() === '' || transcriptLength > MAX_TRANSCRIPT_CODE_POINTS) return writeError(response, 400);
          const event = {
            actorAlias: identity.alias, actorRole: identity.role, bindingSha256: binding.bindingSha256, candidateId: transitionId,
            action: body.action, payload: { transcriptSha256: crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'), transcriptLength }, expectedRevision: body.expectedRevision,
          };
          state = reviewStore.commitPrimaryTranscript({ candidateId: transitionId, bindingSha256: binding.bindingSha256, text, event });
        } else {
          let payload = body.payload;
          if (body.action === 'set-final-tags') {
            if (!hasExactKeys(payload, ['tags', 'lightAccentRationale']) || !Array.isArray(payload.tags)) return writeError(response, 400);
            const requiresRationale = payload.tags.includes('light-accent');
            if (requiresRationale ? typeof payload.lightAccentRationale !== 'string' || payload.lightAccentRationale.trim() === '' : payload.lightAccentRationale !== null) return writeError(response, 400);
            payload = { tags: payload.tags, lightAccentRationaleSha256: requiresRationale ? crypto.createHash('sha256').update(Buffer.from(payload.lightAccentRationale, 'utf8')).digest('hex') : null };
          }
          const event = {
            actorAlias: identity.alias, actorRole: identity.role, bindingSha256: binding.bindingSha256, candidateId: transitionId,
            action: body.action, payload, expectedRevision: body.expectedRevision,
          };
          state = reviewStore.commitTransition({ state: candidate.state, event, expectedRevision: body.expectedRevision });
        }
        return writeResponse(response, 200, JSON.stringify(state), { 'Content-Type': 'application/json; charset=utf-8' });
      } catch { return writeError(response, 409); }
    }
    if (request.method !== 'GET' && request.method !== 'POST') return writeError(response, 405);
    return writeError(response, 404);
  } catch {
    if (!response.headersSent) writeError(response, 500);
    else response.destroy();
  }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      expectedHost = `127.0.0.1:${address.port}`;
      resolve({ url: `http://${expectedHost}/?token=${exchangeToken.toString('hex')}`, server, close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())) });
    });
  });
}

module.exports = { createReviewServer };
