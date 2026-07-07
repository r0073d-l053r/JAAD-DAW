import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkStemServer,
  separateViaServer,
  getStemServerUrl,
  DEMUCS_STEM_MAP,
} from './stemServer';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stemServer client', () => {
  it('defaults to localhost:8000 and honors the localStorage override', () => {
    expect(getStemServerUrl()).toBe('http://localhost:8000');
    localStorage.setItem('jaad_stems_url', 'http://10.0.0.5:8000');
    expect(getStemServerUrl()).toBe('http://10.0.0.5:8000');
  });

  it('checkStemServer returns true only for a healthy response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    expect(await checkStemServer()).toBe(true);

    mockFetch.mockResolvedValueOnce({ ok: false });
    expect(await checkStemServer()).toBe(false);

    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await checkStemServer()).toBe(false);
  });

  it('runs the full separate flow: upload -> poll -> download -> cleanup', async () => {
    const stemBlob = new Blob(['wav-bytes'], { type: 'audio/wav' });
    mockFetch
      // POST /separate
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'job1' }) })
      // GET /jobs/job1 (processing)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'processing', progress: 0.5, stems: [], error: '' }),
      })
      // GET /jobs/job1 (done)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'done', progress: 1, stems: ['vocals'], error: '' }),
      })
      // GET stem download
      .mockResolvedValueOnce({ ok: true, blob: async () => stemBlob })
      // DELETE cleanup (fire-and-forget)
      .mockResolvedValueOnce({ ok: true });

    const progress: number[] = [];
    const results = await separateViaServer(new Blob(['in']), ['Vocals'], (pct) =>
      progress.push(pct)
    );

    expect(results).toHaveLength(1);
    expect(results[0].instrument).toBe('Vocals');
    expect(results[0].blob).toBe(stemBlob);

    // Upload used the 4-stem model (no guitar/piano requested)
    const uploadBody = mockFetch.mock.calls[0][1].body as FormData;
    expect(uploadBody.get('model')).toBe('htdemucs');

    // Stem download hit the mapped demucs name
    expect(mockFetch.mock.calls[3][0]).toContain('/jobs/job1/stem/vocals');

    // Progress moved forward and reached the download phase
    expect(progress[0]).toBeLessThan(progress[progress.length - 1]);
    expect(progress[progress.length - 1]).toBeGreaterThanOrEqual(90);
  });

  it('selects the 6-stem model when Guitar or Keyboard is requested', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'j' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'done', progress: 1, stems: ['guitar'], error: '' }),
      })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['g']) })
      .mockResolvedValueOnce({ ok: true });

    await separateViaServer(new Blob(['in']), ['Guitar']);
    const uploadBody = mockFetch.mock.calls[0][1].body as FormData;
    expect(uploadBody.get('model')).toBe('htdemucs_6s');
    expect(mockFetch.mock.calls[2][0]).toContain('/stem/guitar');
  });

  it('sends the bearer token when configured', async () => {
    localStorage.setItem('jaad_stems_token', 'sekrit');
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'j' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'done', progress: 1, stems: ['vocals'], error: '' }),
      })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['v']) })
      .mockResolvedValueOnce({ ok: true });

    await separateViaServer(new Blob(['in']), ['Vocals']);
    expect(mockFetch.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer sekrit' });
  });

  it('surfaces a server-side failure as a thrown error', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job_id: 'j' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'error', progress: 0, stems: [], error: 'out of memory' }),
      });

    await expect(separateViaServer(new Blob(['in']), ['Drums'])).rejects.toThrow('out of memory');
  });

  it('returns [] without any network calls when no Demucs-capable stems are requested', async () => {
    const results = await separateViaServer(new Blob(['in']), ['Strings', 'FX']);
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(DEMUCS_STEM_MAP['Strings']).toBeUndefined();
  });
});
