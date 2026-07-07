/**
 * Type declarations for the untyped `demucs-web` package (MIT) — in-browser
 * HT-Demucs via onnxruntime-web. Only the surface JAAD uses is declared.
 */
declare module 'demucs-web' {
  export interface DemucsStemChannels {
    left: Float32Array;
    right: Float32Array;
  }

  export interface DemucsSeparationResult {
    drums: DemucsStemChannels;
    bass: DemucsStemChannels;
    other: DemucsStemChannels;
    vocals: DemucsStemChannels;
  }

  export interface DemucsProgressEvent {
    progress?: number;
    currentSegment?: number;
    totalSegments?: number;
  }

  export interface DemucsProcessorOptions {
    /** The onnxruntime-web module (pass the imported namespace). */
    ort?: unknown;
    modelPath?: string;
    sessionOptions?: Record<string, unknown>;
    onProgress?: (event: DemucsProgressEvent) => void;
  }

  export class DemucsProcessor {
    constructor(options?: DemucsProcessorOptions);
    loadModel(modelPathOrBuffer: string | ArrayBuffer): Promise<unknown>;
    separate(left: Float32Array, right: Float32Array): Promise<DemucsSeparationResult>;
  }

  export const CONSTANTS: {
    SAMPLE_RATE: number;
    FFT_SIZE: number;
    HOP_SIZE: number;
    TRAINING_SAMPLES: number;
    SEGMENT_OVERLAP: number;
    TRACKS: string[];
    DEFAULT_MODEL_URL: string;
  };
}
