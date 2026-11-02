-- A Worker that selected 建築學長 reports jzxz_v1 instead of codex_v1.
-- Claim and the generate-SKP preflight already call fds_skp_device_has_codex;
-- that check now accepts either engine, and the job payload stays mode=codex_v1.

create or replace function public.fds_skp_device_has_codex(p_checks jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (
      coalesce(p_checks -> 'capabilities', '[]'::jsonb) ? 'codex_v1'
      and coalesce(p_checks ->> 'codex_ready', '') = 'true'
    )
    or (
      coalesce(p_checks -> 'capabilities', '[]'::jsonb) ? 'jzxz_v1'
      and coalesce(p_checks ->> 'jzxz_ready', '') = 'true'
    );
$$;
