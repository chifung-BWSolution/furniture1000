-- Brief JSON already stores clientId (client_companies.id). This column mirrors it
-- for queries. Do not require an edge-function change: save_draft writes the whole brief.

alter table public.canva_design_sessions
  add column if not exists client_id uuid;

alter table public.canva_design_sessions
  drop constraint if exists canva_design_sessions_client_id_fkey;

alter table public.canva_design_sessions
  add constraint canva_design_sessions_client_id_fkey
  foreign key (client_id) references public.client_companies (id) on delete set null;

create index if not exists canva_design_sessions_client_id_idx
  on public.canva_design_sessions (client_id);

create or replace function public.fds_canva_session_sync_client_id()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_raw text;
begin
  v_raw := nullif(btrim(new.brief->>'clientId'), '');
  if v_raw is null or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    new.client_id := null;
    return new;
  end if;

  select c.id into new.client_id
  from public.client_companies c
  where c.id = v_raw::uuid;

  return new;
end;
$$;

drop trigger if exists trg_canva_session_sync_client_id on public.canva_design_sessions;
create trigger trg_canva_session_sync_client_id
  before insert or update of brief on public.canva_design_sessions
  for each row execute function public.fds_canva_session_sync_client_id();

update public.canva_design_sessions
set brief = brief
where brief ? 'clientId';

comment on column public.canva_design_sessions.client_id is
  'Mirrors brief.clientId when that value is a client_companies.id. Wizard may still store a free-text client with no id.';

revoke all on function public.fds_canva_session_sync_client_id() from public, anon, authenticated;
