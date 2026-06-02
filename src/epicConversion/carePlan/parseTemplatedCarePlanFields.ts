import {
  EPIC_CONVERSION_TEMPLATE_MARKERS,
} from './classifyCarePlanContent';

export interface TemplatedCarePlanFields {
  service: string | null;
  frequency: string | null;
  startDate: string | null;
  endDate: string | null;
  specificTime: string | null;
  interventions: string | null;
  specialInstructions: string | null;
  pddCalls: string | null;
}

export const TEMPLATED_CARE_PLAN_FIELD_HEADERS: {
  key: keyof TemplatedCarePlanFields;
  label: string;
}[] = [
  { key: 'service', label: 'Service' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'startDate', label: 'Start Date' },
  { key: 'endDate', label: 'End Date' },
  { key: 'specificTime', label: 'Specific Time' },
  { key: 'interventions', label: 'Interventions' },
  { key: 'specialInstructions', label: 'Special Instructions' },
  { key: 'pddCalls', label: 'PDD Calls' },
];

interface FieldLabelSpec {
  field: keyof TemplatedCarePlanFields;
  pattern: RegExp;
}

/** Longest / most specific patterns first so shorter labels do not steal a match. */
const FIELD_LABEL_SPECS: FieldLabelSpec[] = [
  { field: 'startDate', pattern: /Start date \(first visit date\):/i },
  { field: 'pddCalls', pattern: /PDD calls & date(?:\s*\(VHA\/ICL\))?:/i },
  { field: 'specialInstructions', pattern: /Special care instructions:/i },
  { field: 'frequency', pattern: /Frequency of visits:/i },
  { field: 'service', pattern: /Service:/i },
  { field: 'endDate', pattern: /End date:/i },
  { field: 'specificTime', pattern: /Specific time:/i },
  { field: 'interventions', pattern: /Interventions:/i },
  { field: 'startDate', pattern: /Start date:/i },
];

interface LabelSpan {
  field: keyof TemplatedCarePlanFields;
  index: number;
  length: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withGlobalFlag(pattern: RegExp): RegExp {
  if (pattern.global) return pattern;
  return new RegExp(pattern.source, `${pattern.flags}g`);
}

function stripTemplateMarkers(text: string): string {
  let result = text;
  for (const marker of EPIC_CONVERSION_TEMPLATE_MARKERS) {
    result = result.replace(new RegExp(escapeRegExp(marker), 'g'), '');
  }
  return result.trim();
}

function findFieldLabelSpans(text: string): LabelSpan[] {
  const raw: LabelSpan[] = [];

  for (const spec of FIELD_LABEL_SPECS) {
    const pattern = withGlobalFlag(spec.pattern);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      raw.push({
        field: spec.field,
        index: match.index,
        length: match[0].length,
      });
    }
  }

  const sorted = [...raw].sort((a, b) => a.index - b.index || b.length - a.length);
  const kept: LabelSpan[] = [];
  let occupiedUntil = 0;

  for (const candidate of sorted) {
    if (candidate.index < occupiedUntil) continue;
    kept.push(candidate);
    occupiedUntil = candidate.index + candidate.length;
  }

  return kept.sort((a, b) => a.index - b.index);
}

function emptyFields(): TemplatedCarePlanFields {
  return {
    service: null,
    frequency: null,
    startDate: null,
    endDate: null,
    specificTime: null,
    interventions: null,
    specialInstructions: null,
    pddCalls: null,
  };
}

export function parseTemplatedCarePlanFields(
  clientNeedsGoals: string | null | undefined
): TemplatedCarePlanFields {
  const trimmed = clientNeedsGoals?.trim();
  if (!trimmed) return emptyFields();

  const text = stripTemplateMarkers(trimmed);
  const spans = findFieldLabelSpans(text);
  const fields = emptyFields();

  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    const valueStart = span.index + span.length;
    const valueEnd = i + 1 < spans.length ? spans[i + 1].index : text.length;
    const value = text.slice(valueStart, valueEnd).trim();
    if (value) {
      fields[span.field] = value;
    }
  }

  return fields;
}
