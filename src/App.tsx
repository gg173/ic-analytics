import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAnalytics, type ParsedInputs } from './analytics/buildAnalytics';
import { parseSheetFromBuffer } from './ingest/parseXlsx';
import { parseCsvBuffer } from './ingest/parseCsv';
import {
  analyticsToWorkbook,
  downloadLinkageMismatchExcel,
  downloadWorkbook,
} from './export/excelExport';
import { downloadExecutivePdf } from './export/pdfExport';
import type { AnalyticsBundle } from './data/types';
import { startOfMonth } from './analytics/dates';
import { isMrnHospDcDateMatch } from './analytics/merge';
import type { BarRectangleItem, XAxisTickContentProps } from 'recharts';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './App.css';
import { SupportCheckInCorrelationHexbin } from './charts/SupportCheckInCorrelationHexbin';

type Slot = 'vha' | 'flowsheet' | 'peIp' | 'peIc';

const APP_LOGO_SRC = '/UHN-at-Home.svg';

const ENROL_LEGEND_PALETTE = [
  '#2563eb',
  '#14b8a6',
  '#7c3aed',
  '#ea580c',
  '#0891b2',
  '#6366f1',
  '#db2777',
  '#0d9488',
  '#4f46e5',
  '#c026d3',
] as const;

const SLOT_LABEL: Record<Slot, string> = {
  vha: 'VHA extract (.xlsx)',
  flowsheet: 'Flowsheet extract (.xlsx)',
  peIp: 'Inpatient survey (.csv)',
  peIc: 'IC survey (.csv)',
};

/** Upper Y bound for enrolment charts: proportional headroom vs fixed + padding (keeps bars filling the chart). */
function enrolmentChartYUpperBound(maxVolume: number): number {
  if (!Number.isFinite(maxVolume) || maxVolume <= 0) return 1;
  const padded = maxVolume * 1.082;
  let upper = Math.max(1, Math.ceil(padded));
  /* Snap to multiples of 5 for medium totals (cleaner ticks) only if overhead stays modest. */
  if (upper > 35) {
    const snapped5 = Math.ceil(upper / 5) * 5;
    if (snapped5 / upper <= 1.35) upper = snapped5;
  }
  return upper;
}

interface FiscalQuarterOption {
  key: string;
  quarterLabel: string;
  dateRangeLabel: string;
}

interface FiscalYearGroup {
  fiscalYearLabel: string;
  options: FiscalQuarterOption[];
}

interface PathwayFilterGroup {
  pathway: string;
  rowCount: number;
  carePaths: Array<{
    carePath: string;
    rowCount: number;
  }>;
}

interface DepartmentFilterGroup {
  department: string;
  rowCount: number;
  pathways: PathwayFilterGroup[];
}

interface ClinicalMonthlyPctKpiRow {
  month: string;
  volume: number;
  numerator: number;
  pct: number | null;
  allProgramsPct: number | null;
}

function clinicalPctDisplayWhole(p: number): string {
  return `${Math.round(p)}%`;
}

type SupportLineMetricMode = 'total' | 'avgPerPatient';

type CallsMetricAvgMonthRow = {
  month: string;
  /** `null` when the month is not yet eligible for final 90-day metrics (line has a gap). */
  calls: number | null;
  allProgramsAvg: number | null;
  fillVariant?: 'pending';
};

/** Bar chart row; optional fields mark 90-day incomplete months (`calls` is 0, no bar). */
type CallsToggleTotalRow = {
  month: string;
  calls: number;
  fillVariant?: 'pending';
  tooltipActualCalls?: number;
};

/** One linked enrolment in the support-line vs check-in correlation scatter. */
type SupportCheckInCorrelationPoint = {
  checkIn: number;
  support: number;
};

function formatCallsMetricDisplay(
  mode: SupportLineMetricMode,
  v: number
): string {
  if (!Number.isFinite(v)) return '';
  if (mode === 'total') return Math.round(v).toLocaleString();
  return v.toFixed(1);
}

function carePathsForDepartmentGroup(group: DepartmentFilterGroup): string[] {
  return group.pathways.flatMap((p) => p.carePaths.map((e) => e.carePath));
}

function sameCarePathSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

const SPROTT_SURGERY_DEPARTMENT = 'Sprott Surgery';

/** Display name for Ajmera cohort (matches department quick-filter label). */
const AJMERA_TRANSPLANT_DEPARTMENT = 'Ajmera Transplant Centre';

/**
 * Ajmera: merge sibling care paths that differ only by a final segment
 * (e.g. CP-TX-BW-N + CP-TX-BW-P → CP-TX-BW).
 */
function ajmeraCollapseCarePathGroupKey(carePath: string): string {
  const segments = carePath.split('-').map((s) => s.trim()).filter(Boolean);
  if (segments.length < 4) return carePath;
  return segments.slice(0, -1).join('-');
}

/** Ajmera enrolment legend: collapse all pathways to trailing N vs P only. */
type AjmeraCarePathGroupMode =
  | 'organTypeNp'
  | 'organTypeOnly'
  | 'npOnly';

const AJMERA_NP_ONLY_CATEGORY_FILL: Record<
  'New transplant' | 'Past transplant' | 'Other',
  string
> = {
  'New transplant': '#3730a3',
  'Past transplant': '#a5b4fc',
  Other: '#64748b',
};

function ajmeraNewPastOnlyGroupKey(carePath: string): string {
  const segments = carePath.split('-').map((s) => s.trim()).filter(Boolean);
  const lastRaw = segments[segments.length - 1];
  if (!lastRaw) return 'Other';
  const last = lastRaw.toUpperCase();
  if (last === 'N') return 'New transplant';
  if (last === 'P') return 'Past transplant';
  return 'Other';
}

/** Ajmera TX enrolment stacks: hue by family segment; N = darker hex, P = lighter. */
const AJMERA_CARE_PATH_FAMILY_COLORS = {
  BW: { darker: '#6d28d9', lighter: '#c4b5fd' },
  HR: { darker: '#db2777', lighter: '#fca5cb' },
  KD: { darker: '#1d4ed8', lighter: '#93c5fd' },
  LG: { darker: '#c2410c', lighter: '#fdba74' },
  LV: { darker: '#0f766e', lighter: '#5eead4' },
} as const;

type AjmeraCarePathFamily = keyof typeof AJMERA_CARE_PATH_FAMILY_COLORS;

const AJMERA_CARE_PATH_FAMILY_SET = new Set<string>(
  Object.keys(AJMERA_CARE_PATH_FAMILY_COLORS)
);

/** CP-TX-… segments; BW/HR/KD/LG/LV after pathway; trailing N|P optional. */
function parseAjmeraTxCarePathStyle(label: string): {
  family: AjmeraCarePathFamily;
  variant: 'N' | 'P' | null;
} | null {
  const seg = label.split('-').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (seg.length < 3 || seg[1] !== 'TX') return null;
  const last = seg[seg.length - 1]!;
  const variant =
    last === 'N' || last === 'P' ? (last as 'N' | 'P') : null;
  const body = variant ? seg.slice(0, -1) : seg;
  for (let i = 2; i < body.length; i += 1) {
    const t = body[i];
    if (t && AJMERA_CARE_PATH_FAMILY_SET.has(t)) {
      return { family: t as AjmeraCarePathFamily, variant };
    }
  }
  return null;
}

/** Fill for stacked enrolment bar + legend swatch (null → use palette). */
function enrolAjmeraCarePathCategoryFill(categoryLabel: string): string | null {
  const npOnly = AJMERA_NP_ONLY_CATEGORY_FILL[categoryLabel as keyof typeof AJMERA_NP_ONLY_CATEGORY_FILL];
  if (npOnly != null) return npOnly;
  const parsed = parseAjmeraTxCarePathStyle(categoryLabel);
  if (!parsed) return null;
  const hex = AJMERA_CARE_PATH_FAMILY_COLORS[parsed.family];
  if (parsed.variant === 'P') return hex.lighter;
  return hex.darker;
}

/** Pathway code (2nd segment of care path key) → hospital program / department */
const DEPARTMENT_BY_PATHWAY: Record<string, string> = {
  TX: AJMERA_TRANSPLANT_DEPARTMENT,
  ED: 'Medicine Program',
  GIM: 'Medicine Program',
  CV: 'Peter Munk Cardiac Centre',
  VAS: 'Peter Munk Cardiac Centre',
  CRD: 'Peter Munk Cardiac Centre',
  ORT: 'Schroeder Arthritis Institute',
  TSN: 'Transitions Pathway',
};

const DEPARTMENT_DISPLAY_ORDER = [
  AJMERA_TRANSPLANT_DEPARTMENT,
  'Medicine Program',
  'Peter Munk Cardiac Centre',
  'Schroeder Arthritis Institute',
  'Transitions Pathway',
  SPROTT_SURGERY_DEPARTMENT,
] as const;

function departmentForPathway(pathwayCode: string): string {
  return DEPARTMENT_BY_PATHWAY[pathwayCode] ?? SPROTT_SURGERY_DEPARTMENT;
}

