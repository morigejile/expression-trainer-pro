'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createReviewServer } = require('../benchmark/lib/assisted-review-server');
const { buildTransition, renderText } = require('../benchmark/assisted-review/review-ui');

const CANDIDATE_ID = 'fleurs-dev-candidate-01';
const BINDING_SHA256 = 'a'.repeat(64);

function wav({ sampleRateHz = 16000, channels = 1, samples = Buffer.alloc(32) } = {}) {
  const byteRate = sampleRateHz * channels * 2;
  const bytes = Buffer.alloc(44 + samples.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii'); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(sampleRateHz, 24); bytes.writeUInt32LE(byteRate, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(samples.length, 40); samples.copy(bytes, 44);
  return bytes;
}

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function request({ port, method = 'GET', pathname, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function host(port) { return `127.0.0.1:${port}`; }

function securityHeaders(response) {
  assert.match(response.headers['content-security-policy'], /default-src 'none'; frame-ancestors 'none'/);
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.headers['permissions-policy'], /geolocation=\(\)/);
}

async function makeServer(t, { tokenBytes = Buffer.alloc(32, 7), mutateStore, audio = wav() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-server-'));
  let instance;
  t.after(async () => { if (instance) await instance.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const audioPath = path.join(root, 'audio.wav');
  fs.writeFileSync(audioPath, audio);
  const calls = [];
  const candidate = {
    candidateId: CANDIDATE_ID,
    binding: {
      candidateId: CANDIDATE_ID, bindingSha256: BINDING_SHA256, audioFile: 'audio.wav', audioSha256: sha256(audio),
      sampleRateHz: 16000, channels: 1, durationMs: 1,
    },
    transcript: '</script><img src=x onerror=1>',
    predictions: [{ rawText: '<b>hostile</b>' }], comparison: { bindingSha256: BINDING_SHA256 }, suggestions: {}, state: { revision: 0 },
  };
  const reviewStore = {
    getSessionIdentity() { return { alias: 'primary-reviewer-1', role: 'primary' }; },
    getCandidate(candidateId) { return candidateId === CANDIDATE_ID ? candidate : null; },
    commitPrimaryTranscript(value) { candidate.primaryTranscriptText = value.text; calls.push({ kind: 'primary', value }); return { revision: 1, primaryTranscript: { transcriptSha256: value.event.payload.transcriptSha256 } }; },
    commitTransition(value) { calls.push({ kind: 'transition', value }); return { revision: 1 }; },
  };
  if (mutateStore) mutateStore(reviewStore, candidate, root, calls);
  instance = await createReviewServer({ datasetRoot: root, reviewStore, tokenBytes, port: 0 });
  return { ...instance, root, calls, candidate, audio };
}

async function login(instance) {
  const port = Number(new URL(instance.url).port);
  const tokenPath = new URL(instance.url).pathname + new URL(instance.url).search;
  const exchange = await request({ port, pathname: tokenPath, headers: { Host: host(port) } });
  assert.equal(exchange.status, 302);
  const cookie = exchange.headers['set-cookie'][0].split(';')[0];
  const review = await request({ port, pathname: '/review', headers: { Host: host(port), Cookie: cookie } });
  assert.equal(review.status, 200);
  const csrf = /data-csrf="([a-f0-9]{64})"/.exec(review.body.toString('utf8'));
  assert.ok(csrf, 'authenticated review markup contains a per-session CSRF value');
  return { port, tokenPath, cookie, csrf: csrf[1] };
}

function transitionBody(overrides = {}) {
  return JSON.stringify({ action: 'record-primary-transcript', payload: { transcriptText: '人工转写🙂' }, expectedRevision: 0, ...overrides });
}

function mutationHeaders(session, body, overrides = {}) {
  return {
    Host: host(session.port), Cookie: session.cookie, Origin: `http://${host(session.port)}`,
    'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf, 'Content-Length': Buffer.byteLength(body), ...overrides,
  };
}

test('requires exactly a 256-bit exchange token', async (t) => {
  await assert.rejects(() => makeServer(t, { tokenBytes: Buffer.alloc(31) }), /32 bytes/);
  await assert.rejects(() => makeServer(t, { tokenBytes: Buffer.alloc(33) }), /32 bytes/);
});

test('binds IPv4 loopback and exchanges one exact token for a token-free short-lived session', async (t) => {
  const instance = await makeServer(t);
  const port = Number(new URL(instance.url).port);
  assert.equal(instance.server.address().address, '127.0.0.1');
  assert.match(instance.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]{64}$/);
  const exchange = await request({ port, pathname: new URL(instance.url).pathname + new URL(instance.url).search, headers: { Host: host(port) } });
  assert.equal(exchange.status, 302); assert.equal(exchange.headers.location, '/review'); securityHeaders(exchange);
  assert.match(exchange.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+/);
  assert.equal(exchange.body.toString('utf8').includes('07'.repeat(32)), false);
  const replay = await request({ port, pathname: new URL(instance.url).pathname + new URL(instance.url).search, headers: { Host: host(port) } });
  assert.equal(replay.status, 404); securityHeaders(replay);
});

test('rejects sessions and Host values that do not exactly match this loopback server', async (t) => {
  const instance = await makeServer(t); const session = await login(instance);
  for (const headers of [{ Host: host(session.port) }, { Host: 'localhost' }, { Host: host(session.port), Cookie: `${session.cookie}; ${session.cookie}` }]) {
    const response = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}`, headers });
    assert.notEqual(response.status, 200); securityHeaders(response);
  }
  const body = transitionBody();
  const badPost = await request({ port: session.port, method: 'POST', pathname: `/api/candidates/${CANDIDATE_ID}/transitions`, headers: mutationHeaders(session, body, { Host: 'evil.test' }), body });
  assert.notEqual(badPost.status, 200); securityHeaders(badPost);
});

test('serves hostile candidate evidence as JSON rather than markup and only resolves opaque identifiers', async (t) => {
  const instance = await makeServer(t); const session = await login(instance);
  const candidate = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}`, headers: { Host: host(session.port), Cookie: session.cookie } });
  assert.equal(candidate.status, 200); securityHeaders(candidate);
  const decoded = JSON.parse(candidate.body.toString('utf8'));
  assert.equal(decoded.transcript, '</script><img src=x onerror=1>');
  assert.equal(decoded.predictions[0].rawText, '<b>hostile</b>');
  for (const id of ['..', '%2e%2e', 'audio.wav', 'bad/id', 'bad%2fid']) {
    const response = await request({ port: session.port, pathname: `/api/candidates/${id}`, headers: { Host: host(session.port), Cookie: session.cookie } });
    assert.notEqual(response.status, 200); securityHeaders(response);
  }
});

test('revalidates contained WAV bytes and binding metadata instead of trusting store-provided audio', async (t) => {
  const instance = await makeServer(t); const session = await login(instance);
  const audio = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}/audio`, headers: { Host: host(session.port), Cookie: session.cookie } });
  assert.equal(audio.status, 200); assert.equal(audio.headers['content-type'], 'audio/wav'); assert.deepEqual(audio.body, instance.audio);
  fs.writeFileSync(path.join(instance.root, 'audio.wav'), wav({ sampleRateHz: 8000 }));
  const tampered = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}/audio`, headers: { Host: host(session.port), Cookie: session.cookie } });
  assert.notEqual(tampered.status, 200); assert.equal(tampered.body.equals(instance.audio), false); securityHeaders(tampered);
});

