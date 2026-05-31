import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { AuditEvent, SpoResponse, VisitApproval, VisitIssue, CancellationInvestigation } from '../types';

export function useVisitIssues(visitId: string | undefined) {
  const [issues, setIssues] = useState<VisitIssue[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!visitId) return;
    setLoading(true);
    const { data } = await supabase
      .from('visit_issues')
      .select('*')
      .eq('visit_id', visitId)
      .order('created_at', { ascending: false });
    setIssues((data as VisitIssue[]) ?? []);
    setLoading(false);
  }, [visitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resolveIssue = useCallback(
    async (issueId: string, resolution: VisitIssue['resolution']) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('visit_issues')
        .update({
          resolution,
          resolved_at: new Date().toISOString(),
          resolved_by: userData.user?.id,
        })
        .eq('id', issueId);
      if (!error) await refresh();
      return { error: error?.message ?? null };
    },
    [refresh]
  );

  return { issues, loading, refresh, resolveIssue };
}

export function useVisitApprovals(visitId: string | undefined) {
  const [approvals, setApprovals] = useState<VisitApproval[]>([]);

  const refresh = useCallback(async () => {
    if (!visitId) return;
    const { data } = await supabase.from('visit_approvals').select('*').eq('visit_id', visitId);
    setApprovals((data as VisitApproval[]) ?? []);
  }, [visitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submitApproval = useCallback(
    async (
      approvalType: VisitApproval['approval_type'],
      status: VisitApproval['status'],
      notes?: string,
      externalReference?: string
    ) => {
      if (!visitId) return { error: 'No visit' };
      const { data: userData } = await supabase.auth.getUser();
      const existing = approvals.find((a) => a.approval_type === approvalType);

      if (existing) {
        const { error } = await supabase
          .from('visit_approvals')
          .update({
            status,
            notes: notes ?? null,
            external_reference: externalReference ?? null,
            approved_by: userData.user?.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (!error) await refresh();
        return { error: error?.message ?? null };
      }

      const { error } = await supabase.from('visit_approvals').insert({
        visit_id: visitId,
        approval_type: approvalType,
        status,
        notes: notes ?? null,
        external_reference: externalReference ?? null,
        approved_by: userData.user?.id,
      });
      if (!error) await refresh();
      return { error: error?.message ?? null };
    },
    [visitId, approvals, refresh]
  );

  return { approvals, refresh, submitApproval };
}

export function useInvestigation(visitId: string | undefined) {
  const [investigation, setInvestigation] = useState<CancellationInvestigation | null>(null);

  const refresh = useCallback(async () => {
    if (!visitId) return;
    const { data } = await supabase
      .from('cancellation_investigations')
      .select('*')
      .eq('visit_id', visitId)
      .maybeSingle();
    setInvestigation(data as CancellationInvestigation | null);
  }, [visitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submitInvestigation = useCallback(
    async (outcome: CancellationInvestigation['outcome'], notes: string, cancelReasonCode?: string) => {
      if (!visitId) return { error: 'No visit' };
      const { data: userData } = await supabase.auth.getUser();

      const payload = {
        visit_id: visitId,
        cancel_reason_code: cancelReasonCode ?? null,
        investigation_status: 'closed',
        outcome,
        notes,
        investigated_by: userData.user?.id,
        updated_at: new Date().toISOString(),
      };

      if (investigation) {
        const { error } = await supabase
          .from('cancellation_investigations')
          .update(payload)
          .eq('id', investigation.id);
        if (!error) {
          if (outcome === 'billable' || outcome === 'payable') {
            await supabase
              .from('service_visits')
              .update({ is_billable: true, needs_cancellation_investigation: false, billing_block_reason: null })
              .eq('id', visitId);
          }
          await refresh();
        }
        return { error: error?.message ?? null };
      }

      const { error } = await supabase.from('cancellation_investigations').insert(payload);
      if (!error) await refresh();
      return { error: error?.message ?? null };
    },
    [visitId, investigation, refresh]
  );

  return { investigation, refresh, submitInvestigation };
}

export function useAuditTrail(batchId: string | undefined, visitId?: string) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('audit_events').select('*').order('created_at', { ascending: false }).limit(100);
    if (visitId) query = query.eq('visit_id', visitId);
    else if (batchId) query = query.eq('batch_id', batchId);
    const { data } = await query;
    setEvents((data as AuditEvent[]) ?? []);
    setLoading(false);
  }, [batchId, visitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { events, loading, refresh };
}

export function useSpoResponses(visitId?: string, batchId?: string, auditEventId?: string) {
  const [responses, setResponses] = useState<SpoResponse[]>([]);

  const refresh = useCallback(async () => {
    let query = supabase.from('spo_responses').select('*').order('created_at', { ascending: true });
    if (auditEventId) query = query.eq('audit_event_id', auditEventId);
    else if (visitId) query = query.eq('visit_id', visitId);
    else if (batchId) query = query.eq('batch_id', batchId);
    const { data } = await query;
    setResponses((data as SpoResponse[]) ?? []);
  }, [visitId, batchId, auditEventId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addResponse = useCallback(
    async (body: string) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return { error: 'Not authenticated' };

      const { error } = await supabase.from('spo_responses').insert({
        body,
        author_id: userData.user.id,
        visit_id: visitId ?? null,
        batch_id: batchId ?? null,
        audit_event_id: auditEventId ?? null,
      });
      if (!error) await refresh();
      return { error: error?.message ?? null };
    },
    [visitId, batchId, auditEventId, refresh]
  );

  return { responses, refresh, addResponse };
}
