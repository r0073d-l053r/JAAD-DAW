import { describe, it, expect } from 'vitest';
import {
  appReducer,
  initialState,
  Marker,
  Track,
  Clip,
  AppStateWithHistory,
  MAX_HISTORY_ENTRIES,
} from './store';

const makeTrack = (id: string, clips: Clip[] = []): Track => ({
  id,
  name: `Track ${id}`,
  volume: 0.8,
  pan: 0,
  muted: false,
  solo: false,
  color: '#3b82f6',
  clips,
  lanes: [],
  showLanes: false,
});

const makeClip = (
  id: string,
  start: number,
  duration: number,
  extra: Partial<Clip> = {}
): Clip => ({ id, start, duration, ...extra });

describe('Store reducer marker actions', () => {
  it('should add markers and keep them sorted chronologically', () => {
    let state = { ...initialState, markers: [] as Marker[] };

    // Add first marker at 5.0 seconds
    state = appReducer(state, {
      type: 'ADD_MARKER',
      payload: { time: 5.0, label: 'Chorus' }
    });

    expect(state.markers).toHaveLength(1);
    expect(state.markers[0].label).toBe('Chorus');
    expect(state.markers[0].time).toBe(5.0);
    expect(state.markers[0].color).toBe('#3b82f6'); // Default color

    // Add second marker at 2.5 seconds (earlier)
    state = appReducer(state, {
      type: 'ADD_MARKER',
      payload: { time: 2.5, label: 'Intro', color: '#10b981' }
    });

    expect(state.markers).toHaveLength(2);
    // Should be sorted chronologically: [2.5s, 5.0s]
    expect(state.markers[0].label).toBe('Intro');
    expect(state.markers[0].time).toBe(2.5);
    expect(state.markers[0].color).toBe('#10b981');
    expect(state.markers[1].label).toBe('Chorus');
    expect(state.markers[1].time).toBe(5.0);
  });

  it('should remove markers successfully', () => {
    let state = { ...initialState, markers: [] as Marker[] };

    state = appReducer(state, {
      type: 'ADD_MARKER',
      payload: { time: 1.0, label: 'Intro' }
    });
    state = appReducer(state, {
      type: 'ADD_MARKER',
      payload: { time: 10.0, label: 'Outro' }
    });

    expect(state.markers).toHaveLength(2);
    const firstMarkerId = state.markers[0].id;

    // Remove the first marker
    state = appReducer(state, {
      type: 'REMOVE_MARKER',
      payload: firstMarkerId
    });

    expect(state.markers).toHaveLength(1);
    expect(state.markers[0].label).toBe('Outro');
  });

  it('should update markers and resort when time shifts', () => {
    let state = { ...initialState, markers: [] as Marker[] };

    state = appReducer(state, {
      type: 'ADD_MARKER',
      payload: { time: 2.0, label: 'Intro' }
    });
    state = appReducer(state, {
      type: 'ADD_MARKER',
      payload: { time: 8.0, label: 'Chorus' }
    });

    const introId = state.markers[0].id;

    // Update label and color of intro
    state = appReducer(state, {
      type: 'UPDATE_MARKER',
      payload: {
        id: introId,
        changes: { label: 'Intro Extended', color: '#ef4444' }
      }
    });

    expect(state.markers[0].label).toBe('Intro Extended');
    expect(state.markers[0].color).toBe('#ef4444');

    // Shift time of intro to be LATER than chorus (2.0s -> 10.0s)
    state = appReducer(state, {
      type: 'UPDATE_MARKER',
      payload: {
        id: introId,
        changes: { time: 10.0 }
      }
    });

    // Should resort: Chorus (8.0s) first, Intro Extended (10.0s) second
    expect(state.markers[0].label).toBe('Chorus');
    expect(state.markers[1].label).toBe('Intro Extended');
  });

  it('should navigate to next and previous markers relative to playhead', () => {
    let state = { ...initialState, markers: [] as Marker[], currentTime: 0 };

    state = appReducer(state, { type: 'ADD_MARKER', payload: { time: 2.0, label: 'M1' } });
    state = appReducer(state, { type: 'ADD_MARKER', payload: { time: 5.0, label: 'M2' } });
    state = appReducer(state, { type: 'ADD_MARKER', payload: { time: 9.0, label: 'M3' } });

    // Initial position: 0.0s
    // Go to next marker -> M1 at 2.0s
    state = appReducer(state, { type: 'GO_TO_NEXT_MARKER' });
    expect(state.currentTime).toBe(2.0);

    // Go to next marker -> M2 at 5.0s
    state = appReducer(state, { type: 'GO_TO_NEXT_MARKER' });
    expect(state.currentTime).toBe(5.0);

    // Go to prev marker -> M1 at 2.0s
    state = appReducer(state, { type: 'GO_TO_PREV_MARKER' });
    expect(state.currentTime).toBe(2.0);

    // Go to prev marker from 2.0s -> no marker before 2.0s -> remains at 2.0s
    state = appReducer(state, { type: 'GO_TO_PREV_MARKER' });
    expect(state.currentTime).toBe(2.0);

    // Seek to 6.0s manually
    state.currentTime = 6.0;

    // Go to next marker -> M3 at 9.0s
    state = appReducer(state, { type: 'GO_TO_NEXT_MARKER' });
    expect(state.currentTime).toBe(9.0);

    // Go to next marker from 9.0s -> no marker after 9.0s -> remains at 9.0s
    state = appReducer(state, { type: 'GO_TO_NEXT_MARKER' });
    expect(state.currentTime).toBe(9.0);
  });
});