test('rejects a symlinked audio path that escapes the external dataset root where supported', async (t) => {
  const instance = await makeServer(t); const session = await login(instance);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'review-server-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'outside.wav'), instance.audio);
  try {
    fs.symlinkSync(outside, path.join(instance.root, 'linked'), 'junction');
  } catch (error) {
    t.skip(`symlink/junction creation unavailable: ${error.code}`);
    return;
  }
  instance.candidate.binding.audioFile = 'linked/outside.wav';
  const response = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}/audio`, headers: { Host: host(session.port), Cookie: session.cookie } });
  assert.notEqual(response.status, 200); assert.equal(response.body.equals(instance.audio), false); securityHeaders(response);
});

test('fails closed if the audio path is swapped after opening', async (t) => {
  const instance = await makeServer(t); const session = await login(instance); const audioPath = path.join(instance.root, 'audio.wav');
  const originalRead = fs.readFileSync; let swapped = false;
  fs.readFileSync = function patchedRead(target, ...args) {
    if (!swapped && typeof target === 'number') { swapped = true; fs.renameSync(audioPath, path.join(instance.root, 'prior.wav')); fs.writeFileSync(audioPath, wav({ sampleRateHz: 8000 })); }
    return originalRead.call(this, target, ...args);
  };
  try {
    const response = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}/audio`, headers: { Host: host(session.port), Cookie: session.cookie } });
    assert.notEqual(response.status, 200); assert.equal(response.body.equals(instance.audio), false); securityHeaders(response);
  } finally { fs.readFileSync = originalRead; }
});

