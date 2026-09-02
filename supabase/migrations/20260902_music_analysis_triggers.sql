create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.notify_music_analysis_worker()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  project_url text;
  anon_key text;
begin
  if new.src is null
     or (nullif(trim(coalesce(new.style, '')), '') is not null
         and new.tempo_bpm is not null
         and nullif(trim(coalesce(new.rhythm_profile, '')), '') is not null) then
    return new;
  end if;

  select decrypted_secret into project_url
    from vault.decrypted_secrets
   where name = 'music_analysis_project_url'
   limit 1;
  select decrypted_secret into anon_key
    from vault.decrypted_secrets
   where name = 'music_analysis_anon_key'
   limit 1;

  if project_url is not null and anon_key is not null then
    perform net.http_post(
      url := project_url || '/functions/v1/music-analysis-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key
      ),
      body := jsonb_build_object('source', 'music_insert', 'music_id', new.id)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_music_analysis_worker() from public, anon, authenticated;

drop trigger if exists music_analysis_notify_trigger on public.musics;
create trigger music_analysis_notify_trigger
after insert on public.musics
for each row execute function public.notify_music_analysis_worker();

do $$
declare
  existing_job_id bigint;
  project_url text;
  anon_key text;
begin
  select jobid into existing_job_id from cron.job where jobname = 'music-analysis-worker-every-five-minutes' limit 1;
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;

  select decrypted_secret into project_url
    from vault.decrypted_secrets
   where name = 'music_analysis_project_url'
   limit 1;
  select decrypted_secret into anon_key
    from vault.decrypted_secrets
   where name = 'music_analysis_anon_key'
   limit 1;

  if project_url is not null and anon_key is not null then
    perform cron.schedule(
      'music-analysis-worker-every-five-minutes',
      '*/5 * * * *',
      format($job$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || %L, 'apikey', %L),
          body := '{"source":"cron"}'::jsonb
        );
      $job$, project_url || '/functions/v1/music-analysis-worker', anon_key, anon_key)
    );
  end if;
end;
$$;
