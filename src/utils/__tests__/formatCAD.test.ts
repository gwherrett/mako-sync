import { describe, it, expect } from 'vitest';
import { formatCAD } from '../formatCAD';

describe('formatCAD', () => {
  it('formats a price in CAD rounded to whole dollars', () => {
    expect(formatCAD(24.6)).toBe('$25');
    expect(formatCAD(1234)).toBe('$1,234');
  });

  it('formats zero as a price', () => {
    expect(formatCAD(0)).toBe('$0');
  });

  it('returns a dash when there is no price', () => {
    expect(formatCAD(null)).toBe('—');
    expect(formatCAD(undefined)).toBe('—');
  });
});
