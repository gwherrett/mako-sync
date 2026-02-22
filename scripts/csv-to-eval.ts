/**
 * Merge reviewed CSV edits back into eval-cases.json.
 *
 * Only the editable columns (verdict, failureCategory, notes) are updated.
 * All other fields (IDs, nested objects, albums, genres) are preserved
 * from the original JSON.
 *
 * Usage:
 *   npx ts-node scripts/csv-to-eval.ts [--csv <path>] [--json <path>] [--output <path>]
 *
 * Defaults:
 *   --csv     eval-review.csv
 *   --json    src/services/__tests__/fixtures/eval-cases.json
 *   --output  src/services/__tests__/fixtures/eval-cases.json  (overwrites in place)
 */

import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_CSV = 'eval-review.csv';
const DEFAULT_JSON = 'src/services/__tests__/fixtures/eval-cases.json';

// ---- CSV parser (no external deps) ----

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("") or end of quoted field
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current); // last field
  return fields;
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

// ---- Main ----

const VALID_VERDICTS = new Set(['true-missing', 'false-negative']);

const VALID_CATEGORIES = new Set([
  'artist-mismatch',
  'artist-featuring',
  'artist-ampersand',
  'title-mismatch',
  'title-version-confusion',
  'title-punctuation',
  'title-diacritics',
  'title-remaster-suffix',
  'title-abbreviation',
  'primary-artist-extraction',
  'unknown',
  '', // allows clearing
]);

function parseArgs(): { csv: string; json: string; output: string } {
  const args = process.argv.slice(2);
  let csv = DEFAULT_CSV;
  let json = DEFAULT_JSON;
  let output = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv' && args[i + 1]) csv = args[++i];
    else if (args[i] === '--json' && args[i + 1]) json = args[++i];
    else if (args[i] === '--output' && args[i + 1]) output = args[++i];
  }

  if (!output) output = json; // overwrite in place by default

  return { csv, json, output };
}

function main() {
  const { csv, json, output } = parseArgs();

  // Load original JSON
  const fixture = JSON.parse(fs.readFileSync(path.resolve(json), 'utf-8'));
  const casesById = new Map<string, any>();
  for (const c of fixture.cases) {
    casesById.set(c.id, c);
  }

  // Load CSV edits
  const csvRows = parseCsv(fs.readFileSync(path.resolve(csv), 'utf-8'));

  let updated = 0;
  let unchanged = 0;
  const warnings: string[] = [];

  for (const row of csvRows) {
    const id = row.id;
    const original = casesById.get(id);

    if (!original) {
      warnings.push(`CSV row "${id}" not found in JSON — skipped`);
      continue;
    }

    let changed = false;

    // verdict
    const newVerdict = row.verdict?.trim();
    if (newVerdict && newVerdict !== original.verdict) {
      if (!VALID_VERDICTS.has(newVerdict)) {
        warnings.push(`${id}: invalid verdict "${newVerdict}" — skipped`);
      } else {
        original.verdict = newVerdict;
        changed = true;
      }
    }

    // failureCategory
    const newCategory = row.failureCategory?.trim() ?? '';
    const oldCategory = original.failureCategory ?? '';
    if (newCategory !== oldCategory) {
      if (!VALID_CATEGORIES.has(newCategory)) {
        warnings.push(`${id}: unknown failureCategory "${newCategory}" — applied anyway`);
      }
      original.failureCategory = newCategory === '' ? null : newCategory;
      changed = true;
    }

    // notes
    const newNotes = row.notes ?? '';
    if (newNotes !== (original.notes ?? '')) {
      original.notes = newNotes;
      changed = true;
    }

    // If verdict changed to true-missing, clear the local match
    if (original.verdict === 'true-missing' && original.expectedLocalMatch !== null) {
      original.expectedLocalMatch = null;
      original.failureCategory = null;
      changed = true;
    }

    if (changed) updated++;
    else unchanged++;
  }

  // Update totalCases in case cases were removed/added
  fixture.totalCases = fixture.cases.length;

  // Write output
  const outputPath = path.resolve(output);
  fs.writeFileSync(outputPath, JSON.stringify(fixture, null, 2) + '\n');

  console.log(`Merged CSV into ${output}`);
  console.log(`  ${updated} cases updated`);
  console.log(`  ${unchanged} cases unchanged`);

  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`  ⚠ ${w}`);
    }
  }

  console.log('\nNext: run eval to check your changes:');
  console.log('  npm run eval:matching');
}

main();
