import { MonoChunkCollector } from './audio-chunk-collector.mjs';

class ExpressionTrainerAudioCollector extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.enabled = options?.processorOptions?.enabled === true;
    this.captureEpoch = Number.isSafeInteger(options?.processorOptions?.captureEpoch)
      && options.processorOptions.captureEpoch >= 0
      ? options.processorOptions.captureEpoch
      : 0;
    this.collector = new MonoChunkCollector({
      onChunk: samples => {
        const frames = samples.length;
        const buffer = samples.buffer;
        this.port.postMessage({
          type: 'chunk',
          captureEpoch: this.captureEpoch,
          frames,
          samples: buffer
        }, [buffer]);
      }
    });
    this.port.onmessage = event => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (message?.type === 'set-enabled'
        && typeof message.enabled === 'boolean'
        && Number.isSafeInteger(message.captureEpoch)
        && message.captureEpoch > this.captureEpoch
        && message.enabled !== this.enabled) {
      this.captureEpoch = message.captureEpoch;
      this.enabled = message.enabled;
      if (!this.enabled) this.collector.reset();
    } else if (message?.type === 'flush'
        && Number.isSafeInteger(message.requestId)
        && message.captureEpoch === this.captureEpoch) {
      this.collector.flush();
      this.port.postMessage({
        type: 'flushed',
        requestId: message.requestId,
        captureEpoch: this.captureEpoch
      });
    }
  }

  process(inputs) {
    if (this.enabled) this.collector.push(inputs[0]);
    return true;
  }
}

registerProcessor('expression-trainer-audio-collector', ExpressionTrainerAudioCollector);
