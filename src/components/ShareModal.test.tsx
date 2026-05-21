import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ShareModal } from './ShareModal';
import { useApp } from '../lib/store';

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

// Mock useApp hook from store
vi.mock('../lib/store', () => ({
  useApp: vi.fn(),
}));

describe('ShareModal', () => {
  let mockSaveToCloud: any;
  let mockWriteText: any;
  let mockOpen: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockSaveToCloud = vi.fn().mockResolvedValue(undefined);
    mockWriteText = vi.fn().mockResolvedValue(undefined);
    mockOpen = vi.fn();

    // Stub global browser APIs
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    vi.stubGlobal('window', {
      location: {
        origin: 'http://localhost:5173',
        pathname: '/',
      },
      open: mockOpen,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders "Cloud Save Required" warning when hasManuallySaved is false', () => {
    vi.mocked(useApp).mockReturnValue({
      state: {
        hasManuallySaved: false,
        projectId: 'test_project_123',
        projectName: 'My Epic Song',
      },
    } as any);

    render(<ShareModal isOpen={true} onClose={vi.fn()} onSaveToCloud={mockSaveToCloud} />);

    expect(screen.queryByText('Cloud Save Required')).not.toBeNull();
    // Use regex to support partial matches on long text nodes
    expect(screen.queryByText(/Your project must be saved to the cloud/)).not.toBeNull();
    expect(screen.queryByText('Save to Cloud & Share')).not.toBeNull();
  });

  it('triggers onSaveToCloud when "Save to Cloud & Share" is clicked', async () => {
    vi.mocked(useApp).mockReturnValue({
      state: {
        hasManuallySaved: false,
        projectId: 'test_project_123',
        projectName: 'My Epic Song',
      },
    } as any);

    render(<ShareModal isOpen={true} onClose={vi.fn()} onSaveToCloud={mockSaveToCloud} />);

    const saveBtn = screen.getByText('Save to Cloud & Share');
    
    // Await act to flush the async onSaveToCloud state tree transitions
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(mockSaveToCloud).toHaveBeenCalledTimes(1);
  });

  it('renders sharing fields and link once hasManuallySaved is true', () => {
    vi.mocked(useApp).mockReturnValue({
      state: {
        hasManuallySaved: true,
        projectId: 'test_project_123',
        projectName: 'My Epic Song',
      },
    } as any);

    render(<ShareModal isOpen={true} onClose={vi.fn()} onSaveToCloud={mockSaveToCloud} />);

    expect(screen.queryByText('Project Share Link')).not.toBeNull();
    expect(screen.queryByText('Copy Link')).not.toBeNull();
    expect(screen.queryByText('http://localhost:5173/?project=test_project_123')).not.toBeNull();
  });

  it('copies URL to clipboard and triggers animation status changes on click', async () => {
    vi.mocked(useApp).mockReturnValue({
      state: {
        hasManuallySaved: true,
        projectId: 'test_project_123',
        projectName: 'My Epic Song',
      },
    } as any);

    render(<ShareModal isOpen={true} onClose={vi.fn()} onSaveToCloud={mockSaveToCloud} />);

    const copyBtn = screen.getByText('Copy Link');
    
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(mockWriteText).toHaveBeenCalledWith('http://localhost:5173/?project=test_project_123');
    // Synchronous check is safe here because act flushes the clipboard promise macro-micro loop
    expect(screen.queryByText('Copied!')).not.toBeNull();

    // Fast-forward copy animation timer (2000ms)
    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.queryByText('Copy Link')).not.toBeNull();
  });

  it('handles Discord quick share action correctly', async () => {
    vi.mocked(useApp).mockReturnValue({
      state: {
        hasManuallySaved: true,
        projectId: 'test_project_123',
        projectName: 'My Epic Song',
      },
    } as any);

    render(<ShareModal isOpen={true} onClose={vi.fn()} onSaveToCloud={mockSaveToCloud} />);

    const discordBtn = screen.getByText('Share to Discord');
    
    await act(async () => {
      fireEvent.click(discordBtn);
    });

    expect(mockWriteText).toHaveBeenCalledWith(
      '🎵 Check out my project on JAAD DAW! 🎵\n👉 http://localhost:5173/?project=test_project_123'
    );
    expect(mockOpen).toHaveBeenCalledWith('https://discord.com/channels/@me', '_blank', 'noopener,noreferrer');
  });

  it('does not render modal when isOpen={false}', () => {
    vi.mocked(useApp).mockReturnValue({
      state: { hasManuallySaved: true },
    } as any);

    render(<ShareModal isOpen={false} onClose={vi.fn()} onSaveToCloud={mockSaveToCloud} />);
    expect(screen.queryByText('Project Share Link')).toBeNull();
  });
});
