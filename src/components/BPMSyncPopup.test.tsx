import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BPMSyncPopup } from './BPMSyncPopup';
import { useApp } from '../lib/store';

// Mock useApp hook from store
vi.mock('../lib/store', () => ({
  useApp: vi.fn(),
}));

// Mock motion/react to avoid transition delays and complex web animations
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, className, onClick, ...props }: any) => (
      <div className={className} onClick={onClick} {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock LiquidGlass component to bypass SVG filter layout processes
vi.mock('./LiquidGlass', () => ({
  LiquidGlassPanel: ({ children, className }: any) => <div data-testid="liquid-glass" className={className}>{children}</div>,
}));

describe('BPMSyncPopup', () => {
  const mockDispatch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when state.showBPMSyncPopup is false', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { showBPMSyncPopup: false },
      dispatch: mockDispatch,
    } as any);

    const { container } = render(<BPMSyncPopup />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Syncing Project BPM')).toBeNull();
  });

  it('renders popup layout when state.showBPMSyncPopup is true', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { showBPMSyncPopup: true },
      dispatch: mockDispatch,
    } as any);

    render(<BPMSyncPopup />);

    expect(screen.queryByText('Syncing Project BPM')).not.toBeNull();
    expect(screen.queryByText(/Please wait while your project BPM/)).not.toBeNull();
    expect(screen.queryByText('Cancel Auto-Detection')).not.toBeNull();
  });

  it('dispatches REQUEST_BPM_SYNC_CANCEL when the background overlay is clicked', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { showBPMSyncPopup: true },
      dispatch: mockDispatch,
    } as any);

    const { container } = render(<BPMSyncPopup />);
    
    // Background overlay is the absolute-positioned backdrop div
    const backdrop = container.querySelector('.bg-black\\/60');
    expect(backdrop).not.toBeNull();

    fireEvent.click(backdrop!);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'REQUEST_BPM_SYNC_CANCEL' });
  });

  it('dispatches REQUEST_BPM_SYNC_CANCEL when the Cancel button is clicked', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { showBPMSyncPopup: true },
      dispatch: mockDispatch,
    } as any);

    render(<BPMSyncPopup />);

    const cancelBtn = screen.getByText('Cancel Auto-Detection');
    fireEvent.click(cancelBtn);

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'REQUEST_BPM_SYNC_CANCEL' });
  });
});
