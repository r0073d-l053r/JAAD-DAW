
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  writable: WritableStream;
  readable: ReadableStream;
}

export class WebSerialManager {
  port: SerialPort | null = null;
  reader: ReadableStreamDefaultReader | null = null;
  writer: WritableStreamDefaultWriter | null = null;

  async requestPort() {
    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port!.open({ baudRate: 115200 });
      this.writer = this.port!.writable.getWriter();
      this.reader = this.port!.readable.getReader();
      console.log("📍 JAAD Hardware Bridge: Connected to device.");
    } catch (err) {
      console.error("Failed to connect to hardware device:", err);
    }
  }

  async sendMIDIMessage(message: number[]) {
    if (!this.writer) return;
    const data = new Uint8Array(message);
    await this.writer.write(data);
  }

  async sendAudioChunk(chunk: Float32Array) {
    if (!this.writer) return;
    // Convert to Int16 for ESP32/ARM DACs
    const int16 = new Int16Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      int16[i] = Math.max(-1, Math.min(1, chunk[i])) * 0x7FFF;
    }
    await this.writer.write(int16);
  }

  async startListening(onData: (data: Uint8Array) => void) {
    if (!this.reader) return;
    while (true) {
      const { value, done } = await this.reader.read();
      if (done) break;
      onData(value);
    }
  }
}

export const hardwareBridge = new WebSerialManager();
