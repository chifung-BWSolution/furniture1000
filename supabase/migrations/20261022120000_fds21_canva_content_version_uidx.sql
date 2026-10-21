-- One content_version per Canva version chain.
-- Concurrent save_draft used max(content_version)+1 and could insert the same pair.
-- NULL root_id (the row just inserted, before root_id is set to its own id) stays distinct.

do $$
declare
  dup record;
  next_version int;
begin
  for dup in
    select id, root_id
    from (
      select
        id,
        root_id,
        row_number() over (
          partition by root_id, content_version
          order by created_at, id
        ) as n
      from public.canva_design_sessions
      where root_id is not null
    ) numbered
    where n > 1
    order by root_id, id
  loop
    select coalesce(max(content_version), 0) + 1
      into next_version
    from public.canva_design_sessions
    where root_id = dup.root_id;

    update public.canva_design_sessions
    set content_version = next_version
    where id = dup.id;
  end loop;
end $$;

create unique index if not exists canva_design_sessions_root_version_uidx
  on public.canva_design_sessions (root_id, content_version);

comment on index public.canva_design_sessions_root_version_uidx is
  'One content_version per root_id. NULL root_id rows are not duplicates of each other.';
