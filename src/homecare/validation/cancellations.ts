import type { MappedHomecareRow, RuleCancellationReason } from '../types';

export function checkCancellationInvestigation(
  row: MappedHomecareRow,
  rules: RuleCancellationReason[]
): string | null {
  if (!row.visit_cancel_reason) return null;
  const rule = rules.find(
    (r) => r.active && r.reason_code === row.visit_cancel_reason
  );
  if (rule?.requires_investigation) {
    return `Cancellation reason "${row.visit_cancel_reason}" requires investigation`;
  }
  return null;
}
