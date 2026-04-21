import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateMimeType,
  fileToBase64,
  compressToJpeg,
  MAX_SIZE_BYTES,
} from '@/components/vinyl/cameraCaptureUtils';

// ─── validateMimeType ─────────────────────────────────────────────────────────

describe('validateMimeType', () => {
  it('accepts image/jpeg', () => expect(validateMimeType('image/jpeg')).toBe(true));
  it('accepts image/png', () => expect(validateMimeType('image/png')).toBe(true));
  it('accepts image/webp', () => expect(validateMimeType('image/webp')).toBe(true));
  it('rejects image/gif', () => expect(validateMimeType('image/gif')).toBe(false));
  it('rejects application/pdf', () => expect(validateMimeType('application/pdf')).toBe(false));
  it('rejects video/mp4', () => expect(validateMimeType('video/mp4')).toBe(false));
  it('rejects empty string', () => expect(validateMimeType('')).toBe(false));
});

// ─── fileToBase64 — small file (≤ 2 MB) ──────────────────────────────────────

function makeMockFileReader(dataUrl: string, fail = false) {
  return vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.result = dataUrl;
    this.onload = null;
    this.onerror = null;
    this.readAsDataURL = () => {
      Promise.resolve().then(() => {
        if (fail) (this.onerror as (() => void) | null)?.();
        else (this.onload as (() => void) | null)?.();
      });
    };
  });
}

describe('fileToBase64 — small file path (≤ 2 MB)', () => {
  beforeEach(() => {
    vi.stubGlobal('FileReader', makeMockFileReader('data:image/jpeg;base64,SGVsbG8='));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts the base64 portion from the data URL', async () => {
    const file = new File(['hello'], 'small.jpg', { type: 'image/jpeg' });
    const result = await fileToBase64(file);
    expect(result.base64).toBe('SGVsbG8=');
  });

  it('preserves the file mime type', async () => {
    const file = new File(['hello'], 'small.png', { type: 'image/png' });
    const result = await fileToBase64(file);
    expect(result.mimeType).toBe('image/png');
  });

  it('falls back to image/jpeg when file.type is empty', async () => {
    const file = new File(['hello'], 'noext', { type: '' });
    const result = await fileToBase64(file);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('rejects when the FileReader errors', async () => {
    vi.stubGlobal('FileReader', makeMockFileReader('', true));
    const file = new File(['hello'], 'bad.jpg', { type: 'image/jpeg' });
    await expect(fileToBase64(file)).rejects.toThrow('Failed to read image');
  });
});

// ─── fileToBase64 — large file delegation (> 2 MB) ───────────────────────────

describe('fileToBase64 — large file path (> 2 MB)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls URL.createObjectURL for files over the size threshold', async () => {
    const mockCreateObjectURL = vi.fn(() => 'blob:mock');
    Object.assign(URL, { createObjectURL: mockCreateObjectURL, revokeObjectURL: vi.fn() });

    // Mock Image to reject quickly so we don't hang
    vi.stubGlobal('Image', class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) { Promise.resolve().then(() => this.onerror?.()); }
    });

    const largeContent = new Uint8Array(MAX_SIZE_BYTES + 1);
    const file = new File([largeContent], 'large.jpg', { type: 'image/jpeg' });
    await fileToBase64(file).catch(() => {});

    expect(mockCreateObjectURL).toHaveBeenCalledWith(file);
  });
});

// ─── compressToJpeg — canvas.toBlob arguments ────────────────────────────────

describe('compressToJpeg — canvas.toBlob arguments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls canvas.toBlob with image/jpeg and 0.8 quality', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

    let capturedType = '';
    let capturedQuality = 0;
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((
        _cb: BlobCallback,
        type: string,
        quality: number,
      ) => {
        capturedType = type;
        capturedQuality = quality;
        // don't invoke _cb — we only need to observe the args
      }),
    };
    vi.stubGlobal('document', { createElement: vi.fn(() => mockCanvas) });
    vi.stubGlobal('Image', class MockImage {
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) { Promise.resolve().then(() => this.onload?.()); }
    });

    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    compressToJpeg(file); // fire-and-forget; we just need Image.onload to fire
    await new Promise(r => setTimeout(r, 20));

    expect(capturedType).toBe('image/jpeg');
    expect(capturedQuality).toBe(0.8);
  });
});

// ─── compressToJpeg — canvas context unavailable ─────────────────────────────

describe('compressToJpeg — canvas context unavailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects with "Canvas unavailable" when getContext returns null', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => null),
        toBlob: vi.fn(),
      })),
    });
    vi.stubGlobal('Image', class MockImage {
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) { Promise.resolve().then(() => this.onload?.()); }
    });

    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    await expect(compressToJpeg(file)).rejects.toThrow('Canvas unavailable');
  });
});
