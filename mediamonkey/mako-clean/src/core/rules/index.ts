import type { Rule } from '../types';
import { superGenreGrouping } from './superGenreGrouping';

/** The rules Mako Clean runs, in order. */
export const RULES: Rule[] = [superGenreGrouping];
