const crypto = require('node:crypto');
const fs = require('node:fs');
const { loadDatasetManifest } = require('../lib/dataset-manifest');
const { renderQualityReport } = require('../lib/dataset-quality-report');

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function main() {
  const manifestPath = requiredEnvironment('MANIFEST_PATH');
  const datasetRoot = requiredEnvironment('DATASET_ROOT');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = loadDatasetManifest(manifestPath, { datasetRoot });
  const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  process.stdout.write(renderQualityReport({ manifest, manifestSha256 }));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Unable to generate dataset quality report: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
