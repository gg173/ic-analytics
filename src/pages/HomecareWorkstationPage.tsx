import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../homecare/hooks/useAuth';
import { useBatch } from '../homecare/hooks/useBatch';
import { useVisits, useAllVisitsForExport } from '../homecare/hooks/useVisits';
import {
  useVisitIssues,
  useVisitApprovals,
  useInvestigation,
  useAuditTrail,
  useSpoResponses,
} from '../homecare/hooks/useAudit';
import { revalidateBatch } from '../homecare/hooks/useRules';
import { useRules } from '../homecare/hooks/useRules';
import {
  VisitGrid,
  VisitFilterBar,
  IssueDrawer,
  AuditTimeline,
  SpoResponseThread,
} from '../homecare/components/WorkstationPanels';
import { downloadBillingCsv } from '../homecare/export/buildBillingCsv';
import { triggerPush } from '../homecare/push/triggerPush';
import type { ServiceVisit, VisitFilter } from '../homecare/types';
import { supabase } from '../lib/supabase';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  validated: 'Validated',
  in_review: 'In review',
  ready_for_spo: 'Ready for SPO',
  pushed: 'Pushed',
};

export function HomecareWorkstationPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const { canEdit, isSpo, isUhn } = useAuth();
  const { batch, loading: batchLoading, refresh: refreshBatch, updateStatus } = useBatch(batchId);
  const [filter, setFilter] = useState<VisitFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailsVisit, setDetailsVisit] = useState<ServiceVisit | null>(null);
  const { visits, loading, refresh, updateVisit } = useVisits(batchId, filter);
  const { issues, refresh: refreshIssues } = useVisitIssues(detailsVisit?.id);
  const { submitApproval } = useVisitApprovals(detailsVisit?.id);
  const { submitInvestigation } = useInvestigation(detailsVisit?.id);
  const { events } = useAuditTrail(batchId, detailsVisit?.id);
  const { responses, addResponse } = useSpoResponses(detailsVisit?.id, batchId);
  const { fetchAll } = useAllVisitsForExport(batchId);
  const { pushDestinations } = useRules();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleRevalidate = useCallback(async () => {
    if (!batchId) return;
    setBusy(true);
    const { error } = await revalidateBatch(batchId);
    setMessage(error ?? 'Validation complete');
    await refreshBatch();
    await refresh();
    setBusy(false);
  }, [batchId, refreshBatch, refresh]);

  const handleMarkReady = useCallback(async () => {
    const { error } = await updateStatus('ready_for_spo');
    setMessage(error ?? 'Batch marked ready for SPO');
  }, [updateStatus]);

  const handlePullBack = useCallback(async () => {
    const { error } = await updateStatus('in_review');
    setMessage(error ?? 'Batch returned to review');
  }, [updateStatus]);

  const handleExport = useCallback(async () => {
    const all = await fetchAll();
    downloadBillingCsv(all, `${batch?.filename ?? 'batch'}_billing_ready.csv`);
    if (batchId) {
      await supabase.from('audit_events').insert({
        entity_type: 'import_batch',
        entity_id: batchId,
        batch_id: batchId,
        action: 'export',
        metadata: { row_count: all.length },
      });
    }
  }, [fetchAll, batch, batchId]);

  const handlePush = useCallback(async () => {
    if (!batchId || pushDestinations.length === 0) return;
    setBusy(true);
    const dest = pushDestinations.find((d) => d.active) ?? pushDestinations[0];
    const result = await triggerPush(batchId, dest.id);
    if (result.ok) {
      await updateStatus('pushed');
      setMessage('Push job submitted');
    } else {
      setMessage(result.error ?? 'Push failed');
    }
    setBusy(false);
  }, [batchId, pushDestinations, updateStatus]);

  const handleSaveField = useCallback(
    async (field: keyof ServiceVisit, value: string) => {
      if (!detailsVisit) return;
      const updates: Partial<ServiceVisit> = {};
      if (field === 'duration_minutes') {
        updates.duration_minutes = parseFloat(value) || null;
      } else {
        (updates as Record<string, string | null>)[field] = value || null;
      }
      await updateVisit(detailsVisit.id, updates);
      await refreshIssues();
      await handleRevalidate();
      setDetailsVisit({ ...detailsVisit, ...updates });
    },
    [detailsVisit, updateVisit, refreshIssues, handleRevalidate]
  );

  const handleSaveRow = useCallback(
    async (visitId: string, updates: Partial<ServiceVisit>) => {
      await updateVisit(visitId, updates);
      await handleRevalidate();
      setEditingId(null);
      if (detailsVisit?.id === visitId) {
        setDetailsVisit({ ...detailsVisit, ...updates });
      }
    },
    [updateVisit, handleRevalidate, detailsVisit]
  );

  const handleStartEdit = useCallback(
    (visit: ServiceVisit) => {
      setEditingId(visit.id);
    },
    []
  );

  const handleApprove = useCallback(
    async (
      type: 'virtual_visit' | 'visit_limit_excess',
      status: 'approved' | 'denied',
      notes: string,
      extRef: string
    ) => {
      await submitApproval(type, status, notes, extRef);
      if (detailsVisit && status === 'approved') {
        await supabase
          .from('service_visits')
          .update({
            is_billable: true,
            needs_virtual_approval: type === 'virtual_visit' ? false : detailsVisit.needs_virtual_approval,
            needs_limit_approval: type === 'visit_limit_excess' ? false : detailsVisit.needs_limit_approval,
            billing_block_reason: null,
          })
          .eq('id', detailsVisit.id);
      }
      await handleRevalidate();
      await refresh();
    },
    [submitApproval, detailsVisit, handleRevalidate, refresh]
  );

  const handleInvestigate = useCallback(
    async (outcome: string, notes: string) => {
      await submitInvestigation(
        outcome as 'billable' | 'not_billable' | 'payable' | 'not_payable',
        notes,
        detailsVisit?.visit_cancel_reason ?? undefined
      );
      await handleRevalidate();
      await refresh();
    },
    [submitInvestigation, detailsVisit, handleRevalidate, refresh]
  );

  if (batchLoading) return <p className="hc-muted">Loading batch…</p>;
  if (!batch) return <p className="hc-form-error">Batch not found</p>;

  const batchEditable = canEdit && batch.status !== 'pushed';

  return (
    <div className="hc-workstation">
      <div className="hc-batch-header">
        <div>
          <button type="button" className="hc-btn hc-btn-ghost" onClick={() => navigate('/homecare')}>
            ← Batches
          </button>
          <div className="hc-batch-title-row">
            <h1>{batch.filename}</h1>
            <span className={`hc-badge hc-badge--${batch.status}`}>
              {STATUS_LABELS[batch.status] ?? batch.status}
            </span>
          </div>
          <p className="hc-muted">
            {batch.row_count} rows · {batch.issue_count} open issues
          </p>
        </div>
        <div className="hc-btn-row">
          {canEdit && batch.status !== 'pushed' && (
            <>
              <button type="button" className="hc-btn hc-btn-secondary" disabled={busy} onClick={handleRevalidate}>
                Re-validate
              </button>
              {batch.status !== 'ready_for_spo' ? (
                <button type="button" className="hc-btn hc-btn-primary" onClick={handleMarkReady}>
                  Mark ready for SPO
                </button>
              ) : (
                <button type="button" className="hc-btn hc-btn-secondary" onClick={handlePullBack}>
                  Return to review
                </button>
              )}
              {isUhn && pushDestinations.length > 0 && (
                <button type="button" className="hc-btn hc-btn-secondary" disabled={busy} onClick={handlePush}>
                  Push to SPO
                </button>
              )}
            </>
          )}
          {(isSpo || batch.status === 'ready_for_spo' || batch.status === 'pushed') && (
            <button type="button" className="hc-btn hc-btn-primary" onClick={handleExport}>
              Export billing CSV
            </button>
          )}
        </div>
      </div>

      {message && <p className="hc-info">{message}</p>}

      <VisitFilterBar
        filter={filter}
        onFilterChange={setFilter}
        loading={loading}
        visitCount={visits.length}
      />

      <div className="hc-workstation-body">
        <VisitGrid
          visits={visits}
          loading={loading}
          canEdit={batchEditable}
          editingId={editingId}
          onStartEdit={handleStartEdit}
          onCancelEdit={() => setEditingId(null)}
          onSaveRow={handleSaveRow}
        />
        <IssueDrawer
          visit={detailsVisit}
          issues={issues}
          canEdit={batchEditable}
          isSpo={isSpo}
          onClose={() => setDetailsVisit(null)}
          onSaveField={handleSaveField}
          onApprove={handleApprove}
          onInvestigate={handleInvestigate}
          auditContent={<AuditTimeline events={events} />}
          spoContent={
            <SpoResponseThread
              responses={responses}
              canRespond={isSpo}
              onSubmit={addResponse}
            />
          }
        />
      </div>
    </div>
  );
}
