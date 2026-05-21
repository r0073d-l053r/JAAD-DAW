import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WelcomeModal } from './WelcomeModal';
import { isGitHubPagesBuild } from '../lib/syncUtils';

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

// Mock syncUtils isGitHubPagesBuild helper
vi.mock('../lib/syncUtils', () => ({
  isGitHubPagesBuild: vi.fn(),
}));

describe('WelcomeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
  });

  it('renders modal when manual prop isOpen={true} is passed', () => {
    render(<WelcomeModal isOpen={true} />);
    expect(screen.queryByText('Welcome to')).not.toBeNull();
    expect(screen.queryByText('J.A.A.D.')).not.toBeNull();
  });

  it('does not render modal when manual prop isOpen={false} is passed', () => {
    render(<WelcomeModal isOpen={false} />);
    expect(screen.queryByText('Welcome to')).toBeNull();
  });

  it('dismisses and sets localStorage when close icon is clicked', () => {
    render(<WelcomeModal isOpen={true} />);
    
    // Grab the first button which is the top-right close icon
    const closeIconBtn = screen.getAllByRole('button')[0];
    fireEvent.click(closeIconBtn);

    expect(localStorage.getItem('jaad_welcome_modal_dismissed')).toBe('true');
    expect(screen.queryByText('Welcome to')).toBeNull();
  });

  it('dismisses and sets localStorage when Lets Make Music button is clicked', () => {
    render(<WelcomeModal isOpen={true} />);
    
    const actionBtn = screen.getByText("Let's Make Music");
    fireEvent.click(actionBtn);

    expect(localStorage.getItem('jaad_welcome_modal_dismissed')).toBe('true');
    expect(screen.queryByText('Welcome to')).toBeNull();
  });

  it('automatically opens after a delay on GitHub Pages builds if not dismissed', () => {
    vi.mocked(isGitHubPagesBuild).mockReturnValue(true);

    render(<WelcomeModal />);

    // Initially closed before delay
    expect(screen.queryByText('Welcome to')).toBeNull();

    // Fast-forward delay (1200ms in source code)
    act(() => {
      vi.advanceTimersByTime(1250);
    });

    expect(screen.queryByText('Welcome to')).not.toBeNull();
  });

  it('does not automatically open if running on a standard local environment', () => {
    vi.mocked(isGitHubPagesBuild).mockReturnValue(false);

    render(<WelcomeModal />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.queryByText('Welcome to')).toBeNull();
  });

  it('does not automatically open if previously dismissed in localStorage', () => {
    vi.mocked(isGitHubPagesBuild).mockReturnValue(true);
    localStorage.setItem('jaad_welcome_modal_dismissed', 'true');

    render(<WelcomeModal />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.queryByText('Welcome to')).toBeNull();
  });
});