function toFiscalYearStartYear(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function toFiscalQuarter(monthIndex: number): string {
  if (monthIndex >= 3 && monthIndex <= 5) return 'Q1';
  if (monthIndex >= 6 && monthIndex <= 8) return 'Q2';
  if (monthIndex >= 9 && monthIndex <= 11) return 'Q3';
  return 'Q4';
}

function fiscalYearLabelFromStartYear(startYear: number): string {
  return `FY${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function reportingPeriodKeyForDate(d: Date): string {
  const startYear = toFiscalYearStartYear(d);
  const quarter = toFiscalQuarter(d.getMonth());
  return `${fiscalYearLabelFromStartYear(startYear)}-${quarter}`;
}

/**
 * Support-line and check-in total call charts: treat a discharge month as having
 * final call totals only once today is at least 90 calendar days after the last day
 * of that month. Ineligible months show a grey placeholder bar and no value label.
 */
function isCallVolumeMonthDisplayEligible(
  monthStart: Date,
  now: Date = new Date()
): boolean {
  const y = monthStart.getFullYear();
  const m = monthStart.getMonth();
  const lastDayOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);
  const eligibleAt = new Date(lastDayOfMonth);
  eligibleAt.setDate(eligibleAt.getDate() + 90);
  return now.getTime() >= eligibleAt.getTime();
}

function buildAllProgramsClinicalPctByMonthKey(
  bundle: AnalyticsBundle | null,
  selectedReportingPeriods: readonly string[],
  allProgramCarePaths: readonly string[],
  numeratorKey: 'contact24Numerator' | 'weekendNumerator'
): Map<string, number | null> {
  const m = new Map<string, number | null>();
  if (!bundle) return m;
  for (const roll of bundle.clinicalRollups) {
    if (
      !selectedReportingPeriods.includes(
        reportingPeriodKeyForDate(roll.monthStart)
      )
    ) {
      continue;
    }
    const slices = roll.byPathway.filter((slice) =>
      allProgramCarePaths.includes(slice.carePath)
    );
    if (!slices.length) continue;
    let volume = 0;
    let numerator = 0;
    for (const s of slices) {
      volume += s.volume;
      numerator += s[numeratorKey];
    }
    m.set(roll.monthKey, volume > 0 ? (100 * numerator) / volume : null);
  }
  return m;
}

function buildFiscalYearGroups(bundle: AnalyticsBundle | null): FiscalYearGroup[] {
  if (!bundle) return [];
  const byFiscalYear = new Map<number, Set<string>>();
  for (const roll of bundle.clinicalRollups) {
    const startYear = toFiscalYearStartYear(roll.monthStart);
    const quarter = toFiscalQuarter(roll.monthStart.getMonth());
    const existing = byFiscalYear.get(startYear);
    if (existing) {
      existing.add(quarter);
    } else {
      byFiscalYear.set(startYear, new Set([quarter]));
    }
  }

  return [...byFiscalYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([startYear, quarters]) => {
      const fiscalYearLabel = fiscalYearLabelFromStartYear(startYear);
      const quarterOrder: Array<{ quarter: string; range: string }> = [
        { quarter: 'Q1', range: `Apr - Jun ${startYear}` },
        { quarter: 'Q2', range: `Jul - Sep ${startYear}` },
        { quarter: 'Q3', range: `Oct - Dec ${startYear}` },
        { quarter: 'Q4', range: `Jan - Mar ${startYear + 1}` },
      ];
      const options = quarterOrder
        .filter(({ quarter }) => quarters.has(quarter))
        .map(({ quarter, range }) => ({
          key: `${fiscalYearLabel}-${quarter}`,
          quarterLabel: quarter,
          dateRangeLabel: range,
        }));
      return { fiscalYearLabel, options };
    })
    .filter((group) => group.options.length > 0);
}

function sameValuesInSameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildEnrolmentCumulativeStackRows(
  monthlyRows: Array<Record<string, string | number>>,
  categoryCount: number
): Array<Record<string, string | number>> {
  if (!monthlyRows.length) return [];
  const sums = Array.from({ length: categoryCount }, () => 0);
  return monthlyRows.map((monthRow) => {
    const row: Record<string, string | number> = {
      month: monthRow.month as string,
    };
    let stackTotal = 0;
    for (let i = 0; i < categoryCount; i += 1) {
      sums[i] += Number(monthRow[`_e${i}`]) || 0;
      row[`_e${i}`] = sums[i];
      stackTotal += sums[i];
    }
    row.volume = stackTotal;
    return row;
  });
}

/** Cumulative stacked segments for TG/TW enrolment pillars (paired `tg_e*`, `tw_e*` keys per month row). */
function buildEnrolmentCumulativeSiteSplitStackRows(
  monthlyRows: Array<Record<string, string | number>>,
  categoryCount: number
): Array<Record<string, string | number>> {
  if (!monthlyRows.length) return [];
  const sumsTg = Array.from({ length: categoryCount }, () => 0);
  const sumsTw = Array.from({ length: categoryCount }, () => 0);
  return monthlyRows.map((monthRow) => {
    const row: Record<string, string | number> = {
      month: monthRow.month as string,
    };
    let tgTotals = 0;
    let twTotals = 0;
    for (let i = 0; i < categoryCount; i += 1) {
      sumsTg[i] += Number(monthRow[`tg_e${i}`]) || 0;
      sumsTw[i] += Number(monthRow[`tw_e${i}`]) || 0;
      row[`tg_e${i}`] = sumsTg[i];
      row[`tw_e${i}`] = sumsTw[i];
      tgTotals += sumsTg[i];
      twTotals += sumsTw[i];
    }
    row.volume = tgTotals + twTotals;
    return row;
  });
}

function enrolPctSiteStratSimpleMonthly(
  rows: ReadonlyArray<Record<string, string | number>>
): Array<Record<string, string | number>> {
  if (!rows.length) return [];
  const grandTotal = rows.reduce((s, r) => s + ((Number(r.tgVol) || 0) + (Number(r.twVol) || 0)), 0);
  if (grandTotal <= 0) {
    return rows.map((row) => ({
      ...row,
      _enrolPctMode: 1,
      _raw_volume: 0,
      volume: 0,
      tgVol: 0,
      twVol: 0,
      _raw_tgVol: 0,
      _raw_twVol: 0,
    }));
  }
  return rows.map((row) => {
    const tg = Number(row.tgVol) || 0;
    const tw = Number(row.twVol) || 0;
    const sum = tg + tw;
    return {
      ...row,
      _enrolPctMode: 1,
      month: row.month,
      volume: (sum / grandTotal) * 100,
      _raw_volume: sum,
      _raw_tgVol: tg,
      _raw_twVol: tw,
      tgVol: (tg / grandTotal) * 100,
      twVol: (tw / grandTotal) * 100,
    };
  });
}

function enrolPctSiteStratSimpleCumulative(
  rows: ReadonlyArray<Record<string, string | number>>
): Array<Record<string, string | number>> {
  if (!rows.length) return [];
  const last = rows[rows.length - 1];
  const grandCum = Number(last?.volume) || 0;
  if (grandCum <= 0) {
    return rows.map((row) => ({
      ...row,
      _enrolPctMode: 1,
      _raw_volume: 0,
      _raw_priorTGCumulative: 0,
      _raw_priorTWCumulative: 0,
      _raw_tgMonthAdded: 0,
      _raw_twMonthAdded: 0,
      volume: 0,
      priorTGCumulative: 0,
      priorTWCumulative: 0,
      tgMonthAdded: 0,
      twMonthAdded: 0,
    }));
  }
  return rows.map((row) => {
    const rv = Number(row.volume) || 0;
    const rpt = Number(row.priorTGCumulative) || 0;
    const rtta = Number(row.tgMonthAdded) || 0;
    const rpw = Number(row.priorTWCumulative) || 0;
    const rtw = Number(row.twMonthAdded) || 0;
    return {
      ...row,
      _enrolPctMode: 1,
      _raw_volume: rv,
      _raw_priorTGCumulative: rpt,
      _raw_priorTWCumulative: rpw,
      _raw_tgMonthAdded: rtta,
      _raw_twMonthAdded: rtw,
      volume: (rv / grandCum) * 100,
      priorTGCumulative: (rpt / grandCum) * 100,
      tgMonthAdded: (rtta / grandCum) * 100,
      priorTWCumulative: (rpw / grandCum) * 100,
      twMonthAdded: (rtw / grandCum) * 100,
    };
  });
}

type EnrolLegendPayloadEntry = {
  value: unknown;
  color: string;
};

/** Care-path breakdown list (paired bar colours via `payload` from parent). */
function EnrolBreakdownLegendContent(props: {
  payload?: readonly EnrolLegendPayloadEntry[];
  soloCategory: string | null;
  onToggleSolo: (label: string) => void;
  variant?: 'inline' | 'side';
}) {
  const { payload, soloCategory, onToggleSolo, variant = 'inline' } = props;
  if (!payload?.length) return null;
  return (
    <ul
      className={`enrol-breakdown-legend${variant === 'side' ? ' enrol-breakdown-legend--side' : ''}`}
    >
      {payload.map((entry, i) => {
        const label = String(entry.value ?? '');
        const isSolo = soloCategory === label;
        const isDimmed = soloCategory !== null && !isSolo;
        return (
          <li key={`${label}:${i}`}>
            <button
              type="button"
              className={`enrol-breakdown-legend-btn${isSolo ? ' enrol-breakdown-legend-btn--solo' : ''}${isDimmed ? ' enrol-breakdown-legend-btn--dimmed' : ''}`}
              onClick={() => onToggleSolo(label)}
              aria-pressed={isSolo}
              title={
                soloCategory === null
                  ? 'Show only this series (click again to reset)'
                  : isSolo
                    ? 'Clear filter'
                    : 'Show only this series'
              }
            >
              <span
                className="enrol-breakdown-legend-swatch"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              <span className="enrol-breakdown-legend-label">{label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function rechartsGeomNumber(v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

const ENROL_BAR_LABEL_PROP_STRIP = new Set([
  'x',
  'y',
  'width',
  'height',
  'value',
  'offset',
  'index',
  'fill',
  'stroke',
  'textAnchor',
  'verticalAnchor',
  'parentViewBox',
  'viewBox',
  'payload',
  'name',
  'color',
  'dataKey',
  'position',
]);

/** Chart datum for stacked LabelList (`payload`, or flattened props in some Recharts versions). */
function enrolBarLabelDatumFromLabelProps(
  p: Record<string, unknown>
): Record<string, unknown> | undefined {
  const rawPayload = p.payload;
  if (
    rawPayload !== null &&
    typeof rawPayload === 'object' &&
    !Array.isArray(rawPayload)
  ) {
    const o = rawPayload as Record<string, unknown>;
    if (
      typeof o.month === 'string' &&
      (Object.keys(o).some(
        (k) => /^_e\d+$/.test(k) || /^tg_e\d+$/.test(k) || /^tw_e\d+$/.test(k)
      ) ||
        'volume' in o)
    ) {
      return o;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (ENROL_BAR_LABEL_PROP_STRIP.has(k)) continue;
    out[k] = v;
  }
  if (
    typeof out.month === 'string' &&
    (Object.keys(out).some(
      (k) => /^_e\d+$/.test(k) || /^tg_e\d+$/.test(k) || /^tw_e\d+$/.test(k)
    ) ||
      'volume' in out)
  ) {
    return out;
  }
  return undefined;
}

/**
 * Recharts 3 forwards `LabelList` labels through `svgPropertiesAndEvents`, which drops
 * `payload` from props passed to custom `content`. `valueAccessor` still receives the full
 * list entry (`entry.payload`). We put the month key in `Label.value` (`RenderableText`) and
 * look up the row in-chart (same pattern needed for typings in recharts ≥3).
 */
function enrolStackLabelRowFromContentProps(
  p: Record<string, unknown>,
  rowByMonth: Map<string, Record<string, unknown>>
): Record<string, unknown> | undefined {
  const v = p.value;
  if (typeof v === 'string') {
    const byMonth = rowByMonth.get(v);
    if (byMonth != null) return byMonth;
  }
  return enrolBarLabelDatumFromLabelProps(p);
}

/**
 * Renders stack total once per column on the visually top segment (% Total mode
 * uses the same pct-of-grand-total wording as single-bar Month view).
 */
function EnrolStackVolumeTopLabel(
  props: {
    x?: number | string;
    y?: number | string;
    width?: number | string;
    payload?: Record<string, unknown>;
    segmentIndex: number;
    categoryCount: number;
    enrolmentYPercentTotal: boolean;
    pctGrandDenom: number;
    /** Pixels to move text above the bar top (Recharts `Label` + function `content` skips `getCartesianPosition`). */
    liftPx?: number;
  }
) {
  const {
    x: xIn,
    y: yIn,
    width: wIn,
    payload,
    segmentIndex,
    categoryCount,
    enrolmentYPercentTotal,
    pctGrandDenom,
    liftPx = 6,
  } = props;
  const x = rechartsGeomNumber(xIn);
  const y = rechartsGeomNumber(yIn);
  const width = rechartsGeomNumber(wIn);
  if (payload == null || x === undefined || y === undefined) return null;

  let topSegment = -1;
  for (let j = categoryCount - 1; j >= 0; j--) {
    const segVal = payload._enrolPctMode
      ? Number(payload[`_raw_e${j}`])
      : Number(payload[`_e${j}`]);
    if (Number.isFinite(segVal) && segVal > 0) {
      topSegment = j;
      break;
    }
  }
  if (topSegment !== segmentIndex) return null;

  const pctMode = Boolean(payload._enrolPctMode);
  const rawTotal = pctMode ? Number(payload._raw_volume) : Number(payload.volume);
  if (!Number.isFinite(rawTotal) || rawTotal <= 0) return null;

  let labelStr: string;
  if (
    pctMode &&
    enrolmentYPercentTotal &&
    Number.isFinite(pctGrandDenom) &&
    pctGrandDenom > 0
  ) {
    labelStr = `${((rawTotal / pctGrandDenom) * 100).toFixed(1)}%`;
  } else {
    labelStr = String(rawTotal);
  }

  const w = width ?? 0;
  const textY = y - liftPx;
  return (
    <text
      x={x + (w > 0 ? w / 2 : 0)}
      y={textY}
      fill="#000000"
      fontSize={12}
      fontWeight={700}
      textAnchor="middle"
      dominantBaseline="auto"
    >
      {labelStr}
    </text>
  );
}

function enrolPctYAxisCeilPct(maxPct: number): number {
  if (!Number.isFinite(maxPct) || maxPct <= 0) return 1;
  let upper = Math.min(100, Math.ceil(maxPct * 1.06 * 10) / 10);
  if (upper > 92) upper = 100;
  return upper || 100;
}

/** Recharts tick values can be 100.00000000000001; format so labels stay short and readable. */
function formatEnrolPctYAxisTick(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  const cleaned = Math.round(n * 1e6) / 1e6;
  const nearestInt = Math.round(cleaned);
  if (Math.abs(cleaned - nearestInt) < 1e-5) return `${nearestInt}%`;
  const oneDecimal = Math.round(cleaned * 10) / 10;
  return `${oneDecimal}%`;
}

/**
 * Copies chart rows with Y-values as % total; keeps `_raw_*` counts for labels and tooltip.
 */
function enrolChartRowsPercentTotal(
  rows: ReadonlyArray<Record<string, string | number>>,
  opts: {
    useLegendBreakdown: boolean;
    chartView: 'monthly' | 'cumulative';
    categoryCount: number;
    /** TG vs TW paired stacks (Medicine Program site stratify). */
    siteSplitStacks?: boolean;
  }
): Array<Record<string, string | number>> {
  if (!rows.length) return [];
  const { useLegendBreakdown, chartView, categoryCount, siteSplitStacks } = opts;

  if (useLegendBreakdown) {
    return rows.map((row) => {
      const out: Record<string, string | number> = {
        month: row.month as string,
        _enrolPctMode: 1,
      };
      const denom = Number(row.volume) || 0;
      out._raw_volume = denom;
      if (denom <= 0) {
        out.volume = 0;
        for (let i = 0; i < categoryCount; i += 1) {
          if (siteSplitStacks) {
            out[`_raw_tg_e${i}`] = 0;
            out[`_raw_tw_e${i}`] = 0;
            out[`tg_e${i}`] = 0;
            out[`tw_e${i}`] = 0;
          } else {
            out[`_raw_e${i}`] = 0;
            out[`_e${i}`] = 0;
          }
        }
        return out;
      }
      let sumPct = 0;
      for (let i = 0; i < categoryCount; i += 1) {
        if (siteSplitStacks) {
          const rawTg = Number(row[`tg_e${i}`]) || 0;
          const rawTw = Number(row[`tw_e${i}`]) || 0;
          out[`_raw_tg_e${i}`] = rawTg;
          out[`_raw_tw_e${i}`] = rawTw;
          const pctTg = (rawTg / denom) * 100;
          const pctTw = (rawTw / denom) * 100;
          out[`tg_e${i}`] = pctTg;
          out[`tw_e${i}`] = pctTw;
          sumPct += pctTg + pctTw;
        } else {
          const raw = Number(row[`_e${i}`]) || 0;
          out[`_raw_e${i}`] = raw;
          const pct = (raw / denom) * 100;
          out[`_e${i}`] = pct;
          sumPct += pct;
        }
      }
      out.volume = sumPct;
      return out;
    });
  }

  if (chartView === 'monthly') {
    const grandTotal = rows.reduce(
      (s, r) => s + (Number((r as { volume?: number }).volume) || 0),
      0
    );
    if (grandTotal <= 0) {
      return rows.map((row) => ({
        ...row,
        _enrolPctMode: 1,
        _raw_volume: 0,
        volume: 0,
      }));
    }
    return rows.map((row) => {
      const raw = Number(row.volume) || 0;
      return {
        ...row,
        _enrolPctMode: 1,
        _raw_volume: raw,
        volume: (raw / grandTotal) * 100,
      };
    });
  }

  const last = rows[rows.length - 1] as { volume?: number };
  const grandCum = Number(last?.volume) || 0;
  if (grandCum <= 0) {
    return rows.map((row) => ({
      ...row,
      _enrolPctMode: 1,
      _raw_volume: 0,
      _raw_priorCumulative: 0,
      _raw_monthAdded: 0,
      volume: 0,
      priorCumulative: 0,
      monthAdded: 0,
    }));
  }
  return rows.map((row) => {
    const rawVol = Number(row.volume) || 0;
    const rawPrior = Number((row as { priorCumulative?: number }).priorCumulative) || 0;
    const rawAdded = Number((row as { monthAdded?: number }).monthAdded) || 0;
    return {
      ...row,
      _enrolPctMode: 1,
      _raw_volume: rawVol,
      _raw_priorCumulative: rawPrior,
      _raw_monthAdded: rawAdded,
      volume: (rawVol / grandCum) * 100,
      priorCumulative: (rawPrior / grandCum) * 100,
      monthAdded: (rawAdded / grandCum) * 100,
    };
  });
}

/** Sum shown in tooltip header: month total count, or raw total in % mode. */
function enrolmentTooltipTotalDisplay(
  row: Record<string, unknown>,
  payload: readonly unknown[],
  pctMode: boolean
): string | null {
  if (pctMode) {
    const rawVol = Number(row._raw_volume);
    if (Number.isFinite(rawVol) && rawVol >= 0) {
      return String(Math.round(rawVol));
    }
    let sum = 0;
    for (const key of Object.keys(row)) {
      if (key.startsWith('_raw_e') && !key.startsWith('_raw_e_')) {
        sum += Number(row[key]) || 0;
      }
    }
    if (sum <= 0) {
      for (const key of Object.keys(row)) {
        if (key.startsWith('_raw_tg_e') || key.startsWith('_raw_tw_e')) {
          sum += Number(row[key]) || 0;
        }
      }
    }
    return sum > 0 ? String(Math.round(sum)) : null;
  }
  const vol = Number(row.volume);
  if (Number.isFinite(vol) && vol >= 0) {
    return String(Math.round(vol));
  }
  let sum = 0;
  for (const raw of payload) {
    const entry = raw as { value?: unknown };
    const n = typeof entry.value === 'number' ? entry.value : Number(entry.value);
    if (Number.isFinite(n)) sum += n;
  }
  return sum > 0 ? String(Math.round(sum)) : null;
}

function EnrolmentChartTooltip(props: {
  active?: boolean;
  label?: string;
  /** Recharts Tooltip payload entries (typed loosely for compatibility). */
  payload?: readonly unknown[];
  pctMode: boolean;
}) {
  const { active, label, payload, pctMode } = props;
  if (!active || !payload?.length) return null;
  const first = payload[0] as { payload?: Record<string, unknown> };
  const row = first.payload;
  if (!row) return null;

  const totalDisplay = enrolmentTooltipTotalDisplay(row, payload, pctMode);

  const fmtVal = (dataKey: string | number | undefined, value: unknown) => {
    if (!pctMode) return String(value ?? '—');
    const key = String(dataKey ?? '');
    let raw: unknown;
    if (key === 'volume') raw = row._raw_volume;
    else if (key === 'priorCumulative') raw = row._raw_priorCumulative;
    else if (key === 'monthAdded') raw = row._raw_monthAdded;
    else if (/^_e\d+$/.test(key)) {
      const m = /^_e(\d+)$/.exec(key);
      raw = m ? row[`_raw_e${m[1]}`] : undefined;
    } else if (/^tg_e\d+$/.test(key)) {
      const m = /^tg_e(\d+)$/.exec(key);
      raw = m ? row[`_raw_tg_e${m[1]}`] : undefined;
    } else if (/^tw_e\d+$/.test(key)) {
      const m = /^tw_e(\d+)$/.exec(key);
      raw = m ? row[`_raw_tw_e${m[1]}`] : undefined;
    } else if (key === 'tgVol') raw = row._raw_tgVol;
    else if (key === 'twVol') raw = row._raw_twVol;
    else if (key === 'priorTGCumulative')
      raw = row._raw_priorTGCumulative;
    else if (key === 'priorTWCumulative')
      raw = row._raw_priorTWCumulative;
    else if (key === 'tgMonthAdded') raw = row._raw_tgMonthAdded;
    else if (key === 'twMonthAdded') raw = row._raw_twMonthAdded;
    const n = typeof value === 'number' ? value : Number(value);
    const pctStr = Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
    const rawN = typeof raw === 'number' ? raw : Number(raw);
    const rawStr = Number.isFinite(rawN) ? ` (n=${rawN})` : '';
    return `${pctStr}${rawStr}`;
  };

  return (
    <div className="enrol-chart-tooltip">
      <div className="enrol-chart-tooltip-header">
        <p className="enrol-chart-tooltip-label">{label}</p>
        {totalDisplay != null ? (
          <span
            className="enrol-chart-tooltip-total"
            aria-label={`Total ${totalDisplay}`}
          >
            {totalDisplay}
          </span>
        ) : null}
      </div>
      <ul className="enrol-chart-tooltip-list">
        {payload.map((rawEntry, i) => {
          const entry = rawEntry as {
            name?: string | number;
            value?: unknown;
            color?: string;
            dataKey?: string | number;
          };
          return (
          <li key={`${String(entry.dataKey ?? i)}:${i}`}>
            <span
              className="enrol-chart-tooltip-swatch"
              style={{ backgroundColor: entry.color ?? 'transparent' }}
              aria-hidden
            />
            <span className="enrol-chart-tooltip-name">
              {entry.name != null ? String(entry.name) : ''}
            </span>
            <span className="enrol-chart-tooltip-value">
              {fmtVal(entry.dataKey, entry.value)}
            </span>
          </li>
          );
        })}
      </ul>
    </div>
  );
}

function ClinicalMonthlyPctTrendCard(props: {
  cardClassName: string;
  title: string;
  isAllProgramsCohort: boolean;
  monthlyRows: ClinicalMonthlyPctKpiRow[];
  tooltipMetricPhrase: string;
}) {
  const {
    cardClassName,
    title,
    isAllProgramsCohort,
    monthlyRows,
    tooltipMetricPhrase,
  } = props;
  return (
    <div className={`card ${cardClassName}`}>
      <h4>{title}</h4>
      {monthlyRows.length === 0 ? (
        <p className="clinical-kpi-sub">
          No linked enrolments for the current filters.
        </p>
      ) : (
        <div className="clinical-contact24-chart">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={monthlyRows}
              margin={{
                top: 20,
                right: 8,
                left: 4,
                bottom: 52,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                angle={-45}
                textAnchor="end"
                height={56}
                interval={0}
                minTickGap={0}
                tickMargin={4}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                domain={[0, 100]}
                tickCount={6}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) =>
                  clinicalPctDisplayWhole(Number(v))
                }
                width={48}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as {
                    pct: number | null;
                    allProgramsPct: number | null;
                    numerator: number;
                    volume: number;
                  };
                  if (!row) return null;
                  const selStr =
                    row.pct != null && Number.isFinite(row.pct)
                      ? clinicalPctDisplayWhole(row.pct)
                      : '—';
                  const refStr =
                    row.allProgramsPct != null &&
                    Number.isFinite(row.allProgramsPct)
                      ? clinicalPctDisplayWhole(row.allProgramsPct)
                      : null;
                  return (
                    <div className="clinical-contact24-tooltip">
                      <div className="clinical-contact24-tooltip-month">
                        {label != null ? String(label) : ''}
                      </div>
                      <div className="clinical-contact24-tooltip-pct">
                        Selected: {selStr} {tooltipMetricPhrase}
                      </div>
                      {!isAllProgramsCohort && refStr != null ? (
                        <div className="clinical-contact24-tooltip-ref">
                          All programs: {refStr}
                        </div>
                      ) : null}
                      <div className="clinical-contact24-tooltip-sub">
                        Selected cohort:{' '}
                        {row.volume > 0
                          ? `${row.numerator.toLocaleString()} of ${row.volume.toLocaleString()} enrolments (discharge month)`
                          : '—'}
                      </div>
                    </div>
                  );
                }}
              />
              {!isAllProgramsCohort ? (
                <Line
                  type="monotone"
                  dataKey="allProgramsPct"
                  name="All programs"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                />
              ) : null}
              <Line
                type="monotone"
                dataKey="pct"
                name="Selected cohort"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={{ r: 3.5, strokeWidth: 1.5 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              >
                <LabelList
                  dataKey="pct"
                  position="top"
                  offset={6}
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--text, #0f172a)"
                  formatter={(v: unknown) =>
                    typeof v === 'number' && Number.isFinite(v)
                      ? clinicalPctDisplayWhole(v)
                      : ''
                  }
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Hexbin density: X = check-in calls, Y = support line calls (blank → 0); one linked enrolment per patient row. */
function ClinicalSupportCheckInCorrelationCard(props: {
  cardClassName: string;
  points: SupportCheckInCorrelationPoint[];
}) {
  const { cardClassName, points } = props;
  const hasPoints = points.length > 0;

  return (
    <div className={`card ${cardClassName}`}>
      <h4>Support line vs check-in calls</h4>
      <p className="clinical-kpi-sub clinical-correlation-sub">
        Hexagonal bins show how many linked enrolments fall in each region (light blue = fewer,
        dark blue = more). Axes: scheduled check-in calls (horizontal) and 24/7 support-line
        calls (vertical); blank support counts are treated as 0.
      </p>
      {!hasPoints ? (
        <p className="clinical-kpi-sub">
          No linked enrolments for the current filters.
        </p>
      ) : (
        <div className="clinical-contact24-chart clinical-correlation-chart">
          <SupportCheckInCorrelationHexbin points={points} />
        </div>
      )}
    </div>
  );
}

/** Total vs avg/patient calls with optional program-wide reference (bar / line). */
function ClinicalCallsToggleChartCard(props: {
  title: string;
  cardClassName: string;
  radioGroupName: string;
  radiogroupAriaLabel: string;
  metricMode: SupportLineMetricMode;
  onMetricModeChange: (mode: SupportLineMetricMode) => void;
  monthlyRowsTotal: CallsToggleTotalRow[];
  monthlyRowsAvg: CallsMetricAvgMonthRow[];
  yAxisMax: number;
  isAllProgramsCohort: boolean;
}) {
  const {
    title,
    cardClassName,
    radioGroupName,
    radiogroupAriaLabel,
    metricMode,
    onMetricModeChange,
    monthlyRowsTotal,
    monthlyRowsAvg,
    yAxisMax,
    isAllProgramsCohort,
  } = props;

  const hasTotalData = monthlyRowsTotal.length > 0;
  const hasAvgData = monthlyRowsAvg.length > 0;
  const showChart =
    metricMode === 'total' ? hasTotalData : hasAvgData;

  const tooltipSuffixTotal = 'calls';
  const tooltipSuffixAvg = 'avg calls / patient';

  const chartMarginsBar = {
    top: 22,
    right: 8,
    left: 4,
    bottom: 52,
  };
  const chartMarginsLine = {
    top: 26,
    right: 8,
    left: 4,
    bottom: 52,
  };

  const lineAvgXAxisTick = useCallback(
    (tickProps: XAxisTickContentProps) => {
      const x = rechartsGeomNumber(tickProps.x) ?? 0;
      const y = rechartsGeomNumber(tickProps.y) ?? 0;
      const payload = tickProps.payload as { value?: string } | undefined;
      const index =
        typeof tickProps.index === 'number' ? tickProps.index : -1;
      const monthStr = String(payload?.value ?? '');
      const row = index >= 0 ? monthlyRowsAvg[index] : undefined;
      const showNa =
        row != null &&
        (row.fillVariant === 'pending' ||
          row.calls == null ||
          !Number.isFinite(row.calls));
      return (
        <g transform={`translate(${x},${y})`}>
          <text
            textAnchor="end"
            fill="var(--text, #0f172a)"
            fontSize={10}
          >
            <tspan>{monthStr}</tspan>
            {showNa ? (
              <tspan fill="rgba(148, 163, 184, 0.92)" fontWeight={500}>
                {' N/A'}
              </tspan>
            ) : null}
          </text>
        </g>
      );
    },
    [monthlyRowsAvg]
  );

  const callsTotalXAxisTick = useCallback(
    (tickProps: XAxisTickContentProps) => {
      const x = rechartsGeomNumber(tickProps.x) ?? 0;
      const y = rechartsGeomNumber(tickProps.y) ?? 0;
      const payload = tickProps.payload as { value?: string } | undefined;
      const index =
        typeof tickProps.index === 'number' ? tickProps.index : -1;
      const monthStr = String(payload?.value ?? '');
      const row = index >= 0 ? monthlyRowsTotal[index] : undefined;
      const showNa = row?.fillVariant === 'pending';
      return (
        <g transform={`translate(${x},${y})`}>
          <text
            textAnchor="end"
            fill="var(--text, #0f172a)"
            fontSize={10}
          >
            <tspan>{monthStr}</tspan>
            {showNa ? (
              <tspan fill="rgba(148, 163, 184, 0.92)" fontWeight={500}>
                {' N/A'}
              </tspan>
            ) : null}
          </text>
        </g>
      );
    },
    [monthlyRowsTotal]
  );

  const pendingPlaceholderFill = 'rgba(148, 163, 184, 0.42)';
  const callsTotalBarShape = useCallback(
    (
      rectProps: BarRectangleItem & { index?: number },
      barIndexArg?: number
    ) => {
      const ix =
        typeof rectProps.index === 'number'
          ? rectProps.index
          : typeof barIndexArg === 'number'
            ? barIndexArg
            : undefined;
      const row =
        (rectProps.payload as CallsToggleTotalRow | undefined) ??
        (typeof ix === 'number' ? monthlyRowsTotal[ix] : undefined);
      const fill =
        rectProps.fill ??
        (row?.fillVariant === 'pending'
          ? pendingPlaceholderFill
          : 'var(--accent)');
      const radius: [number, number, number, number] = [4, 4, 0, 0];
      return <Rectangle {...rectProps} fill={fill} radius={radius} />;
    },
    [monthlyRowsTotal]
  );

  return (
    <div className={`card ${cardClassName}`}>
      <h4>{title}</h4>
      <div
        className="clinical-support-line-metric-toggle"
        role="radiogroup"
        aria-label={radiogroupAriaLabel}
      >
        <label className="clinical-support-line-metric-option">
          <input
            type="radio"
            name={radioGroupName}
            checked={metricMode === 'total'}
            onChange={() => onMetricModeChange('total')}
          />
          <span>Total # Calls</span>
        </label>
        <label className="clinical-support-line-metric-option">
          <input
            type="radio"
            name={radioGroupName}
            checked={metricMode === 'avgPerPatient'}
            onChange={() => onMetricModeChange('avgPerPatient')}
          />
          <span>Avg # Calls/Patient</span>
        </label>
      </div>
      {!showChart ? (
        <p className="clinical-kpi-sub">
          No linked enrolments for the current filters.
        </p>
      ) : metricMode === 'total' ? (
        <div className="clinical-contact24-chart">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={monthlyRowsTotal}
              margin={chartMarginsBar}
              barCategoryGap="18%"
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                angle={-45}
                textAnchor="end"
                height={56}
                interval={0}
                minTickGap={0}
                tickMargin={4}
                tick={callsTotalXAxisTick}
              />
              <YAxis
                domain={[0, yAxisMax]}
                tickCount={6}
                allowDecimals={false}
                tick={{ fontSize: 11 }}
                width={48}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as CallsToggleTotalRow;
                  const raw = payload[0]?.value;
                  const n = typeof raw === 'number' ? raw : Number(raw);
                  if (row?.fillVariant === 'pending') {
                    const snap = row.tooltipActualCalls;
                    return (
                      <div className="clinical-contact24-tooltip">
                        <div className="clinical-contact24-tooltip-month">
                          {label != null ? String(label) : ''}
                        </div>
                        <div className="clinical-contact24-tooltip-pct">
                          Incomplete month (90-day follow-up)
                        </div>
                        <div className="clinical-contact24-tooltip-sub">
                          Final totals shown once 90 days have passed after the
                          last day of this month. Snapshot to date:{' '}
                          {typeof snap === 'number' && Number.isFinite(snap)
                            ? `${snap.toLocaleString()} ${tooltipSuffixTotal}`
                            : '—'}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="clinical-contact24-tooltip">
                      <div className="clinical-contact24-tooltip-month">
                        {label != null ? String(label) : ''}
                      </div>
                      <div className="clinical-contact24-tooltip-pct">
                        {Number.isFinite(n)
                          ? `${formatCallsMetricDisplay('total', n)} ${tooltipSuffixTotal}`
                          : '—'}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="calls"
                name="Calls"
                radius={[4, 4, 0, 0]}
                shape={callsTotalBarShape}
              >
                {monthlyRowsTotal.map((entry, index) => (
                  <Cell
                    key={`support-bar-${entry.month}:${index}`}
                    fill={
                      entry.fillVariant === 'pending'
                        ? pendingPlaceholderFill
                        : 'var(--accent)'
                    }
                  />
                ))}
                <LabelList
                  dataKey="calls"
                  position="top"
                  offset={6}
                  fontSize={9}
                  fontWeight={600}
                  fill="var(--text, #0f172a)"
                  content={(props) => {
                    /**
                     * Recharts ≥3 strips non-SVG keys from label props, so `payload` is absent in
                     * custom `content`. Resolve the row by bar index (matches `monthlyRowsTotal`).
                     */
                    const idx = props.index;
                    const row =
                      (props as { payload?: CallsToggleTotalRow }).payload ??
                      (typeof idx === 'number' ? monthlyRowsTotal[idx] : undefined);
                    if (row?.fillVariant === 'pending') return null;
                    const v = props.value;
                    const n = typeof v === 'number' ? v : Number(v);
                    if (!Number.isFinite(n)) return null;
                    const xLeft = rechartsGeomNumber(props.x);
                    const vb = props.viewBox;
                    const vbWidth =
                      vb != null &&
                      typeof vb === 'object' &&
                      'width' in vb &&
                      !('cx' in vb)
                        ? rechartsGeomNumber(
                            (vb as { width?: number | string }).width
                          )
                        : undefined;
                    const w = rechartsGeomNumber(props.width) ?? vbWidth;
                    const y = rechartsGeomNumber(props.y);
                    if (y === undefined) return null;
                    const cx =
                      xLeft !== undefined && w !== undefined && w > 0
                        ? xLeft + w / 2
                        : xLeft;
                    if (cx === undefined) return null;
                    return (
                      <text
                        x={cx}
                        y={y}
                        dy={-5}
                        fill="var(--text, #0f172a)"
                        fontSize={9}
                        fontWeight={600}
                        textAnchor="middle"
                      >
                        {formatCallsMetricDisplay('total', n)}
                      </text>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="clinical-contact24-chart">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyRowsAvg} margin={chartMarginsLine}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                angle={-45}
                textAnchor="end"
                height={56}
                interval={0}
                minTickGap={0}
                tickMargin={4}
                tick={lineAvgXAxisTick}
              />
              <YAxis
                domain={[0, yAxisMax]}
                tickCount={6}
                allowDecimals
                tick={{ fontSize: 11 }}
                width={48}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as CallsMetricAvgMonthRow;
                  if (!row) return null;
                  if (
                    row.fillVariant === 'pending' ||
                    row.calls == null ||
                    !Number.isFinite(row.calls)
                  ) {
                    return (
                      <div className="clinical-contact24-tooltip">
                        <div className="clinical-contact24-tooltip-month">
                          {label != null ? String(label) : ''}
                        </div>
                        <div className="clinical-contact24-tooltip-pct">
                          N/A — incomplete month (90-day follow-up)
                        </div>
                        {!isAllProgramsCohort ? (
                          <div className="clinical-contact24-tooltip-ref">
                            All programs: —
                          </div>
                        ) : null}
                      </div>
                    );
                  }
                  const selStr = `${formatCallsMetricDisplay('avgPerPatient', row.calls)} ${tooltipSuffixAvg}`;
                  const refStr =
                    row.allProgramsAvg != null &&
                    Number.isFinite(row.allProgramsAvg)
                      ? `${formatCallsMetricDisplay('avgPerPatient', row.allProgramsAvg)} ${tooltipSuffixAvg}`
                      : null;
                  return (
                    <div className="clinical-contact24-tooltip">
                      <div className="clinical-contact24-tooltip-month">
                        {label != null ? String(label) : ''}
                      </div>
                      <div className="clinical-contact24-tooltip-pct">
                        Selected cohort: {selStr}
                      </div>
                      {!isAllProgramsCohort && refStr != null ? (
                        <div className="clinical-contact24-tooltip-ref">
                          All programs: {refStr}
                        </div>
                      ) : null}
                    </div>
                  );
                }}
              />
              {!isAllProgramsCohort ? (
                <Line
                  type="monotone"
                  dataKey="allProgramsAvg"
                  name="All programs"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="6 5"
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                />
              ) : null}
              <Line
                type="monotone"
                dataKey="calls"
                name="Selected cohort"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={(dotProps) => {
                  const p = dotProps.payload as CallsMetricAvgMonthRow;
                  if (
                    p?.calls == null ||
                    !Number.isFinite(p.calls) ||
                    dotProps.cx == null ||
                    dotProps.cy == null
                  ) {
                    return false;
                  }
                  return (
                    <circle
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      r={3.5}
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      fill="#fff"
                    />
                  );
                }}
                activeDot={(dotProps) => {
                  const p = dotProps.payload as CallsMetricAvgMonthRow;
                  if (
                    p?.calls == null ||
                    !Number.isFinite(p.calls) ||
                    dotProps.cx == null ||
                    dotProps.cy == null
                  ) {
                    return false;
                  }
                  return (
                    <circle
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      r={5}
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      fill="#fff"
                    />
                  );
                }}
                connectNulls={false}
              >
                <LabelList
                  dataKey="calls"
                  position="top"
                  offset={6}
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--text, #0f172a)"
                  formatter={(v: unknown) =>
                    typeof v === 'number' && Number.isFinite(v)
                      ? formatCallsMetricDisplay('avgPerPatient', v)
                      : ''
                  }
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function buildPathwayFilterGroups(bundle: AnalyticsBundle | null): PathwayFilterGroup[] {
  if (!bundle) return [];
  const byPathway = new Map<string, Map<string, number>>();
  for (const row of bundle.merged) {
    const pathway = extractPathway(row.carePath);
    const existing = byPathway.get(pathway);
    if (existing) {
      existing.set(row.carePath, (existing.get(row.carePath) ?? 0) + 1);
    } else {
      byPathway.set(pathway, new Map([[row.carePath, 1]]));
    }
  }
  return [...byPathway.entries()]
    .map(([pathway, carePathCounts]) => ({
      pathway,
      rowCount: [...carePathCounts.values()].reduce((sum, n) => sum + n, 0),
      carePaths: [...carePathCounts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([carePath, rowCount]) => ({ carePath, rowCount })),
    }))
    .sort((a, b) => a.pathway.localeCompare(b.pathway));
}

function nestPathwaysUnderDepartments(
  pathwayGroups: PathwayFilterGroup[]
): DepartmentFilterGroup[] {
  const byDept = new Map<string, PathwayFilterGroup[]>();
  for (const g of pathwayGroups) {
    const dept = departmentForPathway(g.pathway);
    const list = byDept.get(dept);
    if (list) {
      list.push(g);
    } else {
      byDept.set(dept, [g]);
    }
  }
  return DEPARTMENT_DISPLAY_ORDER.filter((dept) => byDept.has(dept)).map((department) => {
    const pathways = [...(byDept.get(department) ?? [])].sort((a, b) =>
      a.pathway.localeCompare(b.pathway)
    );
    const rowCount = pathways.reduce((sum, p) => sum + p.rowCount, 0);
    return { department, rowCount, pathways };
  });
}

function buildDepartmentPathwayFilterGroups(
  bundle: AnalyticsBundle | null
): DepartmentFilterGroup[] {
  return nestPathwaysUnderDepartments(buildPathwayFilterGroups(bundle));
}

function extractPathway(carePath: string): string {
  const segments = carePath.split('-').map((segment) => segment.trim());
  return segments[1] || carePath;
}

async function fileToBuffer(f: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(f);
  });
}

export default function App() {
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({});
  const [bundle, setBundle] = useState<AnalyticsBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<'clinical' | 'experience' | 'linkage'>(
    'clinical'
  );
  const [selectedFiscalYearLabels, setSelectedFiscalYearLabels] = useState<string[]>([]);
  const [selectedQuarterLabels, setSelectedQuarterLabels] = useState<string[]>([]);
  const [selectedCarePaths, setSelectedCarePaths] = useState<string[]>([]);
  const [enrolmentChartView, setEnrolmentChartView] = useState<
    'monthly' | 'cumulative'
  >('monthly');
  const [enrolmentLegendOn, setEnrolmentLegendOn] = useState(false);
  const [medicineEnrolStratBySite, setMedicineEnrolStratBySite] = useState(false);
  const [enrolmentYPercentTotal, setEnrolmentYPercentTotal] = useState(false);
  const [enrolLegendSoloCategory, setEnrolLegendSoloCategory] = useState<string | null>(
    null
  );
  const [ajmeraCarePathGroupMode, setAjmeraCarePathGroupMode] =
    useState<AjmeraCarePathGroupMode>('organTypeNp');
  const [supportLineMetricMode, setSupportLineMetricMode] =
    useState<SupportLineMetricMode>('total');
  const [checkInMetricMode, setCheckInMetricMode] =
    useState<SupportLineMetricMode>('total');
  const fiscalYearGroups = useMemo(() => buildFiscalYearGroups(bundle), [bundle]);

  const quartersWithData = useMemo(
    () =>
      [...new Set(fiscalYearGroups.flatMap((g) => g.options.map((o) => o.quarterLabel)))].sort(
        (a, b) => {
          const order = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
          return (
            order.indexOf(a as (typeof order)[number]) -
            order.indexOf(b as (typeof order)[number])
          );
        }
      ),
    [fiscalYearGroups]
  );

  const selectedReportingPeriods = useMemo(() => {
    if (!selectedFiscalYearLabels.length || !selectedQuarterLabels.length) return [];
    return fiscalYearGroups.flatMap((g) =>
      selectedFiscalYearLabels.includes(g.fiscalYearLabel)
        ? g.options
            .filter((o) => selectedQuarterLabels.includes(o.quarterLabel))
            .map((o) => o.key)
        : []
    );
  }, [fiscalYearGroups, selectedFiscalYearLabels, selectedQuarterLabels]);

  const fiscalYearLabelsInOrder = useMemo(
    () => fiscalYearGroups.map((g) => g.fiscalYearLabel),
    [fiscalYearGroups]
  );

  const pathwayFilterGroups = useMemo(() => buildPathwayFilterGroups(bundle), [bundle]);
  const departmentPathwayFilterGroups = useMemo(
    () => buildDepartmentPathwayFilterGroups(bundle),
    [bundle]
  );
  const allProgramCarePaths = useMemo(
    () =>
      pathwayFilterGroups.flatMap((group) =>
        group.carePaths.map((entry) => entry.carePath)
      ),
    [pathwayFilterGroups]
  );

  const isAllProgramsCohort = useMemo(
    () => sameCarePathSelection(selectedCarePaths, allProgramCarePaths),
    [selectedCarePaths, allProgramCarePaths]
  );

  useEffect(() => {
    const fyLabels = fiscalYearLabelsInOrder;
    const qLabels = quartersWithData;
    if (!fyLabels.length || !qLabels.length) {
      setSelectedFiscalYearLabels((prev) => (prev.length ? [] : prev));
      setSelectedQuarterLabels((prev) => (prev.length ? [] : prev));
      return;
    }
    setSelectedFiscalYearLabels((prev) => {
      const filtered = prev.filter((f) => fyLabels.includes(f));
      const next = filtered.length ? filtered : [...fyLabels];
      return sameValuesInSameOrder(prev, next) ? prev : next;
    });
    setSelectedQuarterLabels((prev) => {
      const filtered = prev.filter((q) => qLabels.includes(q));
      const next = filtered.length ? filtered : [...qLabels];
      return sameValuesInSameOrder(prev, next) ? prev : next;
    });
  }, [fiscalYearLabelsInOrder, quartersWithData]);

  const toggleFiscalYear = useCallback(
    (label: string) => {
      setSelectedFiscalYearLabels((prev) => {
        if (prev.includes(label)) {
          if (prev.length <= 1) return prev;
          return prev.filter((x) => x !== label);
        }
        return [...prev, label].sort(
          (a, b) => fiscalYearLabelsInOrder.indexOf(a) - fiscalYearLabelsInOrder.indexOf(b)
        );
      });
    },
    [fiscalYearLabelsInOrder]
  );

  const toggleQuarter = useCallback(
    (quarter: string) => {
      setSelectedQuarterLabels((prev) => {
        if (prev.includes(quarter)) {
          if (prev.length <= 1) return prev;
          return prev.filter((x) => x !== quarter);
        }
        return [...prev, quarter].sort(
          (a, b) => quartersWithData.indexOf(a) - quartersWithData.indexOf(b)
        );
      });
    },
    [quartersWithData]
  );

  useEffect(() => {
    const allCarePaths = pathwayFilterGroups.flatMap((group) =>
      group.carePaths.map((entry) => entry.carePath)
    );
    if (!allCarePaths.length) {
      setSelectedCarePaths((prev) => (prev.length ? [] : prev));
      return;
    }
    setSelectedCarePaths((prev) => {
      const filteredPrev = prev.filter((key) => allCarePaths.includes(key));
      const next = filteredPrev.length ? filteredPrev : allCarePaths;
      return sameValuesInSameOrder(prev, next) ? prev : next;
    });
  }, [pathwayFilterGroups]);

  const onFile = (slot: Slot, file: File | null) => {
    setFiles((prev) => {
      const n = { ...prev };
      if (file) n[slot] = file;
      else delete n[slot];
      return n;
    });
    setBundle(null);
  };

  const clearAll = () => {
    setFiles({});
    setBundle(null);
  };

  const generate = useCallback(async () => {
    if (
      !files.vha ||
      !files.flowsheet ||
      !files.peIp ||
      !files.peIc
    ) {
      return;
    }
    setBusy(true);
    setBundle(null);
    try {
      const inputs: ParsedInputs = {};

      if (files.vha) {
        const buf = await fileToBuffer(files.vha);
        let pr = parseSheetFromBuffer(buf, 'Export');
        if (pr.errors.length && !pr.rows.length) {
          pr = parseSheetFromBuffer(buf);
        }
        inputs.vha = { rows: pr.rows, sheet: 'Export' };
      }

      if (files.flowsheet) {
        const buf = await fileToBuffer(files.flowsheet);
        const pr = parseSheetFromBuffer(buf);
        inputs.flowsheet = { rows: pr.rows };
      }

      if (files.peIp) {
        const buf = await fileToBuffer(files.peIp);
        const pr = parseCsvBuffer(buf);
        inputs.peIp = { rows: pr.rows, headers: pr.headers };
      }

      if (files.peIc) {
        const buf = await fileToBuffer(files.peIc);
        const pr = parseCsvBuffer(buf);
        inputs.peIc = { rows: pr.rows, headers: pr.headers };
      }

      const b = buildAnalytics(inputs);
      setBundle(b);
    } finally {
      setBusy(false);
    }
  }, [files]);

  const exportXlsx = () => {
    if (!bundle) return;
    const wb = analyticsToWorkbook(bundle);
    downloadWorkbook(wb, 'ic-analytics-export.xlsx');
  };

  const exportPdf = () => {
    if (!bundle) return;
    downloadExecutivePdf(bundle);
  };

  const filteredClinicalRollups = bundle
    ? bundle.clinicalRollups
        .filter((roll) =>
          selectedReportingPeriods.includes(reportingPeriodKeyForDate(roll.monthStart))
        )
        .map((roll) => {
          const filteredByPathway = roll.byPathway.filter((slice) =>
            selectedCarePaths.includes(slice.carePath)
          );
          return {
            ...roll,
            byPathway: filteredByPathway,
          };
        })
        .filter((roll) => roll.byPathway.length > 0)
    : [];

  const allProgramsPctByMonthKey = useMemo(
    () =>
      buildAllProgramsClinicalPctByMonthKey(
        bundle,
        selectedReportingPeriods,
        allProgramCarePaths,
        'contact24Numerator'
      ),
    [bundle, selectedReportingPeriods, allProgramCarePaths]
  );

  const allProgramsWeekendPctByMonthKey = useMemo(
    () =>
      buildAllProgramsClinicalPctByMonthKey(
        bundle,
        selectedReportingPeriods,
        allProgramCarePaths,
        'weekendNumerator'
      ),
    [bundle, selectedReportingPeriods, allProgramCarePaths]
  );

  /** By hospital discharge month; same cohort and filters as enrolment volume chart. */
  const contactWithin24hByDcMonth = useMemo(() => {
    return filteredClinicalRollups.map((roll) => {
      let volume = 0;
      let numerator = 0;
      for (const s of roll.byPathway) {
        volume += s.volume;
        numerator += s.contact24Numerator;
      }
      const month = roll.monthStart.toLocaleString(undefined, {
        month: 'short',
        year: 'numeric',
      });
      return {
        month,
        volume,
        numerator,
        pct: volume > 0 ? (100 * numerator) / volume : null,
        allProgramsPct: allProgramsPctByMonthKey.get(roll.monthKey) ?? null,
      };
    });
  }, [filteredClinicalRollups, allProgramsPctByMonthKey]);

  const weekendDischargeByDcMonth = useMemo(() => {
    return filteredClinicalRollups.map((roll) => {
      let volume = 0;
      let numerator = 0;
      for (const s of roll.byPathway) {
        volume += s.volume;
        numerator += s.weekendNumerator;
      }
      const month = roll.monthStart.toLocaleString(undefined, {
        month: 'short',
        year: 'numeric',
      });
      return {
        month,
        volume,
        numerator,
        pct: volume > 0 ? (100 * numerator) / volume : null,
        allProgramsPct:
          allProgramsWeekendPctByMonthKey.get(roll.monthKey) ?? null,
      };
    });
  }, [filteredClinicalRollups, allProgramsWeekendPctByMonthKey]);

  /** Support-line totals by DC month; incomplete months stay on the axis with `calls: 0` (no bar). */
  const supportLineCallsByDcMonth = useMemo((): CallsToggleTotalRow[] => {
    return filteredClinicalRollups.map((roll) => {
      let calls = 0;
      for (const s of roll.byPathway) {
        if (s.volume > 0 && s.avgSupportLinePerPt != null) {
          calls += s.avgSupportLinePerPt * s.volume;
        }
      }
      const rounded = Math.round(calls);
      const eligible = isCallVolumeMonthDisplayEligible(roll.monthStart);
      const month = roll.monthStart.toLocaleString(undefined, {
        month: 'short',
        year: 'numeric',
      });
      if (eligible) {
        return { month, calls: rounded };
      }
      return {
        month,
        calls: 0,
        fillVariant: 'pending',
        tooltipActualCalls: rounded,
      };
    });
  }, [filteredClinicalRollups]);

  /** Program-wide (all care paths) mean calls / patient by discharge month. */
  const allProgramsAvgSupportCallsPerPatientByMonthKey = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!bundle) return m;
    for (const roll of bundle.clinicalRollups) {
      if (!isCallVolumeMonthDisplayEligible(roll.monthStart)) continue;
      if (
        !selectedReportingPeriods.includes(
          reportingPeriodKeyForDate(roll.monthStart)
        )
      ) {
        continue;
      }
      const slices = roll.byPathway.filter((s) =>
        allProgramCarePaths.includes(s.carePath)
      );
      if (!slices.length) continue;
      let calls = 0;
      let volume = 0;
      for (const s of slices) {
        volume += s.volume;
        if (s.volume > 0 && s.avgSupportLinePerPt != null) {
          calls += s.avgSupportLinePerPt * s.volume;
        }
      }
      m.set(roll.monthKey, volume > 0 ? calls / volume : null);
    }
    return m;
  }, [bundle, selectedReportingPeriods, allProgramCarePaths]);

  /** Mean calls / patient (selected cohort) with program reference, by DC month (all months; incomplete → null so the line gaps). */
  const supportLineAvgCallsPerPatientByDcMonth = useMemo(() => {
    return filteredClinicalRollups.map((roll) => {
      const month = roll.monthStart.toLocaleString(undefined, {
        month: 'short',
        year: 'numeric',
      });
      if (!isCallVolumeMonthDisplayEligible(roll.monthStart)) {
        return {
          month,
          calls: null,
          allProgramsAvg: null,
          fillVariant: 'pending' as const,
        };
      }
      let calls = 0;
      let volume = 0;
      for (const s of roll.byPathway) {
        volume += s.volume;
        if (s.volume > 0 && s.avgSupportLinePerPt != null) {
          calls += s.avgSupportLinePerPt * s.volume;
        }
      }
      const avg = volume > 0 ? calls / volume : 0;
      const allProgramsAvg =
        allProgramsAvgSupportCallsPerPatientByMonthKey.get(roll.monthKey) ??
        null;
      return { month, calls: avg, allProgramsAvg };
    });
  }, [filteredClinicalRollups, allProgramsAvgSupportCallsPerPatientByMonthKey]);

  const supportLineChartYMax = useMemo(() => {
    if (supportLineMetricMode === 'total') {
      if (!supportLineCallsByDcMonth.length) return 1;
      const eligibleCalls = supportLineCallsByDcMonth
        .filter((r) => r.fillVariant !== 'pending')
        .map((r) => r.calls);
      const maxVal =
        eligibleCalls.length > 0 ? Math.max(...eligibleCalls) : 0;
      return enrolmentChartYUpperBound(Math.max(1, maxVal));
    }
    if (!supportLineAvgCallsPerPatientByDcMonth.length) return 1;
    let maxVal = 0;
    for (const r of supportLineAvgCallsPerPatientByDcMonth) {
      if (r.calls != null && Number.isFinite(r.calls)) {
        maxVal = Math.max(maxVal, r.calls);
      }
      if (r.allProgramsAvg != null && Number.isFinite(r.allProgramsAvg)) {
        maxVal = Math.max(maxVal, r.allProgramsAvg);
      }
    }
    return enrolmentChartYUpperBound(Math.max(1, maxVal));
  }, [
    supportLineMetricMode,
    supportLineCallsByDcMonth,
    supportLineAvgCallsPerPatientByDcMonth,
  ]);

  /** Total scheduled check-in calls by DC month; incomplete months stay on the axis with `calls: 0` (no bar). */
  const checkInCallsByDcMonth = useMemo((): CallsToggleTotalRow[] => {
    return filteredClinicalRollups.map((roll) => {
      let calls = 0;
      for (const s of roll.byPathway) {
        if (s.volume > 0 && s.avgCheckInPerPt != null) {
          calls += s.avgCheckInPerPt * s.volume;
        }
      }
      const rounded = Math.round(calls);
      const eligible = isCallVolumeMonthDisplayEligible(roll.monthStart);
      const month = roll.monthStart.toLocaleString(undefined, {
        month: 'short',
        year: 'numeric',
      });
      if (eligible) {
        return { month, calls: rounded };
      }
      return {
        month,
        calls: 0,
        fillVariant: 'pending',
        tooltipActualCalls: rounded,
      };
    });
  }, [filteredClinicalRollups]);

  const allProgramsAvgCheckInPerPatientByMonthKey = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!bundle) return m;
    for (const roll of bundle.clinicalRollups) {
      if (
        !selectedReportingPeriods.includes(
          reportingPeriodKeyForDate(roll.monthStart)
        )
      ) {
        continue;
      }
      const slices = roll.byPathway.filter((s) =>
        allProgramCarePaths.includes(s.carePath)
      );
      if (!slices.length) continue;
      let calls = 0;
      let volume = 0;
      for (const s of slices) {
        volume += s.volume;
        if (s.volume > 0 && s.avgCheckInPerPt != null) {
          calls += s.avgCheckInPerPt * s.volume;
        }
      }
      m.set(roll.monthKey, volume > 0 ? calls / volume : null);
    }
    return m;
  }, [bundle, selectedReportingPeriods, allProgramCarePaths]);

  const checkInAvgCallsPerPatientByDcMonth = useMemo(() => {
    return filteredClinicalRollups.map((roll) => {
      const month = roll.monthStart.toLocaleString(undefined, {
        month: 'short',
        year: 'numeric',
      });
      if (!isCallVolumeMonthDisplayEligible(roll.monthStart)) {
        return {
          month,
          calls: null,
          allProgramsAvg: null,
          fillVariant: 'pending' as const,
        };
      }
      let calls = 0;
      let volume = 0;
      for (const s of roll.byPathway) {
        volume += s.volume;
        if (s.volume > 0 && s.avgCheckInPerPt != null) {
          calls += s.avgCheckInPerPt * s.volume;
        }
      }
      const avg = volume > 0 ? calls / volume : 0;
      const allProgramsAvg =
        allProgramsAvgCheckInPerPatientByMonthKey.get(roll.monthKey) ?? null;
      return { month, calls: avg, allProgramsAvg };
    });
  }, [filteredClinicalRollups, allProgramsAvgCheckInPerPatientByMonthKey]);

  const checkInChartYMax = useMemo(() => {
    if (checkInMetricMode === 'total') {
      if (!checkInCallsByDcMonth.length) return 1;
      const eligibleCalls = checkInCallsByDcMonth
        .filter((r) => r.fillVariant !== 'pending')
        .map((r) => r.calls);
      const maxVal =
        eligibleCalls.length > 0 ? Math.max(...eligibleCalls) : 0;
      return enrolmentChartYUpperBound(Math.max(1, maxVal));
    }
    if (!checkInAvgCallsPerPatientByDcMonth.length) return 1;
    let maxVal = 0;
    for (const r of checkInAvgCallsPerPatientByDcMonth) {
      if (r.calls != null && Number.isFinite(r.calls)) {
        maxVal = Math.max(maxVal, r.calls);
      }
      if (r.allProgramsAvg != null && Number.isFinite(r.allProgramsAvg)) {
        maxVal = Math.max(maxVal, r.allProgramsAvg);
      }
    }
    return enrolmentChartYUpperBound(Math.max(1, maxVal));
  }, [
    checkInMetricMode,
    checkInCallsByDcMonth,
    checkInAvgCallsPerPatientByDcMonth,
  ]);

  /** One scatter point per linked enrolment: (scheduled check-in calls, support line calls). */
  const supportCheckInCorrelationPoints = useMemo((): SupportCheckInCorrelationPoint[] => {
    if (!bundle?.merged.length || !selectedCarePaths.length) return [];
    const out: SupportCheckInCorrelationPoint[] = [];
    for (const r of bundle.merged) {
      if (!isMrnHospDcDateMatch(r) || !r.hospDcDate) continue;
      if (!selectedCarePaths.includes(r.carePath)) continue;
      const periodKey = reportingPeriodKeyForDate(startOfMonth(r.hospDcDate));
      if (!selectedReportingPeriods.includes(periodKey)) continue;

      const checkIn =
        typeof r.scheduledCheckInCalls === 'number' &&
        Number.isFinite(r.scheduledCheckInCalls)
          ? Math.max(0, Math.round(r.scheduledCheckInCalls))
          : 0;
      const supportRaw = r.supportLineCalls;
      const support =
        typeof supportRaw === 'number' && Number.isFinite(supportRaw)
          ? Math.max(0, Math.round(supportRaw))
          : 0;

      out.push({ checkIn, support });
    }
    return out;
  }, [bundle?.merged, selectedCarePaths, selectedReportingPeriods]);

  const isMedicineProgramDeptOnlyCohort = useMemo(() => {
    if (!selectedCarePaths.length) return false;
    const depts = new Set(
      selectedCarePaths.map((cp) =>
        departmentForPathway(extractPathway(cp))
      )
    );
    return depts.size === 1 && depts.has('Medicine Program');
  }, [selectedCarePaths]);

  const medicineEnrolSiteStratifyEffective =
    isMedicineProgramDeptOnlyCohort && medicineEnrolStratBySite;

  useEffect(() => {
    if (!isMedicineProgramDeptOnlyCohort) setMedicineEnrolStratBySite(false);
  }, [isMedicineProgramDeptOnlyCohort]);

  const enrolmentMonthlySeries = useMemo(
    () =>
      filteredClinicalRollups.map((r) => ({
        month: r.monthStart.toLocaleString(undefined, {
          month: 'short',
          year: 'numeric',
        }),
        volume: r.byPathway.reduce((s, p) => s + p.volume, 0),
      })),
    [filteredClinicalRollups]
  );

  const enrolmentMonthlySiteSplitSeries = useMemo(
    () =>
      filteredClinicalRollups.map((r) => {
        let tgVol = 0;
        let twVol = 0;
        for (const s of r.byPathway) {
          if (!selectedCarePaths.includes(s.carePath)) continue;
          if (s.site === 'TG') tgVol += s.volume;
          else if (s.site === 'TW') twVol += s.volume;
        }
        const month = r.monthStart.toLocaleString(undefined, {
          month: 'short',
          year: 'numeric',
        });
        return { month, tgVol, twVol, volume: tgVol + twVol };
      }),
    [filteredClinicalRollups, selectedCarePaths]
  );

  type EnrolmentChartRow = Record<string, string | number> & {
    month: string;
    volume: number;
    priorCumulative?: number;
    monthAdded?: number;
  };

  const chartData: EnrolmentChartRow[] = useMemo(() => {
    if (
      medicineEnrolSiteStratifyEffective &&
      !enrolmentLegendOn &&
      enrolmentMonthlySiteSplitSeries.length
    ) {
      const src = enrolmentMonthlySiteSplitSeries;
      if (enrolmentChartView === 'monthly') {
        return src.map((row) => ({
          month: row.month,
          volume: row.tgVol + row.twVol,
          tgVol: row.tgVol,
          twVol: row.twVol,
          priorCumulative: 0,
          monthAdded: row.tgVol + row.twVol,
        }));
      }
      let tgRunning = 0;
      let twRunning = 0;
      return src.map((row) => {
        const ptg = tgRunning;
        const ptw = twRunning;
        const tgA = row.tgVol;
        const twA = row.twVol;
        tgRunning += tgA;
        twRunning += twA;
        const volSum = tgRunning + twRunning;
        const priorCombined = ptg + ptw;
        const monthCombined = tgA + twA;
        return {
          month: row.month,
          volume: volSum,
          priorTGCumulative: ptg,
          tgMonthAdded: tgA,
          priorTWCumulative: ptw,
          twMonthAdded: twA,
          priorCumulative: priorCombined,
          monthAdded: monthCombined,
        };
      });
    }
    if (enrolmentChartView === 'monthly') {
      return enrolmentMonthlySeries.map((row) => ({
        month: row.month,
        volume: row.volume,
        priorCumulative: 0,
        monthAdded: row.volume,
      }));
    }
    let sum = 0;
    return enrolmentMonthlySeries.map((row) => {
      const priorCumulative = sum;
      const monthAdded = row.volume;
      sum += monthAdded;
      return {
        month: row.month,
        volume: sum,
        priorCumulative,
        monthAdded,
      };
    });
  }, [
    enrolmentMonthlySeries,
    enrolmentMonthlySiteSplitSeries,
    enrolmentChartView,
    medicineEnrolSiteStratifyEffective,
    enrolmentLegendOn,
  ]);

  const isAjmeraOnlyCohort = useMemo(
    () =>
      !isAllProgramsCohort &&
      selectedCarePaths.length > 0 &&
      selectedCarePaths.every(
        (cp) => departmentForPathway(extractPathway(cp)) === AJMERA_TRANSPLANT_DEPARTMENT
      ),
    [isAllProgramsCohort, selectedCarePaths]
  );

  useEffect(() => {
    if (!isAjmeraOnlyCohort) setAjmeraCarePathGroupMode('organTypeNp');
  }, [isAjmeraOnlyCohort]);

  const enrolSingleDeptUsesCarePathLegend = useMemo(
    () =>
      !isAllProgramsCohort &&
      selectedCarePaths.length > 0 &&
      new Set(selectedCarePaths.map(extractPathway)).size <= 2,
    [isAllProgramsCohort, selectedCarePaths]
  );

  const ajmeraLegendEligible = useMemo(
    () =>
      enrolmentLegendOn &&
      isAjmeraOnlyCohort &&
      enrolSingleDeptUsesCarePathLegend,
    [enrolmentLegendOn, isAjmeraOnlyCohort, enrolSingleDeptUsesCarePathLegend]
  );

  const prevAjmeraLegendEligibleRef = useRef(false);
  useEffect(() => {
    const prev = prevAjmeraLegendEligibleRef.current;
    if (ajmeraLegendEligible && !prev) {
      setAjmeraCarePathGroupMode('organTypeOnly');
    }
    prevAjmeraLegendEligibleRef.current = ajmeraLegendEligible;
  }, [ajmeraLegendEligible]);

  const enrolmentLegendAriaLabel = useMemo(() => {
    if (isAllProgramsCohort) return 'Enrolment chart: program legend';
    if (enrolSingleDeptUsesCarePathLegend) return 'Enrolment chart: care path legend';
    return 'Enrolment chart: pathway legend';
  }, [isAllProgramsCohort, enrolSingleDeptUsesCarePathLegend]);

  const ajmeraEnrolCarePathCategoryKey = useCallback(
    (carePath: string) => {
      if (
        !isAjmeraOnlyCohort ||
        !enrolSingleDeptUsesCarePathLegend
      ) {
        return carePath;
      }
      if (ajmeraCarePathGroupMode === 'organTypeOnly') {
        return ajmeraCollapseCarePathGroupKey(carePath);
      }
      if (ajmeraCarePathGroupMode === 'npOnly') {
        return ajmeraNewPastOnlyGroupKey(carePath);
      }
      return carePath;
    },
    [
      isAjmeraOnlyCohort,
      ajmeraCarePathGroupMode,
      enrolSingleDeptUsesCarePathLegend,
    ]
  );

  const enrolmentLegendCategories = useMemo(() => {
    if (!filteredClinicalRollups.length) return [];
    if (isAllProgramsCohort) {
      const seen = new Set<string>();
      for (const roll of filteredClinicalRollups) {
        for (const slice of roll.byPathway) {
          const pathway = extractPathway(slice.carePath);
          seen.add(departmentForPathway(pathway));
        }
      }
      return DEPARTMENT_DISPLAY_ORDER.filter((d) => seen.has(d));
    }
    if (enrolSingleDeptUsesCarePathLegend) {
      const keys = new Set(
        selectedCarePaths.map((cp) => ajmeraEnrolCarePathCategoryKey(cp))
      );
      return [...keys].sort((a, b) => a.localeCompare(b));
    }
    const pathways = new Set<string>();
    for (const cp of selectedCarePaths) {
      pathways.add(extractPathway(cp));
    }
    return [...pathways].sort((a, b) => a.localeCompare(b));
  }, [
    filteredClinicalRollups,
    isAllProgramsCohort,
    enrolSingleDeptUsesCarePathLegend,
    selectedCarePaths,
    ajmeraEnrolCarePathCategoryKey,
  ]);

  useEffect(() => {
    setEnrolLegendSoloCategory(null);
  }, [
    enrolmentLegendOn,
    isAllProgramsCohort,
    enrolSingleDeptUsesCarePathLegend,
    enrolmentLegendCategories.join('\u0001'),
  ]);

  const enrolmentMonthlyStackRows = useMemo(() => {
    if (!filteredClinicalRollups.length || !enrolmentLegendCategories.length) return [];
    const monthLabelOf = (roll: { monthStart: Date }) =>
      roll.monthStart.toLocaleString(undefined, {
        month: 'short',
        year: 'numeric',
      });

    return filteredClinicalRollups.map((roll) => {
      const row: Record<string, string | number> = {
        month: monthLabelOf(roll),
      };

      const catIdx = (slice: { carePath: string }) => {
        const cat = isAllProgramsCohort
          ? departmentForPathway(extractPathway(slice.carePath))
          : enrolSingleDeptUsesCarePathLegend
            ? ajmeraEnrolCarePathCategoryKey(slice.carePath)
            : extractPathway(slice.carePath);
        return enrolmentLegendCategories.indexOf(cat);
      };

      if (medicineEnrolSiteStratifyEffective) {
        enrolmentLegendCategories.forEach((_, i) => {
          row[`tg_e${i}`] = 0;
          row[`tw_e${i}`] = 0;
        });
      } else {
        enrolmentLegendCategories.forEach((_, i) => {
          row[`_e${i}`] = 0;
        });
      }

      let totalVol = 0;
      for (const slice of roll.byPathway) {
        const idx = catIdx(slice);
        if (idx < 0) continue;
        if (medicineEnrolSiteStratifyEffective) {
          if (slice.site === 'TG') {
            row[`tg_e${idx}`] = Number(row[`tg_e${idx}`]) + slice.volume;
            totalVol += slice.volume;
          } else if (slice.site === 'TW') {
            row[`tw_e${idx}`] = Number(row[`tw_e${idx}`]) + slice.volume;
            totalVol += slice.volume;
          }
        } else {
          row[`_e${idx}`] = Number(row[`_e${idx}`]) + slice.volume;
          totalVol += slice.volume;
        }
      }
      row.volume = totalVol;
      return row;
    });
  }, [
    filteredClinicalRollups,
    enrolmentLegendCategories,
    isAllProgramsCohort,
    enrolSingleDeptUsesCarePathLegend,
    ajmeraEnrolCarePathCategoryKey,
    medicineEnrolSiteStratifyEffective,
  ]);

  const enrolMonthlyStackEffective = useMemo(() => {
    if (
      enrolLegendSoloCategory === null ||
      !enrolmentMonthlyStackRows.length ||
      !enrolmentLegendCategories.length
    ) {
      return enrolmentMonthlyStackRows;
    }
    const idx = enrolmentLegendCategories.indexOf(enrolLegendSoloCategory);
    if (idx < 0) return enrolmentMonthlyStackRows;
    return enrolmentMonthlyStackRows.map((monthRow) => {
      const next: Record<string, string | number> = {
        month: monthRow.month as string,
      };
      if (medicineEnrolSiteStratifyEffective) {
        enrolmentLegendCategories.forEach((_, i) => {
          next[`tg_e${i}`] =
            i === idx ? Number(monthRow[`tg_e${i}`]) || 0 : 0;
          next[`tw_e${i}`] =
            i === idx ? Number(monthRow[`tw_e${i}`]) || 0 : 0;
        });
        next.volume =
          enrolmentLegendCategories.reduce(
            (s, _, i) =>
              s +
              (Number(next[`tg_e${i}`]) || 0) +
              (Number(next[`tw_e${i}`]) || 0),
            0
          ) || 0;
      } else {
        enrolmentLegendCategories.forEach((_, i) => {
          next[`_e${i}`] =
            i === idx ? Number(monthRow[`_e${i}`]) || 0 : 0;
        });
        next.volume =
          enrolmentLegendCategories.reduce(
            (s, _, i) => s + (Number(next[`_e${i}`]) || 0),
            0
          ) || 0;
      }
      return next;
    });
  }, [
    enrolLegendSoloCategory,
    enrolmentMonthlyStackRows,
    enrolmentLegendCategories,
    medicineEnrolSiteStratifyEffective,
  ]);

  const enrolmentCumulativeStackEffective = useMemo(
    () =>
      medicineEnrolSiteStratifyEffective
        ? buildEnrolmentCumulativeSiteSplitStackRows(
            enrolMonthlyStackEffective,
            enrolmentLegendCategories.length
          )
        : buildEnrolmentCumulativeStackRows(
            enrolMonthlyStackEffective,
            enrolmentLegendCategories.length
          ),
    [
      enrolMonthlyStackEffective,
      enrolmentLegendCategories.length,
      medicineEnrolSiteStratifyEffective,
    ]
  );

  const enrolUseLegendBreakdown =
    enrolmentLegendOn && enrolmentLegendCategories.length > 0;

  const enrolBreakdownLegendPayload = useMemo((): readonly EnrolLegendPayloadEntry[] => {
    if (!enrolUseLegendBreakdown || !enrolmentLegendCategories.length) return [];
    return enrolmentLegendCategories.map((cat, i) => {
      const ajmeraFill =
        isAjmeraOnlyCohort && enrolSingleDeptUsesCarePathLegend
          ? enrolAjmeraCarePathCategoryFill(cat)
          : null;
      const color =
        ajmeraFill ?? ENROL_LEGEND_PALETTE[i % ENROL_LEGEND_PALETTE.length];
      return { value: cat, color };
    });
  }, [
    enrolUseLegendBreakdown,
    enrolmentLegendCategories,
    isAjmeraOnlyCohort,
    enrolSingleDeptUsesCarePathLegend,
  ]);

  const enrolmentChartRenderData = enrolUseLegendBreakdown
    ? enrolmentChartView === 'monthly'
      ? enrolMonthlyStackEffective
      : enrolmentCumulativeStackEffective
    : chartData;

  /** Denominator for “% Total” bar labels (% of summed counts across plotted months). */
  const enrolmentPctGrandDenom = useMemo(() => {
    if (!enrolmentChartRenderData.length) return 0;
    return enrolmentChartRenderData.reduce((s, r) => {
      const v = Number((r as { volume?: number }).volume) || 0;
      return s + v;
    }, 0);
  }, [enrolmentChartRenderData]);

  const enrolmentChartDisplayData = useMemo(() => {
    if (!enrolmentYPercentTotal) return enrolmentChartRenderData;
    if (medicineEnrolSiteStratifyEffective && enrolUseLegendBreakdown) {
      return enrolChartRowsPercentTotal(enrolmentChartRenderData, {
        useLegendBreakdown: true,
        chartView: enrolmentChartView,
        categoryCount: enrolmentLegendCategories.length,
        siteSplitStacks: true,
      });
    }
    if (
      medicineEnrolSiteStratifyEffective &&
      !enrolUseLegendBreakdown
    ) {
      return enrolmentChartView === 'monthly'
        ? enrolPctSiteStratSimpleMonthly(enrolmentChartRenderData)
        : enrolPctSiteStratSimpleCumulative(enrolmentChartRenderData);
    }
    return enrolChartRowsPercentTotal(enrolmentChartRenderData, {
      useLegendBreakdown: enrolUseLegendBreakdown,
      chartView: enrolmentChartView,
      categoryCount: enrolmentLegendCategories.length,
    });
  }, [
    enrolmentChartRenderData,
    enrolmentYPercentTotal,
    enrolUseLegendBreakdown,
    enrolmentChartView,
    enrolmentLegendCategories.length,
    medicineEnrolSiteStratifyEffective,
  ]);

  const enrolStackRowByMonthLabel = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const row of enrolmentChartDisplayData) {
      const mon = row.month as string | undefined;
      if (typeof mon === 'string' && mon !== '') {
        m.set(mon, row as Record<string, unknown>);
      }
    }
    return m;
  }, [enrolmentChartDisplayData]);

  const enrolmentYAxisMax = useMemo(() => {
    if (!enrolmentChartDisplayData.length) return 1;
    if (enrolmentYPercentTotal && enrolUseLegendBreakdown) return 100;
    if (enrolmentYPercentTotal && enrolmentChartView === 'cumulative') return 100;
    const maxVal = Math.max(
      0,
      ...enrolmentChartDisplayData.map(
        (r) => Number((r as { volume?: number }).volume) || 0
      )
    );
    if (enrolmentYPercentTotal) return enrolPctYAxisCeilPct(maxVal);
    return enrolmentChartYUpperBound(maxVal);
  }, [
    enrolmentChartDisplayData,
    enrolmentYPercentTotal,
    enrolUseLegendBreakdown,
    enrolmentChartView,
  ]);

  const linkedCount = bundle?.linkage.linkedCount ?? 0;
  const vhaOnlyCount = bundle?.linkage.vhaOnlyCount ?? 0;
  const flowsheetOnlyCount = bundle?.linkage.flowsheetOnlyCount ?? 0;

  const hasUploadedDataFiles = !!(
    files.vha ||
    files.flowsheet ||
    files.peIp ||
    files.peIc
  );
  const allUploadSlotsFilled = !!(
    files.vha &&
    files.flowsheet &&
    files.peIp &&
    files.peIc
  );
  /* Full-screen upload UI until analytics run; uploading files alone must not toggle layout. */
  const uploadLandingLayout = !bundle;

  const brandMark = (
    <div className="brand">
      <img src={APP_LOGO_SRC} alt="UHN at Home" className="app-logo" />
    </div>
  );

  return (
    <div
      className={`app-shell${uploadLandingLayout ? ' app-shell--upload-landing' : ''}`}
    >
      <header className="top-header">
        <div className="top-header-inner">
          <div className="top-header-primary">
            {!uploadLandingLayout && brandMark}
            <div className="header-uploads">
              {uploadLandingLayout && (
                <div className="header-upload-slots">
                  {brandMark}
                  {(Object.keys(SLOT_LABEL) as Slot[]).map((slot) => (
                    <label key={slot} className="header-upload">
                      <span className="header-upload-label">
                        {SLOT_LABEL[slot]}
                      </span>
                      <input
                        type="file"
                        accept={slot.startsWith('pe') ? '.csv' : '.xlsx,.xls'}
                        onChange={(e) => onFile(slot, e.target.files?.[0] ?? null)}
                      />
                      {files[slot] && (
                        <span className="header-upload-fname">
                          {files[slot]!.name}
                        </span>
                      )}
                    </label>
                  ))}
                  <div className="header-upload-slots-footer">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !allUploadSlotsFilled}
                      onClick={() => void generate()}
                    >
                      {busy ? 'Working…' : 'Generate analytics'}
                    </button>
                    {hasUploadedDataFiles && (
                      <button
                        type="button"
                        className="btn btn-ghost header-clear"
                        onClick={clearAll}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </div>
              )}
              {!uploadLandingLayout && (
                <div className="header-upload-actions header-upload-actions--post-generate">
                  <button
                    type="button"
                    className="btn btn-ghost header-clear"
                    onClick={clearAll}
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {bundle && (
      <main className="app">
        <>
          {bundle.errors.length > 0 && (
            <section className="panel error-panel">
              <h2>Errors</h2>
              <ul>
                {bundle.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </section>
          )}

          {bundle.warnings.length > 0 && (
            <section className="panel warn-panel">
              <h2>Warnings</h2>
              <ul>
                {bundle.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="tabs-reporting-pair">
            <section
              key="tabs-reporting-a"
              className="panel tabs-panel tabs-panel-reporting"
            >
              <div className="reporting-period-button-strips">
                <div className="reporting-period-strip">
                  <span
                    id="reporting-fy-label"
                    className="reporting-period-strip-label"
                  >
                    Fiscal Year Selection
                  </span>
                  <div
                    className="department-quick-filters"
                    role="toolbar"
                    aria-labelledby="reporting-fy-label"
                  >
                    {fiscalYearLabelsInOrder.map((label) => (
                      <button
                        key={label}
                        type="button"
                        className={`department-quick-btn ${
                          selectedFiscalYearLabels.includes(label)
                            ? 'department-quick-btn--active'
                            : ''
                        }`}
                        onClick={() => toggleFiscalYear(label)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="reporting-period-strip">
                  <span
                    id="reporting-q-label"
                    className="reporting-period-strip-label"
                  >
                    Quarter Selection
                  </span>
                  <div
                    className="department-quick-filters department-quick-filters--segmented"
                    role="toolbar"
                    aria-labelledby="reporting-q-label"
                  >
                    {quartersWithData.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className={`department-quick-btn ${
                          selectedQuarterLabels.includes(q)
                            ? 'department-quick-btn--active'
                            : ''
                        }`}
                        onClick={() => toggleQuarter(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
            <section
              key="tabs-reporting-b"
              className="panel tabs-panel tabs-panel-reporting"
            >
              <div
                className="tabs department-quick-filters"
                role="toolbar"
                aria-label="Filter cohort by clinical program"
              >
                <button
                  type="button"
                  className={`department-quick-btn ${
                    sameCarePathSelection(selectedCarePaths, allProgramCarePaths)
                      ? 'department-quick-btn--active'
                      : ''
                  }`}
                  onClick={() => setSelectedCarePaths(allProgramCarePaths)}
                >
                  All Programs
                </button>
                {departmentPathwayFilterGroups.map((deptGroup) => {
                  const deptCarePaths = carePathsForDepartmentGroup(deptGroup);
                  const isActive = sameCarePathSelection(selectedCarePaths, deptCarePaths);
                  return (
                    <button
                      key={deptGroup.department}
                      type="button"
                      className={`department-quick-btn ${
                        isActive ? 'department-quick-btn--active' : ''
                      }`}
                      onClick={() => setSelectedCarePaths(deptCarePaths)}
                    >
                      {deptGroup.department}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <section className="panel panel--report-main">
            <section key="tabs-toolbar" className="panel tabs-panel">
              <div className="tabs">
                <button
                  type="button"
                  className={active === 'clinical' ? 'active' : ''}
                  onClick={() => setActive('clinical')}
                >
                  Clinical KPIs
                </button>
                <button
                  type="button"
                  className={active === 'experience' ? 'active' : ''}
                  onClick={() => setActive('experience')}
                >
                  Patient experience
                </button>
                <button
                  type="button"
                  className={active === 'linkage' ? 'active' : ''}
                  onClick={() => setActive('linkage')}
                >
                  Linkage
                </button>
                <div className="export-btns">
                  <button type="button" className="btn btn-secondary" onClick={exportXlsx}>
                    Download Excel
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={exportPdf}>
                    Download PDF summary
                  </button>
                </div>
              </div>
            </section>

            {active === 'clinical' && (
              <div className="report">
                <div className="report-enrol-chart">
                  <div className="card report-enrol-chart-card">
                  <div className="report-chart-heading">
                    <h3>Enrolment Volume</h3>
                    <div className="report-chart-heading-controls">
                      <div
                        className="enrolment-view-toggle"
                        role="group"
                        aria-label="Enrolment volume display"
                      >
                        <button
                          type="button"
                          className={enrolmentChartView === 'monthly' ? 'active' : ''}
                          aria-pressed={enrolmentChartView === 'monthly'}
                          onClick={() => setEnrolmentChartView('monthly')}
                        >
                          Monthly
                        </button>
                        <button
                          type="button"
                          className={
                            enrolmentChartView === 'cumulative' ? 'active' : ''
                          }
                          aria-pressed={enrolmentChartView === 'cumulative'}
                          onClick={() => setEnrolmentChartView('cumulative')}
                        >
                          Cumulative
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="chart-wrap chart-wrap--enrolment-side-controls">
                  <div
                    className="enrol-chart-side enrol-chart-side--left"
                    role="presentation"
                  >
                    <div
                      className="enrolment-view-toggle enrolment-view-toggle--stacked"
                      role="group"
                      aria-label="Enrolment Y-axis scale"
                    >
                      <button
                        type="button"
                        className={!enrolmentYPercentTotal ? 'active' : ''}
                        aria-pressed={!enrolmentYPercentTotal}
                        aria-label="Count"
                        title="Count"
                        onClick={() => setEnrolmentYPercentTotal(false)}
                      >
                        #
                      </button>
                      <button
                        type="button"
                        className={enrolmentYPercentTotal ? 'active' : ''}
                        aria-pressed={enrolmentYPercentTotal}
                        aria-label="Percent of total"
                        title="Percent of total"
                        onClick={() => setEnrolmentYPercentTotal(true)}
                      >
                        %
                      </button>
                    </div>
                  </div>
                  <div className="enrol-chart-main">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={enrolmentChartDisplayData}
                      margin={{
                        top: 20,
                        right: 0,
                        left: 0,
                        bottom: 12,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="month"
                        interval={0}
                        minTickGap={0}
                        tickMargin={8}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis
                        domain={[0, enrolmentYAxisMax]}
                        allowDecimals={enrolmentYPercentTotal}
                        tickCount={6}
                        tick={{ fontSize: 11 }}
                        niceTicks="adaptive"
                        tickFormatter={
                          enrolmentYPercentTotal
                            ? formatEnrolPctYAxisTick
                            : undefined
                        }
                      />
                      <Tooltip
                        content={(tipProps) => (
                          <EnrolmentChartTooltip
                            pctMode={enrolmentYPercentTotal}
                            active={tipProps.active}
                            label={
                              tipProps.label != null
                                ? String(tipProps.label)
                                : undefined
                            }
                            payload={tipProps.payload}
                          />
                        )}
                      />
                      {enrolUseLegendBreakdown
                        ? medicineEnrolSiteStratifyEffective
                          ? enrolmentLegendCategories.flatMap((cat, i) => {
                              const ajmeraFill =
                                isAjmeraOnlyCohort &&
                                enrolSingleDeptUsesCarePathLegend
                                  ? enrolAjmeraCarePathCategoryFill(cat)
                                  : null;
                              const fill =
                                ajmeraFill ??
                                ENROL_LEGEND_PALETTE[
                                  i % ENROL_LEGEND_PALETTE.length
                                ];
                              return [
                                <Bar
                                  key={`med-tg-${cat}`}
                                  stackId="enrol-site-tg"
                                  dataKey={`tg_e${i}`}
                                  fill={fill}
                                  name={`${cat} · TG`}
                                />,
                                <Bar
                                  key={`med-tw-${cat}`}
                                  stackId="enrol-site-tw"
                                  dataKey={`tw_e${i}`}
                                  fill={fill}
                                  name={`${cat} · TW`}
                                />,
                              ];
                            })
                          : enrolmentLegendCategories.map((cat, i) => {
                              const ajmeraFill =
                                isAjmeraOnlyCohort &&
                                enrolSingleDeptUsesCarePathLegend
                                  ? enrolAjmeraCarePathCategoryFill(cat)
                                  : null;
                              return (
                                <Bar
                                  key={cat}
                                  stackId="enrol"
                                  dataKey={`_e${i}`}
                                  fill={
                                    ajmeraFill ??
                                    ENROL_LEGEND_PALETTE[
                                      i % ENROL_LEGEND_PALETTE.length
                                    ]
                                  }
                                  name={cat}
                                >
                                  <LabelList
                                    position="top"
                                    offset={6}
                                    valueAccessor={(entry) => {
                                      const mon = (
                                        entry as { payload?: { month?: unknown } }
                                      ).payload?.month;
                                      return typeof mon === 'string' ? mon : null;
                                    }}
                                    content={(lp) => {
                                      const p = lp as Record<string, unknown>;
                                      const row =
                                        enrolStackLabelRowFromContentProps(
                                          p,
                                          enrolStackRowByMonthLabel
                                        );
                                      return (
                                        <EnrolStackVolumeTopLabel
                                          x={p.x as number | string | undefined}
                                          y={
                                            p.y as number | string | undefined
                                          }
                                          width={
                                            p.width as number | string | undefined
                                          }
                                          payload={row}
                                          segmentIndex={i}
                                          categoryCount={
                                            enrolmentLegendCategories.length
                                          }
                                          enrolmentYPercentTotal={
                                            enrolmentYPercentTotal
                                          }
                                          pctGrandDenom={enrolmentPctGrandDenom}
                                        />
                                      );
                                    }}
                                  />
                                </Bar>
                              );
                            })
                        : enrolmentChartView === 'monthly'
                          ? medicineEnrolSiteStratifyEffective
                            ? (
                                <>
                                  <Bar
                                    dataKey="tgVol"
                                    fill="var(--accent)"
                                    name="TG"
                                  >
                                    <LabelList
                                      dataKey="tgVol"
                                      position="top"
                                      offset={6}
                                      fill="#000000"
                                      fontSize={12}
                                      fontWeight={700}
                                      formatter={(v: unknown) =>
                                        enrolmentYPercentTotal &&
                                        typeof v === 'number'
                                          ? `${v.toFixed(1)}%`
                                          : String(v ?? '')
                                      }
                                    />
                                  </Bar>
                                  <Bar
                                    dataKey="twVol"
                                    fill="#14b8a6"
                                    name="TW"
                                  >
                                    <LabelList
                                      dataKey="twVol"
                                      position="top"
                                      offset={6}
                                      fill="#000000"
                                      fontSize={12}
                                      fontWeight={700}
                                      formatter={(v: unknown) =>
                                        enrolmentYPercentTotal &&
                                        typeof v === 'number'
                                          ? `${v.toFixed(1)}%`
                                          : String(v ?? '')
                                      }
                                    />
                                  </Bar>
                                </>
                              )
                            : (
                                <Bar dataKey="volume" fill="var(--accent)">
                                  <LabelList
                                    dataKey="volume"
                                    position="top"
                                    offset={6}
                                    fill="#000000"
                                    fontSize={12}
                                    fontWeight={700}
                                    formatter={(v: unknown) =>
                                      enrolmentYPercentTotal &&
                                      typeof v === 'number'
                                        ? `${v.toFixed(1)}%`
                                        : String(v ?? '')
                                    }
                                  />
                                </Bar>
                              )
                          : medicineEnrolSiteStratifyEffective
                            ? (
                                <>
                                  <Bar
                                    dataKey="priorTGCumulative"
                                    stackId="enrol-mt"
                                    fill="var(--accent)"
                                    name="TG through prior month"
                                  />
                                  <Bar
                                    dataKey="tgMonthAdded"
                                    stackId="enrol-mt"
                                    fill="#0e749e"
                                    name="TG added this month"
                                  />
                                  <Bar
                                    dataKey="priorTWCumulative"
                                    stackId="enrol-mw"
                                    fill="#14b8a6"
                                    name="TW through prior month"
                                  />
                                  <Bar
                                    dataKey="twMonthAdded"
                                    stackId="enrol-mw"
                                    fill="#5eead4"
                                    name="TW added this month"
                                  />
                                </>
                              )
                            : (
                                <>
                                  <Bar
                                    dataKey="priorCumulative"
                                    stackId="enrol"
                                    fill="var(--accent)"
                                    name="Total through prior month"
                                  />
                                  <Bar
                                    dataKey="monthAdded"
                                    stackId="enrol"
                                    fill="#14b8a6"
                                    name="Added this month"
                                  >
                                    <LabelList
                                      dataKey="volume"
                                      position="top"
                                      offset={6}
                                      fill="#000000"
                                      fontSize={12}
                                      fontWeight={700}
                                      name="Cumulative total"
                                      formatter={(v: unknown) =>
                                        enrolmentYPercentTotal &&
                                        typeof v === 'number'
                                          ? `${v.toFixed(1)}%`
                                          : String(v ?? '')
                                      }
                                    />
                                    <LabelList
                                      dataKey="monthAdded"
                                      position="center"
                                      fill="#ffffff"
                                      fontSize={11}
                                      fontWeight={400}
                                      formatter={(label: unknown) => {
                                        const v =
                                          typeof label === 'number'
                                            ? label
                                            : Number(label);
                                        if (!Number.isFinite(v) || v <= 0)
                                          return '';
                                        return enrolmentYPercentTotal
                                          ? `+${v.toFixed(1)}%`
                                          : `+${v}`;
                                      }}
                                    />
                                  </Bar>
                                </>
                              )}
                    </BarChart>
                  </ResponsiveContainer>
                  {isAjmeraOnlyCohort &&
                    enrolSingleDeptUsesCarePathLegend &&
                    enrolUseLegendBreakdown && (
                      <div className="enrol-ajmera-path-group-wrap">
                        <div
                          className="enrolment-view-toggle enrol-ajmera-path-group-toggle"
                          role="group"
                          aria-label="Ajmera enrolment stacking: organ type with N versus P, organ type merged, or N versus P merged"
                          title="Organ type + New/Past: one colour per pathway (includes N/P). Organ type only: merge paths that differ only by final N/P. New/Past only: all pathways ending in N stack as New, all ending in P as Past."
                        >
                          <button
                            type="button"
                            className={
                              ajmeraCarePathGroupMode === 'organTypeNp'
                                ? 'active'
                                : ''
                            }
                            aria-pressed={
                              ajmeraCarePathGroupMode === 'organTypeNp'
                            }
                            onClick={() =>
                              setAjmeraCarePathGroupMode('organTypeNp')
                            }
                          >
                            Organ Type + New/Past
                          </button>
                          <button
                            type="button"
                            className={
                              ajmeraCarePathGroupMode === 'organTypeOnly'
                                ? 'active'
                                : ''
                            }
                            aria-pressed={
                              ajmeraCarePathGroupMode === 'organTypeOnly'
                            }
                            onClick={() =>
                              setAjmeraCarePathGroupMode('organTypeOnly')
                            }
                          >
                            Organ Type
                          </button>
                          <button
                            type="button"
                            className={
                              ajmeraCarePathGroupMode === 'npOnly' ? 'active' : ''
                            }
                            aria-pressed={ajmeraCarePathGroupMode === 'npOnly'}
                            onClick={() =>
                              setAjmeraCarePathGroupMode('npOnly')
                            }
                          >
                            New/Past
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div
                    className="enrol-chart-side enrol-chart-side--right"
                    role="presentation"
                  >
                    <div className="enrol-chart-side-right-stack">
                      <div
                        className="enrolment-legend-toggle enrolment-view-toggle"
                        role="group"
                        aria-label={enrolmentLegendAriaLabel}
                      >
                        <button
                          type="button"
                          className={!enrolmentLegendOn ? 'active' : ''}
                          aria-pressed={!enrolmentLegendOn}
                          onClick={() => setEnrolmentLegendOn(false)}
                        >
                          Off
                        </button>
                        <button
                          type="button"
                          className={enrolmentLegendOn ? 'active' : ''}
                          aria-pressed={enrolmentLegendOn}
                          onClick={() => setEnrolmentLegendOn(true)}
                          disabled={!enrolmentLegendCategories.length}
                        >
                          Legend
                        </button>
                      </div>
                      {isMedicineProgramDeptOnlyCohort && (
                        <div
                          className="enrolment-view-toggle enrolment-view-toggle--stacked medicine-strat-toggle"
                          role="group"
                          aria-label="Stratify enrolment volumes by TG and TW columns"
                          title="When on, enrolment stacks split into TG and TW side-by-side columns per month."
                        >
                          <button
                            type="button"
                            className={!medicineEnrolStratBySite ? 'active' : ''}
                            aria-pressed={!medicineEnrolStratBySite}
                            onClick={() => setMedicineEnrolStratBySite(false)}
                          >
                            Off
                          </button>
                          <button
                            type="button"
                            className={medicineEnrolStratBySite ? 'active' : ''}
                            aria-pressed={medicineEnrolStratBySite}
                            onClick={() => setMedicineEnrolStratBySite(true)}
                          >
                            Site
                          </button>
                        </div>
                      )}
                      {enrolUseLegendBreakdown && (
                        <EnrolBreakdownLegendContent
                          variant="side"
                          payload={enrolBreakdownLegendPayload}
                          soloCategory={enrolLegendSoloCategory}
                          onToggleSolo={(label) =>
                            setEnrolLegendSoloCategory((prev) =>
                              prev === label ? null : label
                            )
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>
                  </div>
                </div>
                <div className="clinical-kpi-chart-rows">
                  <div className="cards report-clinical-kpi-cards">
                    <ClinicalMonthlyPctTrendCard
                      cardClassName="clinical-contact24-kpi-card"
                      title="% Contacted within 24 hrs"
                      isAllProgramsCohort={isAllProgramsCohort}
                      monthlyRows={contactWithin24hByDcMonth}
                      tooltipMetricPhrase="contacted within 24 h"
                    />
                    <ClinicalMonthlyPctTrendCard
                      cardClassName="clinical-weekend-dc-kpi-card"
                      title="% Weekend Discharge"
                      isAllProgramsCohort={isAllProgramsCohort}
                      monthlyRows={weekendDischargeByDcMonth}
                      tooltipMetricPhrase="weekend discharges"
                    />
                  </div>
                  <div className="cards report-clinical-kpi-cards report-clinical-kpi-cards--triple">
                    <ClinicalCallsToggleChartCard
                      title="Patient Calls to the 24/7 Support Line"
                      cardClassName="clinical-support-line-kpi-card"
                      radioGroupName="support-line-metric"
                      radiogroupAriaLabel="Support line metric"
                      metricMode={supportLineMetricMode}
                      onMetricModeChange={setSupportLineMetricMode}
                      monthlyRowsTotal={supportLineCallsByDcMonth}
                      monthlyRowsAvg={supportLineAvgCallsPerPatientByDcMonth}
                      yAxisMax={supportLineChartYMax}
                      isAllProgramsCohort={isAllProgramsCohort}
                    />
                    <ClinicalCallsToggleChartCard
                      title="Check In Calls Made by IC Leads and Homecare Staff"
                      cardClassName="clinical-check-in-kpi-card"
                      radioGroupName="check-in-metric"
                      radiogroupAriaLabel="Check-in calls metric"
                      metricMode={checkInMetricMode}
                      onMetricModeChange={setCheckInMetricMode}
                      monthlyRowsTotal={checkInCallsByDcMonth}
                      monthlyRowsAvg={checkInAvgCallsPerPatientByDcMonth}
                      yAxisMax={checkInChartYMax}
                      isAllProgramsCohort={isAllProgramsCohort}
                    />
                    <ClinicalSupportCheckInCorrelationCard
                      cardClassName="clinical-support-checkin-correlation-card"
                      points={supportCheckInCorrelationPoints}
                    />
                  </div>
                </div>
              </div>
            )}

            {active === 'experience' && (
              <div className="report">
                <div className="cards">
                  <div className="card">
                    <h4>Inpatient survey</h4>
                    {bundle.surveyIp ? (
                      <>
                        <p>
                          Responses: <strong>{bundle.surveyIp.n}</strong>
                        </p>
                        <p>
                          Approx. NPS (0–10 recommend):{' '}
                          <strong>
                            {bundle.surveyIp.nps ?? '—'}
                          </strong>
                        </p>
                        <p>
                          % overall ≥8 (approx.):{' '}
                          <strong>
                            {bundle.surveyIp.pctOverallGte8?.toFixed(1) ?? '—'}%
                          </strong>
                        </p>
                        {bundle.surveyIp.testimonialSamples.length > 0 && (
                          <>
                            <h5>Sample comments (truncated)</h5>
                            <ul className="quotes">
                              {bundle.surveyIp.testimonialSamples.map((t, i) => (
                                <li key={i}>{t}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    ) : (
                      <p>No inpatient CSV loaded.</p>
                    )}
                  </div>
                  <div className="card">
                    <h4>Integrated Care survey</h4>
                    {bundle.surveyIc ? (
                      <>
                        <p>
                          Responses: <strong>{bundle.surveyIc.n}</strong>
                        </p>
                        <p>
                          % rating ≥4 (1–5):{' '}
                          <strong>
                            {bundle.surveyIc.pctRatingGte4?.toFixed(1) ?? '—'}%
                          </strong>
                        </p>
                        {bundle.surveyIc.testimonialSamples.length > 0 && (
                          <>
                            <h5>Sample comments (truncated)</h5>
                            <ul className="quotes">
                              {bundle.surveyIc.testimonialSamples.map((t, i) => (
                                <li key={i}>{t}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    ) : (
                      <p>No IC survey CSV loaded.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {active === 'linkage' && (
              <div className="report">
                <div className="linkage-heading">
                  <h3>VHA vs Flowsheet linkage (MRN + hospital DC date)</h3>
                  <button
                    type="button"
                    className="btn btn-secondary linkage-export-btn"
                    onClick={() => downloadLinkageMismatchExcel(bundle)}
                  >
                    Download VHA-only &amp; Flowsheet-only (Excel)
                  </button>
                </div>
                <p className="linkage-export-hint">
                  Sheets list VHA extract rows and filtered Flowsheet rows that do not
                  contribute to a same-calendar MRN + hospital DC match (rules match the
                  linkage table above).
                </p>
                <div className="venn-wrap" aria-label="Linkage Venn diagram">
                  <svg
                    viewBox="-10 0 500 220"
                    role="img"
                    className="venn-svg"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <title>VHA and Flowsheet linkage overlap</title>
                    <circle cx="155" cy="110" r="78" className="venn-left" />
                    <circle cx="265" cy="110" r="78" className="venn-right" />
                    <text
                      x="67"
                      y="110"
                      className="venn-label"
                      textAnchor="end"
                      dominantBaseline="middle"
                    >
                      VHA
                    </text>
                    <text
                      x="353"
                      y="110"
                      className="venn-label"
                      textAnchor="start"
                      dominantBaseline="middle"
                    >
                      Flowsheet
                    </text>
                    <text x="116" y="116" className="venn-count">
                      {vhaOnlyCount}
                    </text>
                    <text x="210" y="116" className="venn-count">
                      {linkedCount}
                    </text>
                    <text x="300" y="116" className="venn-count">
                      {flowsheetOnlyCount}
                    </text>
                  </svg>
                </div>
                <table className="data-table">
                  <tbody>
                    <tr>
                      <td>VHA rows</td>
                      <td>{bundle.linkage.vhaRowCount}</td>
                    </tr>
                    <tr>
                      <td>Flowsheet rows</td>
                      <td>{bundle.linkage.flowsheetRowCount}</td>
                    </tr>
                    <tr>
                      <td>VHA ↔ Flowsheet (MRN + same hospital DC date)</td>
                      <td>{bundle.linkage.vhaMrnHospDcMatched}</td>
                    </tr>
                    <tr>
                      <td>Linked records (Venn overlap)</td>
                      <td>{bundle.linkage.linkedCount}</td>
                    </tr>
                    <tr>
                      <td>VHA-only records (Venn left)</td>
                      <td>{bundle.linkage.vhaOnlyCount}</td>
                    </tr>
                    <tr>
                      <td>Flowsheet-only records (Venn right)</td>
                      <td>{bundle.linkage.flowsheetOnlyCount}</td>
                    </tr>
                    <tr>
                      <td>Merged rows with Hospital Site</td>
                      <td>{bundle.linkage.mergedWithSite}</td>
                    </tr>
                    <tr>
                      <td>Merged rows without Hospital Site</td>
                      <td>{bundle.linkage.mergedWithoutSite}</td>
                    </tr>
                    <tr>
                      <td>IP survey rows</td>
                      <td>{bundle.linkage.peIpRows}</td>
                    </tr>
                    <tr>
                      <td>IP rows with MRN in clinical cohort</td>
                      <td>{bundle.linkage.peIpWithClinical}</td>
                    </tr>
                    <tr>
                      <td>IC survey rows</td>
                      <td>{bundle.linkage.peIcRows}</td>
                    </tr>
                    <tr>
                      <td>IC rows with MRN in clinical cohort</td>
                      <td>{bundle.linkage.peIcWithClinical}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      </main>
      )}
    </div>
  );
}
