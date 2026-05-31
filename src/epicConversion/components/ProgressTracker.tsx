import type { BatchUploader } from '../../homecare/types';
import { uploaderLabel } from '../../homecare/hooks/useBatch';
import type { ImportActivityRow } from '../progress/computeImportActivity';
import { formatStrategyBreakdown } from '../progress/computeImportActivity';
import type { DailyProgressSnapshot } from '../progress/computeDailyProgressSeries';
import type { ProgressMetrics } from '../progress/computeProgressMetrics';
import { DailyProgressChart } from './DailyProgressChart';
import {
  RECONCILIATION_FIELD_LABELS,
  RECONCILIATION_OUTCOME_LABELS,
  type ReconciliationCompareField,
  type ReconciliationDetailRow,
  type ReconciliationOutcome,
  type ReconciliationSummary,
} from '../reconciliation/types';
import type { EpicConversionReportImport } from '../reconciliation/types';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatImportMeta(uploaderName: string, importedAt: string): string {
  const d = new Date(importedAt);
  if (Number.isNaN(d.getTime())) {
    return `Uploaded by ${uploaderName} on ${importedAt}`;
  }
  const date = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `Uploaded by ${uploaderName} on ${date} at ${hours}:${minutes}`;
}

function ProgressBar({
  complete,
  total,
  percent,
}: {
  complete: number;
  total: number;
  percent: number;
}) {
  return (
    <div
      className="hc-progress-bar"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${complete} of ${total} completed, ${percent}%`}
    >
      <div className="hc-progress-bar-fill" style={{ width: `${percent}%` }} />
      <span className="hc-progress-bar-label">
        {complete} / {total} completed ({percent}%)
      </span>
    </div>
  );
}

function BucketCard({
  title,
  total,
  complete,
  percentComplete,
}: {
  title: string;
  total: number;
  complete: number;
  percentComplete: number;
}) {
  return (
    <article className="hc-progress-card hc-panel">
      <h3 className="hc-progress-card-title">{title}</h3>
      <ProgressBar complete={complete} total={total} percent={percentComplete} />
    </article>
  );
}

function outcomeClass(outcome: ReconciliationOutcome): string {
  if (outcome === 'perfect') return 'hc-reconcile-outcome--perfect';
  if (outcome === 'incorrect') return 'hc-reconcile-outcome--incorrect';
  return 'hc-reconcile-outcome--unmatched';
}

interface ProgressTrackerProps {
  metrics: ProgressMetrics;
  dailyProgressSeries: DailyProgressSnapshot[];
  importActivity: ImportActivityRow[];
  uploaderByUserId: Map<string, BatchUploader>;
  reportImports: EpicConversionReportImport[];
  reportUploaderByUserId: Map<string, BatchUploader>;
  latestSummary: ReconciliationSummary | null;
  reconciliationDetails: ReconciliationDetailRow[];
  detailsImportId: string | null;
  onLoadReconciliationDetails: (importId: string) => void;
}

export function ProgressTracker({
  metrics,
  dailyProgressSeries,
  importActivity,
  uploaderByUserId,
  reportImports,
  reportUploaderByUserId,
  latestSummary,
  reconciliationDetails,
  detailsImportId,
  onLoadReconciliationDetails,
}: ProgressTrackerProps) {
  return (
    <section className="hc-progress-tracker">
      <div
        className={`hc-progress-buckets${
          metrics.daysUntilGoLive != null ? ' hc-progress-buckets--with-go-live' : ''
        }`}
      >
        {metrics.daysUntilGoLive != null && (
          <article className="hc-progress-card hc-panel hc-progress-go-live-card">
            <div className="hc-progress-go-live-body">
              <span className="hc-progress-go-live-value">
                {metrics.daysUntilGoLive > 0
                  ? `${metrics.daysUntilGoLive} days`
                  : metrics.daysUntilGoLive === 0
                    ? 'Today'
                    : `${Math.abs(metrics.daysUntilGoLive)} days ago`}
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
        />
        <BucketCard
          title="ICL Reassessment Required"
          total={metrics.iclReassessment.total}
          complete={metrics.iclReassessment.complete}
          percentComplete={metrics.iclReassessment.percentComplete}
        />
        <BucketCard
          title="Discharge from Program"
          total={metrics.programDischarge.total}
          complete={metrics.programDischarge.complete}
          percentComplete={metrics.programDischarge.percentComplete}
        />
      </div>

      <div className="hc-progress-section hc-panel">
        <DailyProgressChart series={dailyProgressSeries} />
      </div>

      <div className="hc-progress-section hc-panel">
        <h2 className="hc-progress-section-title">Import Activity</h2>
        <div className="hc-table-wrap">
          <table className="hc-table hc-table--grid">
            <thead>
              <tr>
                <th>SSDB Upload</th>
                <th>Rows</th>
                <th>Strategy breakdown</th>
              </tr>
            </thead>
            <tbody>
              {importActivity.length === 0 ? (
                <tr>
                  <td colSpan={3} className="hc-muted">
                    No enrolment data uploaded yet.
                  </td>
                </tr>
              ) : (
                importActivity.map((row) => {
                  const uploader = row.importedBy
                    ? uploaderByUserId.get(row.importedBy)
                    : null;
                  const uploaderName = row.importedBy ? uploaderLabel(uploader) : 'Unknown';
                  return (
                    <tr key={`${row.filename}-${row.importedAt}`}>
                      <td>
                        <div className="hc-import-upload-cell">
                          <span className="hc-import-filename">{row.filename}</span>
                          <span className="hc-import-upload-meta">
                            {formatImportMeta(uploaderName, row.importedAt)}
                          </span>
                        </div>
                      </td>
                      <td>{row.rowCount}</td>
                      <td>{formatStrategyBreakdown(row.strategyBreakdown)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {latestSummary && (
        <div className="hc-progress-section hc-panel">
          <h2 className="hc-progress-section-title">Epic Conversion Reconciliation</h2>
          <p className="hc-muted hc-progress-reconcile-meta">
            Latest report: {latestSummary.filename} ({formatDate(latestSummary.importedAt.slice(0, 10))})
          </p>
          <div className="hc-progress-reconcile-summary">
            <div className="hc-reconcile-stat hc-reconcile-stat--perfect">
              <strong>{latestSummary.perfect}</strong>
              <span>{RECONCILIATION_OUTCOME_LABELS.perfect}</span>
            </div>
            <div className="hc-reconcile-stat hc-reconcile-stat--incorrect">
              <strong>{latestSummary.incorrect}</strong>
              <span>{RECONCILIATION_OUTCOME_LABELS.incorrect}</span>
            </div>
            <div className="hc-reconcile-stat hc-reconcile-stat--unmatched">
              <strong>{latestSummary.unmatched}</strong>
              <span>{RECONCILIATION_OUTCOME_LABELS.unmatched}</span>
            </div>
          </div>

          {reportImports.length > 0 && (
            <div className="hc-progress-reconcile-actions">
              <label className="hc-progress-reconcile-select-label">
                View details for report
                <select
                  className="hc-select"
                  value={detailsImportId ?? latestSummary.importId}
                  onChange={(e) => onLoadReconciliationDetails(e.target.value)}
                >
                  {reportImports.map((imp) => {
                    const uploader = imp.imported_by
                      ? reportUploaderByUserId.get(imp.imported_by)
                      : null;
                    const name = imp.imported_by ? uploaderLabel(uploader) : 'Unknown';
                    return (
                      <option key={imp.id} value={imp.id}>
                        {imp.source_filename} — {name}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
          )}

          {reconciliationDetails.length > 0 && (
            <div className="hc-table-wrap hc-progress-reconcile-table-wrap">
              <table className="hc-table hc-table--grid">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>MRN</th>
                    <th>Outcome</th>
                    <th>Discrepancies</th>
                    <th>Report Pathway</th>
                    <th>Matched Pathway</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliationDetails.map((row) => (
                    <tr key={row.reportRowId}>
                      <td>{row.rowIndex}</td>
                      <td>{row.mrn}</td>
                      <td>
                        <span className={`hc-reconcile-outcome ${outcomeClass(row.outcome)}`}>
                          {RECONCILIATION_OUTCOME_LABELS[row.outcome]}
                        </span>
                      </td>
                      <td>
                        {row.fieldDiscrepancies.length
                          ? row.fieldDiscrepancies
                              .map(
                                (field) =>
                                  RECONCILIATION_FIELD_LABELS[field as ReconciliationCompareField] ??
                                  field
                              )
                              .join(', ')
                          : '—'}
                      </td>
                      <td>{row.pathway ?? '—'}</td>
                      <td>{row.matchedPathway ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
