import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

type PageQueryResult<T> = PromiseLike<{
  data: T[] | null;
  error: PostgrestError | null;
}>;

export async function fetchAllSupabaseRows<T>(
  runQuery: (client: SupabaseClient, from: number, to: number) => PageQueryResult<T>,
  client: SupabaseClient
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await runQuery(client, from, from + PAGE_SIZE - 1);
    if (error) {
      return { data: all, error };
    }

    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < PAGE_SIZE) {
      return { data: all, error: null };
    }
    from += PAGE_SIZE;
  }
}
