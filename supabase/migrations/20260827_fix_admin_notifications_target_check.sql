ALTER TABLE public.admin_notifications
  DROP CONSTRAINT IF EXISTS admin_notifications_target_check;

ALTER TABLE public.admin_notifications
  ADD CONSTRAINT admin_notifications_target_check
  CHECK (target IN ('all', 'users'));
