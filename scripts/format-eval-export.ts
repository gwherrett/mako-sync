/**
 * Format raw SQL export into eval fixture file format.
 *
 * Usage:
 *   npx ts-node scripts/format-eval-export.ts --input raw-export.json --output src/services/__tests__/fixtures/eval-cases.json
 *
 * The script reads the JSON output from export-eval-cases.sql and converts it
 * into an EvalFixtureFile. Tracks with candidate local matches are marked as
 * 'false-negative' (for manual review), tracks without candidates are marked
 * as 'true-missing'.
 */

import * as fs from 'fs';
import * as path from 'path';

interface RawExport {
  exportedAt: string;
  superGenre: string;
  spotify_tracks: Array<{
    id: string;
    title: string;
    artist: string;
    primary_artist: string | null;
    album: string | null;
    genre: string | null;
    super_genre: string | null;
  }>;
  candidate_local_matches: Array<{
    spotify_id: string;
    local_id: string;
    local_title: string | null;
    local_artist: string | null;
    local_primary_artist: string | null;
    local_album: string | null;
    local_genre: string | null;
    local_file_path: string;
  }>;
}

interface EvalCase {
  id: string;
  spotifyTrack: {
    id: string;
    title: string;
    artist: string;
    primary_artist: string | null;
    album: string | null;
    genre: string | null;
    super_genre: string | null;
  };
  expectedLocalMatch: {
    id: string;
    title: string | null;
    artist: string | null;
    primary_artist: string | null;
    album: string | null;
    genre: string | null;
    file_path: string;
  } | null;
  verdict: 'true-missing' | 'false-negative';
  failureCategory: string | null;
  notes: string;
  superGenre: string | null;
}

function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  let input = '';
  let output = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      input = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[++i];
    }
  }

  if (!input || !output) {
    console.error('Usage: npx ts-node scripts/format-eval-export.ts --input <raw.json> --output <fixture.json>');
    process.exit(1);
  }

  return { input, output };
}

function extractRawExport(parsed: unknown): RawExport {
  // Supabase SQL Editor wraps results as [{ "export_data": { ... } }]
  let data = parsed;
  if (Array.isArray(data)) {
    data = data[0];
  }
  if (data && typeof data === 'object' && 'export_data' in data) {
    data = (data as Record<string, unknown>).export_data;
  }
  const raw = data as RawExport;
  // Handle null arrays from SQL coalesce
  raw.spotify_tracks = raw.spotify_tracks || [];
  raw.candidate_local_matches = raw.candidate_local_matches || [];
  return raw;
}

function main() {
  const { input, output } = parseArgs();

  const rawContent = fs.readFileSync(path.resolve(input), 'utf-8');
  const parsed = JSON.parse(rawContent);
  const raw = extractRawExport(parsed);

  // Group candidate local matches by spotify_id
  const candidatesBySpotifyId = new Map<string, typeof raw.candidate_local_matches>();
  for (const candidate of raw.candidate_local_matches) {
    const existing = candidatesBySpotifyId.get(candidate.spotify_id) || [];
    existing.push(candidate);
    candidatesBySpotifyId.set(candidate.spotify_id, existing);
  }

  const cases: EvalCase[] = raw.spotify_tracks.map((st, index) => {
    const candidates = candidatesBySpotifyId.get(st.id) || [];
    const hasCandidates = candidates.length > 0;

    // If there are candidates, use the first one as the expected match.
    // The user should review and adjust.
    const expectedLocalMatch = hasCandidates
      ? {
          id: candidates[0].local_id,
          title: candidates[0].local_title,
          artist: candidates[0].local_artist,
          primary_artist: candidates[0].local_primary_artist,
          album: candidates[0].local_album,
          genre: candidates[0].local_genre,
          file_path: candidates[0].local_file_path,
        }
      : null;

    const candidateNotes = hasCandidates
      ? `${candidates.length} local candidate(s) found. First: "${candidates[0].local_title}" by "${candidates[0].local_artist}". REVIEW: confirm this is the correct match and set failureCategory.`
      : 'No local candidates found by this artist.';

    return {
      id: `eval-${String(index + 1).padStart(3, '0')}`,
      spotifyTrack: {
        id: st.id,
        title: st.title,
        artist: st.artist,
        primary_artist: st.primary_artist,
        album: st.album,
        genre: st.genre,
        super_genre: st.super_genre,
      },
      expectedLocalMatch,
      verdict: hasCandidates ? 'false-negative' as const : 'true-missing' as const,
      failureCategory: hasCandidates ? 'unknown' : null,
      notes: candidateNotes,
      superGenre: raw.superGenre,
    };
  });

  const fixtureFile = {
    exportedAt: raw.exportedAt,
    description: `Unmatched tracks for ${raw.superGenre} - exported for eval review`,
    totalCases: cases.length,
    cases,
  };

  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(fixtureFile, null, 2) + '\n');

  const falseNegatives = cases.filter(c => c.verdict === 'false-negative').length;
  const trueMissing = cases.filter(c => c.verdict === 'true-missing').length;

  console.log(`Wrote ${cases.length} eval cases to ${output}`);
  console.log(`  ${falseNegatives} false-negative candidates (need review)`);
  console.log(`  ${trueMissing} true-missing`);
  console.log('\nNext steps:');
  console.log('  1. Review false-negative cases and set correct failureCategory');
  console.log('  2. Verify expectedLocalMatch is the right local track');
  console.log('  3. Run: npm run eval:matching');
}

main();
