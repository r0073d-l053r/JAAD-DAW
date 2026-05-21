import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncOverlay } from './SyncOverlay';
import { useApp } from '../lib/store';

// Mock useApp hook from store
vi.mock('../lib/store', () => ({
  useApp: vi.fn(),
}));

// Mock LiquidGlass component to bypass SVG filter layout processes
vi.mock('./LiquidGlass', () => ({
  LiquidGlassPanel: ({ children, className, contentClassName }: any) => (
    <div data-testid="liquid-glass" className={className}>
      <div className={contentClassName}>{children}</div>
    </div>
  ),
}));

describe('SyncOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when state.isSyncing is false', () => {
    // Setup store mock state
    vi.mocked(useApp).mockReturnValue({
      state: { isSyncing: false },
      dispatch: vi.fn(),
    } as any);

    const { container } = render(<SyncOverlay progress={40} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Syncing to Cloud')).toBeNull();
  });

  it('renders progress and overlay when state.isSyncing is true', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { isSyncing: true },
      dispatch: vi.fn(),
    } as any);

    const { container } = render(<SyncOverlay progress={65} />);

    expect(screen.queryByText('Syncing to Cloud')).not.toBeNull();
    // Use regex to bypass text node splitting caused by <br />
    expect(screen.queryByText(/Please wait while we secure your project/)).not.toBeNull();
    expect(screen.queryByText('Uploading Assets')).not.toBeNull();

    // Verify progress bar styling width directly via class selector
    const progressBar = container.querySelector('.bg-gradient-to-r');
    expect(progressBar).not.toBeNull();
    
    // The width is passed as custom style: style={{ width: `${progress}%` }}
    expect((progressBar as HTMLElement).style.width).toBe('65%');
  });

  it('shows In Progress state text when isSyncing is active', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { isSyncing: true },
      dispatch: vi.fn(),
    } as any);

    render(<SyncOverlay progress={90} />);
    expect(screen.queryByText('In Progress')).not.toBeNull();
  });
});
