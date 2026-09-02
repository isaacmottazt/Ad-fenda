create or replace function public.get_admin_operational_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  queue_total bigint;
  queue_completed bigint;
  queue_queued bigint;
  queue_processing bigint;
  queue_failed bigint;
  db_bytes bigint;
  storage_bytes bigint;
  storage_objects bigint;
  music_total bigint;
  user_total bigint;
  artist_total bigint;
  last_completed timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Acesso restrito a administradores';
  end if;

  select count(*) into queue_queued from public.music_analysis_jobs where status = 'queued';
  select count(*) into queue_processing from public.music_analysis_jobs where status = 'processing';
  select count(*) into queue_completed from public.music_analysis_jobs where status = 'completed';
  select count(*) into queue_failed from public.music_analysis_jobs where status = 'failed';
  select count(*) into queue_total from public.music_analysis_jobs;
  select max(completed_at) into last_completed from public.music_analysis_jobs where status = 'completed';

  select count(*) into music_total from public.musics;
  select count(*) into user_total from public.profiles;
  select count(*) into artist_total from public.artists;
  select pg_database_size(current_database()) into db_bytes;

  select count(*) into storage_objects from storage.objects;
  select coalesce(sum(
    case when (metadata->>'size') ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end
  ), 0) into storage_bytes from storage.objects;

  return jsonb_build_object(
    'generated_at', now(),
    'catalog', jsonb_build_object('musics', music_total, 'users', user_total, 'artists', artist_total),
    'queue', jsonb_build_object(
      'total', queue_total,
      'queued', queue_queued,
      'processing', queue_processing,
      'completed', queue_completed,
      'failed', queue_failed,
      'progress_percent', case when queue_total > 0 then round((queue_completed::numeric / queue_total::numeric) * 100) else 100 end,
      'last_completed_at', last_completed
    ),
    'database', jsonb_build_object(
      'used_bytes', db_bytes,
      'limit_bytes', null,
      'available_bytes', null,
      'limit_note', 'A cota contratada do plano Supabase não é exposta pelo banco ao aplicativo.'
    ),
    'storage', jsonb_build_object('objects', storage_objects, 'used_bytes', storage_bytes),
    'health', jsonb_build_object(
      'database', 'healthy',
      'storage', 'healthy',
      'analysis_queue', case when queue_failed <= 10 then 'healthy' else 'attention' end,
      'worker_schedule', 'healthy'
    )
  );
end;
$$;

revoke all on function public.get_admin_operational_metrics() from public, anon;
grant execute on function public.get_admin_operational_metrics() to authenticated;
