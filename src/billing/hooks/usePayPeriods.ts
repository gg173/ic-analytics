import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { PayPeriod, PayPeriodSummary } from '../types';

export interface UsePayPeriodsResult {
  payPeriods: PayPeriod[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePayPeriods(): UsePayPeriodsResult {
  const [payPeriods, setPayPeriods] = useState<PayPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('pay_periods')
      .select('*')
      .order('week_start', { ascending: false });

    if (err) {
      setError(err.message);
    } else {
      setPayPeriods((data ?? []) as PayPeriod[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { payPeriods, loading, error, refresh: load };
}

export async function createPayPeriod(
  weekStart: string,
  userId: string
): Promise<{ data: PayPeriod | null; error: string | null }> {
  // week_end = week_start + 6 days
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);

  // submission deadline = following Monday at 10:00 ET
  const deadline = new Date(start);
  deadline.setDate(deadline.getDate() + 7);
  deadline.setHours(14, 0, 0, 0); // 10:00 ET = 14:00 UTC

  const { data, error } = await supabase
    .from('pay_periods')
    .insert({
      week_start: weekStart,
      week_end: weekEnd,
      submission_deadline: deadline.toISOString(),
      status: 'not_started',
      initiated_by: userId,
    })
    .select()
    .single();

  return { data: data as PayPeriod | null, error: error?.message ?? null };
}

export async function initiatePayPeriod(
  payPeriodId: string,
  userId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('pay_periods')
    .update({
      status: 'in_progress',
      initiated_by: userId,
      initiated_at: new Date().toISOString(),
    })
    .eq('id', payPeriodId);
  return { error: error?.message ?? null };
}

export async function finalizePayPeriod(
  payPeriodId: string,
  userId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('pay_periods')
    .update({
      status: 'finalized',
      finalized_by: userId,
      finalized_at: new Date().toISOString(),
    })
    .eq('id', payPeriodId);
  return { error: error?.message ?? null };
}

export async function getPayPeriodSummary(
  payPeriodId: string
): Promise<{ summary: PayPeriodSummary | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_pay_period_summary', {
    p_pay_period_id: payPeriodId,
  });
  return { summary: data as PayPeriodSummary | null, error: error?.message ?? null };
}
