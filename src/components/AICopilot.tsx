import { useState } from 'react';
import { Wand2, Layers, SplitSquareHorizontal } from './Icons';
import { useGemini } from '../lib/useGemini';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { saveAsset } from '../lib/assetManager';
import { uploadAssetCloud } from '../lib/syncUtils';
import { LiquidGlassPanel } from './LiquidGlass';

export function AICopilot() {
  const { state, dispatch } = useApp();
  const { requestMixingAdvice, getMasteringSettings, detectBPM, generateMIDI, generateStyleSheet, generateLyrics, generateMusicClip, isGenerating, error } = useGemini();
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<Array<{role: string, content: string}>>([
    { role: 'assistant', content: 'Hi! I am your AI audio assistant. I can generate tracks, write a style sheet or lyrics, detect tempo, separate stems, and give mixing or mastering advice. Type an idea and use a button, or just ask.' }
  ]);

  const [isGeneratingLocal, setIsGeneratingLocal] = useState(false);

  if (!state.aiPanelOpen) return null;

  const handleSend = async () => {
    if (!prompt.trim()) return;
    const userMsg = prompt;
    setPrompt('');
    setHistory(prev => [...prev, { role: 'user', content: userMsg }]);

    let responseStr = '';
    
    if (userMsg.toLowerCase().includes('master') && !userMsg.toLowerCase().includes('advice')) {
      const match = userMsg.match(/master.*?([a-z]+)/i);
      const genre = match && match[1] !== 'this' ? match[1] : 'pop';
      const settings = await getMasteringSettings(genre);
      responseStr = settings || 'Could not generate mastering settings.';
    } else if (userMsg.toLowerCase().includes('midi') || userMsg.toLowerCase().includes('pattern') || userMsg.toLowerCase().includes('rhythm')) {
       setIsGeneratingLocal(true);
       const midiNotes = await generateMIDI(userMsg);
       setIsGeneratingLocal(false);
       
       if (midiNotes && midiNotes.length > 0) {
         const newTrackId = 'midi_' + Date.now();
         dispatch({
           type: 'ADD_TRACK',
           payload: {
             id: newTrackId,
             name: 'Gen MIDI',
             volume: 0.8,
             pan: 0,
             muted: false,
             solo: false,
             color: '#10b981',
             clips: [],
             lanes: [],
             showLanes: false
           }
         });
         
         const clipId = 'mc_' + Date.now();
         dispatch({ 
           type: 'ADD_CLIP', 
           payload: { 
             trackId: newTrackId, 
             clip: {
               id: clipId,
               start: state.currentTime,
               duration: 4,
               audioData: 'MIDI Pattern: ' + userMsg,
               notes: midiNotes
             } 
           } 
         });
         responseStr = `I've generated a MIDI pattern based on your prompt: "${userMsg}" and placed it on a new MIDI track.`;
       } else {
         responseStr = "I couldn't generate a valid MIDI pattern from that prompt.";
       }
    } else if (userMsg.toLowerCase().includes('lyric')) {
       const theme = userMsg.replace(/.*?lyric[s]?\s*(about|for|on|:)?\s*/i, '').trim() || userMsg;
       const result = await generateLyrics(theme);
       responseStr = result || "I couldn't generate lyrics for that.";
    } else if (userMsg.toLowerCase().includes('style')) {
       const desc = userMsg.replace(/.*?style\s*(sheet)?\s*(about|for|on|:)?\s*/i, '').trim() || userMsg;
       const result = await generateStyleSheet(desc);
       responseStr = result || "I couldn't generate a style sheet for that.";
    } else {
      const simplifiedTracks = state.tracks.map(t => ({ name: t.name, vol: t.volume, pan: t.pan }));
      const advice = await requestMixingAdvice(simplifiedTracks, userMsg);
      responseStr = advice || 'Could not generate advice.';
    }
    setHistory(prev => [...prev, { role: 'assistant', content: responseStr }]);
  };

  return (
    <div className="w-80 flex-shrink-0 z-10 relative" style={{ animation: 'liquidGlassIn 0.3s ease-out' }}>
      <LiquidGlassPanel
        backgroundOpacity={0.12}
        mode="standard"
        className="h-full"
        contentClassName="h-full flex flex-col"
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="h-14 border-b border-white/[0.07] flex items-center px-4 space-x-2">
            <Wand2 size={18} className="text-primary" />
            <span className="font-semibold text-sm tracking-wide text-primary drop-shadow-md">AI COPILOT</span>
          </div>

          {/* Quick Actions */}
          <div className="p-4 grid grid-cols-2 gap-2 border-b border-white/[0.06]">
            <button 
              onClick={async () => {
                 const track = state.tracks.find(t => t.clips.some(c => state.selectedClipIds.includes(c.id))) || state.tracks[0];
                 if (!track || track.clips.length === 0) {
                     setHistory(prev => [...prev, { role: 'assistant', content: "Please select an audio clip or import audio first." }]);
                     return;
                 }
                 const clip = track.clips[0];
                 const buffer = audioEngine.buffers.get(clip.bufferId || clip.id);
                 if (!buffer) return;
                 
                 setIsGeneratingLocal(true);
                 const bpm = await detectBPM(buffer);
                 setIsGeneratingLocal(false);

                 if (bpm) {
                    dispatch({ type: 'SET_BPM', payload: bpm });
                    setHistory(prev => [...prev, { role: 'assistant', content: `Detected tempo: ${bpm} BPM. The project tempo has been updated.` }]);
                 } else {
                    setHistory(prev => [...prev, { role: 'assistant', content: "Could not automatically detect a tempo for this clip." }]);
                 }
              }}
              className="bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.08] rounded-lg p-2 flex flex-col items-center justify-center gap-1 transition backdrop-blur-sm"
            >
              <SplitSquareHorizontal size={16} className="text-secondary" />
              <span className="text-[10px] text-gray-300">Detect Tempo</span>
            </button>
            <button 
              onClick={async () => {
                  const track = state.tracks.find(t => t.clips.some(c => state.selectedClipIds.includes(c.id))) || state.tracks.find(t => t.clips.length > 0);
                  if (!track || track.clips.length === 0) {
                      setHistory(prev => [...prev, { role: 'assistant', content: "Please select an audio clip or import audio first." }]);
                      return;
                  }
                  const clip = track.clips[0];
                  dispatch({ type: "SET_STEM_SEPARATOR_CLIP", payload: clip.id });
                  setHistory(prev => [...prev, { role: 'assistant', content: `Opening the AI Stem Separation Studio for "${clip.audioData || 'Audio Clip'}". Select which instruments you want to extract!` }]);
              }}
              className="bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.08] rounded-lg p-2 flex flex-col items-center justify-center gap-1 transition backdrop-blur-sm"
            >
              <SplitSquareHorizontal size={16} className="text-blue-400" />
              <span className="text-[10px] text-gray-300">Stem Separation</span>
            </button>
            <button
              onClick={async () => {
                 const desc = prompt.trim();
                 if (!desc) {
                   setHistory(prev => [...prev, { role: 'assistant', content: "Type what you'd like me to generate first (e.g. \"lofi piano loop, 90 bpm\"), then tap Generate Track." }]);
                   return;
                 }
                 setPrompt('');
                 setHistory(prev => [...prev, { role: 'user', content: `Generate a track: ${desc}` }]);
                 const result = await generateMusicClip(`Generate a high-fidelity audio track. ${desc}`, 'copilot');
                 if (!result) {
                   setHistory(prev => [...prev, { role: 'assistant', content: "I couldn't generate that track — check your Gemini API key in Settings and try again." }]);
                   return;
                 }
                 await saveAsset(result.clipId, result.file);
                 uploadAssetCloud(result.clipId, result.file).catch(() => {});
                 const trackId = 'ai_' + Date.now();
                 dispatch({
                   type: 'ADD_TRACK',
                   payload: {
                     id: trackId,
                     name: 'AI Generated',
                     volume: 0.8,
                     pan: 0,
                     muted: false,
                     solo: false,
                     color: '#ff00ff',
                     clips: [],
                     lanes: [],
                     showLanes: false,
                   }
                 });
                 dispatch({
                   type: 'ADD_CLIP',
                   payload: {
                     trackId,
                     clip: {
                       id: result.clipId,
                       bufferId: result.clipId,
                       start: state.currentTime,
                       duration: result.duration,
                       audioData: desc.slice(0, 40),
                     }
                   }
                 });
                 setHistory(prev => [...prev, { role: 'assistant', content: `Done — generated "${desc}" and placed it on a new track.` }]);
              }}
              className="bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.08] rounded-lg p-2 flex flex-col items-center justify-center gap-1 transition backdrop-blur-sm"
            >
              <Layers size={16} className="text-pink-400" />
              <span className="text-[10px] text-gray-300">Generate Track</span>
            </button>
            <button
              onClick={async () => {
                 const desc = prompt.trim();
                 if (!desc) {
                   setHistory(prev => [...prev, { role: 'assistant', content: "Describe the vibe first (e.g. \"dark synthwave, 80 bpm, analog\"), then tap Style Sheet." }]);
                   return;
                 }
                 setPrompt('');
                 setHistory(prev => [...prev, { role: 'user', content: `Style sheet: ${desc}` }]);
                 const result = await generateStyleSheet(desc);
                 setHistory(prev => [...prev, { role: 'assistant', content: result || "I couldn't generate a style sheet for that." }]);
              }}
              className="bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.08] rounded-lg p-2 flex flex-col items-center justify-center gap-1 transition backdrop-blur-sm"
            >
              <Wand2 size={16} className="text-amber-400" />
              <span className="text-[10px] text-gray-300">Style Sheet</span>
            </button>
            <button
              onClick={async () => {
                 const theme = prompt.trim();
                 if (!theme) {
                   setHistory(prev => [...prev, { role: 'assistant', content: "Give me a theme first (e.g. \"leaving home at eighteen\"), then tap Write Lyrics." }]);
                   return;
                 }
                 setPrompt('');
                 setHistory(prev => [...prev, { role: 'user', content: `Write lyrics: ${theme}` }]);
                 const result = await generateLyrics(theme);
                 setHistory(prev => [...prev, { role: 'assistant', content: result || "I couldn't generate lyrics for that." }]);
              }}
              className="bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.08] rounded-lg p-2 flex flex-col items-center justify-center gap-1 transition backdrop-blur-sm"
            >
              <Wand2 size={16} className="text-emerald-400" />
              <span className="text-[10px] text-gray-300">Write Lyrics</span>
            </button>
          </div>

          {/* Chat history */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {history.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[90%] p-3 rounded-xl text-sm ${
                  msg.role === 'user'
                    ? 'bg-white/[0.10] text-white border border-white/[0.08]'
                    : 'bg-primary/[0.12] text-gray-200 border border-primary/20'
                }`}>
                  <div className="text-xs font-semibold mb-1 opacity-50">{msg.role === 'user' ? 'You' : 'Audio AI'}</div>
                  <div className="whitespace-pre-wrap font-sans text-xs leading-5">
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
            {(isGenerating || isGeneratingLocal) && (
              <div className="flex space-x-2 items-center text-primary text-xs">
                <div className="w-2 h-2 rounded-full bg-current animate-bounce" />
                <div className="w-2 h-2 rounded-full bg-current animate-bounce delay-75" />
                <div className="w-2 h-2 rounded-full bg-current animate-bounce delay-150" />
              </div>
            )}
            {error && <div className="text-xs text-red-500">{error}</div>}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-white/[0.06]">
            <div className="relative">
              <input
                type="text"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Ask for mixing advice..."
                className="w-full bg-white/[0.06] border border-white/[0.10] rounded-full py-2 px-4 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-primary/40 transition backdrop-blur-sm"
              />
              <button 
                onClick={handleSend}
                disabled={isGenerating || !prompt.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-black disabled:opacity-50 transition"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>
        </div>
      </LiquidGlassPanel>
    </div>
  );
}
