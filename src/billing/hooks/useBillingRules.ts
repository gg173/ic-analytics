import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  BillingDurationRule,
  BillingCancellationCode,
  BillingCareStream,
  BillingRuleHistory,
} from '../types';

export function useDurationRules() {
  const [rules, setRules] = useState<BillingDurationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('billing_duration_rules')
      .select('*')
      .order('visit_category')
      .order('effective_from', { ascending: false });
    if (err) setError(err.message);
    else setRules((data ?? []) as BillingDurationRule[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { rules, loading, error, refresh: load };
}

export function useCancellationCodes() {
  const [codes, setCodes] = useState<BillingCancellationCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('billing_cancellation_codes')
      .select('*')
      .order('code');
    if (err) setError(err.message);
    else setCodes((data ?? []) as BillingCancellationCode[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { codes, loading, error, refresh: load };
}

export function useCareStreams() {
  const [streams, setStreams] = useState<BillingCareStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('billing_care_streams')
      .select('*')
      .order('discipline_group')
      .order('label');
    if (err) setError(err.message);
    else setStreams((data ?? []) as BillingCareStream[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { streams, loading, error, refresh: load };
}

export function useRuleHistory(tableName?: string) {
  const [history, setHistory] = useState<BillingRuleHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      let q = supabase
        .from('billing_rule_history')
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(100);
      if (tableName) q = q.eq('table_name', tableName);
      const { data } = await q;
      setHistory((data ?? []) as BillingRuleHistory[]);
      setLoading(false);
    })();
  }, [tableName]);

  return { history, loading };
}
