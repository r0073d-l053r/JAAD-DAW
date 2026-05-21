import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LearnModal } from './LearnModal';

// Mock Portals to render inline inside the test container rather than document.body
vi.mock('react-dom', async () => {
  const original = await vi.importActual<any>('react-dom');
  return {
    ...original,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock motion/react to avoid transition delays and complex web animations
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock LiquidGlass component to bypass SVG filter layout processes
vi.mock('./LiquidGlass', () => ({
  LiquidGlassPanel: ({ children, className }: any) => <div data-testid="liquid-glass" className={className}>{children}</div>,
}));

describe('LearnModal', () => {
  const mockClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<LearnModal isOpen={false} onClose={mockClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders wiki layout structure and global key maps when isOpen={true}', () => {
    render(<LearnModal isOpen={true} onClose={mockClose} />);

    expect(screen.queryByText('LEARN')).not.toBeNull();
    expect(screen.queryByText('Project Overview')).not.toBeNull();
    expect(screen.queryByText('Quick Start Guide')).not.toBeNull();

    // Hotkeys are present
    expect(screen.queryByText('Play/Pause')).not.toBeNull();
    expect(screen.queryByText('Mixer View')).not.toBeNull();
    expect(screen.queryByText('Split Clip')).not.toBeNull();
  });

  it('navigates through wiki sections and renders dynamic arrangement panels', () => {
    render(<LearnModal isOpen={true} onClose={mockClose} />);

    const buttons = screen.getAllByRole('button');

    // index 0: Header close button
    // index 1: Welcome button
    // index 2: The Timeline button
    // index 3: Mixer & FX button
    // index 4: AI Studio button
    // index 5: Cloud & Export button

    // 1. Swap to Timeline arrangement manual
    fireEvent.click(buttons[2]);
    expect(screen.queryByText('Arrangement Grid')).not.toBeNull();
    expect(screen.queryByText('Magnet Mode (Snap)')).not.toBeNull();
    expect(screen.queryByText('Splicing & Cutting')).not.toBeNull();

    // 2. Swap to Mixer channels manual
    fireEvent.click(buttons[3]);
    expect(screen.queryByText('Channel Strips')).not.toBeNull();
    expect(screen.queryByText('Effect Slots')).not.toBeNull();

    // 3. Swap to AI Studio manual
    fireEvent.click(buttons[4]);
    expect(screen.queryByText('Generative AI')).not.toBeNull();
    expect(screen.queryByText('AI Copilot')).not.toBeNull();

    // 4. Swap to Cloud & Export safety manual
    fireEvent.click(buttons[5]);
    expect(screen.queryByText('Project Safety')).not.toBeNull();
    expect(screen.queryByText('.jaad Bundle')).not.toBeNull();
  });

  it('triggers onClose when closing icon button is clicked', () => {
    render(<LearnModal isOpen={true} onClose={mockClose} />);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]); // Header close button

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