describe('Store history cap (MAX_HISTORY_ENTRIES)', () => {
  const TOTAL = MAX_HISTORY_ENTRIES + 10;

  const buildCappedState = (): AppStateWithHistory => {
    let state: AppStateWithHistory = {
      ...initialState,
      tracks: [],
      past: [],
      future: [],
    };
    for (let i = 0; i < TOTAL; i++) {
      state = appReducer(state, { type: 'ADD_TRACK', payload: makeTrack(`t${i}`) });
    }
    return state;
  };

  it('caps past at MAX_HISTORY_ENTRIES and drops the oldest snapshots', () => {
    const state = buildCappedState();

    expect(state.tracks).toHaveLength(TOTAL);
    expect(state.past).toHaveLength(MAX_HISTORY_ENTRIES);

    // Each ADD_TRACK snapshots the PREVIOUS tracks array. With 10 extra
    // actions past the cap, the 10 oldest snapshots (0..9 tracks) are gone;
    // the oldest surviving snapshot is the one taken with 10 tracks.
    expect(state.past[0]).toHaveLength(TOTAL - MAX_HISTORY_ENTRIES);
    expect(state.past[0][0].id).toBe('t0');
    // The newest snapshot is the state just before the final ADD_TRACK.
    expect(state.past[MAX_HISTORY_ENTRIES - 1]).toHaveLength(TOTAL - 1);
  });

  it('UNDO/REDO round-trips with full integrity after the cap is hit', () => {
    let state = buildCappedState();

    // Undo everything that remains in history
    for (let i = 0; i < MAX_HISTORY_ENTRIES; i++) {
      state = appReducer(state, { type: 'UNDO' });
    }
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(MAX_HISTORY_ENTRIES);
    // We can only rewind to the oldest surviving snapshot (10 tracks),
    // not to the empty project.
    expect(state.tracks).toHaveLength(TOTAL - MAX_HISTORY_ENTRIES);
    expect(state.tracks.map((t) => t.id)).toEqual(
      Array.from({ length: TOTAL - MAX_HISTORY_ENTRIES }, (_, i) => `t${i}`)
    );

    // Extra UNDO past the end is a no-op
    const exhausted = state;
    state = appReducer(state, { type: 'UNDO' });
    expect(state).toBe(exhausted);

    // Redo everything
    for (let i = 0; i < MAX_HISTORY_ENTRIES; i++) {
      state = appReducer(state, { type: 'REDO' });
    }
    expect(state.future).toHaveLength(0);
    expect(state.past).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(state.tracks).toHaveLength(TOTAL);
    expect(state.tracks.map((t) => t.id)).toEqual(
      Array.from({ length: TOTAL }, (_, i) => `t${i}`)
    );

    // Extra REDO past the end is a no-op
    const replayed = state;
    state = appReducer(state, { type: 'REDO' });
    expect(state).toBe(replayed);
  });

  it('a new history-saving action after UNDO clears the redo stack', () => {
    let state = buildCappedState();
    state = appReducer(state, { type: 'UNDO' });
    state = appReducer(state, { type: 'UNDO' });
    expect(state.future).toHaveLength(2);

    state = appReducer(state, { type: 'ADD_TRACK', payload: makeTrack('branch') });
    expect(state.future).toHaveLength(0);
    state = appReducer(state, { type: 'REDO' });
    expect(state.tracks[state.tracks.length - 1].id).toBe('branch');
  });
});

