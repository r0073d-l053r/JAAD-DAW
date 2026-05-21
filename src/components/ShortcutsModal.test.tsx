import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutsModal } from './ShortcutsModal';

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
}));

describe('ShortcutsModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal header and content when isOpen={true}', () => {
    render(<ShortcutsModal {...defaultProps} />);
    
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeNull();
    expect(screen.queryByText('Just Another AI DAW')).not.toBeNull();
    expect(screen.queryByText('Toggle Play/Pause')).not.toBeNull();
    expect(screen.queryByText('Split Clip at playhead')).not.toBeNull();
    expect(screen.queryByText('AI Cleanup Stems')).not.toBeNull();
    // Use regex to bypass split node bounds from nested <span> tags
    expect(screen.queryByText(/Pro Tip: Hold/)).not.toBeNull();
  });

  it('does not render modal when isOpen={false}', () => {
    render(<ShortcutsModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Keyboard Shortcuts')).toBeNull();
  });

  it('calls onClose callback when the backdrop glass overlay is clicked', () => {
    const { container } = render(<ShortcutsModal {...defaultProps} />);
    
    // Backdrop is the absolute positioned overlay div
    const backdrop = container.querySelector('.bg-\\[\\#050507\\]\\/80');
    expect(backdrop).not.toBeNull();

    fireEvent.click(backdrop!);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose callback when the X close icon button is clicked', () => {
    render(<ShortcutsModal {...defaultProps} />);
    
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
