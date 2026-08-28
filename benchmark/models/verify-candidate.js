const crypto = require('crypto');
const fs = require('fs');
const { loadCandidateRegistry } = require('../lib/candidate-registry');
const {resolveModelPath} = require('../lib/model-root');

function resolveModelFile(modelRoot, relativePath) { return resolveModelPath(modelRoot, relativePath); }

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyCandidate(candidate, modelRoot) {
  if (!candidate || typeof candidate.id !== 'string' || !Array.isArray(candidate.files)) {
    throw new Error('Candidate must include an id and files array');
  }
  if (candidate.status === 'pending') {
    return {candidateId: candidate.id, status: 'pending', valid: false, pending: candidate.pending};
  }
  if (candidate.status !== 'verified') {
    throw new Error(`Unsupported candidate status: ${candidate.status}`);
  }
  if (typeof modelRoot !== 'string' || modelRoot.length === 0) {
    throw new Error('modelRoot must be a non-empty string');
  }

  const files = [];
  let totalBytes = 0;

  for (const file of candidate.files) {
    const filePath = resolveModelFile(modelRoot, file.relativePath);
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Model file missing: ${file.relativePath}`);
      }
      throw error;
    }

    if (!stat.isFile()) {
      throw new Error(`Model path is not a file: ${file.relativePath}`);
    }
    if (stat.size !== file.bytes) {
      throw new Error(`Byte-size mismatch for ${file.relativePath}: expected ${file.bytes}, got ${stat.size}`);
    }

    const sha256 = await sha256File(filePath);
    if (sha256 !== file.sha256) {
      throw new Error(`SHA-256 mismatch for ${file.relativePath}: expected ${file.sha256}, got ${sha256}`);
    }

    totalBytes += stat.size;
    files.push({
      relativePath: file.relativePath,
      bytes: stat.size,
      sha256,
      role: file.role
    });
  }

  return {
    candidateId: candidate.id,
    status: 'verified',
    valid: true,
    files,
    totalBytes,
    verifiedAt: new Date().toISOString()
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--registry', '--candidate', '--model-root'].includes(option) || !value) {
      throw new Error('Usage: node verify-candidate.js --registry <file> --candidate <id> --model-root <dir>');
    }
    if (values[option]) throw new Error(`duplicate option: ${option}`);
    values[option] = value;
  }
  if (!values['--registry'] || !values['--candidate'] || !values['--model-root']) {
    throw new Error('Usage: node verify-candidate.js --registry <file> --candidate <id> --model-root <dir>');
  }
  return values;
}

async function main(argv) {
  const values = parseArguments(argv);
  const registry = loadCandidateRegistry(values['--registry'], { modelRoot: values['--model-root'] });
  const candidate = registry.candidates.find(({ id }) => id === values['--candidate']);
  if (!candidate) {
    throw new Error(`Candidate not found: ${values['--candidate']}`);
  }
  const result = await verifyCandidate(candidate, registry.modelRoot);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { resolveModelFile, verifyCandidate };
