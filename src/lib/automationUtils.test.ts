import { describe, it, expect, vi } from "vitest";
import {
  AutomationPoint,
  AUTOMATION_RANGES,
  clampAutomationValue,
  combineAutomation,
  emptyAutomation,
  sampleAutomation,
  scheduleAutomationCurve,
  sortAutomationPoints,
} from "./automationUtils";

describe("sampleAutomation", () => {
  const curve: AutomationPoint[] = [
    { time: 2, value: 0.2 },
    { time: 4, value: 1.0 },
    { time: 8, value: 0.5 },
  ];

  it("returns the default value for an empty or missing curve", () => {
    expect(sampleAutomation([], 3, 0.75)).toBe(0.75);
    expect(sampleAutomation(undefined, 3, -1)).toBe(-1);
  });

  it("holds the first point's value before the curve starts", () => {
    expect(sampleAutomation(curve, 0, 1)).toBe(0.2);
    expect(sampleAutomation(curve, 2, 1)).toBe(0.2);
  });

  it("holds the last point's value after the curve ends", () => {
    expect(sampleAutomation(curve, 8, 1)).toBe(0.5);
    expect(sampleAutomation(curve, 100, 1)).toBe(0.5);
  });

  it("returns exact breakpoint values at their times", () => {
    expect(sampleAutomation(curve, 4, 1)).toBe(1.0);
  });

  it("linearly interpolates between breakpoints", () => {
    // Midpoint of 0.2 -> 1.0 segment
    expect(sampleAutomation(curve, 3, 1)).toBeCloseTo(0.6, 10);
    // Quarter into the 1.0 -> 0.5 segment (4s..8s)
    expect(sampleAutomation(curve, 5, 1)).toBeCloseTo(0.875, 10);
  });

  it("handles coincident point times without dividing by zero", () => {
    const stepped: AutomationPoint[] = [
      { time: 1, value: 0 },
      { time: 1, value: 1 },
      { time: 3, value: 1 },
    ];
    expect(Number.isFinite(sampleAutomation(stepped, 1, 0))).toBe(true);
  });
});

describe("sortAutomationPoints / clampAutomationValue / emptyAutomation", () => {
  it("sorts points ascending by time without mutating the input", () => {
    const input: AutomationPoint[] = [
      { time: 5, value: 1 },
      { time: 1, value: 0 },
      { time: 3, value: 0.5 },
    ];
    const sorted = sortAutomationPoints(input);
    expect(sorted.map((p) => p.time)).toEqual([1, 3, 5]);
    expect(input.map((p) => p.time)).toEqual([5, 1, 3]); // untouched
  });

  it("clamps volume to [0, 1] and pan to [-1, 1]", () => {
    expect(clampAutomationValue("volume", -0.5)).toBe(0);
    expect(clampAutomationValue("volume", 1.5)).toBe(1);
    expect(clampAutomationValue("volume", 0.7)).toBe(0.7);
    expect(clampAutomationValue("pan", -2)).toBe(-1);
    expect(clampAutomationValue("pan", 2)).toBe(1);
    expect(clampAutomationValue("pan", 0.25)).toBe(0.25);
  });

  it("provides neutral defaults (unity volume, centered pan)", () => {
    expect(AUTOMATION_RANGES.volume.defaultValue).toBe(1);
    expect(AUTOMATION_RANGES.pan.defaultValue).toBe(0);
    expect(emptyAutomation()).toEqual({ volume: [], pan: [] });
  });
});

describe("combineAutomation", () => {
  it("multiplies volume automation with the fader value", () => {
    expect(combineAutomation("volume", 0.8, 0.5)).toBeCloseTo(0.4, 10);
    expect(combineAutomation("volume", 0.8, 1)).toBeCloseTo(0.8, 10); // unity passes the fader through
    expect(combineAutomation("volume", 0.8, 0)).toBe(0);
  });

  it("adds pan automation to the knob position and clamps the result", () => {
    expect(combineAutomation("pan", 0.5, 0.25)).toBeCloseTo(0.75, 10);
    expect(combineAutomation("pan", 0.5, 1)).toBe(1); // clamped
    expect(combineAutomation("pan", -0.5, -1)).toBe(-1); // clamped
    expect(combineAutomation("pan", -0.25, 0)).toBeCloseTo(-0.25, 10); // neutral keeps the knob
  });
});

describe("scheduleAutomationCurve", () => {
  const makeParam = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });

  const curve: AutomationPoint[] = [
    { time: 2, value: 0.2 },
    { time: 4, value: 1.0 },
    { time: 8, value: 0.5 },
  ];

  it("pins the interpolated start value and ramps to every future point", () => {
    const param = makeParam();
    // Start mid-segment at project time 3s, context time 10s, fader 0.8
    scheduleAutomationCurve(param, curve, 3, 10, 1.0, 1, (v) => 0.8 * v);

    // sample at 3s = 0.6 -> combined 0.48
    expect(param.setValueAtTime).toHaveBeenCalledTimes(1);
    const [startValue, startTime] = param.setValueAtTime.mock.calls[0];
    expect(startValue).toBeCloseTo(0.48, 10);
    expect(startTime).toBe(10);

    // Only the points at 4s and 8s are in the future; project deltas map 1:1
    expect(param.linearRampToValueAtTime).toHaveBeenCalledTimes(2);
    const calls = param.linearRampToValueAtTime.mock.calls;
    expect(calls[0][0]).toBeCloseTo(0.8, 10); // 1.0 * 0.8
    expect(calls[0][1]).toBeCloseTo(11, 10); // 10 + (4 - 3)
    expect(calls[1][0]).toBeCloseTo(0.4, 10); // 0.5 * 0.8
    expect(calls[1][1]).toBeCloseTo(15, 10); // 10 + (8 - 3)
  });

  it("divides project-time deltas by the playback rate", () => {
    const param = makeParam();
    scheduleAutomationCurve(param, curve, 0, 5, 2.0, 1, (v) => v);

    const calls = param.linearRampToValueAtTime.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0][1]).toBeCloseTo(5 + 2 / 2, 10);
    expect(calls[1][1]).toBeCloseTo(5 + 4 / 2, 10);
    expect(calls[2][1]).toBeCloseTo(5 + 8 / 2, 10);
  });

  it("uses the default value (combined) when the curve is empty", () => {
    const param = makeParam();
    scheduleAutomationCurve(param, [], 0, 0, 1.0, 1, (v) => 0.8 * v);
    expect(param.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(0.8, 10), 0);
    expect(param.linearRampToValueAtTime).not.toHaveBeenCalled();
  });

  it("schedules no ramps when starting after the last point", () => {
    const param = makeParam();
    scheduleAutomationCurve(param, curve, 20, 0, 1.0, 1, (v) => v);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
    expect(param.linearRampToValueAtTime).not.toHaveBeenCalled();
  });

  it("treats a non-positive rate as 1.0", () => {
    const param = makeParam();
    scheduleAutomationCurve(param, curve, 0, 0, 0, 1, (v) => v);
    expect(param.linearRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(2, 10);
  });
});
