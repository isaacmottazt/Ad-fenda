CREATE OR REPLACE FUNCTION public.delete_admin_notification(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
declare
  v_deleted integer;
begin
  if auth.uid() is null or not public.is_fenda_admin() then
    raise exception 'Apenas administradores podem excluir comunicados';
  end if;

  if p_notification_id is null then
    raise exception 'O ID do comunicado é obrigatório';
  end if;

  delete from public.admin_notifications
  where id = p_notification_id;

  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$function$;

REVOKE ALL ON FUNCTION public.delete_admin_notification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_admin_notification(uuid) TO authenticated;
