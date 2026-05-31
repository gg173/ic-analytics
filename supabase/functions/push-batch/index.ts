import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { batch_id, destination_id, job_id } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await supabase.from('push_jobs').update({ status: 'running', attempts: 1 }).eq('id', job_id);

    const { data: destination } = await supabase
      .from('push_destinations')
      .select('*')
      .eq('id', destination_id)
      .single();

    if (!destination?.url) {
      throw new Error('Destination URL not configured');
    }

    const { data: visits } = await supabase
      .from('service_visits')
      .select('*')
      .eq('batch_id', batch_id)
      .eq('is_billable', true)
      .eq('needs_virtual_approval', false)
      .eq('needs_limit_approval', false)
      .eq('needs_cancellation_investigation', false);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (destination.auth_header_name && destination.auth_header_value) {
      headers[destination.auth_header_name] = destination.auth_header_value;
    }

    const pushResponse = await fetch(destination.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ batch_id, visits, pushed_at: new Date().toISOString() }),
    });

    const responseText = await pushResponse.text();

    if (!pushResponse.ok) {
      await supabase
        .from('push_jobs')
        .update({ status: 'failed', response: responseText, completed_at: new Date().toISOString() })
        .eq('id', job_id);
      throw new Error(`Push failed: ${responseText}`);
    }

    await supabase
      .from('push_jobs')
      .update({ status: 'success', response: responseText, completed_at: new Date().toISOString() })
      .eq('id', job_id);

    await supabase.from('import_batches').update({ status: 'pushed' }).eq('id', batch_id);

    return new Response(JSON.stringify({ ok: true, visit_count: visits?.length ?? 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
