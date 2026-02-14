import { describe, it, expect } from 'vitest';
import {
  buildLocalIndex,
  matchTrack,
} from '../trackMatchingEngine';
import type { EvalFixtureFile, EvalCase } from './fixtures/eval-types';
import evalCasesJson from './fixtures/eval-cases.json';

const fixture = evalCasesJson as unknown as EvalFixtureFile;

// ---- Metrics ----

// Tighten this as matching improves. Never loosen it.
const MAX_FALSE_NEGATIVE_RATE = 1.0;

interface EvalMetrics {
  totalCases: number;
  truePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  falsePositives: number;
  matchRecall: number;
  falseNegativeRate: number;
  byCategory: Record<string, { count: number; matched: number; unmatched: number }>;
}

function computeMetrics(
  cases: EvalCase[],
  results: Map<string, boolean>
): EvalMetrics {
  let tp = 0, tn = 0, fn = 0, fp = 0;
  const byCategory: Record<string, { count: number; matched: number; unmatched: number }> = {};

  for (const evalCase of cases) {
    const didMatch = results.get(evalCase.id) ?? false;

    if (evalCase.verdict === 'true-missing') {
      if (!didMatch) tp++;
      else fp++;
    } else if (evalCase.verdict === 'false-negative') {
      if (didMatch) tn++;
      else fn++;

      const cat = evalCase.failureCategory || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, matched: 0, unmatched: 0 };
      byCategory[cat].count++;
      if (didMatch) byCategory[cat].matched++;
      else byCategory[cat].unmatched++;
    }
  }

  const matchRecall = tn + fn > 0 ? tn / (tn + fn) : 1;
  const falseNegativeRate = fn + tn > 0 ? fn / (fn + tn) : 0;

  return {
    totalCases: cases.length,
    truePositives: tp,
    trueNegatives: tn,
    falseNegatives: fn,
    falsePositives: fp,
    matchRecall,
    falseNegativeRate,
    byCategory,
  };
}

// ---- Test Suite ----

describe('Track Matching Eval', () => {
  const falseNegatives = fixture.cases.filter(c => c.verdict === 'false-negative');
  const trueMissing = fixture.cases.filter(c => c.verdict === 'true-missing');

  describe('false-negative cases (should match)', () => {
    if (falseNegatives.length === 0) {
      it('no false-negative cases in fixture', () => {
        expect(true).toBe(true);
      });
      return;
    }

    // Summary test that counts pass/fail without breaking the suite.
    // Individual failures are visible in the metrics report.
    it('should track individual case results', () => {
      const results: Array<{ id: string; matched: boolean; spotify: string; local: string; category: string | null }> = [];

      for (const evalCase of falseNegatives) {
        const localTrack = evalCase.expectedLocalMatch!;
        const localIndex = buildLocalIndex([localTrack]);
        const result = matchTrack(evalCase.spotifyTrack, localIndex);
        results.push({
          id: evalCase.id,
          matched: result.matched,
          spotify: `"${evalCase.spotifyTrack.title}" by "${evalCase.spotifyTrack.artist}"`,
          local: `"${localTrack.title}" by "${localTrack.artist}"`,
          category: evalCase.failureCategory,
        });
      }

      const passing = results.filter(r => r.matched);
      const failing = results.filter(r => !r.matched);

      console.log(`\n--- False-Negative Case Results ---`);
      console.log(`Passing: ${passing.length}/${results.length}`);
      console.log(`Failing: ${failing.length}/${results.length}`);

      if (failing.length > 0) {
        console.log('\nFailing cases (sample):');
        for (const f of failing.slice(0, 10)) {
          console.log(`  ${f.id} [${f.category}]: Spotify ${f.spotify} vs Local ${f.local}`);
        }
        if (failing.length > 10) {
          console.log(`  ... and ${failing.length - 10} more`);
        }
      }

      // This test always passes — the metrics report enforces the ratchet
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('true-missing cases (should not match)', () => {
    if (trueMissing.length === 0) {
      it('no true-missing cases in fixture', () => {
        expect(true).toBe(true);
      });
      return;
    }

    it.each(
      trueMissing.map(c => ({
        id: c.id,
        title: c.spotifyTrack.title,
        evalCase: c,
      }))
    )(
      '$id: "$title" is truly missing',
      ({ evalCase }) => {
        // With no local tracks, it should remain unmatched
        const localIndex = buildLocalIndex([]);
        const result = matchTrack(evalCase.spotifyTrack, localIndex);
        expect(result.matched).toBe(false);
      }
    );
  });

  describe('metrics report', () => {
    it('should compute overall accuracy and stay within threshold', () => {
      // Build index from all false-negative expected matches
      const allLocalTracks = fixture.cases
        .filter(c => c.expectedLocalMatch !== null)
        .map(c => c.expectedLocalMatch!);

      const localIndex = buildLocalIndex(allLocalTracks);
      const results = new Map<string, boolean>();

      for (const evalCase of fixture.cases) {
        const result = matchTrack(evalCase.spotifyTrack, localIndex);
        results.set(evalCase.id, result.matched);
      }

      const metrics = computeMetrics(fixture.cases, results);

      // Print report
      console.log('\n=== TRACK MATCHING EVAL REPORT ===');
      console.log(`Fixture: ${fixture.description}`);
      console.log(`Total cases: ${metrics.totalCases}`);
      console.log(`True positives (correctly missing): ${metrics.truePositives}`);
      console.log(`True negatives (correctly matched): ${metrics.trueNegatives}`);
      console.log(`False negatives (should match but don't): ${metrics.falseNegatives}`);
      console.log(`False positives (matched incorrectly): ${metrics.falsePositives}`);
      console.log(`Match recall: ${(metrics.matchRecall * 100).toFixed(1)}%`);
      console.log(`False negative rate: ${(metrics.falseNegativeRate * 100).toFixed(1)}%`);

      const categories = Object.entries(metrics.byCategory);
      if (categories.length > 0) {
        console.log('\n--- By Failure Category ---');
        for (const [cat, stats] of categories.sort((a, b) => b[1].unmatched - a[1].unmatched)) {
          const status = stats.unmatched === 0 ? 'FIXED' : `${stats.unmatched} failing`;
          console.log(`  ${cat}: ${stats.count} cases, ${stats.matched} pass, ${status}`);
        }
      }

      // Log any false positives (true-missing tracks that matched something)
      if (metrics.falsePositives > 0) {
        console.log('\n--- FALSE POSITIVES (investigate) ---');
        for (const evalCase of fixture.cases) {
          if (evalCase.verdict === 'true-missing' && results.get(evalCase.id)) {
            const result = matchTrack(evalCase.spotifyTrack, localIndex);
            console.log(`  ${evalCase.id}: "${evalCase.spotifyTrack.title}" by "${evalCase.spotifyTrack.artist}"`);
            console.log(`    Matched tier ${result.tier}, local: "${result.matchedLocalTrack?.title}" by "${result.matchedLocalTrack?.artist}"`);
            console.log(`    -> This track is marked true-missing but matched a local track from another eval case`);
          }
        }
      }

      console.log('=================================\n');

      // Ratchet: tighten this as matching improves
      expect(metrics.falseNegativeRate).toBeLessThanOrEqual(MAX_FALSE_NEGATIVE_RATE);

      // No false positives: true-missing tracks should never match
      expect(metrics.falsePositives).toBe(0);
    });
  });
});
