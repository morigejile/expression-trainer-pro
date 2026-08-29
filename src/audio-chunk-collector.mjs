export const DEFAULT_CHUNK_FRAMES = 320;

export class MonoChunkCollector {
  #buffer;
  #chunkFrames;
  #onChunk;
  #writeIndex = 0;

  constructor({ chunkFrames = DEFAULT_CHUNK_FRAMES, onChunk } = {}) {
    if (!Number.isSafeInteger(chunkFrames) || chunkFrames <= 0) {
      throw new TypeError('chunkFrames must be a positive safe integer');
    }
    if (typeof onChunk !== 'function') {
      throw new TypeError('onChunk must be a function');
    }
    this.#chunkFrames = chunkFrames;
    this.#onChunk = onChunk;
    this.#buffer = new Float32Array(chunkFrames);
  }

  push(channels) {
    if (!Array.isArray(channels) || channels.length === 0) return;
    const availableChannels = channels.filter(channel => channel && Number.isSafeInteger(channel.length));
    if (availableChannels.length === 0) return;
    const frames = Math.min(...availableChannels.map(channel => channel.length));

    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0;
      for (const channel of availableChannels) sum += channel[frame];
      this.#buffer[this.#writeIndex] = sum / availableChannels.length;
      this.#writeIndex += 1;

      if (this.#writeIndex === this.#chunkFrames) {
        const chunk = this.#buffer;
        this.#buffer = new Float32Array(this.#chunkFrames);
        this.#writeIndex = 0;
        this.#onChunk(chunk);
      }
    }
  }

  reset() {
    this.#buffer = new Float32Array(this.#chunkFrames);
    this.#writeIndex = 0;
  }

  flush() {
    if (this.#writeIndex === 0) return false;
    const tail = this.#buffer.slice(0, this.#writeIndex);
    this.#buffer = new Float32Array(this.#chunkFrames);
    this.#writeIndex = 0;
    this.#onChunk(tail);
    return true;
  }
}
