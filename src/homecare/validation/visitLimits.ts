/** Client-side visit limit messaging (authoritative validation runs in validate_batch RPC). */

import type { CareStream, ServiceVisit } from '../types';

export function describeVisitLimitExcess(
  visitRank: number,
  careStream: CareStream
): string {
  return `Visit #${visitRank} exceeds ${careStream.name} limit of ${careStream.visit_limit} in ${careStream.period_days}-day period`;
}

export function isVisitExportReady(visit: ServiceVisit): boolean {
  return (
    visit.is_billable &&
    !visit.needs_virtual_approval &&
    !visit.needs_limit_approval &&
    !visit.needs_cancellation_investigation
  );
}
