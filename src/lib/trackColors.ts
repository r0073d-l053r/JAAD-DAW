// Canonical track color palette shared across the app (track creation, color picker, etc.)
export const TRACK_COLORS = [
  '#FF2A5F', '#FF3B30', '#FF9500', '#FFCC00',
  '#4CD964', '#00E871', '#5AC8FA', '#007AFF',
  '#5856D6', '#6B44FF', '#AF52DE', '#FF2D55',
  '#A2845E', '#8E8E93', '#1C1C1E', '#FFFFFF'
];

export function pickTrackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}
