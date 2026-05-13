import { useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';


export function SettingsModal() {
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState('Audio');

  if (!state.settingsOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="w-[600px] h-[400px] bg-[#151619] border border-[#2a2b30] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="h-14 border-b border-[#2a2b30] flex items-center justify-between px-6">
          <h2 className="font-semibold tracking-wide flex items-center space-x-2">
            Settings
          </h2>
          <button 
            onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
            className="text-gray-500 hover:text-white transition"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Tabs */}
          <div className="w-48 border-r border-[#2a2b30] bg-[#111] p-4 flex flex-col space-y-2">
            {['Audio', 'MIDI', 'Shortcuts', 'AI & Cloud', 'Theme'].map((tab) => (
              <button 
                key={tab} 
                onClick={() => setActiveTab(tab)}
                className={`text-left px-3 py-2 rounded text-sm ${activeTab === tab ? 'bg-primary/10 text-primary font-medium' : 'text-gray-400 hover:bg-white/5'}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto w-full">
            {activeTab === 'Audio' && (
              <>
                <h3 className="text-lg font-medium mb-6">Device Settings</h3>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Input Device</label>
                    <select className="w-full bg-[#0a0a0c] border border-[#333] rounded px-3 py-2 text-sm focus:border-primary outline-none text-white">
                      <option>Default System Microphone</option>
                      <option>External Audio Interface</option>
                    </select>
                  </div>
                  <div className="space-y-2 pt-4 border-t border-[#333]">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Buffer Size</label>
                    <select defaultValue="256 samples (Standard)" className="w-full bg-[#0a0a0c] border border-[#333] rounded px-3 py-2 text-sm focus:border-primary outline-none text-white">
                      <option>128 samples (Low Latency)</option>
                      <option>256 samples (Standard)</option>
                      <option>512 samples</option>
                      <option>1024 samples (Safe)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Increasing buffer size reduces CPU load but adds latency.</p>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'MIDI' && (
              <>
                <h3 className="text-lg font-medium mb-6">MIDI Setup</h3>
                <div className="space-y-4">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">MIDI Input Devices</label>
                  <button 
                    onClick={() => {
                       audioEngine.setupMidi();
                       alert("Requested MIDI Access! Play your keyboard.");
                    }}
                    className="bg-primary/20 text-primary border border-primary/50 py-2 px-4 rounded text-sm hover:bg-primary/30 transition w-full"
                  >
                    Connect / Refresh MIDI Devices
                  </button>
                  <p className="text-xs text-gray-500 mt-2">Connecting a MIDI keyboard allows you to record notes directly onto MIDI tracks.</p>
                </div>
              </>
            )}

            {activeTab === 'Shortcuts' && (
              <>
                <h3 className="text-lg font-medium mb-6">Keyboard Shortcuts</h3>
                <div className="space-y-3 text-sm text-gray-300">
                   <div className="flex justify-between border-b border-[#222] pb-1"><span>Play/Pause</span><span className="font-mono text-gray-500">Spacebar</span></div>
                   <div className="flex justify-between border-b border-[#222] pb-1"><span>Split Clip</span><span className="font-mono text-gray-500">S</span></div>
                   <div className="flex justify-between border-b border-[#222] pb-1"><span>Undo</span><span className="font-mono text-gray-500">Ctrl/Cmd + Z</span></div>
                   <div className="flex justify-between border-b border-[#222] pb-1"><span>Redo</span><span className="font-mono text-gray-500">Ctrl/Cmd + Y</span></div>
                   <div className="flex justify-between border-b border-[#222] pb-1"><span>Copy</span><span className="font-mono text-gray-500">Ctrl/Cmd + C</span></div>
                   <div className="flex justify-between border-b border-[#222] pb-1"><span>Paste</span><span className="font-mono text-gray-500">Ctrl/Cmd + V</span></div>
                   <div className="flex justify-between border-b border-[#222] pb-1"><span>Cut</span><span className="font-mono text-gray-500">Ctrl/Cmd + X</span></div>
                   <div className="flex justify-between border-b border-[#222] pb-1"><span>Delete</span><span className="font-mono text-gray-500">Del</span></div>
                   <div className="flex justify-between pb-1"><span>Toggle Mixer</span><span className="font-mono text-gray-500">Tab</span></div>
                </div>
              </>
            )}

            {activeTab === 'AI & Cloud' && (
              <>
                <h3 className="text-lg font-medium mb-6">AI and Cloud Setup</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">AI Model Backend</label>
                    <select className="w-full bg-[#0a0a0c] border border-[#333] rounded px-3 py-2 text-sm focus:border-primary outline-none text-white">
                      <option>Gemini 2.5 Pro (Default)</option>
                      <option>Gemini 2.5 Flash</option>
                      <option>Local Inference (WebNN - Experimental)</option>
                    </select>
                  </div>
                  <div className="space-y-2 pt-4 border-t border-[#333]">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cloud Sync Storage</label>
                    <div className="flex items-center space-x-2 text-sm text-gray-300">
                      <input type="checkbox" id="cloud-sync" defaultChecked className="rounded bg-[#222] border-[#444] text-primary" />
                      <label htmlFor="cloud-sync">Automatically backup project to GAW Cloud (Firebase)</label>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'Theme' && (
              <>
                <h3 className="text-lg font-medium mb-6">Theme Customization</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Accent Color</label>
                    <div className="flex space-x-2">
                       <div className="w-6 h-6 rounded-full bg-[#f97316] ring-2 ring-white cursor-pointer"></div>
                       <div className="w-6 h-6 rounded-full bg-blue-500 cursor-pointer"></div>
                       <div className="w-6 h-6 rounded-full bg-green-500 cursor-pointer"></div>
                       <div className="w-6 h-6 rounded-full bg-pink-500 cursor-pointer"></div>
                       <div className="w-6 h-6 rounded-full bg-purple-500 cursor-pointer"></div>
                    </div>
                  </div>
                  <div className="space-y-2 pt-4 border-t border-[#333]">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Dark Mode</label>
                    <select className="w-full bg-[#0a0a0c] border border-[#333] rounded px-3 py-2 text-sm focus:border-primary outline-none text-white">
                      <option>Midnight (Default)</option>
                      <option>OLED Black</option>
                      <option>Light Theme (Beta)</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
