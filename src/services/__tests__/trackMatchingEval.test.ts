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

    it.each(
      falseNegatives.map(c => ({
        id: c.id,
        spotifyTitle: c.spotifyTrack.title,
        spotifyArtist: c.spotifyTrack.artist,
        localTitle: c.expectedLocalMatch?.title,
        category: c.failureCategory,
        evalCase: c,
      }))
    )(
      '$id: "$spotifyTitle" by "$spotifyArtist" [$category]',
      ({ evalCase }) => {
        const localTrack = evalCase.expectedLocalMatch!;
        const localIndex = buildLocalIndex([localTrack]);
        const result = matchTrack(evalCase.spotifyTrack, localIndex);

        // This documents the current matching state.
        // As matching improves, failing cases will start passing.
        expect(result.matched).toBe(true);
      }
    );
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

      console.log('=================================\n');

      // Ratchet: tighten this as matching improves
      expect(metrics.falseNegativeRate).toBeLessThanOrEqual(MAX_FALSE_NEGATIVE_RATE);

      // No false positives: true-missing tracks should never match
      expect(metrics.falsePositives).toBe(0);
    });
  });
});
