/**
 * Track automation curve utilities.
 *
 * A curve is a list of breakpoints `{ time, value }` (time in project
 * seconds) kept sorted by time. Between points the value is linearly
 * interpolated; before the first and after the last point the curve is flat
 * (holds the nearest point's value).
 *
 * Automation never replaces the fader: volume automation MULTIPLIES with the
 * track volume fader, pan automation is ADDED to the pan knob and clamped.
 */

export interface AutomationPoint {
  time: number;
  value: number;
}

export type AutomationParam = "volume" | "pan";

export interface TrackAutomation {
  volume: AutomationPoint[];
  pan: AutomationPoint[];
}

export const AUTOMATION_RANGES: Record<
  AutomationParam,
  { min: number; max: number; defaultValue: number }
> = {
  // 1 = unity (fader value passes through unchanged)
  volume: { min: 0, max: 1, defaultValue: 1 },
  // 0 = no pan offset on top of the knob position
  pan: { min: -1, max: 1, defaultValue: 0 },
};

export function emptyAutomation(): TrackAutomation {
  return { volume: [], pan: [] };
}

/** Clamps a breakpoint value to the legal range for its parameter. */
export function clampAutomationValue(
  param: AutomationParam,
  value: number,
): number {
  const { min, max } = AUTOMATION_RANGES[param];
  return Math.max(min, Math.min(max, value));
}

/** Returns a new array sorted ascending by time (stable for equal times). */
export function sortAutomationPoints(
  points: AutomationPoint[],
): AutomationPoint[] {
  return [...points].sort((a, b) => a.time - b.time);
}

/**
 * Samples a curve at `time` using linear interpolation between breakpoints.
 * The curve is flat before the first and after the last point. An empty (or
 * missing) curve returns `defaultValue`. Points must be sorted by time — the
 * store reducer maintains that invariant.
 */
export function sampleAutomation(
  points: AutomationPoint[] | undefined,
  time: number,
  defaultValue: number,
): number {
  if (!points || points.length === 0) return defaultValue;
  if (time <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (time >= a.time && time <= b.time) {
      if (b.time === a.time) return b.value;
      const t = (time - a.time) / (b.time - a.time);
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/**
 * Combines a fader value with an automation value. Volume multiplies (so the
 * fader scales the whole curve); pan adds an offset to the knob position,
 * clamped to the legal [-1, 1] range.
 */
export function combineAutomation(
  param: AutomationParam,
  faderValue: number,
  automationValue: number,
): number {
  if (param === "volume") {
    return Math.max(0, faderValue * automationValue);
  }
  return Math.max(-1, Math.min(1, faderValue + automationValue));
}

/**
 * Minimal AudioParam surface used by the scheduler — keeps the function
 * testable without a real AudioContext.
 */
export interface SchedulableParam {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
}

/**
 * Schedules a curve onto an AudioParam as linearRampToValueAtTime segments.
 *
 * Pins the interpolated value at `contextStartTime` (which corresponds to
 * project time `fromProjectTime`), then ramps to every breakpoint after that
 * project time. Project-time deltas are divided by `rate` to land on the
 * context clock (mirrors how clip envelopes are scheduled).
 *
 * @param combine maps a raw automation value to the final param value
 *                (e.g. multiplies in the fader volume)
 */
export function scheduleAutomationCurve(
  param: SchedulableParam,
  points: AutomationPoint[],
  fromProjectTime: number,
  contextStartTime: number,
  rate: number,
  defaultValue: number,
  combine: (automationValue: number) => number,
): void {
  const r = rate > 0 ? rate : 1.0;
  const startValue = combine(
    sampleAutomation(points, fromProjectTime, defaultValue),
  );
  param.setValueAtTime(startValue, contextStartTime);
  for (const pt of points) {
    if (pt.time > fromProjectTime) {
      param.linearRampToValueAtTime(
        combine(pt.value),
        contextStartTime + (pt.time - fromProjectTime) / r,
      );
    }
  }
}
