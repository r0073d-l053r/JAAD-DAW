# Next Steps & To-Do List

## Core Engine & Playback
- [ ] **Metronome Integration:** Implement a toggle-able metronome strictly synced to the global BPM for recording accuracy.
- [ ] **Dynamic Tempo Mapping:** Allow users to automate or change the BPM mid-track rather than relying on a static global tempo.
- [ ] **Clip Envelopes:** Direct volume/pan curve drawing overlaid directly on audio clips (for precise fade-ins/outs per clip).
- [ ] **Real VST/AudioUnit Support via WebAssembly:** Begin scaffolding out integration with WebAssembly packages of common synths and effects to replace mocked plugin behavior.

## Workflow & UX Polish
- [ ] **Clip Grouping:** Allow users to select multiple clips and "Group" them so they move and edit together.
- [ ] **True Touch Support / Mobile Optimizations:** Improve drag handles and interactions for tablet/mobile web browsers, converting complex hover states into explicit tap targets if necessary.
- [ ] **Color Palette Expansion:** Provide richer color labeling options for entire track lanes to further organize massive projects.

## Generative & AI
- [ ] **"Fix My Mix" Automator:** Automatically parse channel volumes and apply soft limiting/compression based on the user clicking a single "Master/Polish" button.
- [ ] **AI Clip Tagging:** Automatically tag and suggest titles for uploaded audio (e.g., "808 Kick", "Synth Pad") using the Gemini API.
- [ ] **Generative MIDI Patterns:** A tool where users can type "Give me a syncopated hi-hat pattern at 120BPM" and the app generates a MIDI clip directly onto the timeline.

## Infrastructure & Cloud
- [ ] **Firebase Real-time Sync:** Upgrade from local mocked states and `alert()` popups to true Firebase Cloud Database documents where multiplayer cursors and changes broadcast instantly.
- [ ] **Project Asset Bundling:** Implement a more robust File API integration using IndexedDB so large imported gigabytes of WAV files are aggressively locally cached without browser bloat.
- [ ] **Robust Offline Recovery:** Write an auto-save local cache mechanism that immediately recovers the user's project if the browser crashes.
