import { describe, it, expect } from 'vitest';
import type { VinylIdentifyResult } from '@/types/discogs';

/**
 * Tests for AddVinylDialog business logic.
 *
 * The dialog is now a thin "Add to Discogs" flow — no local DB save.
 * Tests cover:
 *   1. Discogs payload construction from form + release
 *   2. Camera scan pre-fill of the form
 *   3. canAdvance guard (artist + title required before proceeding to search)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  artist: string;
  title: string;
  label: string;
  catalogue_number: string;
  year: string;
  country: string;
  format: string;
}

const EMPTY_FORM: FormData = {
  artist: '',
  title: '',
  label: '',
  catalogue_number: '',
  year: '',
  country: '',
  format: '',
};

// ─── Discogs payload construction ─────────────────────────────────────────────

/**
 * Mirrors what handleDiscogsSelect passes to addToCollection().
 * releaseId comes from the confirmed DiscogsRelease; rating from form state.
 */
function buildAddToDiscogsPayload(releaseId: number, rating: number | null) {
  return { releaseId, rating: rating ?? 0 };
}

describe('buildAddToDiscogsPayload', () => {
  it('passes releaseId through unchanged', () => {
    const payload = buildAddToDiscogsPayload(12345, null);
    expect(payload.releaseId).toBe(12345);
  });

  it('maps null rating to 0', () => {
    const payload = buildAddToDiscogsPayload(1, null);
    expect(payload.rating).toBe(0);
  });

  it('passes explicit rating through', () => {
    const payload = buildAddToDiscogsPayload(1, 4);
    expect(payload.rating).toBe(4);
  });

  it('passes rating 0 through (unrated)', () => {
    const payload = buildAddToDiscogsPayload(1, 0);
    expect(payload.rating).toBe(0);
  });
});

// ─── Camera scan pre-fill ─────────────────────────────────────────────────────

/**
 * Mirrors handleIdentified() — maps a VinylIdentifyResult onto FormData.
 */
function applyIdentifyResult(result: VinylIdentifyResult): FormData {
  return {
    artist: result.artist ?? '',
    title: result.title ?? '',
    label: result.label ?? '',
    catalogue_number: result.catalogue_number ?? '',
    year: result.year != null ? String(result.year) : '',
    country: '',
    format: '',
  };
}

describe('camera scan pre-fill (handleIdentified)', () => {
  it('maps all fields from a full result', () => {
    const result: VinylIdentifyResult = {
      artist: 'Orbital',
      title: 'In Sides',
      label: 'ffrr',
      catalogue_number: '828 727-1',
      year: 1996,
      format_hints: 'Double LP',
    };
    const form = applyIdentifyResult(result);
    expect(form.artist).toBe('Orbital');
    expect(form.title).toBe('In Sides');
    expect(form.label).toBe('ffrr');
    expect(form.catalogue_number).toBe('828 727-1');
    expect(form.year).toBe('1996');
    expect(form.country).toBe('');
    expect(form.format).toBe('');
  });

  it('coerces null fields to empty strings', () => {
    const result: VinylIdentifyResult = {
      artist: null,
      title: null,
      label: null,
      catalogue_number: null,
      year: null,
      format_hints: null,
    };
    const form = applyIdentifyResult(result);
    expect(form.artist).toBe('');
    expect(form.title).toBe('');
    expect(form.label).toBe('');
    expect(form.catalogue_number).toBe('');
    expect(form.year).toBe('');
  });

  it('converts numeric year to string', () => {
    const form = applyIdentifyResult({ artist: 'A', title: 'B', year: 2001 });
    expect(form.year).toBe('2001');
  });

  it('leaves year as empty string when null', () => {
    const form = applyIdentifyResult({ artist: 'A', title: 'B', year: null });
    expect(form.year).toBe('');
  });

  it('resets country and format to empty regardless of result', () => {
    const form = applyIdentifyResult({ artist: 'A', title: 'B', year: null });
    expect(form.country).toBe('');
    expect(form.format).toBe('');
  });
});

// ─── canAdvance guard ─────────────────────────────────────────────────────────

/**
 * Mirrors the canAdvance expression used to gate the "Find on Discogs" button.
 */
function canAdvance(form: FormData): boolean {
  return !!(form.artist.trim() && form.title.trim());
}

describe('canAdvance (step 1 → step 2 gate)', () => {
  it('true when both artist and title are set', () => {
    expect(canAdvance({ ...EMPTY_FORM, artist: 'Orbital', title: 'In Sides' })).toBe(true);
  });

  it('false when artist is missing', () => {
    expect(canAdvance({ ...EMPTY_FORM, title: 'In Sides' })).toBe(false);
  });

  it('false when title is missing', () => {
    expect(canAdvance({ ...EMPTY_FORM, artist: 'Orbital' })).toBe(false);
  });

  it('false when both are empty', () => {
    expect(canAdvance(EMPTY_FORM)).toBe(false);
  });

  it('false when artist is whitespace only', () => {
    expect(canAdvance({ ...EMPTY_FORM, artist: '   ', title: 'In Sides' })).toBe(false);
  });

  it('false when title is whitespace only', () => {
    expect(canAdvance({ ...EMPTY_FORM, artist: 'Orbital', title: '  ' })).toBe(false);
  });
});
