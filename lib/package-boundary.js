'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {listPackage} = require('@electron/asar');

const MODEL_PAYLOAD_SUFFIXES = [
  '.gguf',
  '.onnx',
  '.ort',
  '.pt',
  '.pth',
  '.safetensors',
  '.tar.bz2',
  '.tar.gz',
  '.tflite'
];

function isModelPayloadPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  return MODEL_PAYLOAD_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

function assertOrdinaryPackageModelFree(resourcesPath, {listPackage: readAsarEntries = listPackage} = {}) {
  if (fs.existsSync(path.join(resourcesPath, 'asr-models'))) {
    throw new Error('Ordinary package must not contain bundled ASR models');
  }
  const asarPath = path.join(resourcesPath, 'app.asar');
  if (fs.existsSync(asarPath) && readAsarEntries(asarPath).some(isModelPayloadPath)) {
    throw new Error('Ordinary package ASAR must not contain model weights or archives');
  }
}

module.exports = {assertOrdinaryPackageModelFree, isModelPayloadPath};
