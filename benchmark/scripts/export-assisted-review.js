'use strict';

const { exportReviewedManifest } = require('../lib/assisted-review-export');

function parseExportArgs(argv) {
  const values = {};
  const candidates = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--dataset-root', '--candidate', '--run-id', '--export-id', '--batch-id', '--intake-path'].includes(flag) || index + 1 >= argv.length) throw new Error('invalid export arguments');
    const value = argv[++index];
    if (flag === '--candidate') candidates.push(value);
    else if (values[flag] !== undefined) throw new Error('duplicate export argument');
    else values[flag] = value;
  }
  return { datasetRoot: values['--dataset-root'], candidateIds: candidates, runId: values['--run-id'], exportId: values['--export-id'], batchId: values['--batch-id'], intakePath: values['--intake-path'] };
}

if (require.main === module) {
  const result = exportReviewedManifest(parseExportArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { parseExportArgs };
