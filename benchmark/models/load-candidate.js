const path = require('path');
const { loadCandidateRegistry } = require('../lib/candidate-registry');

function requiredFile(candidate, role) {
  const file = candidate.files.find((entry) => entry.role === role);
  if (!file) {
    throw new Error(`Candidate ${candidate.id} is missing required ${role} file`);
  }
  return file.relativePath;
}

function filePath(modelRoot, candidate, role) {
  return path.resolve(modelRoot, requiredFile(candidate, role));
}

function baseModelConfig(candidate, modelRoot) {
  return {
    tokens: filePath(modelRoot, candidate, 'tokens'),
    numThreads: candidate.numThreads,
    provider: candidate.provider,
    debug: false
  };
}

function buildParaformerConfig(candidate, modelRoot) {
  return {
    recognizerKind: 'online',
    featConfig: { sampleRate: candidate.sampleRateHz, featureDim: 80 },
    modelConfig: {
      ...baseModelConfig(candidate, modelRoot),
      paraformer: {
        encoder: filePath(modelRoot, candidate, 'encoder'),
        decoder: filePath(modelRoot, candidate, 'decoder')
      }
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20
  };
}

function buildZipformerCtcConfig(candidate, modelRoot) {
  return {
    recognizerKind: 'online',
    featConfig: { sampleRate: candidate.sampleRateHz, featureDim: 80 },
    modelConfig: {
      ...baseModelConfig(candidate, modelRoot),
      zipformer2Ctc: { model: filePath(modelRoot, candidate, 'model') }
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20
  };
}

function buildSenseVoiceConfig(candidate, modelRoot) {
  return {
    recognizerKind: 'offline',
    featConfig: { sampleRate: candidate.sampleRateHz, featureDim: 80 },
    modelConfig: {
      ...baseModelConfig(candidate, modelRoot),
      senseVoice: {
        model: filePath(modelRoot, candidate, 'model'),
        language: 'auto',
        useInverseTextNormalization: true
      }
    }
  };
}

function buildSherpaConfig(candidate, modelRoot) {
  if (candidate.family === 'paraformer' && candidate.mode === 'streaming') {
    return buildParaformerConfig(candidate, modelRoot);
  }
  if (candidate.family === 'zipformer-ctc' && candidate.mode === 'streaming') {
    return buildZipformerCtcConfig(candidate, modelRoot);
  }
  if (candidate.family === 'sensevoice' && candidate.mode === 'utterance') {
    return buildSenseVoiceConfig(candidate, modelRoot);
  }
  throw new Error(`Unsupported candidate family/mode: ${candidate.family}/${candidate.mode}`);
}

function sanitizeForReport(value, modelRoot) {
  if (typeof value === 'string') {
    return value.startsWith(path.resolve(modelRoot))
      ? `<model-root>${value.slice(path.resolve(modelRoot).length)}`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForReport(entry, modelRoot));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeForReport(entry, modelRoot)]));
  }
  return value;
}

function initializeCandidate(candidate, modelRoot) {
  const sherpa = require('sherpa-onnx-node');
  const config = buildSherpaConfig(candidate, modelRoot);
  const { recognizerKind, ...nativeConfig } = config;
  const startedAt = process.hrtime.bigint();
  const recognizer = recognizerKind === 'online'
    ? new sherpa.OnlineRecognizer(nativeConfig)
    : new sherpa.OfflineRecognizer(nativeConfig);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  return { config, elapsedMs, recognizerKind, recognizer };
}

function parseArguments(argv) {
  if (argv.length !== 7 || argv[6] !== '--dry-run') {
    throw new Error('Usage: node load-candidate.js --registry <file> --candidate <id> --model-root <dir> --dry-run');
  }
  const values = {};
  for (let index = 0; index < 6; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--registry', '--candidate', '--model-root'].includes(option) || !value) {
      throw new Error('Usage: node load-candidate.js --registry <file> --candidate <id> --model-root <dir> --dry-run');
    }
    values[option] = value;
  }
  return values;
}

function sherpaVersion() {
  return require('sherpa-onnx-node/package.json').version;
}

function main(argv) {
  const values = parseArguments(argv);
  const registry = loadCandidateRegistry(values['--registry'], { modelRoot: values['--model-root'] });
  const candidate = registry.candidates.find(({ id }) => id === values['--candidate']);
  if (!candidate) {
    throw new Error(`Candidate not found: ${values['--candidate']}`);
  }

  const result = {
    candidateId: candidate.id,
    sherpaVersion: sherpaVersion(),
    processVersions: { node: process.versions.node, modules: process.versions.modules },
    arch: process.arch,
    platform: process.platform,
    config: null,
    initSuccess: false,
    initError: null,
    initElapsedMs: null
  };

  try {
    const initialized = initializeCandidate(candidate, registry.modelRoot);
    result.config = sanitizeForReport(initialized.config, registry.modelRoot);
    result.initSuccess = true;
    result.initElapsedMs = initialized.elapsedMs;
  } catch (error) {
    result.config = sanitizeForReport(buildSherpaConfig(candidate, registry.modelRoot), registry.modelRoot);
    result.initError = error.message;
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.initSuccess) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildSherpaConfig, initializeCandidate, sanitizeForReport };
