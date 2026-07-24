import { type AnalogMasterSettings } from './analogMaster';

// User-created Analog Master presets, persisted in the browser (localStorage).
const KEY = 'jaad_analog_presets';

export function loadCustomPresets(): Record<string, AnalogMasterSettings> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, AnalogMasterSettings>) : {};
  } catch {
    return {};
  }
}

export function saveCustomPreset(name: string, settings: AnalogMasterSettings): Record<string, AnalogMasterSettings> {
  const all = loadCustomPresets();
  all[name] = settings;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota / disabled */ }
  return all;
}

export function deleteCustomPreset(name: string): Record<string, AnalogMasterSettings> {
  const all = loadCustomPresets();
  delete all[name];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* noop */ }
  return all;
}
