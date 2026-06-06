import type { BatchUploader } from '../../homecare/types';
import { uploaderLabel } from '../../homecare/hooks/useBatch';
import {
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
} from '../progress/recordStrategyTabs';
import {
  formatUnifiedImportResults,
  uploadTypeLabel,
  type UnifiedImportActivityRow,
} from '../progress/computeUnifiedImportActivity';
import type { DailyProgressSnapshot } from '../progress/computeDailyProgressSeries';
import type { CarePlanProgressMetrics } from '../carePlan/linkCarePlans';
import type { ProgressMetrics } from '../progress/computeProgressMetrics';
import { DailyProgressChart } from './DailyProgressChart';

function formatImportTimestamp(importedAt: string): string {
  const d = new Date(importedAt);
  if (Number.isNaN(d.getTime())) {
    return importedAt;
  }
  const date = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${date} at ${hours}:${minutes}`;
}

function ProgressBar({
  complete,
  total,
  percent,
  validatedComplete,
  iclStats,
  statUnit = 'completed',
  visitWindowFilter,
}: {
  complete: number;
  total: number;
  percent: number;
  validatedComplete?: number;
  iclStats?: {
    decidedConvert: number;
    decidedDischarge: number;
  };
  statUnit?: 'converted' | 'completed' | 'icl-reassessment' | 'discharge-submitted' | 'care-plan';
  visitWindowFilter?: {
    checked: boolean;
    disabled: boolean;
    label: string;
    onChange: (checked: boolean) => void;
  };
}) {
  const validatedPercentOfComplete =
    validatedComplete != null && complete > 0
      ? Math.round((validatedComplete / complete) * 100)
      : 0;
  const convertDecisionPercent =
    iclStats && complete > 0 ? Math.round((iclStats.decidedConvert / complete) * 100) : 0;
  const dischargeDecisionPercent =
    iclStats && complete > 0 ? Math.round((iclStats.decidedDischarge / complete) * 100) : 0;
  const iclDecisionDenominator = complete + total;
  const iclDecisionPercent =
    iclDecisionDenominator > 0 ? Math.round((complete / iclDecisionDenominator) * 100) : 0;
  const validatedLabel =
    validatedComplete != null && complete > 0
      ? `, ${validatedComplete} of ${complete} converted Epic episodes validated (${validatedPercentOfComplete}% of converted)`
      : '';
  const isEpisodeConversion = statUnit === 'converted';
  const isCarePlanConversion = statUnit === 'care-plan';
  const isIclReassessment = statUnit === 'icl-reassessment';
  const isDischargeSubmitted = statUnit === 'discharge-submitted';
  const carePlanConversionLabel =
    validatedComplete != null && complete > 0
      ? `, ${validatedComplete} of ${complete} episodes with completed CP conversion (${validatedPercentOfComplete}% of templated)`
      : '';

  return (
    <div className="hc-progress-bar-group">
      <div
        className="hc-progress-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          isEpisodeConversion
            ? `${complete} of ${total} VHA enrolments converted to Epic episodes, ${percent}%${validatedLabel}`
            : isCarePlanConversion
              ? `${complete} of ${total} episodes with templated CP, ${percent}%${carePlanConversionLabel}`
              : isIclReassessment && iclStats
              ? `${complete} of ${iclDecisionDenominator} ICL reassessments decided, ${iclDecisionPercent}%. ${total} still requiring reassessment. ${iclStats.decidedConvert} of ${complete} decisions to convert (${convertDecisionPercent}%), ${iclStats.decidedDischarge} of ${complete} decisions to discharge (${dischargeDecisionPercent}%)`
              : isDischargeSubmitted
                ? `${complete} of ${total} discharges submitted, ${percent}%`
                : `${complete} of ${total} completed, ${percent}%${validatedLabel}`
        }
      >
        <div
          className={`hc-progress-bar-fill${percent >= 100 ? ' hc-progress-bar-fill--full' : ''}`}
          style={{ width: `${percent}%` }}
        >
          {validatedComplete != null && complete > 0 && validatedComplete > 0 ? (
            <div
              className={`hc-progress-bar-fill-validated${
                validatedPercentOfComplete >= 100 && percent >= 100
                  ? ' hc-progress-bar-fill-validated--full'
                  : ''
              }`}
              style={{ width: `${validatedPercentOfComplete}%` }}
              title={
                isCarePlanConversion
                  ? `${validatedComplete} of ${complete} episodes with completed CP conversion`
                  : `${validatedComplete} of ${complete} converted Epic episodes validated`
              }
            />
          ) : null}
        </div>
      </div>
      <div className="hc-progress-bar-stats">
        {isEpisodeConversion ? (
          <>
            <p className="hc-progress-bar-stat hc-progress-bar-stat--converted">
              {complete} / {total} VHA enrolments converted to Epic episodes ({percent}%)
            </p>
            {validatedComplete != null ? (
              <p className="hc-progress-bar-stat hc-progress-bar-stat--validated">
                {validatedComplete} / {complete} converted Epic episodes validated (
                {validatedPercentOfComplete}%)
              </p>
            ) : null}
          </>
        ) : isCarePlanConversion ? (
          <>
            <p className="hc-progress-bar-stat hc-progress-bar-stat--converted">
              {complete} / {total} episodes with templated CP ({percent}%)
            </p>
            {validatedComplete != null ? (
              <p className="hc-progress-bar-stat hc-progress-bar-stat--validated">
                {validatedComplete} / {complete} episodes with completed CP conversion (
                {validatedPercentOfComplete}%)
              </p>
            ) : null}
            {visitWindowFilter ? (
              <label
                className="hc-progress-card-visit-filter"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={visitWindowFilter.checked}
                  disabled={visitWindowFilter.disabled}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => visitWindowFilter.onChange(event.target.checked)}
                />
                {visitWindowFilter.label}
                {visitWindowFilter.disabled ? (
                  <span className="hc-muted"> — loading…</span>
                ) : null}
              </label>
            ) : null}
          </>
        ) : isIclReassessment && iclStats ? (
          <>
            <p className="hc-progress-bar-stat">
              {total} Reassessment{total === 1 ? '' : 's'} Required
            </p>
            <p className="hc-progress-bar-stat">
              {complete} / {iclDecisionDenominator} ICL Reassessments Decided ({iclDecisionPercent}%)
            </p>
            <p className="hc-progress-bar-stat">
              {iclStats.decidedConvert} / {complete} Decisions to Convert ({convertDecisionPercent}%)
            </p>
            <p className="hc-progress-bar-stat">
              {iclStats.decidedDischarge} / {complete} Decisions to Discharge ({dischargeDecisionPercent}
              %)
            </p>
          </>
        ) : isDischargeSubmitted ? (
          <p className="hc-progress-bar-stat">
            {complete} / {total} Discharges Submitted ({percent}%)
          </p>
        ) : (
          <p className="hc-progress-bar-stat">
            {complete} / {total} completed ({percent}%)
          </p>
        )}
      </div>
    </div>
  );
}

function BucketCard({
  title,
  total,
  complete,
  percentComplete,
  validatedComplete,
  iclStats,
  statUnit = 'completed',
  onClick,
  visitWindowFilter,
}: {
  title: string;
  total: number;
  complete: number;
  percentComplete: number;
  validatedComplete?: number;
  iclStats?: {
    decidedConvert: number;
    decidedDischarge: number;
  };
  statUnit?: 'converted' | 'completed' | 'icl-reassessment' | 'discharge-submitted' | 'care-plan';
  onClick?: () => void;
  visitWindowFilter?: {
    checked: boolean;
    disabled: boolean;
    label: string;
    onChange: (checked: boolean) => void;
  };
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <article
      className={`hc-progress-card hc-panel${onClick ? ' hc-progress-card--clickable' : ''}`}
      {...(onClick
        ? {
            role: 'button',
            tabIndex: 0,
            onClick,
            onKeyDown: handleKeyDown,
            'aria-label': `View ${title}`,
          }
        : {})}
    >
      <h3 className="hc-progress-card-title">{title}</h3>
      <ProgressBar
        complete={complete}
        total={total}
        percent={percentComplete}
        validatedComplete={validatedComplete}
        iclStats={iclStats}
        statUnit={statUnit}
        visitWindowFilter={visitWindowFilter}
      />
    </article>
  );
}

interface ProgressTrackerProps {
  metrics: ProgressMetrics;
  carePlanMetrics: CarePlanProgressMetrics;
  dailyProgressSeries: DailyProgressSnapshot[];
  unifiedImportActivity: UnifiedImportActivityRow[];
  uploaderByUserId: Map<string, BatchUploader>;
  reportUploaderByUserId: Map<string, BatchUploader>;
  carePlanUploaderByUserId: Map<string, BatchUploader>;
  onNavigateToStrategy?: (strategy: string) => void;
  onNavigateToCarePlan?: () => void;
  hasServiceDataImports?: boolean;
  limitToGoLiveVisitWindow?: boolean;
  onLimitToGoLiveVisitWindowChange?: (checked: boolean) => void;
  visitWindowFilterLoading?: boolean;
}

function resolveUploaderName(
  importedBy: string | null,
  ssdbUploaders: Map<string, BatchUploader>,
  epicUploaders: Map<string, BatchUploader>,
  emriUploaders: Map<string, BatchUploader>
): string {
  if (!importedBy) return 'Unknown';
  const profile =
    ssdbUploaders.get(importedBy) ??
    epicUploaders.get(importedBy) ??
    emriUploaders.get(importedBy);
  return uploaderLabel(profile);
}

export function ProgressTracker({
  metrics,
  carePlanMetrics,
  dailyProgressSeries,
  unifiedImportActivity,
  uploaderByUserId,
  reportUploaderByUserId,
  carePlanUploaderByUserId,
  onNavigateToStrategy,
  onNavigateToCarePlan,
  hasServiceDataImports = false,
  limitToGoLiveVisitWindow = true,
  onLimitToGoLiveVisitWindowChange,
  visitWindowFilterLoading = false,
}: ProgressTrackerProps) {
  const hasGoLive = metrics.daysUntilGoLive != null;
  const daysUntilGoLive = metrics.daysUntilGoLive;
  const carePlanVisitWindowFilter =
    hasServiceDataImports && onLimitToGoLiveVisitWindowChange
      ? {
          checked: limitToGoLiveVisitWindow,
          disabled: visitWindowFilterLoading,
          label: 'Only Pts with June 22 - July 5 Service.',
          onChange: onLimitToGoLiveVisitWindowChange,
        }
      : undefined;

  return (
    <section className="hc-progress-tracker">
      <div
        className={`hc-progress-tracker-grid${
          hasGoLive ? ' hc-progress-tracker-grid--with-go-live' : ''
        }`}
      >
        {hasGoLive && (
          <article className="hc-progress-card hc-panel hc-progress-go-live-card">
            <div className="hc-progress-go-live-body">
              <span className="hc-progress-go-live-value">
                {daysUntilGoLive! > 0
                  ? `${daysUntilGoLive} days`
                  : daysUntilGoLive === 0
                    ? 'Today'
                    : `${Math.abs(daysUntilGoLive!)} days ago`}
              </span>
              <span className="hc-muted">until go-live</span>
            </div>
          </article>
        )}
        <BucketCard
          title="Episode Conversion"
          total={metrics.episodeConversion.total}
          complete={metrics.episodeConversion.complete}
          percentComplete={metrics.episodeConversion.percentComplete}
          validatedComplete={metrics.episodeConversion.validatedComplete}
          statUnit="converted"
          onClick={
            onNavigateToStrategy
              ? () => onNavigateToStrategy(EPISODE_CONVERSION_STRATEGY)
              : undefined
          }
        />
        <BucketCard
          title="Care Plan Conversion"
          total={carePlanMetrics.total}
          complete={carePlanMetrics.linkedComplete}
          percentComplete={carePlanMetrics.percentLinked}
          validatedComplete={carePlanMetrics.conversionComplete}
          statUnit="care-plan"
          onClick={onNavigateToCarePlan}
          visitWindowFilter={carePlanVisitWindowFilter}
        />
        <BucketCard
          title="ICL Reassessment Required"
          total={metrics.iclReassessment.total}
          complete={metrics.iclReassessment.complete}
          percentComplete={metrics.iclReassessment.percentComplete}
          statUnit="icl-reassessment"
          iclStats={{
            decidedConvert: metrics.iclReassessment.decidedConvert,
            decidedDischarge: metrics.iclReassessment.decidedDischarge,
          }}
          onClick={
            onNavigateToStrategy
              ? () => onNavigateToStrategy(ICL_REASSESSMENT_STRATEGY)
              : undefined
          }
        />
        <BucketCard
          title="Discharge from Program"
          total={metrics.programDischarge.total}
          complete={metrics.programDischarge.complete}
          percentComplete={metrics.programDischarge.percentComplete}
          statUnit="discharge-submitted"
          onClick={
            onNavigateToStrategy ? () => onNavigateToStrategy(DISCHARGE_STRATEGY) : undefined
          }
        />

        <section className="hc-epic-split-panel hc-progress-section hc-progress-section--overall hc-progress-tracker-overall">
          <h3 className="hc-epic-split-panel-title">
            <span className="hc-epic-split-panel-title-main">Overall Progress</span>
          </h3>
          <div className="hc-progress-section-body">
            <DailyProgressChart series={dailyProgressSeries} />
          </div>
        </section>

        <section className="hc-epic-split-panel hc-progress-section hc-progress-section--import-activity hc-progress-tracker-import">
          <h3 className="hc-epic-split-panel-title">
            <span className="hc-epic-split-panel-title-main">Import Activity</span>
          </h3>
          <div className="hc-table-wrap">
            <table className="hc-table hc-table--grid hc-table--import-activity">
              <thead>
                <tr>
                  <th className="hc-col-upload-details">Upload Details</th>
                  <th className="hc-col-import-rows">Rows</th>
                  <th className="hc-col-upload-results">Results</th>
                </tr>
              </thead>
              <tbody>
                {unifiedImportActivity.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="hc-muted">
                      No SSDB, Epic, or EMRI uploads yet.
                    </td>
                  </tr>
                ) : (
                  unifiedImportActivity.map((row) => {
                    const uploaderName = resolveUploaderName(
                      row.importedBy,
                      uploaderByUserId,
                      reportUploaderByUserId,
                      carePlanUploaderByUserId
                    );
                    return (
                      <tr key={`${row.type}-${row.filename}-${row.importedAt}`}>
                        <td className="hc-col-upload-details">
                          <div className="hc-import-upload-cell">
                            <div className="hc-import-upload-title">
                              <span className="hc-import-filename">{row.filename}</span>
                              <span
                                className={`hc-badge hc-upload-type-badge hc-upload-type-badge--${row.type}`}
                              >
                                {uploadTypeLabel(row.type)}
                              </span>
                            </div>
                            <span className="hc-import-upload-meta">
                              <span className="hc-import-upload-meta-line">
                                Uploaded by {uploaderName}
                              </span>
                              <span className="hc-import-upload-meta-line">
                                {formatImportTimestamp(row.importedAt)}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="hc-col-import-rows">{row.rowCount}</td>
                        <td className="hc-col-upload-results">
                          {formatUnifiedImportResults(row)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
