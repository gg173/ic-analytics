import type {
  MappedHomecareRow,
  RuleDurationBounds,
  RuleTitleDiscipline,
  RuleVirtualVisitApproval,
  RuleCancellationReason,
} from '../types';
import { checkDurationBounds } from './durationChecks';
import { checkTitleDiscipline } from './titleDiscipline';
import { checkVirtualVisitApproval } from './virtualVisitApproval';
import { checkCancellationInvestigation } from './cancellations';

export interface ClientValidationIssue {
  import_row_number: number;
  issue_type: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface ClientValidationRules {
  durationBounds: RuleDurationBounds;
  titleDiscipline: RuleTitleDiscipline[];
  virtualVisit: RuleVirtualVisitApproval[];
  cancellations: RuleCancellationReason[];
}

export function runClientValidation(
  rows: MappedHomecareRow[],
  rules: ClientValidationRules
): ClientValidationIssue[] {
  const issues: ClientValidationIssue[] = [];

  for (const row of rows) {
    const durationMsg = checkDurationBounds(row, rules.durationBounds);
    if (durationMsg) {
      issues.push({
        import_row_number: row.import_row_number,
        issue_type: 'duration_bounds',
        severity: 'warning',
        message: durationMsg,
      });
    }

    const titleMsg = checkTitleDiscipline(row, rules.titleDiscipline);
    if (titleMsg) {
      issues.push({
        import_row_number: row.import_row_number,
        issue_type: 'title_discipline',
        severity: 'warning',
        message: titleMsg,
      });
    }

    const virtualMsg = checkVirtualVisitApproval(row, rules.virtualVisit);
    if (virtualMsg) {
      issues.push({
        import_row_number: row.import_row_number,
        issue_type: 'virtual_visit_approval',
        severity: 'error',
        message: virtualMsg,
      });
    }

    const cancelMsg = checkCancellationInvestigation(row, rules.cancellations);
    if (cancelMsg) {
      issues.push({
        import_row_number: row.import_row_number,
        issue_type: 'cancellation_investigation',
        severity: 'error',
        message: cancelMsg,
      });
    }
  }

  return issues;
}
