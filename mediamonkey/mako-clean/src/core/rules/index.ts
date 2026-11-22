import type { Rule } from '../types';
import { superGenreGrouping } from './superGenreGrouping';

/**
 * The rules Mako Clean runs, in order.
 *
 * albumArtistMixedBy (./albumArtistMixedBy.ts, MAK-200) is built and tested but not
 * turned on yet: Album Artist is left alone until that's decided. To turn it on, add
 * it after superGenreGrouping.
 */
export const RULES: Rule[] = [superGenreGrouping];
