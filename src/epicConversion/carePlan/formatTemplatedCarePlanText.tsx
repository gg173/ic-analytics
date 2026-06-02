import { Fragment, type ReactNode } from 'react';
import {
  carePlanContentKindLabel,
  EPIC_CONVERSION_TEMPLATE_MARKERS,
  type CarePlanContentKind,
} from './classifyCarePlanContent';
import {
  parseTemplatedCarePlanFields,
  TEMPLATED_CARE_PLAN_FIELD_HEADERS,
} from './parseTemplatedCarePlanFields';

/** Longer phrases first so shorter prefixes do not steal a match. */
const TEMPLATED_BREAK_BEFORE = [
  'Start date (first visit date):',
  'Start date:',
  'Frequency of visits:',
  'End date:',
  'Specific time:',
  'Interventions:',
  'Special care instructions:',
  'PDD calls & date',
] as const;

interface TemplatedLabelRule {
  pattern: RegExp;
  display: string | ((matched: string) => string);
}

/** Case-insensitive source patterns → proper-cased bold labels. Longest first. */
const TEMPLATED_LABEL_RULES: TemplatedLabelRule[] = [
  {
    pattern: /Start date \(first visit date\):/gi,
    display: 'Start date (first visit date):',
  },
  { pattern: /Start date:/gi, display: 'Start date:' },
  { pattern: /Frequency of visits:/gi, display: 'Frequency of visits:' },
  { pattern: /End date:/gi, display: 'End date:' },
  { pattern: /Specific time:/gi, display: 'Specific time:' },
  { pattern: /Interventions:/gi, display: 'Interventions:' },
  {
    pattern: /Special care instructions:/gi,
    display: 'Special Care instructions:',
  },
  {
    pattern: /PDD calls & date(?:\s*\(VHA\/ICL\))?:/gi,
    display: (matched) =>
      /\(VHA\/ICL\)/i.test(matched)
        ? 'PDD calls & date (VHA/ICL):'
        : 'PDD calls & date:',
  },
  { pattern: /Service:/gi, display: 'Service:' },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withGlobalFlag(pattern: RegExp): RegExp {
  if (pattern.global) return pattern;
  return new RegExp(pattern.source, `${pattern.flags}g`);
}

function isAtLineStart(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1];
  return prev === '\n' || prev === '\r';
}

function insertNewlineBefore(text: string, label: string): string {
  const pattern = new RegExp(escapeRegExp(label), 'gi');
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const index = match.index;
    result += text.slice(lastIndex, index);
    if (!isAtLineStart(text, index)) {
      result += '\n';
    }
    result += match[0];
    lastIndex = index + match[0].length;
  }

  return result + text.slice(lastIndex);
}

function insertNewlineAfter(text: string, marker: string): string {
  const pattern = new RegExp(escapeRegExp(marker), 'gi');
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const index = match.index;
    const afterMarker = index + match[0].length;
    result += text.slice(lastIndex, afterMarker);
    if (afterMarker < text.length && !isAtLineStart(text, afterMarker)) {
      result += '\n';
    }
    lastIndex = afterMarker;
  }

  return result + text.slice(lastIndex);
}

export function formatTemplatedCarePlanText(text: string): string {
  let formatted = text;
  for (const marker of EPIC_CONVERSION_TEMPLATE_MARKERS) {
    formatted = insertNewlineAfter(formatted, marker);
  }
  for (const label of TEMPLATED_BREAK_BEFORE) {
    formatted = insertNewlineBefore(formatted, label);
  }
  return formatted;
}

interface LabelMatch {
  index: number;
  length: number;
  display: string;
}

function findTemplatedLabelMatches(text: string): LabelMatch[] {
  const raw: LabelMatch[] = [];

  for (const rule of TEMPLATED_LABEL_RULES) {
    const pattern = withGlobalFlag(rule.pattern);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const display =
        typeof rule.display === 'function' ? rule.display(match[0]) : rule.display;
      raw.push({ index: match.index, length: match[0].length, display });
    }
  }

  const sorted = [...raw].sort((a, b) => a.index - b.index || b.length - a.length);
  const kept: LabelMatch[] = [];
  let occupiedUntil = 0;

  for (const candidate of sorted) {
    if (candidate.index < occupiedUntil) continue;
    kept.push(candidate);
    occupiedUntil = candidate.index + candidate.length;
  }

  return kept.sort((a, b) => a.index - b.index);
}

function buildTemplatedCarePlanNodes(text: string): ReactNode[] {
  const formatted = formatTemplatedCarePlanText(text);
  const matches = findTemplatedLabelMatches(formatted);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.index > cursor) {
      nodes.push(formatted.slice(cursor, match.index));
    }
    nodes.push(
      <strong key={`label-${match.index}`} className="hc-care-plan-needs-label">
        {match.display}
      </strong>
    );
    cursor = match.index + match.length;
  }

  if (cursor < formatted.length) {
    nodes.push(formatted.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [formatted];
}

function displayFieldValue(value: string | null | undefined): string {
  return value?.trim() ? value.trim() : '—';
}

export function renderCarePlanContentKindBadge(kind: CarePlanContentKind): ReactNode {
  return (
    <span className={`hc-care-plan-kind hc-care-plan-kind--${kind}`}>
      {carePlanContentKindLabel(kind)}
    </span>
  );
}

export function renderCarePlanRowsListNeedsCell(
  clientNeedsGoals: string | null | undefined,
  kind: CarePlanContentKind
): ReactNode {
  const trimmed = clientNeedsGoals?.trim();

  if (!trimmed) {
    return '—';
  }

  if (kind !== 'templated') {
    return <div className="hc-care-plan-rows-list-needs-text">{trimmed}</div>;
  }

  const fields = parseTemplatedCarePlanFields(trimmed);
  return (
    <table className="hc-care-plan-templated-fields">
      <tbody>
        {TEMPLATED_CARE_PLAN_FIELD_HEADERS.map(({ key, label }) => (
          <tr key={key}>
            <th scope="row">{label}</th>
            <td>{displayFieldValue(fields[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function renderClientNeedsGoalsContent(
  clientNeedsGoals: string | null | undefined,
  kind: CarePlanContentKind
): ReactNode {
  const trimmed = clientNeedsGoals?.trim();
  if (!trimmed) return '—';
  if (kind !== 'templated') {
    return trimmed;
  }

  const nodes = buildTemplatedCarePlanNodes(trimmed);
  return (
    <span className="hc-care-plan-formatted-needs">
      {nodes.map((node, index) => (
        <Fragment key={index}>{node}</Fragment>
      ))}
    </span>
  );
}

/** @deprecated Use renderClientNeedsGoalsContent for UI. */
export function formatClientNeedsGoalsForDisplay(
  clientNeedsGoals: string | null | undefined,
  kind: CarePlanContentKind
): string {
  const trimmed = clientNeedsGoals?.trim();
  if (!trimmed) return '';
  if (kind !== 'templated') return trimmed;
  return formatTemplatedCarePlanText(trimmed);
}
