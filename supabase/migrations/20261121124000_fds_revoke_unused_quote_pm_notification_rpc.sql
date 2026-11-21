-- The current quote portal has no manual notification caller. Automatic
-- notifications run through the worker's separate claim RPCs.
revoke execute on function public.request_quote_pm_notification(uuid, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
