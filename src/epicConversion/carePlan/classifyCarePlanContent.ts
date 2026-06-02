export const EPIC_CONVERSION_CLIENT_NEEDS_MARKER = '###Epic Conversion###';
export const EPIC_CONVERSION_SHORT_MARKER = '###CONVERSION###';

export const EPIC_CONVERSION_TEMPLATE_MARKERS = [
  EPIC_CONVERSION_CLIENT_NEEDS_MARKER,
  EPIC_CONVERSION_SHORT_MARKER,
] as const;

export type CarePlanContentKind = 'templated' | 'unstructured';

export function classifyClientNeedsGoals(
  clientNeedsGoals: string | null | undefined
): CarePlanContentKind {
  if (
    clientNeedsGoals &&
    EPIC_CONVERSION_TEMPLATE_MARKERS.some((marker) =>
      clientNeedsGoals.includes(marker)
    )
  ) {
    return 'templated';
  }
  return 'unstructured';
}

export function carePlanContentKindLabel(kind: CarePlanContentKind): string {
  return kind === 'templated' ? 'Templated' : 'Unstructured';
}
