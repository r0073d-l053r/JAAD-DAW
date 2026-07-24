import { type AnalogMasterSettings } from './analogMaster';

/**
 * Process channel data through the Analog Master worker (off the main thread,
 * GPU-accelerated FFT when available). Copies the input so the caller's buffers
 * aren't detached by the transfer. Returns the processed channels + gpu flag.
 */
export function runAnalogMasterWorker(
  channels: Float32Array[],
  sampleRate: number,
  settings: AnalogMasterSettings,
): Promise<{ channels: Float32Array[]; gpu: boolean }> {
  return new Promise((resolve, reject) => {
    const copies = channels.map((c) => new Float32Array(c));
    const worker = new Worker(new URL('../workers/analogMaster.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data?.error) reject(new Error(e.data.error));
      else resolve({ channels: e.data.channels, gpu: !!e.data.gpu });
    };
    worker.onerror = (err) => { worker.terminate(); reject(new Error(err.message || 'analog master worker error')); };
    worker.postMessage({ channels: copies, sampleRate, settings }, copies.map((c) => c.buffer));
  });
}
