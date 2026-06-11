import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';

// Mock Portals to render inline inside the test container rather than document.body
vi.mock('react-dom', async () => {
  const original = await vi.importActual<any>('react-dom');
  return {
    ...original,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock LiquidGlass component to bypass SVG filter layout processes
vi.mock('./LiquidGlass', () => ({
  LiquidGlassPanel: ({ children, className }: any) => <div data-testid="liquid-glass" className={className}>{children}</div>,
  DEFAULT_GLASS_SETTINGS: {
    displacementScale: 100,
    blurAmount: 10,
    saturation: 140,
    aberrationIntensity: 2,
    cornerRadius: 20,
    mode: 'standard',
    overLight: false,
    backgroundOpacity: 0.1,
  },
}));

// Mock useApp hook from store
vi.mock('../lib/store', () => ({
  useApp: vi.fn(),
}));

// Mock audioEngine
vi.mock('../lib/audioEngine', () => ({
  audioEngine: {
    setupMidi: vi.fn(),
  },
}));

describe('SettingsModal', () => {
  const mockDispatch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when settingsOpen is false', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { settingsOpen: false },
      dispatch: mockDispatch,
    } as any);

    const { container } = render(<SettingsModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders settings layout and core Audio configuration when settingsOpen is true', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { settingsOpen: true },
      dispatch: mockDispatch,
    } as any);

    render(<SettingsModal />);

    expect(screen.queryByText('Settings')).not.toBeNull();
    expect(screen.queryByText('Audio Configuration')).not.toBeNull();
    expect(screen.queryByText('Input Device')).not.toBeNull();
    expect(screen.queryByText('Buffer Size')).not.toBeNull();
  });

  it('navigates seamlessly across tabs and displays relevant panels', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { settingsOpen: true },
      dispatch: mockDispatch,
    } as any);

    render(<SettingsModal />);

    // 1. Navigate to MIDI tab
    const midiTabBtn = screen.getByRole('button', { name: 'MIDI' });
    fireEvent.click(midiTabBtn);
    expect(screen.queryByText('MIDI Setup')).not.toBeNull();

    // 2. Navigate to Shortcuts tab
    const shortcutsTabBtn = screen.getByRole('button', { name: 'Shortcuts' });
    fireEvent.click(shortcutsTabBtn);
    expect(screen.queryByText('Play / Pause')).not.toBeNull();
    expect(screen.queryByText('Spacebar')).not.toBeNull();

    // 3. Navigate to AI & Cloud tab
    const aiTabBtn = screen.getByRole('button', { name: 'AI & Cloud' });
    fireEvent.click(aiTabBtn);
    expect(screen.queryByText('AI Reasoning Model')).not.toBeNull();

    // 4. Navigate to Theme tab
    const themeTabBtn = screen.getByRole('button', { name: 'Theme' });
    fireEvent.click(themeTabBtn);
    expect(screen.queryByText('Visual Aesthetics')).not.toBeNull();
  });

  it('toggles dropdown select options and updates local choice values', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { settingsOpen: true },
      dispatch: mockDispatch,
    } as any);

    render(<SettingsModal />);

    // Selector starts with "Default System Microphone"
    const dropdownBtn = screen.getByRole('button', { name: 'Default System Microphone' });
    expect(dropdownBtn).not.toBeNull();

    // Toggle dropdown open
    fireEvent.click(dropdownBtn);
    
    // Choose "External Audio Interface"
    const targetOption = screen.getByRole('button', { name: 'External Audio Interface' });
    fireEvent.click(targetOption);

    // Dropdown value is updated
    expect(screen.queryByText('External Audio Interface')).not.toBeNull();
  });

  it('triggers scans and alerts inside the MIDI setup tab', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { settingsOpen: true },
      dispatch: mockDispatch,
    } as any);

    render(<SettingsModal />);

    // Navigate to MIDI
    fireEvent.click(screen.getByRole('button', { name: 'MIDI' }));

    // Click scan fader button
    const scanBtn = screen.getByText('Scan for MIDI Devices');
    fireEvent.click(scanBtn);

    expect(audioEngine.setupMidi).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Requested MIDI Access! Play your keyboard.');
  });

  it('dispatches TOGGLE_BACKGROUND_ANIMATION inside Theme tab', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { settingsOpen: true, disableBackgroundAnimation: false },
      dispatch: mockDispatch,
    } as any);

    render(<SettingsModal />);

    // Navigate to Theme
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));

    const checkbox = screen.getByLabelText('Animated background');
    fireEvent.click(checkbox);

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'TOGGLE_BACKGROUND_ANIMATION' });
  });

  it('dispatches TOGGLE_SETTINGS when close icon button is clicked', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { settingsOpen: true },
      dispatch: mockDispatch,
    } as any);

    render(<SettingsModal />);

    // Find closing icon button (it has Lucide X icon inside)
    const closeBtn = screen.getAllByRole('button')[0]; // Header close button is the first button in layout
    fireEvent.click(closeBtn);

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'TOGGLE_SETTINGS' });
  });
});
