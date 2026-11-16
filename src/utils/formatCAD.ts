const CAD_FORMATTER = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

/** Formats a CAD price rounded to whole dollars, or '—' when there is no price. */
export function formatCAD(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return CAD_FORMATTER.format(value);
}
