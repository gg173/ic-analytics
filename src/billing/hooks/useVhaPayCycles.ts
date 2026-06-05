import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { VhaPayCycle } from '../types';

export function useVhaPayCycles() {
  const [cycles, setCycles] = useState<VhaPayCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await supabase
        .from('vha_pay_cycles')
        .select('*')
        .order('cycle_start', { ascending: true });
      if (err) setError(err.message);
      else setCycles((data ?? []) as VhaPayCycle[]);
      setLoading(false);
    })();
  }, []);

  return { cycles, loading, error };
}
