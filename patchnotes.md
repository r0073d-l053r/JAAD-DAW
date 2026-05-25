**🎛️ J.A.A.D. — Patch Notes**  
*Just Another AI DAW*  
***Internal Release Notes***  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAMUlEQVR4nO3WAQkAIBAEsBPMYs4PZhMDWMAA5njYUmxU1UqyAwBAF2cmeZE4AIBO7gentgXapSWpbgAAAABJRU5ErkJggg==)  
***Current Build:*** * v0.15.3 · May 25, 2026*  
 *  
 * ***Platform:*** * Web (React + Vite + Firebase)*  
 *  
 * ***Engine:*** * Web Audio API + AudioWorklet + Wasm SIMD + Carla Headless DSP Sidecar*  
 *  
 * ***AI Backend:*** * Google Gemini + essentia.js*  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANElEQVR4nO3OUQmAABBAsSdYxKYXx1gmEBOIFfwTYUuwZWa2ag8AgL841uquzq8nAAC8dj05WgYLQTzjnAAAAABJRU5ErkJggg==)  
**v0.15.3 — May 25, 2026**  
**🐳 ***"The Headless Host"***  
Introduced a high-performance, containerized DSP sidecar to offload heavy VST processing from the browser thread. This architecture allows users to natively host commercial Windows VST plugins (like Waves) on Linux via Wine and Carla.

***✨ New Features***  
| | |  
|-|-|  
| **Feature** | **Description** |   
| **Carla Headless Integration** | The old Node.js dummy DSP script has been completely replaced with a robust Python server bridging WebSockets and JACK Audio Connection Kit. Real-time Float32Array PCM data from the DAW frontend is now directly piped through a headless `carla-single` instance. |   
| **Windows VST Support** | The Docker environment is built on Ubuntu 22.04 and includes Wine64, Wine32, and KXStudio repositories. This natively supports `carla-bridge-win64` and `carla-bridge-win32` for running WaveShells and Windows DLLs dynamically. |   
| **OSC Parameter Automation** | Turning dials on the DAW frontend now sends JSON `param_change` events which the sidecar translates into instantaneous Open Sound Control (OSC) messages, adjusting the parameters of the active VST in real-time. |   

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANElEQVR4nO3OUQmAABBAsSdYxKYXx1gmEBOIFfwTYUuwZWa2ag8AgL841uquzq8nAAC8dj05WgYLQTzjnAAAAABJRU5ErkJggg==)  
**v0.15.2 — May 25, 2026**  
**🛡️ ***"Snapshot Serenity"***  
Implemented a robust Cloud Snapshot Backup & Recovery system to prevent project corruption and data loss. This release introduces automated background backups during cloud saves, storage-efficient pruning, and a one-click project restoration interface.

***✨ New Features***  
| | |  
|-|-|  
| **Feature** | **Description** |   
| **Automated Cloud Snapshots** | A secondary `.jaad` project bundle is automatically uploaded to a versioned `backups/` directory during every successful cloud save. This provides a non-destructive safety net if the primary project file becomes corrupted. |   
| **Snapshot Pruning** | To maintain efficient Firebase Storage usage, an auto-pruning mechanism ensures only the 3 most recent snapshots per project are retained, automatically deleting older versions. |   
| **Project Restoration UI** | Added a new "View Snapshots" menu to the Cloud Project Browser. Users can browse chronological timestamps of previous backups and restore a stable project state with a single click, completely resetting the corrupted workspace. |   

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANElEQVR4nO3OUQmAABBAsSdYxKYXx1gmEBOIFfwTYUuwZWa2ag8AgL841uquzq8nAAC8dj05WgYLQTzjnAAAAABJRU5ErkJggg==)  
**v0.15.1 — May 24, 2026**  
**🔧 ***"Tighten the Bolts"***  
Stability and polish release. Fixed critical Spectrogram loading failures, isolated plugin dial interactions from window dragging, hardened cloud project loading, and upgraded mixer metering fidelity.  
***🐛 Bug Fixes***  
| | |  
|-|-|  
| **Fix** | **Description** |   
| **Spectrogram Worker Loading** | Fixed a `failed to load module script` error caused by Vite misidentifying the Worker file as `video/mp2t`. Refactored the instantiation to use the canonical single-line `new Worker(new URL(...), { type: 'module' })` pattern so Vite can statically analyze and correctly bundle the worker asset. |   
| **VST/Sidechain Dial Drag Interference** | Dragging knobs in the Cloud VST Bridge and Sidechain Compressor popup editors was unintentionally moving the entire floating window. Migrated all dial controls from MouseEvents to PointerEvents with `stopPropagation()` and `setPointerCapture()`, fully isolating knob interaction from window drag logic. |   
| **Cloud Project Loading Crashes** | Resolved crashes when loading projects from the cloud where tracks had missing `clips` or `lanes` arrays. Added defensive sanitization in the `SYNC_STATE` reducer and null-safe iteration across `App.tsx`, `Navbar.tsx`, and `ProjectBrowser.tsx`. |   
| **Firebase Bundle Download Failures** | Wrapped the progressive `fetch` download in a `try/catch` with automatic fallback to the Firebase Storage SDK `getBlob` method, handling CORS and enterprise firewall restrictions gracefully. |   
| **Mixer Meter Layout** | Removed conflicting CSS `relative` class on track and master meter wrappers that was breaking the absolute positioning of the reactive LED bars. |   
  
***📝 Improvements***  
| | |  
|-|-|  
| **Improvement** | **Description** |   
| **Mixer Metering Fidelity** | Increased the AudioContext `AnalyserNode` FFT size from 64 to 1024 samples. This provides a significantly smoother and more accurate real-time RMS calculation, eliminating jittery/flickering meter bars and delivering professional-grade visual feedback on every mixer stem. |   
| **Pointer Event Standardization** | All custom dial/knob UI components across plugin editors now use the `PointerEvent` API for consistent cross-device behavior (mouse, touch, pen) and reliable pointer capture semantics. |   
  
***🏗️ Technical Details***  
- 5 files changed across `Spectrogram.tsx`, `VstBridgeEditor.tsx`, `SidechainEditor.tsx`, `audioEngine.ts`, and `Mixer.tsx`.  
- Full Vitest suite: **21 test files, 105 tests — 100% passing.**  
- Zero compilation or runtime errors in development and production builds.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OQQmAABRAsSd4NIGRTPXNaQBrWMGbCFuCLTOzV2cAAPzFvVZbdXw9AQDgtesBhZQEOYZGgUEAAAAASUVORK5CYII=)  
*Last updated: May 25, 2026*  
