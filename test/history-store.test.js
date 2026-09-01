const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createHistoryEntry,
  getHistoryEntry,
  listHistoryEntries,
  updateHistoryReport
} = require('../lib/history-store');

function withUserData(run) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-history-'));
  return Promise.resolve(run(userDataPath)).finally(() => {
    fs.rmSync(userDataPath, {recursive: true, force: true});
  });
}

function stats(totalWords) {
  return {duration: 12, fillers: 1, hedges: 2, totalWords, vagueWords: 3};
}

test('history keeps only the newest 50 transcript entries', async () => {
  await withUserData((userDataPath) => {
    for (let index = 0; index < 51; index += 1) {
      createHistoryEntry(userDataPath, {
        source: 'recording',
        transcript: `第${index}条逐字稿`,
        stats: stats(index)
      }, {
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        randomUUID: () => `entry-${index}`
      });
    }

    const entries = listHistoryEntries(userDataPath);
    assert.equal(entries.length, 50);
    assert.equal(entries[0].id, 'entry-50');
    assert.equal(entries.at(-1).id, 'entry-1');
    assert.equal(getHistoryEntry(userDataPath, 'entry-0'), null);
    assert.equal(Object.hasOwn(entries[0], 'transcript'), false);
    assert.equal(entries[0].preview, '第50条逐字稿');
  });
});

test('generated report updates the matching history entry without changing its transcript', async () => {
  await withUserData((userDataPath) => {
    const entry = createHistoryEntry(userDataPath, {
      source: 'paste',
      transcript: '这是需要保留的逐字稿',
      stats: stats(10)
    }, {
      now: () => '2026-09-01T00:00:00.000Z',
      randomUUID: () => 'entry-a'
    });

    const updated = updateHistoryReport(userDataPath, {
      id: entry.id,
      report: '你这次把重点讲得很清楚 ✨\n\n## 总评\n继续保持。'
    }, {now: () => '2026-09-01T00:01:00.000Z'});

    assert.equal(updated.transcript, '这是需要保留的逐字稿');
    assert.match(updated.report, /重点讲得很清楚/);
    assert.equal(updated.updatedAt, '2026-09-01T00:01:00.000Z');
    assert.equal(listHistoryEntries(userDataPath)[0].hasReport, true);
  });
});

test('invalid history JSON is preserved and treated as an empty history', async () => {
  await withUserData((userDataPath) => {
    const filePath = path.join(userDataPath, 'training-history.json');
    fs.writeFileSync(filePath, '{"entries":', 'utf8');
    const warnings = [];

    assert.deepEqual(listHistoryEntries(userDataPath, {
      logger: {warn: message => warnings.push(message)}
    }), []);
    assert.equal(fs.readFileSync(filePath, 'utf8'), '{"entries":');
    assert.equal(warnings.length, 1);
  });
});

test('automatic history save refuses to overwrite an invalid existing file', async () => {
  await withUserData((userDataPath) => {
    const filePath = path.join(userDataPath, 'training-history.json');
    const original = '{"schemaVersion":1,"entries":';
    fs.writeFileSync(filePath, original, 'utf8');

    assert.throws(() => createHistoryEntry(userDataPath, {
      source: 'recording',
      transcript: '不能覆盖原文件',
      stats: stats(6)
    }), error => error.code === 'invalid-history-file');
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  });
});
