import { describe, it, expect } from 'vitest';
import type { DiscogsRelease, DiscogsTrack, NewPhysicalMedia } from '@/types/discogs';

/**
 * Tests for AddVinylDialog business logic.
 *
 * The component is React-stateful and multi-step, so tests cover the two
 * pure logic areas extracted from saveRecord():
 *   1. Form + release → NewPhysicalMedia record construction
 *   2. Auto-sync guard — the condition that decides whether to call addToCollection
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  artist: string;
  title: string;
  label: string;
  catalogue_number: string;
  year: string;
  country: string;
  pressing: string;
  format: string;
  format_details: string;
  notes: string;
}

// ─── Form → NewPhysicalMedia mapping ─────────────────────────────────────────

/**
 * Mirrors the record construction block inside saveRecord().
 * Empty strings are coerced to null; year is parsed to int.
 */
function buildPhysicalMediaRecord(
  form: FormData,
  rating: number | null,
  release: DiscogsRelease | null
): NewPhysicalMedia {
  return {
    artist: form.artist,
    title: form.title,
    label: form.label || null,
    catalogue_number: form.catalogue_number || null,
    year: form.year ? parseInt(form.year, 10) : null,
    country: form.country || null,
    pressing: (form.pressing as NewPhysicalMedia['pressing']) || null,
    rating,
    discogs_instance_id: null,
    discogs_synced_at: null,
    format: (form.format as NewPhysicalMedia['format']) || null,
    format_details: form.format_details || null,
    notes: form.notes || null,
    discogs_release_id: release?.id ?? null,
    discogs_master_id: release?.master_id ?? null,
    cover_image_url: release?.images?.[0]?.uri ?? null,
    tracklist: release?.tracklist ?? null,
    genres: release?.genres ?? null,
    styles: release?.styles ?? null,
  };
}

const baseForm: FormData = {
  artist: 'Orbital',
  title: 'In Sides',
  label: 'ffrr',
  catalogue_number: '828 727-1',
  year: '1996',
  country: 'UK',
  pressing: 'original',
  format: 'LP',
  format_details: 'Gatefold',
  notes: 'Near mint',
};

const mockRelease: DiscogsRelease = {
  id: 123456,
  master_id: 54321,
  title: 'In Sides',
  artists: [{ name: 'Orbital', id: 1 }],
  year: 1996,
  labels: [{ name: 'ffrr', catno: '828 727-1' }],
  formats: [{ name: 'Vinyl', descriptions: ['LP', 'Gatefold'], qty: '1' }],
  country: 'UK',
  genres: ['Electronic'],
  styles: ['Techno', 'Ambient Techno'],
  tracklist: [
    { position: 'A1', title: 'The Girl with the Sun in Her Head', duration: '7:03', type_: 'track' },
    { position: 'B1', title: 'P.E.T.R.O.L', duration: '6:22', type_: 'track' },
  ],
  images: [{ uri: 'https://i.discogs.com/cover.jpg', type: 'primary' }],
  thumb: null,
};

