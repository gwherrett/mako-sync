/**
 * Export eval-cases.json to a flat CSV for spreadsheet review.
 *
 * Only the columns you need to eyeball and edit are included.
 * The full JSON (with IDs, albums, genres) is preserved — csv-to-eval.ts
 * merges your edits back by the `id` column.
 *
 * Usage:
 *   npx ts-node scripts/eval-to-csv.ts [--input <path>] [--output <path>]
 *
 * Defaults:
 *   --input  src/services/__tests__/fixtures/eval-cases.json
 *   --output eval-review.csv
 */

import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_INPUT = 'src/services/__tests__/fixtures/eval-cases.json';
const DEFAULT_OUTPUT = 'eval-review.csv';

// ---- CSV helpers (no external deps) ----

function csvEscape(value: string | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  // Wrap in quotes if the value contains commas, quotes, or newlines
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(fields: (string | null | undefined)[]): string {
  return fields.map(csvEscape).join(',');
}

// ---- Main ----

function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  let input = DEFAULT_INPUT;
  let output = DEFAULT_OUTPUT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) input = args[++i];
    else if (args[i] === '--output' && args[i + 1]) output = args[++i];
  }

  return { input, output };
}

function main() {
  const { input, output } = parseArgs();
  const fixture = JSON.parse(fs.readFileSync(path.resolve(input), 'utf-8'));
  const cases: Array<Record<string, any>> = fixture.cases;

  const HEADER = [
    'id',
    'verdict',
    'failureCategory',
    'spotify_title',
    'spotify_artist',
    'local_title',
    'local_artist',
    'local_file_path',
    'notes',
  ];

  const rows: string[] = [csvRow(HEADER)];

  for (const c of cases) {
    rows.push(
      csvRow([
        c.id,
        c.verdict,
        c.failureCategory,
        c.spotifyTrack?.title,
        c.spotifyTrack?.artist,
        c.expectedLocalMatch?.title,
        c.expectedLocalMatch?.artist,
        c.expectedLocalMatch?.file_path,
        c.notes,
      ])
    );
  }

  const outputPath = path.resolve(output);
  fs.writeFileSync(outputPath, rows.join('\n') + '\n');

  const falseNeg = cases.filter((c: any) => c.verdict === 'false-negative').length;
  const trueMissing = cases.filter((c: any) => c.verdict === 'true-missing').length;

  console.log(`Wrote ${cases.length} rows to ${output}`);
  console.log(`  ${falseNeg} false-negative (need review)`);
  console.log(`  ${trueMissing} true-missing`);
  console.log(`\nEditable columns: verdict, failureCategory, notes`);
  console.log('When done, run: npx ts-node scripts/csv-to-eval.ts');
}

main();
