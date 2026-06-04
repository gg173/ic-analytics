export const EPIC_CONVERSION_CLIENT_NEEDS_MARKER = '###Epic Conversion###';
export const EPIC_CONVERSION_SHORT_MARKER = '###CONVERSION###';

export const EPIC_CONVERSION_TEMPLATE_MARKERS = [
  EPIC_CONVERSION_CLIENT_NEEDS_MARKER,
  EPIC_CONVERSION_SHORT_MARKER,
] as const;

/** Case-insensitive — EMRI exports vary (e.g. `###EPIC Conversion###`). */
export const EPIC_CONVERSION_TEMPLATE_MARKER_PATTERNS: readonly RegExp[] = [
  /###Epic Conversion###/i,
  /###CONVERSION###/i,
];

export type CarePlanContentKind = 'templated' | 'unstructured';

export function hasEpicConversionTemplateMarker(text: string): boolean {
  return EPIC_CONVERSION_TEMPLATE_MARKER_PATTERNS.some((pattern) => pattern.test(text));
}

export function stripEpicConversionTemplateMarkers(text: string): string {
  let result = text;
  for (const pattern of EPIC_CONVERSION_TEMPLATE_MARKER_PATTERNS) {
    result = result.replace(
      pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`),
      ''
    );
  }
  return result.trim();
}

export function classifyClientNeedsGoals(
  clientNeedsGoals: string | null | undefined
): CarePlanContentKind {
  if (clientNeedsGoals && hasEpicConversionTemplateMarker(clientNeedsGoals)) {
    return 'templated';
  }
  return 'unstructured';
}

export function carePlanContentKindLabel(kind: CarePlanContentKind): string {
  return kind === 'templated' ? 'Templated' : 'Unstructured';
}
