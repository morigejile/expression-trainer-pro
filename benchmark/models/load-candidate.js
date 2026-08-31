'use strict';

const path = require('node:path');

const {loadCandidateRegistry} = require('../lib/candidate-registry');
const {redactModelPath, resolveModelPath} = require('../lib/model-root');

function requiredFile(candidate, role) {
  const file = candidate.files.find((entry) => entry.role === role);
  if (!file) throw new Error(`Candidate ${candidate.id} is missing required ${role} file`);
  return file.relativePath;
}
function filePath(modelRoot, candidate, role) { return resolveModelPath(modelRoot, requiredFile(candidate, role)); }
function baseModelConfig(candidate, modelRoot) { return {tokens: filePath(modelRoot, candidate, 'tokens'), numThreads: candidate.numThreads, provider: candidate.provider, debug: false}; }

function buildParaformerConfig(candidate, modelRoot) {
  return {recognizerKind: 'online', featConfig: {sampleRate: candidate.sampleRateHz, featureDim: 80}, modelConfig: {...baseModelConfig(candidate, modelRoot), paraformer: {encoder: filePath(modelRoot, candidate, 'encoder'), decoder: filePath(modelRoot, candidate, 'decoder')}}, decodingMethod: 'greedy_search', maxActivePaths: 4, enableEndpoint: true, rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20};
}
function buildZipformerCtcConfig(candidate, modelRoot) {
  return {recognizerKind: 'online', featConfig: {sampleRate: candidate.sampleRateHz, featureDim: 80}, modelConfig: {...baseModelConfig(candidate, modelRoot), zipformer2Ctc: {model: filePath(modelRoot, candidate, 'model')}}, decodingMethod: 'greedy_search', maxActivePaths: 4, enableEndpoint: true, rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20};
}
function buildSenseVoiceConfig(candidate, modelRoot) {
  return {recognizerKind: 'offline', featConfig: {sampleRate: candidate.sampleRateHz, featureDim: 80}, modelConfig: {...baseModelConfig(candidate, modelRoot), senseVoice: {model: filePath(modelRoot, candidate, 'model'), language: 'auto', useInverseTextNormalization: true}}};
}
function buildFireRedAsrCtcConfig(candidate, modelRoot) {
  return {recognizerKind: 'offline', featConfig: {sampleRate: candidate.sampleRateHz, featureDim: 80}, modelConfig: {...baseModelConfig(candidate, modelRoot), fireRedAsrCtc: {model: filePath(modelRoot, candidate, 'model')}}};
}
function buildQwen3AsrConfig(candidate, modelRoot) {
  return {
    recognizerKind: 'offline',
    featConfig: {sampleRate: candidate.sampleRateHz, featureDim: 80},
    modelConfig: {
      tokens: '',
      numThreads: candidate.numThreads,
      provider: candidate.provider,
      debug: false,
      qwen3Asr: {
        convFrontend: filePath(modelRoot, candidate, 'conv-frontend'),
        encoder: filePath(modelRoot, candidate, 'encoder'),
        decoder: filePath(modelRoot, candidate, 'decoder'),
        tokenizer: path.dirname(filePath(modelRoot, candidate, 'tokenizer-config')),
        maxTotalLen: 512,
        maxNewTokens: 128,
        temperature: 0.000001,
        topP: 0.8,
        seed: 42
      }
    }
  };
}
function buildSherpaConfig(candidate, modelRoot) {
  if (candidate.family === 'paraformer' && candidate.mode === 'streaming') return buildParaformerConfig(candidate, modelRoot);
  if (candidate.family === 'zipformer-ctc' && candidate.mode === 'streaming') return buildZipformerCtcConfig(candidate, modelRoot);
  if (candidate.family === 'sensevoice' && candidate.mode === 'utterance') return buildSenseVoiceConfig(candidate, modelRoot);
  if (candidate.family === 'fire-red-asr-ctc' && candidate.mode === 'utterance') return buildFireRedAsrCtcConfig(candidate, modelRoot);
  if (candidate.family === 'qwen3-asr' && candidate.mode === 'utterance') return buildQwen3AsrConfig(candidate, modelRoot);
  throw new Error(`Unsupported candidate family/mode: ${candidate.family}/${candidate.mode}`);
}