describe('Store reducer clip edge cases', () => {
  it('SPLIT_CLIP at the exact clip boundaries does not split', () => {
    const baseState: AppStateWithHistory = {
      ...initialState,
      tracks: [makeTrack('t1', [makeClip('c1', 2, 4)])],
      selectedClipIds: ['c1'],
      past: [],
      future: [],
    };

    // Playhead exactly at clip start (2.0): currentTime > clip.start is false
    let next = appReducer({ ...baseState, currentTime: 2 }, { type: 'SPLIT_CLIP' });
    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[0].clips[0].id).toBe('c1');

    // Playhead exactly at clip end (6.0): currentTime < start + duration is false
    next = appReducer({ ...baseState, currentTime: 6 }, { type: 'SPLIT_CLIP' });
    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[0].clips[0].duration).toBe(4);
  });

  it('SPLIT_CLIP mid-clip produces two clips with contiguous timing and audioOffset', () => {
    const state: AppStateWithHistory = {
      ...initialState,
      tracks: [makeTrack('t1', [makeClip('c1', 2, 4, { audioOffset: 1.5 })])],
      selectedClipIds: ['c1'],
      currentTime: 3.5,
      past: [],
      future: [],
    };

    const next = appReducer(state, { type: 'SPLIT_CLIP' });
    const clips = next.tracks[0].clips;
    expect(clips).toHaveLength(2);

    const [left, right] = clips;
    // Left half keeps the original id/start/offset, shortened to the playhead
    expect(left.id).toBe('c1');
    expect(left.start).toBe(2);
    expect(left.duration).toBeCloseTo(1.5, 10);
    expect(left.audioOffset).toBe(1.5);
    expect(left.bufferId).toBe('c1'); // bufferId backfilled from clip id

    // Right half starts at the playhead and continues within the same buffer
    expect(right.id).toContain('_split_');
    expect(right.start).toBeCloseTo(3.5, 10);
    expect(right.duration).toBeCloseTo(2.5, 10);
    expect(right.audioOffset).toBeCloseTo(3.0, 10); // 1.5 + 1.5
    expect(right.bufferId).toBe('c1');

    // The split is undoable
    const undone = appReducer(next, { type: 'UNDO' });
    expect(undone.tracks[0].clips).toHaveLength(1);
    expect(undone.tracks[0].clips[0].duration).toBe(4);
  });

  it('DELETE_CLIPS removes a multi-selection across tracks and lanes, then UNDO restores it', () => {
    const t1 = makeTrack('t1', [makeClip('a', 0, 2), makeClip('b', 3, 2)]);
    const t2: Track = {
      ...makeTrack('t2', [makeClip('c', 1, 1)]),
      lanes: [{ id: 'l1', name: 'Lane 1', clips: [makeClip('d', 0, 1)] }],
    };
    const state: AppStateWithHistory = {
      ...initialState,
      tracks: [t1, t2],
      selectedClipIds: ['a', 'c', 'd'],
      past: [],
      future: [],
    };

    const next = appReducer(state, { type: 'DELETE_CLIPS' });

    expect(next.tracks[0].clips.map((c) => c.id)).toEqual(['b']);
    expect(next.tracks[1].clips).toHaveLength(0);
    expect(next.tracks[1].lanes[0].clips).toHaveLength(0);
    expect(next.selectedClipIds).toEqual([]);
    expect(next.past).toHaveLength(1);

    const undone = appReducer(next, { type: 'UNDO' });
    expect(undone.tracks[0].clips.map((c) => c.id)).toEqual(['a', 'b']);
    expect(undone.tracks[1].clips.map((c) => c.id)).toEqual(['c']);
    expect(undone.tracks[1].lanes[0].clips.map((c) => c.id)).toEqual(['d']);
  });

  it('DELETE_CLIPS with no selection is a no-op that does not pollute history', () => {
    const state: AppStateWithHistory = {
      ...initialState,
      tracks: [makeTrack('t1', [makeClip('a', 0, 2)])],
      selectedClipIds: [],
      timeSelection: null,
      past: [],
      future: [],
    };
    const next = appReducer(state, { type: 'DELETE_CLIPS' });
    expect(next).toBe(state);
  });

  it('DELETE_CLIPS with a time selection trims overlapping clips into prefix/suffix parts', () => {
    const state: AppStateWithHistory = {
      ...initialState,
      tracks: [makeTrack('t1', [makeClip('c1', 0, 10)])],
      selectedClipIds: [],
      timeSelection: { startTime: 2, endTime: 4, trackIds: ['t1'] },
      past: [],
      future: [],
    };

    const next = appReducer(state, { type: 'DELETE_CLIPS' });
    const clips = next.tracks[0].clips;
    expect(clips).toHaveLength(2);

    const [prefix, suffix] = clips;
    expect(prefix.id).toContain('_prefix_');
    expect(prefix.start).toBe(0);
    expect(prefix.duration).toBe(2);

    expect(suffix.id).toContain('_suffix_');
    expect(suffix.start).toBe(4);
    expect(suffix.duration).toBe(6);
    expect(suffix.audioOffset).toBe(4); // skips the deleted 2s..4s region of audio

    expect(next.timeSelection).toBeNull();
  });
});

