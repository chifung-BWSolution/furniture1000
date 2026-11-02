create or replace function public.fds_skp_device_pairings_list()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'pm', 'designer']);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'code', substr(p.public_code,1,4) || '-' || substr(p.public_code,5,4),
    'computer_name', p.computer_name, 'environment', p.environment,
    'status', p.status, 'created_at', p.created_at, 'expires_at', p.expires_at,
    'can_authorize', true
  ) order by p.created_at desc)
  from public.fds_skp_device_pairings p
  where p.status = 'pending' and p.expires_at > now()), '[]'::jsonb);
end;
$$;
revoke all on function public.fds_skp_device_pairings_list() from public, anon;
grant execute on function public.fds_skp_device_pairings_list() to authenticated;
