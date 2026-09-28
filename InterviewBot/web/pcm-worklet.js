// Microphone → 16 kHz, 16-bit PCM, in 100 ms chunks (what the Sarvam agent expects).
// Browsers record at 44.1 or 48 kHz; this averages each window down to one sample.

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.acc = 0
    this.sum = 0
    this.n = 0
    this.out = new Int16Array(1600)
    this.k = 0
  }

  process(inputs) {
    const x = inputs[0] && inputs[0][0]
    if (!x) return true
    for (let i = 0; i < x.length; i++) {
      this.sum += x[i]
      this.n++
      this.acc += 1
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio
        const v = Math.max(-1, Math.min(1, this.sum / this.n))
        this.sum = 0
        this.n = 0
        this.out[this.k++] = v < 0 ? v * 0x8000 : v * 0x7fff
        if (this.k === this.out.length) {
          this.port.postMessage(this.out.buffer, [this.out.buffer])
          this.out = new Int16Array(1600)
          this.k = 0
        }
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCapture)
