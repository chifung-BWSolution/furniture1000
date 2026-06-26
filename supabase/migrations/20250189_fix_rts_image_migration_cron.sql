-- Make ready_to_shopify image migration deterministic and hourly.
--
-- The old edge function scanned only the first 200 ready_to_shopify rows and
-- filtered base64 in JavaScript. If base64 rows were later in the table, the
-- cron job reported done while data still needed conversion. These RPCs let the
-- edge function fetch exactly the rows that still contain base64.

create or replace function public.get_rts_image_migration_batch(p_limit integer default 10)
returns table(product_id text, image_url text, images jsonb)
language sql
stable
as $$
  select r.product_id, r.image_url, r.images
  from public.ready_to_shopify r
  where
    (r.image_url like 'data:%')
    or (r.image_url is not null and r.image_url not like 'http%' and length(r.image_url) > 100)
    or (r.images::text like '%data:image%')
  order by r.product_id
  limit greatest(1, least(coalesce(p_limit, 10), 10));
$$;

create or replace function public.get_rts_image_migration_count()
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.ready_to_shopify r
  where
    (r.image_url like 'data:%')
    or (r.image_url is not null and r.image_url not like 'http%' and length(r.image_url) > 100)
    or (r.images::text like '%data:image%');
$$;

grant execute on function public.get_rts_image_migration_batch(integer) to anon, authenticated, service_role;
grant execute on function public.get_rts_image_migration_count() to anon, authenticated, service_role;

do $$
declare
  existing_command text;
begin
  select command
    into existing_command
  from cron.job
  where jobname in ('migrate-rts-images-hourly', 'migrate-rts-images-every-10min')
     or command like '%migrate-rts-images%'
  order by case when jobname = 'migrate-rts-images-hourly' then 0 else 1 end, jobid
  limit 1;

  if existing_command is null then
    raise notice 'migrate-rts-images cron command not found; create it manually with project anon key';
    return;
  end if;

  perform cron.unschedule(jobname)
  from cron.job
  where jobname in ('migrate-rts-images-hourly', 'migrate-rts-images-every-10min');

  perform cron.schedule(
    'migrate-rts-images-hourly',
    '0 * * * *',
    existing_command
  );
end $$;