describe('Track automation reducer actions', () => {
  const baseState = (): AppStateWithHistory => ({
    ...initialState,
    tracks: [makeTrack('t1'), makeTrack('t2')],
    past: [],
    future: [],
  });

  it('ADD_AUTOMATION_POINT creates the curve, keeps it sorted, clamps values, and is undoable', () => {
    let state = baseState();

    state = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'volume', time: 4, value: 0.5 },
    });
    state = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'volume', time: 1, value: 1.7 }, // clamped to 1
    });
    state = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'pan', time: -2, value: -3 }, // time floored to 0, value clamped to -1
    });

    const t1 = state.tracks[0];
    expect(t1.automation?.volume).toEqual([
      { time: 1, value: 1 },
      { time: 4, value: 0.5 },
    ]);
    expect(t1.automation?.pan).toEqual([{ time: 0, value: -1 }]);
    // Other tracks untouched
    expect(state.tracks[1].automation).toBeUndefined();
    // Each add is one undoable history entry
    expect(state.past).toHaveLength(3);

    const undone = appReducer(state, { type: 'UNDO' });
    expect(undone.tracks[0].automation?.pan).toEqual([]);
    expect(undone.tracks[0].automation?.volume).toHaveLength(2);
  });

  it('ADD_AUTOMATION_POINT on an unknown track is a no-op that does not pollute history', () => {
    const state = baseState();
    const next = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 'nope', param: 'volume', time: 1, value: 0.5 },
    });
    expect(next).toBe(state);
  });

  it('MOVE_AUTOMATION_POINT updates a breakpoint, re-sorts on time changes, and is undoable', () => {
    let state = baseState();
    state = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'volume', time: 1, value: 0.2 },
    });
    state = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'volume', time: 5, value: 0.8 },
    });

    // Drag the first point (index 0) past the second one, with an out-of-range value
    const moved = appReducer(state, {
      type: 'MOVE_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'volume', index: 0, time: 9, value: 2 },
    });

    expect(moved.tracks[0].automation?.volume).toEqual([
      { time: 5, value: 0.8 },
      { time: 9, value: 1 }, // value clamped, re-sorted to the end
    ]);
    expect(moved.past.length).toBe(state.past.length + 1);

    const undone = appReducer(moved, { type: 'UNDO' });
    expect(undone.tracks[0].automation?.volume).toEqual([
      { time: 1, value: 0.2 },
      { time: 5, value: 0.8 },
    ]);
  });

  it('MOVE_AUTOMATION_POINT with an out-of-bounds index is a no-op', () => {
    let state = baseState();
    state = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'pan', time: 2, value: 0.5 },
    });

    const oob = appReducer(state, {
      type: 'MOVE_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'pan', index: 3, time: 4, value: 0 },
    });
    expect(oob).toBe(state);

    const negative = appReducer(state, {
      type: 'MOVE_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'pan', index: -1, time: 4, value: 0 },
    });
    expect(negative).toBe(state);
  });

  it('DELETE_AUTOMATION_POINT removes only the targeted breakpoint and is undoable', () => {
    let state = baseState();
    state = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'pan', time: 1, value: -0.5 },
    });
    state = appReducer(state, {
      type: 'ADD_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'pan', time: 3, value: 0.5 },
    });

    const next = appReducer(state, {
      type: 'DELETE_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'pan', index: 0 },
    });
    expect(next.tracks[0].automation?.pan).toEqual([{ time: 3, value: 0.5 }]);

    const undone = appReducer(next, { type: 'UNDO' });
    expect(undone.tracks[0].automation?.pan).toHaveLength(2);

    // Out-of-bounds delete is a no-op
    const oob = appReducer(next, {
      type: 'DELETE_AUTOMATION_POINT',
      payload: { trackId: 't1', param: 'pan', index: 5 },
    });
    expect(oob).toBe(next);
  });

  it('TOGGLE_AUTOMATION_LANES flips the UI flag without saving undo history', () => {
    const state = baseState();
    const shown = appReducer(state, {
      type: 'TOGGLE_AUTOMATION_LANES',
      payload: 't1',
    });
    expect(shown.tracks[0].showAutomation).toBe(true);
    expect(shown.tracks[1].showAutomation).toBeUndefined();
    expect(shown.past).toHaveLength(0); // UI-only toggle must not pollute undo

    const hidden = appReducer(shown, {
      type: 'TOGGLE_AUTOMATION_LANES',
      payload: 't1',
    });
    expect(hidden.tracks[0].showAutomation).toBe(false);
    expect(hidden.past).toHaveLength(0);
  });
});

