-- Update installations that already recorded the short-code migration.
-- Existing share links keep their assigned codes.

create or replace function public.bwf_gen_share_short_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- A short code grants the same access as the full share token.
  select translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/=', '-_');
$$;
