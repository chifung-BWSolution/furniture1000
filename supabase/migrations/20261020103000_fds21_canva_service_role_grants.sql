-- Branch FDS2.0 created canva_* without SELECT/INSERT/UPDATE/DELETE for
-- service_role (only REFERENCES/TRIGGER/TRUNCATE). Edge status then reads
-- as "not connected", and the OAuth upsert cannot store the token.
-- RLS stays on with no policies, so anon/authenticated still cannot read tokens.

grant all on table public.canva_connections to service_role;
grant all on table public.canva_imports to service_role;
grant select on table public.canva_imports to authenticated;
