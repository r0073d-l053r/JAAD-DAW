class SoundTouchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);
    
    this.tempo = 1.0;
    this.sampleRate = 44100;
    
    this.sequenceLength = 4096;
    this.seekTolerance = 0.1;
    this.overlap = 512;
    
    this.processing = false;
  }

  handleMessage(event) {
    if (event.data.type === 'INIT') {
      this.tempo = event.data.tempo;
      this.sampleRate = event.data.sampleRate;
      this.port.postMessage({ type: 'INIT_COMPLETE' });
    } else if (event.data.type === 'SET_TEMPO') {
      this.tempo = event.data.tempo;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0) return true;

    const inputChannel = input[0];
    const outputChannel = output[0];

    if (!inputChannel || !outputChannel) return true;

    for (let i = 0; i < inputChannel.length; ++i) {
      outputChannel[i] = inputChannel[i];
    }

    return true;
  }
}

registerProcessor('soundtouch-processor', SoundTouchProcessor);