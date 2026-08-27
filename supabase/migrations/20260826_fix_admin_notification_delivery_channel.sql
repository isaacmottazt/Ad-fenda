CREATE OR REPLACE FUNCTION public.create_admin_notification(
  p_title text,
  p_body text DEFAULT ''::text,
  p_deep_link text DEFAULT NULL::text,
  p_image_url text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
declare
  v_id uuid;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_target text := 'all';
begin
  if auth.uid() is null or not public.is_fenda_admin() then
    raise exception 'Apenas administradores podem enviar comunicados';
  end if;

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'Título do comunicado é obrigatório';
  end if;

  if p_deep_link is not null
     and p_deep_link !~ '^(fenda://|/|https://fenda-com\\.vercel\\.app/)'
  then
    raise exception 'Deep link não permitido';
  end if;

  if p_image_url is not null and p_image_url !~ '^https://'
  then
    raise exception 'A imagem do comunicado precisa usar HTTPS';
  end if;

  if jsonb_typeof(v_metadata->'recipient_ids') = 'array'
     and jsonb_array_length(v_metadata->'recipient_ids') > 0
  then
    v_target := 'users';
  end if;

  insert into public.admin_notifications (
    created_by, title, body, deep_link, image_url, target, metadata
  ) values (
    auth.uid(), trim(p_title), coalesce(p_body, ''), p_deep_link, p_image_url,
    v_target, v_metadata
  ) returning id into v_id;

  return v_id;
end;
$function$;

DROP FUNCTION IF EXISTS public.list_fenda_in_app_announcements();

CREATE OR REPLACE FUNCTION public.list_fenda_in_app_announcements()
RETURNS TABLE(
  id uuid,
  title text,
  body text,
  image_url text,
  deep_link text,
  created_at timestamp with time zone,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  select n.id, n.title, n.body, n.image_url, n.deep_link, n.created_at, n.metadata
  from public.admin_notifications n
  where auth.uid() is not null
    and n.status = 'sent'
    and (
      n.target = 'all'
      or (
        n.target = 'users'
        and coalesce(n.metadata->'recipient_ids', '[]'::jsonb) ? (auth.uid())::text
      )
    )
  order by n.created_at desc
  limit 50;
$function$;

REVOKE ALL ON FUNCTION public.create_admin_notification(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_admin_notification(text, text, text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.list_fenda_in_app_announcements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_fenda_in_app_announcements() TO authenticated;
