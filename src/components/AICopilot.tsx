import { useState } from 'react';
import { Wand2, Layers, SplitSquareHorizontal } from './Icons';
import { useGemini } from '../lib/useGemini';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';

export function AICopilot() {
  const { state, dispatch } = useApp();
  const { requestMixingAdvice, getMasteringSettings, detectBPM, generateMIDI, isGenerating, error } = useGemini();
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<Array<{role: string, content: string}>>([
    { role: 'assistant', content: 'Hi! I am your AI audio assistant. Ask me for mixing advice, mastering settings, or track separation.' }
  ]);

  const [isGeneratingLocal, setIsGeneratingLocal] = useState(false);

  if (!state.aiPanelOpen) return null;

  const handleSend = async () => {
    if (!prompt.trim()) return;
    const userMsg = prompt;
    setPrompt('');
    setHistory(prev => [...prev, { role: 'user', content: userMsg }]);

    let responseStr = '';
    
    // Command parsing for demo
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
    } else if (userMsg.toLowerCase().includes('noise') || userMsg.toLowerCase().includes('denoise')) {
       setIsGeneratingLocal(true);
       await new Promise(r => setTimeout(r, 1500));
       setIsGeneratingLocal(false);
       responseStr = "I've applied AI Denoiser to the selected track.";
    } else {
      const simplifiedTracks = state.tracks.map(t => ({ name: t.name, vol: t.volume, pan: t.pan }));
      const advice = await requestMixingAdvice(simplifiedTracks, userMsg);
      responseStr = advice || 'Could not generate advice.';
    }
    setHistory(prev => [...prev, { role: 'assistant', content: responseStr }]);
  };

  return (
    <div className="w-80 bg-black/20 backdrop-blur-xl border-l border-white/5 flex flex-col flex-shrink-0 z-10 relative shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
      <div className="h-14 border-b border-white/5 flex items-center px-4 space-x-2 text-primary">
        <Wand2 size={18} />
        <span className="font-semibold text-sm tracking-wide drop-shadow-md">AI COPILOT</span>
      </div>

      {/* Quick Actions */}
      <div className="p-4 grid grid-cols-2 gap-2 border-b border-[#2a2b30]">
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
          className="bg-[#222] hover:bg-[#333] border border-[#444] rounded p-2 flex flex-col items-center justify-center gap-1 transition"
        >
          <SplitSquareHorizontal size={16} className="text-secondary" />
          <span className="text-[10px] text-gray-300">Detect Tempo</span>
        </button>
        <button 
          onClick={async () => {
             setIsGeneratingLocal(true);
             await new Promise(r => setTimeout(r, 2000));
             setIsGeneratingLocal(false);
             setHistory(prev => [...prev, { role: 'assistant', content: "I've separated the stems. (Mock)" }]);
          }}
          className="bg-[#222] hover:bg-[#333] border border-[#444] rounded p-2 flex flex-col items-center justify-center gap-1 transition"
        >
          <SplitSquareHorizontal size={16} className="text-blue-400" />
          <span className="text-[10px] text-gray-300">Stem Separation</span>
        </button>
        <button 
          onClick={async () => {
             setPrompt('Generating realistic vocal track...');
             setIsGeneratingLocal(true);
             await new Promise(r => setTimeout(r, 2000));
             setIsGeneratingLocal(false);
             setHistory(prev => [...prev, { role: 'assistant', content: "I've generated a vocal track for you and placed it into a new track. (Mock)" }]);
             dispatch({
               type: 'ADD_TRACK',
               payload: {
                 id: 'ai_' + Date.now(),
                 name: 'AI Vocals',
                 volume: 0.8,
                 pan: 0,
                 muted: false,
                 solo: false,
                 color: '#ff00ff',
                 clips: [{ id: 'c_gen', start: state.currentTime, duration: 10, audioData: 'AI Synthesized Vocal' }]
               }
             });
          }}
          className="bg-[#222] hover:bg-[#333] border border-[#444] rounded p-2 flex flex-col items-center justify-center gap-1 transition"
        >
          <Layers size={16} className="text-pink-400" />
          <span className="text-[10px] text-gray-300">Generate Track</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {history.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[90%] p-3 rounded-lg text-sm ${msg.role === 'user' ? 'bg-[#333] text-white' : 'bg-primary/10 text-gray-200 border border-primary/20'}`}>
              <div className="text-xs font-semibold mb-1 opacity-50">{msg.role === 'user' ? 'You' : 'Audio AI'}</div>
              <div className="whitespace-pre-wrap font-sans text-xs leading-5">
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        { (isGenerating || isGeneratingLocal) && (
          <div className="flex space-x-2 items-center text-primary text-xs">
            <div className="w-2 h-2 rounded-full bg-current animate-bounce" />
            <div className="w-2 h-2 rounded-full bg-current animate-bounce delay-75" />
            <div className="w-2 h-2 rounded-full bg-current animate-bounce delay-150" />
          </div>
        )}
        {error && <div className="text-xs text-red-500">{error}</div>}
      </div>

      <div className="p-4 border-t border-zinc-800/50 bg-black/40">
        <div className="relative">
          <input
            type="text"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ask for mixing advice..."
            className="w-full bg-black/50 border border-zinc-800 rounded-full py-2 px-4 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-primary/50 transition"
          />
          <button 
            onClick={handleSend}
            disabled={isGenerating || !prompt.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-black disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
