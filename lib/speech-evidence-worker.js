'use strict';

const {validateAudio} = require('./training-audio-store');
const {analyzeSpeechEvidence} = require('./speech-evidence-engine');

// Electron utilityProcess is the production boundary. Node IPC enables the same
// entry point to be verified without a desktop. A thread cannot contain exit().
const channel = process.parentPort;
if (!channel && typeof process.send !== 'function') throw new Error('Speech evidence requires process IPC');
const send = message => channel ? channel.postMessage(message) : process.send(message);
let started = false;
async function receive(event) {
  if (started) return;
  started = true;
  try {
    const {audio, modelPath} = event?.data ?? event;
    const bytes = validateAudio(audio);
    const samples = new Float32Array((bytes.length - 44) / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(44 + i * 2) / 32768;
    send(await analyzeSpeechEvidence({samples, sampleRateHz: 16000, modelPath}));
  } catch {
    // The parent treats malformed output as a safe local failure, never as silence.
    send({schemaVersion: 0});
  }
}
if (channel) channel.on('message', receive);
else process.on('message', receive);