describe('Active track selection (Track menu targeting)', () => {
  const twoTrackState = (): AppStateWithHistory => ({
    ...initialState,
    tracks: [makeTrack('t1'), makeTrack('t2')],
    activeTrackId: null,
    past: [],
    future: [],
  });

  it('SET_ACTIVE_TRACK sets the active track id', () => {
    const state = appReducer(twoTrackState(), { type: 'SET_ACTIVE_TRACK', payload: 't2' });
    expect(state.activeTrackId).toBe('t2');
    expect(state.past).toHaveLength(0); // selection is not an undoable edit
  });

  it('ADD_TRACK makes the new track active', () => {
    const state = appReducer(twoTrackState(), { type: 'ADD_TRACK', payload: makeTrack('t3') });
    expect(state.activeTrackId).toBe('t3');
  });

  it('DUPLICATE_TRACK makes the copy active', () => {
    const state = appReducer({ ...twoTrackState(), activeTrackId: 't1' }, {
      type: 'DUPLICATE_TRACK',
      payload: 't1',
    });
    expect(state.tracks).toHaveLength(3);
    const copy = state.tracks[state.tracks.length - 1];
    expect(copy.id).not.toBe('t1');
    expect(state.activeTrackId).toBe(copy.id);
  });

  it('DELETE_TRACK reassigns active to the first remaining track when the active one is deleted', () => {
    const state = appReducer({ ...twoTrackState(), activeTrackId: 't2' }, {
      type: 'DELETE_TRACK',
      payload: 't2',
    });
    expect(state.tracks.map((t) => t.id)).toEqual(['t1']);
    expect(state.activeTrackId).toBe('t1');
  });

  it('DELETE_TRACK leaves active null when the last track is deleted', () => {
    let state: AppStateWithHistory = {
      ...initialState,
      tracks: [makeTrack('only')],
      activeTrackId: 'only',
      past: [],
      future: [],
    };
    state = appReducer(state, { type: 'DELETE_TRACK', payload: 'only' });
    expect(state.tracks).toHaveLength(0);
    expect(state.activeTrackId).toBeNull();
  });

  it('DELETE_TRACK keeps active untouched when a different track is deleted', () => {
    const state = appReducer({ ...twoTrackState(), activeTrackId: 't1' }, {
      type: 'DELETE_TRACK',
      payload: 't2',
    });
    expect(state.activeTrackId).toBe('t1');
  });
});

describe('TOGGLE_ALL_AUTOMATION_LANES (global View toggle)', () => {
  it('shows all lanes when none are shown, then hides all — without touching undo history', () => {
    const base: AppStateWithHistory = {
      ...initialState,
      tracks: [makeTrack('t1'), makeTrack('t2')],
      past: [],
      future: [],
    };
    const shown = appReducer(base, { type: 'TOGGLE_ALL_AUTOMATION_LANES' });
    expect(shown.tracks.every((t) => t.showAutomation === true)).toBe(true);
    expect(shown.past).toHaveLength(0); // UI-only toggle, no history

    const hidden = appReducer(shown, { type: 'TOGGLE_ALL_AUTOMATION_LANES' });
    expect(hidden.tracks.every((t) => t.showAutomation === false)).toBe(true);
    expect(hidden.past).toHaveLength(0);
  });

  it('hides all when even one track already shows automation', () => {
    const mixed: AppStateWithHistory = {
      ...initialState,
      tracks: [makeTrack('t1'), { ...makeTrack('t2'), showAutomation: true }],
      past: [],
      future: [],
    };
    const result = appReducer(mixed, { type: 'TOGGLE_ALL_AUTOMATION_LANES' });
    expect(result.tracks.every((t) => t.showAutomation === false)).toBe(true);
  });
});
