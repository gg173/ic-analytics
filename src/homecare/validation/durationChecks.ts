import type { MappedHomecareRow, RuleDurationBounds } from '../types';

export function checkDurationBounds(
  row: MappedHomecareRow,
  bounds: RuleDurationBounds
): string | null {
  if (row.duration_minutes == null) return null;
  if (row.duration_minutes < bounds.min_minutes) {
    return `Duration ${row.duration_minutes} min is below minimum ${bounds.min_minutes} min`;
  }
  if (row.duration_minutes > bounds.max_minutes) {
    return `Duration ${row.duration_minutes} min exceeds maximum ${bounds.max_minutes} min`;
  }
  return null;
}