test('requires exact mutation authority and derives primary transcript evidence on the server', async (t) => {
  const instance = await makeServer(t); const session = await login(instance);
  const valid = transitionBody();
  const variants = [
    { Host: host(session.port), Origin: `http://${host(session.port)}`, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
    mutationHeaders(session, valid, { Origin: 'http://127.0.0.1:1' }),
    mutationHeaders(session, valid, { 'X-CSRF-Token': 'b'.repeat(64) }),
    mutationHeaders(session, valid, { 'Content-Type': 'text/plain' }),
  ];
  for (const headers of variants) {
    const response = await request({ port: session.port, method: 'POST', pathname: `/api/candidates/${CANDIDATE_ID}/transitions`, headers, body: valid });
    assert.notEqual(response.status, 200); securityHeaders(response);
  }
  const forged = transitionBody({ actorAlias: 'attacker-9', actorRole: 'secondary', bindingSha256: 'b'.repeat(64), candidateId: 'attacker-9', payload: { transcriptText: '人工转写🙂', transcriptSha256: 'c'.repeat(64) } });
  const rejected = await request({ port: session.port, method: 'POST', pathname: `/api/candidates/${CANDIDATE_ID}/transitions`, headers: mutationHeaders(session, forged), body: forged });
  assert.equal(rejected.status, 400); assert.equal(instance.calls.length, 0);
  const accepted = await request({ port: session.port, method: 'POST', pathname: `/api/candidates/${CANDIDATE_ID}/transitions`, headers: mutationHeaders(session, valid), body: valid });
  assert.equal(accepted.status, 200); assert.equal(instance.calls.length, 1);
  const call = instance.calls[0]; const expectedHash = sha256(Buffer.from('人工转写🙂', 'utf8'));
  assert.equal(call.kind, 'primary'); assert.equal(call.value.candidateId, CANDIDATE_ID); assert.equal(call.value.bindingSha256, BINDING_SHA256); assert.equal(call.value.text, '人工转写🙂');
  assert.deepEqual(call.value.event, { actorAlias: 'primary-reviewer-1', actorRole: 'primary', bindingSha256: BINDING_SHA256, candidateId: CANDIDATE_ID, action: 'record-primary-transcript', payload: { transcriptSha256: expectedHash, transcriptLength: 5 }, expectedRevision: 0 });
  const reviewed = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}`, headers: { Host: host(session.port), Cookie: session.cookie } });
  assert.equal(JSON.parse(reviewed.body.toString('utf8')).primaryTranscriptText, '人工转写🙂');
});

test('rejects malformed, oversized, and unknown transition bodies without recording transcript text', async (t) => {
  const instance = await makeServer(t); const session = await login(instance);
  const cases = ['{', JSON.stringify({ action: 'record-primary-transcript', payload: { transcriptText: 'x' }, expectedRevision: 0, extra: true }), transitionBody({ payload: { transcriptText: '' } }), transitionBody({ payload: { transcriptText: 'x'.repeat(5000) } })];
  for (const body of cases) {
    const response = await request({ port: session.port, method: 'POST', pathname: `/api/candidates/${CANDIDATE_ID}/transitions`, headers: mutationHeaders(session, body), body });
    assert.notEqual(response.status, 200); assert.equal(response.body.toString('utf8').includes('人工转写'), false); securityHeaders(response);
  }
  assert.equal(instance.calls.length, 0);
});

test('uses textContent as the only candidate-text rendering sink', () => {
  let value = null;
  const node = { set textContent(text) { value = text; }, set innerHTML(_text) { throw new Error('unsafe HTML sink'); } };
  renderText(node, '<img src=x onerror=1>');
  assert.equal(value, '<img src=x onerror=1>');
});

test('review UI sends a primary transcript as exact client transition keys without authority fields', () => {
  assert.deepEqual(buildTransition('record-primary-transcript', '人工转写🙂', 7), {
    action: 'record-primary-transcript', payload: { transcriptText: '人工转写🙂' }, expectedRevision: 7,
  });
});

test('mutation revalidates the current bound WAV before reaching either store commit', async (t) => {
  const instance = await makeServer(t); const session = await login(instance); const body = transitionBody();
  fs.writeFileSync(path.join(instance.root, 'audio.wav'), wav({ sampleRateHz: 8000 }));
  const response = await request({ port: session.port, method: 'POST', pathname: `/api/candidates/${CANDIDATE_ID}/transitions`, headers: mutationHeaders(session, body), body });
  assert.notEqual(response.status, 200); assert.equal(instance.calls.length, 0); securityHeaders(response);
});

test('expired session after slow body intake cannot commit', async (t) => {
  const originalNow = Date.now; let now = 1000; Date.now = () => now;
  try {
    const instance = await makeServer(t); const session = await login(instance); const body = transitionBody();
    const result = new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: session.port, method: 'POST', path: `/api/candidates/${CANDIDATE_ID}/transitions`, headers: mutationHeaders(session, body) }, (res) => { const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) })); });
      req.on('error', reject); req.write(body.slice(0, 8)); setTimeout(() => { now += 301000; req.end(body.slice(8)); }, 30);
    });
    const response = await result;
    assert.notEqual(response.status, 200); assert.equal(instance.calls.length, 0);
  } finally { Date.now = originalNow; }
});

test('governed PCM limits apply to audio and transition reads', async (t) => {
  const bad = wav({ sampleRateHz: 4000 });
  const instance = await makeServer(t, { audio: bad }); const session = await login(instance); const body = transitionBody();
  instance.candidate.binding.audioSha256 = sha256(bad); instance.candidate.binding.sampleRateHz = 4000;
  const audio = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}/audio`, headers: { Host: host(session.port), Cookie: session.cookie } });
  const transition = await request({ port: session.port, method: 'POST', pathname: `/api/candidates/${CANDIDATE_ID}/transitions`, headers: mutationHeaders(session, body), body });
  assert.notEqual(audio.status, 200); assert.notEqual(transition.status, 200); assert.equal(instance.calls.length, 0);
});

