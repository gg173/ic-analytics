import type { MappedHomecareRow, RuleVirtualVisitApproval } from '../types';

export function checkVirtualVisitApproval(
  row: MappedHomecareRow,
  rules: RuleVirtualVisitApproval[]
): string | null {
  if (!row.employee_discipline || !row.visit_type) return null;
  const discipline = row.employee_discipline.toUpperCase();
  const visitType = row.visit_type.toLowerCase();

  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.employee_discipline.toUpperCase() !== discipline) continue;
    const pattern = rule.visit_type_pattern.replace(/%/g, '').toLowerCase();
    if (visitType.includes(pattern)) {
      return `Virtual ${row.employee_discipline} visit requires approval`;
    }
  }
  return null;
}
