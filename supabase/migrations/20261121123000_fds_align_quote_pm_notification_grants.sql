-- Production grants service_role execute by default. The worker uses the claim
-- RPCs, while customers use the manual request RPC through anon or authenticated.
revoke execute on function public.request_quote_pm_notification(uuid, text)
  from service_role;
