import { type AnalogMasterSettings } from './analogMaster';

// User-created Analog Master presets, persisted in the browser (localStorage).
const KEY = 'jaad_analog_presets';

const REQUIRED_FIELDS = ['mix', 'saturation', 'exciter', 'exciterFreq', 'width', 'air', 'warmth', 'deHarsh', 'outputGain'];

function isValidSettings(v: unknown): v is AnalogMasterSettings {
  return !!v && typeof v === 'object' && REQUIRED_FIELDS.every((k) => Number.isFinite((v as Record<string, unknown>)[k]));
}

export function loadCustomPresets(): Record<string, AnalogMasterSettings> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const parsed = raw ? JSON.parse(raw) : {};
    // Only keep well-formed presets — a corrupt/tampered entry with a missing
    // numeric field would propagate NaN through the DSP and corrupt the audio.
    const out: Record<string, AnalogMasterSettings> = {};
    for (const [name, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidSettings(v)) out[name] = v;
    }
    return out;
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