test('strictly over-limit body and method matrix fail closed', async (t) => {
  const instance = await makeServer(t); const session = await login(instance); const oversized = transitionBody({ payload: { transcriptText: 'x'.repeat(17000) } });
  const response = await request({ port: session.port, method: 'POST', pathname: `/api/candidates/${CANDIDATE_ID}/transitions`, headers: mutationHeaders(session, oversized), body: oversized });
  assert.equal(response.status, 400); assert.equal(instance.calls.length, 0);
  for (const [method, pathname, allow] of [['POST', '/review', 'GET'], ['POST', `/api/candidates/${CANDIDATE_ID}`, 'GET'], ['GET', `/api/candidates/${CANDIDATE_ID}/transitions`, 'POST']]) {
    const actual = await request({ port: session.port, method, pathname, headers: { Host: host(session.port), Cookie: session.cookie } });
    assert.equal(actual.status, 405); assert.equal(actual.headers.allow, allow);
  }
  assert.equal((await request({ port: session.port, pathname: '/unknown', headers: { Host: host(session.port), Cookie: session.cookie } })).status, 404);
});

test('review UI builds exact schemas for every Task 5 action and marks light-accent rationale human-only', () => {
  assert.deepEqual(buildTransition('approve-secondary-transcript', {}, 2), { action: 'approve-secondary-transcript', payload: {}, expectedRevision: 2 });
  assert.deepEqual(buildTransition('approve-license', {}, 3), { action: 'approve-license', payload: { approved: true }, expectedRevision: 3 });
  assert.deepEqual(buildTransition('clear-pii', {}, 4), { action: 'clear-pii', payload: { cleared: true }, expectedRevision: 4 });
  assert.deepEqual(buildTransition('set-final-tags', { tags: ['mandarin', 'light-accent'], lightAccentRationale: 'human-only reason' }, 5), { action: 'set-final-tags', payload: { tags: ['mandarin', 'light-accent'], lightAccentRationale: 'human-only reason' }, expectedRevision: 5 });
});

test('shipped UI exposes fixed evidence nodes and has no unsafe candidate-text or remote dependency sink', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'benchmark', 'assisted-review', 'review-ui.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'benchmark', 'assisted-review', 'review-ui.js'), 'utf8');
  for (const id of ['comparison-risk', 'suggestions', 'pii-warnings', 'approval-state', 'review-audio', 'action-input', 'tags-input', 'light-accent-rationale']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(`${html}\n${script}`, /(?:innerHTML|outerHTML|insertAdjacentHTML|\beval\b|new Function|\bon[a-z]+\s*=|https?:\/\/)/i);
});

test('store read errors return a generic envelope without poisoning later requests', async (t) => {
  const sentinel = 'TOKEN_PATH_TRANSCRIPT_SENTINEL';
  const instance = await makeServer(t, { mutateStore(store) { const original = store.getCandidate; let fail = true; store.getCandidate = (id) => { if (fail) { fail = false; throw new Error(sentinel); } return original(id); }; } });
  const session = await login(instance);
  const failed = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}`, headers: { Host: host(session.port), Cookie: session.cookie } });
  assert.equal(failed.status, 500); assert.equal(failed.body.toString('utf8').includes(sentinel), false);
  const healthy = await request({ port: session.port, pathname: `/api/candidates/${CANDIDATE_ID}`, headers: { Host: host(session.port), Cookie: session.cookie } });
  assert.equal(healthy.status, 200);
});
