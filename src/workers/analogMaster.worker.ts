/**
 * Analog Master Rack Worker
 *
 * Runs the analog-character master processing (GPU-accelerated spectral exciter +
 * saturation + width + tone) off the main thread so a full-track render doesn't
 * freeze the UI. WebGPU is available in module workers, so the exciter's batch FFT
 * runs on the GPU here too when one is present.
 */

import { processAnalogMaster, type AnalogMasterSettings } from '../lib/analogMaster';

interface AnalogMasterInput {
  channels: Float32Array[];
  sampleRate: number;
  settings: AnalogMasterSettings;
}

self.onmessage = async (e: MessageEvent<AnalogMasterInput>) => {
  const { channels, sampleRate, settings } = e.data;

  if (!channels || channels.length === 0) {
    self.postMessage({ error: 'No channel data provided' });
    return;
  }

  try {
    const t0 = performance.now();
    // Copy the (transferred) channel buffers so processing owns its own memory.
    const input = channels.map((c) => new Float32Array(c));
    const res = await processAnalogMaster(input, sampleRate, settings);
    const ms = performance.now() - t0;

    const transfer = res.channels.map((c) => c.buffer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    self.postMessage({ channels: res.channels, gpu: res.gpu, ms }, transfer as any);
  } catch (err) {
    self.postMessage({ error: (err as Error)?.message || 'Analog master processing failed' });
  }
};
