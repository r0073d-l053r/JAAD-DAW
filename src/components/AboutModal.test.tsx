import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AboutModal } from './AboutModal';

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

describe('AboutModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal content when isOpen={true}', () => {
    render(<AboutModal {...defaultProps} />);
    
    expect(screen.queryByText('JAAD')).not.toBeNull();
    expect(screen.queryByText('v1.1.0 • Built with Passion')).not.toBeNull();
    expect(screen.queryByText('The Vision')).not.toBeNull();
    expect(screen.queryByText('The Tech')).not.toBeNull();
    expect(screen.queryByText('Connect with the Creator')).not.toBeNull();
  });

  it('does not render modal when isOpen={false}', () => {
    render(<AboutModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('JAAD')).toBeNull();
  });

  it('calls onClose callback when the background overlay is clicked', () => {
    const { container } = render(<AboutModal {...defaultProps} />);
    
    // Background overlay is the absolute-positioned div with backdrop blur styles
    const backgroundOverlay = container.querySelector('.bg-\\[\\#050507\\]\\/80');
    expect(backgroundOverlay).not.toBeNull();

    fireEvent.click(backgroundOverlay!);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose callback when the X close icon button is clicked', () => {
    render(<AboutModal {...defaultProps} />);
    
    // The close button is the button element with className absolute top-6 right-6
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
