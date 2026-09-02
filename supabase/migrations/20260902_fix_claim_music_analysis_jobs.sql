create or replace function public.claim_music_analysis_jobs(p_limit integer default 3)
returns table (
  job_id bigint,
  music_id bigint,
  title text,
  artist text,
  src text,
  genre text,
  style text,
  style_tags text[],
  tempo_bpm numeric,
  rhythm_profile text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.music_analysis_jobs j
    where j.status in ('queued', 'failed')
      and j.available_at <= now()
      and j.attempts < 8
    order by j.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 3), 10))
  ), claimed as (
    update public.music_analysis_jobs j
       set status = 'processing',
           attempts = j.attempts + 1,
           locked_at = now(),
           updated_at = now()
      from candidates c
     where j.id = c.id
    returning j.id, j.music_id
  )
  select c.id,
         m.id,
         m.title::text,
         m.artist::text,
         m.src::text,
         m.genre::text,
         m.style::text,
         m.style_tags,
         m.tempo_bpm,
         m.rhythm_profile::text
    from claimed c
    join public.musics m on m.id = c.music_id;
end;
$$;