function sanitizeForReport(value, modelRoot) {
  if (typeof value === 'string') return redactModelPath(value, modelRoot);
  if (Array.isArray(value)) return value.map((entry) => sanitizeForReport(entry, modelRoot));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeForReport(entry, modelRoot)]));
  return value;
}

function initializeCandidate(candidate, modelRoot, {sherpa = require('sherpa-onnx-node'), config = buildSherpaConfig(candidate, modelRoot)} = {}) {
  const {recognizerKind, ...nativeConfig} = config;
  const startedAt = process.hrtime.bigint();
  const recognizer = recognizerKind === 'online' ? new sherpa.OnlineRecognizer(nativeConfig) : new sherpa.OfflineRecognizer(nativeConfig);
  return {config, elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6, recognizerKind, recognizer};
}

function parseArguments(argv) {
  if (argv.at(-1) !== '--dry-run') throw new Error('Usage: node load-candidate.js --registry <file> --candidate <id> --model-root <dir> --dry-run');
  const values = {};
  for (let index = 0; index < argv.length - 1; index += 2) {
    const option = argv[index]; const value = argv[index + 1];
    if (!['--registry', '--candidate', '--model-root'].includes(option) || !value) throw new Error('Usage: node load-candidate.js --registry <file> --candidate <id> --model-root <dir> --dry-run');
    if (values[option]) throw new Error(`duplicate option: ${option}`);
    values[option] = value;
  }
  if (argv.length !== 7 || !values['--registry'] || !values['--candidate'] || !values['--model-root']) throw new Error('Usage: node load-candidate.js --registry <file> --candidate <id> --model-root <dir> --dry-run');
  return values;
}
function sherpaVersion() { return require('sherpa-onnx-node/package.json').version; }
function baseResult(candidateId = null) {
  return {candidateId, status: null, sherpaVersion: null, processVersions: {node: process.versions.node, modules: process.versions.modules}, arch: process.arch, platform: process.platform, config: null, initSuccess: false, initError: null, initElapsedMs: null};
}

function runLoadCandidate(argv, dependencies = {}) {
  const result = baseResult();
  const loadRegistry = dependencies.loadRegistry || loadCandidateRegistry;
  const getSherpaVersion = dependencies.getSherpaVersion || sherpaVersion;
  const initializer = dependencies.initializeCandidate || initializeCandidate;
  try {
    const values = parseArguments(argv);
    const registry = loadRegistry(values['--registry'], {modelRoot: values['--model-root']});
    const candidate = registry.candidates.find(({id}) => id === values['--candidate']);
    if (!candidate) throw new Error(`Candidate not found: ${values['--candidate']}`);
    result.candidateId = candidate.id;
    result.status = candidate.status;
    if (candidate.status === 'pending') {
      result.initError = `Candidate pending: ${candidate.pending.reason}`;
      return result;
    }
    result.sherpaVersion = getSherpaVersion();
    const config = buildSherpaConfig(candidate, registry.modelRoot);
    result.config = sanitizeForReport(config, registry.modelRoot);
    const initialized = initializer(candidate, registry.modelRoot, {config, sherpa: dependencies.sherpa});
    result.initSuccess = true;
    result.initElapsedMs = initialized.elapsedMs;
  } catch (error) {
    result.initError = error instanceof Error ? error.message : String(error);
  }
  return result;
}

function main(argv) {
  const result = runLoadCandidate(argv);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.initSuccess) process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2));

module.exports = {buildSherpaConfig, initializeCandidate, parseArguments, runLoadCandidate, sanitizeForReport};
