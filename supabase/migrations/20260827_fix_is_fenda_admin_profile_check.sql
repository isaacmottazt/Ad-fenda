CREATE OR REPLACE FUNCTION public.is_fenda_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  select coalesce(
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'fenda_role') = 'admin'
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.is_fenda_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_fenda_admin() TO authenticated;
