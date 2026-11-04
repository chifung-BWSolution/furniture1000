-- Only develop is provisioned with this dedicated Vault credential.
-- Other environments record the migration without creating a queue, trigger or cron.
do $environment_guard$
begin
  if exists(select 1 from vault.secrets where name='fds_model_sync_cron_key') then
    execute $develop_ddl$
-- Install ONLY on FDS develop (omxizeukbcqzsnjsuwod). Production has no reverse queue.
create table public.fds_model_sync_queue (
  model_id uuid primary key references public.product_models(id) on delete cascade,
  revision bigint not null default 1,
  synced_revision bigint not null default 0,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  synced_at timestamptz
);
alter table public.fds_model_sync_queue enable row level security;
revoke all on public.fds_model_sync_queue from public,anon,authenticated;
grant all on public.fds_model_sync_queue to service_role;
create function public.fds_enqueue_model_sync() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.product_id is not null then
    insert into public.fds_model_sync_queue(model_id) values(new.id)
    on conflict(model_id) do update set revision=fds_model_sync_queue.revision+1,available_at=now(),last_error=null;
  end if;
  return new;
end $$;
create trigger fds_model_sync_after_write after insert or update on public.product_models
for each row when (new.product_id is not null) execute function public.fds_enqueue_model_sync();
create function public.fds_claim_model_sync() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.fds_model_sync_queue; m public.product_models; paths jsonb;
begin
  select * into v from public.fds_model_sync_queue
  where revision>synced_revision and available_at<=now() and (locked_until is null or locked_until<now())
  order by available_at,model_id for update skip locked limit 1;
  if v.model_id is null then return null; end if;
  update public.fds_model_sync_queue set locked_until=now()+interval '10 minutes',attempts=attempts+1 where model_id=v.model_id;
  select * into m from public.product_models where id=v.model_id;
  select coalesce(jsonb_agg(name),'[]'::jsonb) into paths from storage.objects
  where bucket_id='product-models' and (name in (m.storage_path,m.preview_storage_path,m.bundle_storage_path)
    or (m.format='fbx' and starts_with(name,regexp_replace(m.storage_path,'[^/]+$',''))));
  return jsonb_build_object('revision',v.revision,'model',to_jsonb(m),'paths',paths);
end $$;
create function public.fds_finish_model_sync(p_id uuid,p_revision bigint,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.fds_model_sync_queue set
    synced_revision=case when p_error is null then greatest(synced_revision,p_revision) else synced_revision end,
    synced_at=case when p_error is null then now() else synced_at end,
    locked_until=null,last_error=left(p_error,500),
    available_at=case when p_error is null then now() else now()+interval '2 minutes' end
  where model_id=p_id;
end $$;
revoke all on function public.fds_enqueue_model_sync() from public,anon,authenticated;
revoke all on function public.fds_claim_model_sync() from public,anon,authenticated;
revoke all on function public.fds_finish_model_sync(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.fds_claim_model_sync() to service_role;
grant execute on function public.fds_finish_model_sync(uuid,bigint,text) to service_role;
-- Include already uploaded develop models; identical Production artifacts are retained without duplicates.
insert into public.fds_model_sync_queue(model_id) select id from public.product_models where product_id is not null;
select cron.schedule('fds-develop-model-sync','* * * * *',$cron$
 select net.http_post(
   url:='https://omxizeukbcqzsnjsuwod.supabase.co/functions/v1/supabase-functions-skp-worker-agent',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='fds_model_sync_cron_key' limit 1)),
   body:='{"action":"sync-models"}'::jsonb, timeout_milliseconds:=300000
 );
$cron$);

$develop_ddl$;
  end if;
end
$environment_guard$;
