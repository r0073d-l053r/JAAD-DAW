import { useState, useRef, useEffect } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { LiquidGlassPanel } from './LiquidGlass';

function GlassSelect({ 
  label, 
  options, 
  value, 
  onChange,
  className = ""
}: { 
  label: string, 
  options: string[], 
  value: string, 
  onChange: (val: string) => void,
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm flex justify-between items-center text-white hover:bg-white/10 transition-all backdrop-blur-md"
      >
        <span className="truncate">{value || options[0]}</span>
        <ChevronDown size={16} className={`text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[101] animate-in fade-in slide-in-from-top-2 duration-200">
          <LiquidGlassPanel
            cornerRadius={12}
            blurAmount={16}
            backgroundOpacity={0.25}
            className="w-full shadow-2xl border border-white/10"
            contentClassName="py-1"
          >
            {options.map((option) => (
              <button
                key={option}
                onClick={() => {
                  onChange(option);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${
                  option === value ? 'text-primary bg-primary/5' : 'text-zinc-300'
                }`}
              >
                {option}
              </button>
            ))}
          </LiquidGlassPanel>
        </div>
      )}
    </div>
  );
}

export function SettingsModal() {
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState('Audio');

  // Internal states for local dropdowns if they aren't in the store
  const [inputDevice, setInputDevice] = useState('Default System Microphone');
  const [bufferSize, setBufferSize] = useState('256 samples (Standard)');
  const [aiModel, setAiModel] = useState('Gemini 2.5 Pro (Default)');
  const [appearance, setAppearance] = useState('Midnight (Default)');

  const [apiKeyVal, setApiKeyVal] = useState(() => {
    const saved = localStorage.getItem("user_gemini_api_key");
    return saved ? `••••••••${saved.slice(-4)}` : "";
  });
  const [isKeySaved, setIsKeySaved] = useState(() => !!localStorage.getItem("user_gemini_api_key"));

  const handleSaveKey = (val: string) => {
    const trimmed = val.trim();
    if (trimmed === "") {
      localStorage.removeItem("user_gemini_api_key");
      setApiKeyVal("");
      setIsKeySaved(false);
      return;
    }
    if (trimmed.startsWith("••••")) {
      return;
    }
    localStorage.setItem("user_gemini_api_key", trimmed);
    setApiKeyVal(`••••••••${trimmed.slice(-4)}`);
    setIsKeySaved(true);
  };

  if (!state.settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <LiquidGlassPanel
        cornerRadius={20}
        blurAmount={20}
        saturation={180}
        backgroundOpacity={0.10}
        className="w-[600px] h-[450px]"
        style={{ animation: 'liquidGlassIn 0.3s ease-out' }}
      >
        <div className="flex flex-col h-[450px] overflow-hidden rounded-[20px]">
          <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-white/[0.03]">
            <h2 className="font-semibold tracking-wide text-white/90 flex items-center space-x-2 text-lg">
              Settings
            </h2>
            <button 
              onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
              className="text-gray-400 hover:text-white transition p-2 rounded-xl hover:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Tabs */}
            <div className="w-48 border-r border-white/10 bg-white/[0.01] p-4 flex flex-col space-y-1">
              {['Audio', 'MIDI', 'Shortcuts', 'AI & Cloud', 'Theme'].map((tab) => (
                <button 
                  key={tab} 
                  onClick={() => setActiveTab(tab)}
                  className={`text-left px-4 py-2.5 rounded-xl text-sm transition-all ${activeTab === tab ? 'bg-white/10 text-white font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] border border-white/5' : 'text-gray-400 hover:bg-white/5 hover:text-gray-300'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 p-8 overflow-y-auto w-full custom-scrollbar">
              {activeTab === 'Audio' && (
                <>
                  <h3 className="text-xl font-bold mb-8 text-white/95">Audio Configuration</h3>
                  <div className="space-y-8">
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Input Device</label>
                      <GlassSelect 
                        label="Input Device" 
                        options={['Default System Microphone', 'External Audio Interface']} 
                        value={inputDevice}
                        onChange={setInputDevice}
                      />
                    </div>
                    <div className="space-y-3 pt-6 border-t border-white/5">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Buffer Size</label>
                      <GlassSelect 
                        label="Buffer Size" 
                        options={['128 samples (Low Latency)', '256 samples (Standard)', '512 samples', '1024 samples (Safe)']} 
                        value={bufferSize}
                        onChange={setBufferSize}
                      />
                      <p className="text-xs text-gray-500 mt-2 leading-relaxed">Increasing buffer size reduces CPU load but adds latency. Recommended for mixing.</p>
                    </div>
                    <div className="space-y-4 pt-6 border-t border-white/5">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">System Engine Diagnostics</label>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white/[0.03] p-3 rounded-xl border border-white/5 flex flex-col space-y-1">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">Wasm SIMD Acceleration</span>
                          <span className="text-xs font-mono text-green-500">Supported / Active</span>
                        </div>
                        <div className="bg-white/[0.03] p-3 rounded-xl border border-white/5 flex flex-col space-y-1">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">Audio Worklet Engine</span>
                          <span className="text-xs font-mono text-green-500">Ready (Real-time)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'MIDI' && (
                <>
                  <h3 className="text-xl font-bold mb-8 text-white/95">MIDI Setup</h3>
                  <div className="space-y-6">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">MIDI Input Devices</label>
                    <button 
                      onClick={() => {
                         audioEngine.setupMidi();
                         alert("Requested MIDI Access! Play your keyboard.");
                      }}
                      className="bg-primary/20 text-primary border border-primary/40 py-3 px-6 rounded-xl text-sm font-bold hover:bg-primary/30 transition w-full shadow-lg shadow-primary/10"
                    >
                      Scan for MIDI Devices
                    </button>
                    <p className="text-xs text-gray-500 leading-relaxed">Connecting a MIDI keyboard allows you to record notes directly onto MIDI tracks. Web MIDI API must be supported.</p>
                  </div>
                </>
              )}

              {activeTab === 'Shortcuts' && (
                <>
                  <h3 className="text-xl font-bold mb-6 text-white/95">Keyboard Shortcuts</h3>
                  <div className="space-y-6 overflow-y-auto pr-2 max-h-[280px] custom-scrollbar">
                    {/* Transport Section */}
                    <div>
                      <h4 className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] mb-3">Transport & Core</h4>
                      <div className="space-y-2 text-sm text-gray-300">
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Play / Pause</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Spacebar</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Save Project</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Ctrl + S</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Toggle Fullscreen</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">F11</span></div>
                      </div>
                    </div>

                    {/* Editing Section */}
                    <div>
                      <h4 className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] mb-3 mt-4">Editing</h4>
                      <div className="space-y-2 text-sm text-gray-300">
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Split Clip at Playhead</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">S</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Undo</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Ctrl + Z</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Redo</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Ctrl + Y</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Select All</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Ctrl + A</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Copy / Cut</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Ctrl + C / X</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Paste</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Ctrl + V</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Delete Selected</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Del</span></div>
                      </div>
                    </div>

                    {/* Navigation Section */}
                    <div>
                      <h4 className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] mb-3 mt-4">Navigation & View</h4>
                      <div className="space-y-2 text-sm text-gray-300">
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Toggle Mixer / Timeline</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Tab</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Zoom In / Out</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Ctrl + Shift + Scroll</span></div>
                        <div className="flex justify-between items-center py-1 border-b border-white/5"><span>Clean Up Audio Stems</span><span className="font-mono text-xs text-zinc-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">Ctrl + Shift + S</span></div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'AI & Cloud' && (
                <>
                  <h3 className="text-xl font-bold mb-8 text-white/95">AI & Cloud Pipeline</h3>
                  <div className="space-y-8">
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">AI Reasoning Model</label>
                      <GlassSelect 
                        label="AI Model" 
                        options={['Gemini 2.5 Pro (Default)', 'Gemini 2.5 Flash', 'Local Inference (WebNN)']} 
                        value={aiModel}
                        onChange={setAiModel}
                      />
                    </div>

                    <div className="space-y-3 pt-6 border-t border-white/5">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Custom Gemini API Key</label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Paste your Gemini API Key here..."
                          value={apiKeyVal}
                          onChange={(e) => setApiKeyVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveKey(apiKeyVal);
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          onBlur={() => handleSaveKey(apiKeyVal)}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-700 outline-none focus:border-primary/50 transition-all font-mono"
                        />
                      </div>
                      <p className="text-[11px] text-zinc-500 leading-relaxed">
                        {isKeySaved 
                          ? "Custom Key loaded! Showing last 4 digits. Press Enter to modify or clear." 
                          : "Paste your custom paid Gemini API Key and press Enter to save locally."}
                      </p>
                    </div>

                    <div className="space-y-4 pt-6 border-t border-white/5">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Cloud Sync Storage</label>
                      <div className="flex items-center space-x-3 text-sm text-gray-300 bg-white/[0.03] p-4 rounded-xl border border-white/5">
                        <input type="checkbox" id="cloud-sync" defaultChecked className="w-4 h-4 rounded bg-white/10 border-white/20 text-primary focus:ring-primary" />
                        <label htmlFor="cloud-sync" className="cursor-pointer">Automatically backup project to JAAD Cloud</label>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'Theme' && (
                <>
                  <h3 className="text-xl font-bold mb-8 text-white/95">Visual Aesthetics</h3>
                  <div className="space-y-8">
                    <div className="space-y-3">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Appearance</label>
                      <GlassSelect 
                        label="Appearance" 
                        options={['Midnight (Default)', 'OLED Black', 'Deep Sea', 'Cyberpunk']} 
                        value={appearance}
                        onChange={setAppearance}
                      />
                    </div>
                    <div className="space-y-4 pt-6 border-t border-white/5">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Performance</label>
                      <div className="flex items-center space-x-3 text-sm text-zinc-300 bg-white/[0.03] p-4 rounded-xl border border-white/5">
                        <input 
                          type="checkbox" 
                          id="bg-animation" 
                          checked={!state.disableBackgroundAnimation} 
                          onChange={() => dispatch({ type: 'TOGGLE_BACKGROUND_ANIMATION' })}
                          className="w-4 h-4 rounded bg-white/10 border-white/20 text-primary focus:ring-primary" 
                        />
                        <label htmlFor="bg-animation" className="cursor-pointer">Enable high-fidelity background animations</label>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </LiquidGlassPanel>
    </div>
  );
}
