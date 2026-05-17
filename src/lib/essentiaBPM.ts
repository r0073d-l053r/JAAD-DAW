let essentia: any = null;

/**
 * Dynamically loads Essentia.js only when needed to keep the main bundle size small.
 * This also avoids build-time warnings about Node.js modules (path, fs, crypto) 
 * being externalized for the browser.
 */
export async function initEssentia() {
  if (essentia) return essentia;
  
  console.log("Essentia: Initializing library (ESM mode)...");
  try {
    // Import ESM builds directly to avoid 'require' errors
    const [coreMod, wasmMod] = await Promise.all([
      import('essentia.js/dist/essentia.js-core.es.js'),
      import('essentia.js/dist/essentia-wasm.es.js')
    ]);

    const Essentia = coreMod.Essentia || coreMod.default?.Essentia || coreMod.default;
    const EssentiaWASM = wasmMod.EssentiaWASM || wasmMod.default?.EssentiaWASM || wasmMod.default;

    if (!Essentia || !EssentiaWASM) {
      throw new Error(`ESM Module structure unexpected. Core: ${!!Essentia}, WASM: ${!!EssentiaWASM}`);
    }

    console.log(`Essentia: Initializing WASM. Type: ${typeof EssentiaWASM}`);
    
    let wasm;
    if (typeof EssentiaWASM === 'function') {
      // Factory mode
      wasm = await EssentiaWASM({
        locateFile: (path: string) => {
          const url = path.endsWith('.wasm') ? `${import.meta.env.BASE_URL}essentia-wasm.web.wasm` : path;
          console.log(`Essentia WASM: Locating ${path} -> ${url}`);
          return url;
        }
      });
    } else {
      // Object mode (already instantiated or non-factory build)
      EssentiaWASM.locateFile = (path: string) => {
        const url = path.endsWith('.wasm') ? `${import.meta.env.BASE_URL}essentia-wasm.web.wasm` : path;
        console.log(`Essentia WASM (obj): Locating ${path} -> ${url}`);
        return url;
      };
      
      if (EssentiaWASM.ready instanceof Promise) {
        await EssentiaWASM.ready;
      }
      wasm = EssentiaWASM;
    }

    essentia = new Essentia(wasm);
    console.log("Essentia: Library and WASM initialized successfully.");
    return essentia;
  } catch (err) {
    console.error("Failed to initialize Essentia.js:", err);
    throw err;
  }
}

export async function detectBPMOffline(audioBuffer: AudioBuffer): Promise<number | null> {
  console.log("Essentia: Starting BPM detection...");
  try {
    const essentiaInstance = await initEssentia();
    console.log("Essentia: Instance ready.");
    
    // Ensure we are analyzing at 44100Hz (Essentia's standard)
    let analyzedBuffer = audioBuffer;
    if (audioBuffer.sampleRate !== 44100) {
      console.log(`Essentia: Resampling from ${audioBuffer.sampleRate}Hz to 44100Hz...`);
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * 44100), 44100);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      analyzedBuffer = await offlineCtx.startRendering();
    }
    
    // Convert to Mono signal
    const channelData = essentiaInstance.audioBufferToMonoSignal(analyzedBuffer);
    console.log(`Essentia: Audio data prepared (${channelData.length} samples at 44.1kHz)`);
    
    const vector = essentiaInstance.arrayToVector(channelData);
    
    // Try RhythmExtractor2013 (more accurate but slower)
    console.log("Essentia: Running RhythmExtractor2013...");
    const result = essentiaInstance.RhythmExtractor2013(vector);
    
    let bpm = result.bpm;
    console.log("Essentia: RhythmExtractor result:", bpm);

    // If RhythmExtractor failed, try BeatTrackerDegara (faster, more robust)
    if (!bpm || bpm < 40) {
      console.log("Essentia: Falling back to BeatTrackerDegara...");
      const ticksResult = essentiaInstance.BeatTrackerDegara(vector);
      console.log("Essentia: BeatTrackerDegara result:", ticksResult);
      
      const ticks = essentiaInstance.vectorToArray(ticksResult.ticks);
      console.log("Essentia: BeatTrackerDegara ticks:", ticks);
      
      if (ticks && ticks.length > 1) {
        // Calculate BPM from average tick interval
        let intervals = [];
        for (let i = 1; i < ticks.length; i++) {
          intervals.push(ticks[i] - ticks[i-1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        bpm = 60 / avgInterval;
        console.log("Essentia: BeatTrackerDegara calculated average interval:", avgInterval);
        console.log("Essentia: BeatTrackerDegara calculated BPM:", bpm);
      } else {
        console.warn("Essentia: BeatTrackerDegara returned insufficient ticks.");
      }
    }
    
    if (vector && (vector as any).delete) {
      (vector as any).delete();
    }
    console.log("Essentia: Vector deleted.");
    
    if (bpm && bpm >= 40 && bpm <= 250) {
      console.log("Essentia: Final BPM detected:", Math.round(bpm));
      return Math.round(bpm);
    }
    
    console.warn("Essentia: Could not determine valid BPM.");
    return null;
  } catch (err) {
    console.error("Essentia BPM Error:", err);
    return null;
  }
}
