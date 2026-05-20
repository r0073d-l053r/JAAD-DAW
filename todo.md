# JAAD - Future Roadmap & Ideas

## Advanced AI Composition
- [ ] **AI Vocal Harmony Generator:** Automatically generate 3-part backing harmonies for any vocal track using the Gemini API.
- [ ] **Sonic Style Transfer:** Upload a reference track (e.g., a specific 70s rock song) and have the AI adjust your project's EQ, compression, and reverb to match that "vibe."
- [ ] **Intelligent Arrangement Engine:** Convert an 8-bar loop into a full song structure (Intro -> Verse -> Chorus -> Bridge) with AI-suggested transitions.
- [ ] **Lyric-to-Vocal Synthesis:** Type lyrics and select a "voice profile" to generate high-quality vocal guide tracks directly in your project.

## Social & Collaboration
- [ ] **Live Presence Cursors:** See your collaborators' names and cursors moving in real-time across the timeline (Figma-style).
- [ ] **In-Project Version Comments:** Leave "Sticky Notes" at specific timestamps for feedback (e.g., "Bring the vocals up here").
- [ ] **Community Project Gallery:** A "Public" tab in the Project Browser where users can share templates and "Open Source" stems.
- [x] **Liquid Glass Share Modal:** Replace standard share alerts with a premium glassmorphic modal featuring animated link copying, deep-linked URLs, social share buttons, and customized styling.

## Professional Tools
- [ ] **Spectrogram Analysis View:** Toggle clips between traditional waveforms and high-resolution spectral heatmaps for surgical EQ work.
- [ ] **Video-to-Audio Sync:** Import a video file (MP4/WebM) to a dedicated video track for scoring and sound design for film.
- [ ] **VST/AU Bridge (Cloud-Side):** A microservice that lets you use professional desktop plugins by processing the audio in the cloud.
- [ ] **Advanced Sidechaining UI:** A visual "patch bay" for routing sidechain signals (e.g., Kick triggering Bass compression) with real-time gain-reduction meters.

## FX System Development
- [ ] **WebEQ Implementation:**
  - [ ] Create EQ parameter state management (track FX settings)
  - [ ] Build EQ control UI (Low/Mid/High frequency sliders with visual feedback)
  - [ ] Implement real-time EQ parameter updates in audioEngine
  - [ ] Add preset EQ curves (Flat, Bass Boost, Vocal Cut, etc.)
  - [ ] Create EQ visual meter to show frequency response
  
- [ ] **Compressor Implementation:**
  - [ ] Create compressor parameter state management
  - [ ] Build compressor control UI (Threshold, Ratio, Attack, Release sliders)
  - [ ] Implement real-time compressor parameter updates
  - [ ] Add gain reduction meter display
  - [ ] Create compressor presets (Vocal, Kick, Mix Bus, Master)
  
- [ ] **Delay Implementation:**
  - [ ] Create delay parameter state management
  - [ ] Build delay control UI (Time, Feedback, Wet/Dry mix)
  - [ ] Implement tempo-synced delay logic
  - [ ] Add delay visualization (oscilloscope-style feedback pattern)
  - [ ] Create delay presets (Echo, Ping Pong, Tape Delay, etc.)
  
- [ ] **FX Slot Management:**
  - [ ] Track FX slot persistence in project state
  - [ ] Enable FX loading/unloading (remove FX button when loaded)
  - [ ] Add FX chain ordering controls (reorder FX in chain)
  - [ ] Create FX chain visualization (show loaded FX in order)
  - [ ] Add FX bypass/enable toggle for each slot

## Performance & Ecosystem
- [ ] **Cloud Headless Rendering:** Offload the final .WAV render to a cloud server to free up local CPU for massive multi-track projects.
- [ ] **Mobile Remote App:** A simplified "Remote Control" web view for mobile devices to act as a wireless Transport/Mixer controller.
- [ ] **Project Bundling (.JAAD):** A single-file archive format that packs the JSON state AND all audio assets into one shareable file using JSZip.
