import type { Rule } from '../types';
import { albumArtistMixedBy } from './albumArtistMixedBy';
import { superGenreGrouping } from './superGenreGrouping';

/** The rules Mako Clean runs, in order. */
export const RULES: Rule[] = [superGenreGrouping, albumArtistMixedBy];
