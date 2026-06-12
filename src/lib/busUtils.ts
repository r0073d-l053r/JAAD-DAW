/**
 * Submix/group bus utilities.
 *
 * A Bus is a named gain stage between tracks and the master output:
 * track output -> bus gain -> master. Tracks reference a bus by `busId`
 * (null/undefined = routed straight to master). These helpers are pure so
 * the store reducer, the audio engine and the offline exporters all resolve
 * routing the same way.
 */

import { pickTrackColor } from "./trackColors";

export interface Bus {
  id: string;
  name: string;
  color: string;
  volume: number;
  muted: boolean;
}

/** Unity gain and audible by default. */
export const DEFAULT_BUS_VOLUME = 1.0;

export function generateBusId(): string {
  return (
    "bus_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)
  );
}

/**
 * Picks the first "Bus N" name not already taken, so deleting "Bus 1" and
 * creating a new bus does not produce a duplicate "Bus 2".
 */
export function nextBusName(existing: Bus[]): string {
  const taken = new Set(existing.map((b) => b.name));
  let n = existing.length + 1;
  // Also scan forward from 1 so gaps left by deletes get reused first.
  for (let i = 1; i <= existing.length + 1; i++) {
    if (!taken.has(`Bus ${i}`)) {
      n = i;
      break;
    }
  }
  return `Bus ${n}`;
}

/** Builds a new bus, applying any overrides (tests pass explicit ids). */
export function createBus(existing: Bus[], overrides?: Partial<Bus>): Bus {
  return {
    id: generateBusId(),
    name: nextBusName(existing),
    // Offset into the shared palette so early buses don't mirror early tracks.
    color: pickTrackColor(existing.length + 5),
    volume: DEFAULT_BUS_VOLUME,
    muted: false,
    ...(overrides || {}),
  };
}

/**
 * Resolves a track's bus assignment against the current bus list. Returns the
 * bus id only when that bus still exists; otherwise null (master). This is
 * the single source of truth for "where does this track's output go".
 */
export function resolveTrackBusId(
  busId: string | null | undefined,
  buses: Pick<Bus, "id">[],
): string | null {
  if (!busId) return null;
  return buses.some((b) => b.id === busId) ? busId : null;
}

/** The bus entity a track routes through, or null for master. */
export function getBusForTrack(
  track: { busId?: string | null },
  buses: Bus[],
): Bus | null {
  const id = resolveTrackBusId(track.busId, buses);
  if (!id) return null;
  return buses.find((b) => b.id === id) || null;
}

/**
 * The effective gain a bus stage applies: 0 when muted, otherwise its fader
 * volume. Master routing (no bus) is unity.
 */
export function busGainValue(
  bus: Pick<Bus, "volume" | "muted"> | null | undefined,
): number {
  if (!bus) return 1;
  return bus.muted ? 0 : Math.max(0, bus.volume);
}