describe('AddVinylDialog — form to NewPhysicalMedia mapping', () => {
  describe('required fields', () => {
    it('maps artist and title directly from form', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.artist).toBe('Orbital');
      expect(record.title).toBe('In Sides');
    });

    it('always sets discogs_instance_id to null on create', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, mockRelease);
      expect(record.discogs_instance_id).toBeNull();
    });

    it('always sets discogs_synced_at to null on create', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, mockRelease);
      expect(record.discogs_synced_at).toBeNull();
    });
  });

  describe('year parsing', () => {
    it('parses year string to integer', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.year).toBe(1996);
    });

    it('sets year to null when year string is empty', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, year: '' }, null, null);
      expect(record.year).toBeNull();
    });

    it('parses two-digit year strings correctly', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, year: '96' }, null, null);
      expect(record.year).toBe(96);
    });
  });

  describe('optional string fields — empty string → null', () => {
    it('sets label to null when form field is empty', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, label: '' }, null, null);
      expect(record.label).toBeNull();
    });

    it('sets catalogue_number to null when form field is empty', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, catalogue_number: '' }, null, null);
      expect(record.catalogue_number).toBeNull();
    });

    it('sets country to null when form field is empty', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, country: '' }, null, null);
      expect(record.country).toBeNull();
    });

    it('sets format_details to null when form field is empty', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, format_details: '' }, null, null);
      expect(record.format_details).toBeNull();
    });

    it('sets notes to null when form field is empty', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, notes: '' }, null, null);
      expect(record.notes).toBeNull();
    });

    it('preserves non-empty optional fields', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.label).toBe('ffrr');
      expect(record.catalogue_number).toBe('828 727-1');
      expect(record.country).toBe('UK');
      expect(record.format_details).toBe('Gatefold');
      expect(record.notes).toBe('Near mint');
    });
  });

  describe('enum fields — empty string → null', () => {
    it('sets pressing to null when form field is empty', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, pressing: '' }, null, null);
      expect(record.pressing).toBeNull();
    });

    it('sets format to null when form field is empty', () => {
      const record = buildPhysicalMediaRecord({ ...baseForm, format: '' }, null, null);
      expect(record.format).toBeNull();
    });

    it('preserves valid pressing value', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.pressing).toBe('original');
    });

    it('preserves valid format value', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.format).toBe('LP');
    });
  });

  describe('rating', () => {
    it('preserves numeric rating', () => {
      const record = buildPhysicalMediaRecord(baseForm, 4, null);
      expect(record.rating).toBe(4);
    });

    it('preserves null rating (unrated)', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.rating).toBeNull();
    });
  });

  describe('with Discogs release attached', () => {
    it('maps discogs_release_id from release.id', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, mockRelease);
      expect(record.discogs_release_id).toBe(123456);
    });

    it('maps discogs_master_id from release.master_id', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, mockRelease);
      expect(record.discogs_master_id).toBe(54321);
    });

    it('maps cover_image_url from release.images[0].uri', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, mockRelease);
      expect(record.cover_image_url).toBe('https://i.discogs.com/cover.jpg');
    });

    it('maps tracklist from release', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, mockRelease);
      expect(record.tracklist).toHaveLength(2);
      expect((record.tracklist as DiscogsTrack[])[0].title).toBe('The Girl with the Sun in Her Head');
    });

    it('maps genres from release', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, mockRelease);
      expect(record.genres).toEqual(['Electronic']);
    });

    it('maps styles from release', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, mockRelease);
      expect(record.styles).toEqual(['Techno', 'Ambient Techno']);
    });
  });

  describe('without Discogs release (skipped)', () => {
    it('sets discogs_release_id to null', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.discogs_release_id).toBeNull();
    });

    it('sets discogs_master_id to null', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.discogs_master_id).toBeNull();
    });

    it('sets cover_image_url to null', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.cover_image_url).toBeNull();
    });

    it('sets tracklist to null', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.tracklist).toBeNull();
    });

    it('sets genres to null', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.genres).toBeNull();
    });

    it('sets styles to null', () => {
      const record = buildPhysicalMediaRecord(baseForm, null, null);
      expect(record.styles).toBeNull();
    });
  });

  describe('release with missing optional fields', () => {
    it('sets cover_image_url to null when release has no images', () => {
      const release: DiscogsRelease = { ...mockRelease, images: null };
      const record = buildPhysicalMediaRecord(baseForm, null, release);
      expect(record.cover_image_url).toBeNull();
    });

    it('sets cover_image_url to null when images array is empty', () => {
      const release: DiscogsRelease = { ...mockRelease, images: [] };
      const record = buildPhysicalMediaRecord(baseForm, null, release);
      expect(record.cover_image_url).toBeNull();
    });

    it('sets discogs_master_id to null when release has no master_id', () => {
      const release: DiscogsRelease = { ...mockRelease, master_id: null };
      const record = buildPhysicalMediaRecord(baseForm, null, release);
      expect(record.discogs_master_id).toBeNull();
    });

    it('sets genres to null when release has no genres', () => {
      const release: DiscogsRelease = { ...mockRelease, genres: null };
      const record = buildPhysicalMediaRecord(baseForm, null, release);
      expect(record.genres).toBeNull();
    });
  });
});

// ─── Auto-sync guard ──────────────────────────────────────────────────────────

/**
 * Mirrors the guard condition in saveRecord() that decides whether to call
 * addToCollection() after the record is saved:
 *   if (saved?.discogs_release_id && discogsConnected) { ... }
 */
function shouldAutoSync(
  saved: { discogs_release_id: number | null; id: string } | null | undefined,
  discogsConnected: boolean
): boolean {
  return !!(saved?.discogs_release_id && discogsConnected);
}

describe('AddVinylDialog — auto-sync guard', () => {
  it('fires when saved record has a discogs_release_id and Discogs is connected', () => {
    expect(shouldAutoSync({ id: 'r1', discogs_release_id: 123456 }, true)).toBe(true);
  });

  it('does not fire when Discogs is not connected', () => {
    expect(shouldAutoSync({ id: 'r1', discogs_release_id: 123456 }, false)).toBe(false);
  });

  it('does not fire when saved record has no discogs_release_id (Discogs step skipped)', () => {
    expect(shouldAutoSync({ id: 'r1', discogs_release_id: null }, true)).toBe(false);
  });

  it('does not fire when both conditions are false', () => {
    expect(shouldAutoSync({ id: 'r1', discogs_release_id: null }, false)).toBe(false);
  });

  it('does not fire when saved is null (addRecord threw and was caught)', () => {
    expect(shouldAutoSync(null, true)).toBe(false);
  });

  it('does not fire when saved is undefined', () => {
    expect(shouldAutoSync(undefined, true)).toBe(false);
  });

  it('does not fire when discogs_release_id is 0 (falsy)', () => {
    expect(shouldAutoSync({ id: 'r1', discogs_release_id: 0 as unknown as null }, true)).toBe(false);
  });
});
