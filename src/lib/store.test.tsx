import { describe, it, expect } from 'vitest';
import { appReducer, initialState, Marker, AppStateWithHistory } from './store';

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
