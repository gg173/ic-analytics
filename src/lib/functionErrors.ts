import { FunctionsHttpError } from '@supabase/supabase-js';

export async function readEdgeFunctionError(
  error: unknown,
  data: unknown
): Promise<string | null> {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === 'string' && message.length > 0) return message;
  }

  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body && typeof body === 'object' && 'error' in body) {
        const message = (body as { error?: unknown }).error;
        if (typeof message === 'string' && message.length > 0) return message;
      }
    } catch {
      const raw = error.context.body;
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed.error) return parsed.error;
        } catch {
          return raw;
        }
      }
    }
    return error.message;
  }

  if (error instanceof Error) return error.message;
  return null;
}
