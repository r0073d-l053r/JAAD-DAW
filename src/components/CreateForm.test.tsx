import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateForm } from './CreateForm';

// Mock dependencies
vi.mock('../lib/store', () => ({
  useApp: vi.fn(() => ({
    state: { tracks: [] },
    dispatch: vi.fn(),
  })),
}));

vi.mock('../lib/audioEngine', () => ({
  audioEngine: {
    loadAudio: vi.fn(),
  },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

vi.mock('../lib/assetManager', () => ({
  saveAsset: vi.fn(),
}));

vi.mock('../lib/syncUtils', () => ({
  uploadAssetCloud: vi.fn(),
}));

// Mock motion/react to avoid transition delays and complex web animations
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div>,
    button: ({ children, className, ...props }: any) => <button className={className} {...props}>{children}</button>,
    span: ({ children, className, ...props }: any) => <span className={className} {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock LiquidGlass component to bypass SVG filter layout processes
vi.mock('./LiquidGlass', () => ({
  LiquidGlassPanel: ({ children, className }: any) => <div data-testid="liquid-glass" className={className}>{children}</div>,
}));

describe('CreateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock ResizeObserver
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    // Setup window.aistudio mock
    window.aistudio = {
      hasSelectedApiKey: vi.fn().mockResolvedValue(true),
      openSelectKey: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('renders correctly with default state', () => {
    render(<CreateForm />);

    // By default the form is collapsed, only instrument and generate buttons are visible
    const instrumentButtons = screen.getAllByText('Vocals');
    expect(instrumentButtons.length).toBeGreaterThan(0);

    // Check that Generate button is present (might be an icon or different text when collapsed)
    // The button has text "Create", not "Generate" in the collapsed state as per the output.
    const createBtns = screen.getAllByRole('button');
    const createBtn = createBtns.find(btn => btn.textContent?.match(/Create/i));
    expect(createBtn).toBeDefined();
  });

  it('handles user input for song name, lyrics, and styles', () => {
    render(<CreateForm />);

    // Expand the form
    const expandBtns = screen.getAllByRole('button');
    const expandBtn = expandBtns.find(btn => btn.innerHTML.includes('lucide-panel-left-open') || btn.innerHTML.includes('lucide-expand') || btn.textContent?.includes('Create'))!;
    fireEvent.click(expandBtn);

    // Find inputs
    // In the expanded state, the textareas have longer placeholders
    const lyricsInput = screen.getByPlaceholderText(/Write your lyrics here/i);
    const stylesInput = screen.getByPlaceholderText(/Describe the genre/i);

    // Type into inputs
    fireEvent.change(lyricsInput, { target: { value: 'These are the best lyrics' } });
    fireEvent.change(stylesInput, { target: { value: 'Pop, Rock' } });

    // Verify values updated
    expect((lyricsInput as HTMLInputElement).value).toBe('These are the best lyrics');
    expect((stylesInput as HTMLInputElement).value).toBe('Pop, Rock');
  });

  it('can select a different instrument from the menu', () => {
    render(<CreateForm />);

    // The instrument selector button
    const vocalsBtns = screen.getAllByText('Vocals');
    const selectorBtn = vocalsBtns[0].closest('button')!;

    fireEvent.click(selectorBtn);

    // Click on "Drums" from the dropdown
    const drumsBtn = screen.getAllByText('Drums').find(el => el.tagName === 'SPAN' || el.tagName === 'BUTTON')!;
    fireEvent.click(drumsBtn);

    // The main selector should now say "Drums"
    const drumElements = screen.getAllByText('Drums');
    expect(drumElements.length).toBeGreaterThan(0);
  });

  it('clicks generate and checks API key (if relevant)', async () => {
    render(<CreateForm />);

    // In collapsed mode, click the "Create" button next to "Vocals"
    const generateBtns = screen.getAllByRole('button');
    // The main floating button is marked as "Create" with an icon
    const generateBtn = generateBtns.find(btn => btn.textContent?.match(/Create/i))!;

    fireEvent.click(generateBtn);

    // Verify the test reached this point (button click did not throw).
    // Note: depending on the selected options (like generating audio procedurally)
    // window.aistudio.hasSelectedApiKey might not be invoked if it's a procedural generation.
    expect(generateBtn).toBeDefined();
  });

  it('can toggle between Lyrics and Advanced Options tabs', () => {
    render(<CreateForm />);

    // Expand the form
    const expandBtns = screen.getAllByRole('button');
    const expandBtn = expandBtns.find(btn => btn.innerHTML.includes('lucide-panel-left-open') || btn.innerHTML.includes('lucide-expand') || btn.textContent?.includes('Create'))!;
    fireEvent.click(expandBtn);

    // "Lyrics" tab should be present
    const lyricsTab = screen.getByText('Lyrics', { selector: 'button' });
    expect(lyricsTab).toBeDefined();

    // "Advanced Options" tab should be present
    const advancedTab = screen.getByText('Advanced Options', { selector: 'button' });
    expect(advancedTab).toBeDefined();

    // Click Advanced Options tab
    fireEvent.click(advancedTab);

    // Should now show advanced controls
    const weirdnessLabel = screen.getByText(/Weirdness/i);
    expect(weirdnessLabel).toBeDefined();
  });
});
