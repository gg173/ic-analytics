import type { MappedHomecareRow, RuleTitleDiscipline } from '../types';

export function checkTitleDiscipline(
  row: MappedHomecareRow,
  rules: RuleTitleDiscipline[]
): string | null {
  if (!row.employee_title || !row.employee_discipline) return null;
  if (rules.length === 0) return null;
  const match = rules.some(
    (r) =>
      r.active &&
      r.employee_title.toLowerCase() === row.employee_title!.toLowerCase() &&
      r.employee_discipline.toLowerCase() === row.employee_discipline!.toLowerCase()
  );
  if (!match) {
    return `Title "${row.employee_title}" does not match discipline "${row.employee_discipline}"`;
  }
  return null;
}
