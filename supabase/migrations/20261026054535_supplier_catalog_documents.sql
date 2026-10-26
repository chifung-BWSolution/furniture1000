create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Catalog PDFs stay on the existing supplier_documents row.
-- A new upload never replaces an older file. Parsing is a separate job
-- and is not started by the insert.

alter table public.supplier_documents
  add column if not exists document_year integer,
  add column if not exists series text,
  add column if not exists product_categories text[] not null default '{}',
  add column if not exists version_label text,
  add column if not exists description text,
  add column if not exists processing_status text not null default 'pending';

alter table public.supplier_documents
  drop constraint if exists supplier_documents_processing_status_chk;

alter table public.supplier_documents
  add constraint supplier_documents_processing_status_chk
  check (processing_status in (
    'pending',
    'processing',
    'completed',
    'failed',
    'review_required',
    'not_applicable'
  ));

alter table public.supplier_documents
  drop constraint if exists supplier_documents_catalog_meta_chk;

alter table public.supplier_documents
  add constraint supplier_documents_catalog_meta_chk
  check (
    doc_type <> 'catalog'
    or (
      document_year between 1990 and 2100
      and length(btrim(coalesce(series, ''))) > 0
      and cardinality(product_categories) > 0
    )
  );

create unique index if not exists supplier_documents_catalog_hash_uidx
  on public.supplier_documents (factory_id, doc_type, content_hash)
  where doc_type = 'catalog'
    and content_hash is not null
    and parent_document_id is null;

create index if not exists supplier_documents_catalog_factory_idx
  on public.supplier_documents (factory_id, document_year desc)
  where doc_type = 'catalog' and parent_document_id is null;

create table if not exists public.supplier_document_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.supplier_documents (id) on delete cascade,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint supplier_document_jobs_status_chk
    check (status in ('pending', 'processing', 'completed', 'failed', 'review_required'))
);

create unique index if not exists supplier_document_jobs_one_open
  on public.supplier_document_jobs (document_id)
  where status in ('pending', 'processing');

create index if not exists supplier_document_jobs_pending_idx
  on public.supplier_document_jobs (created_at)
  where status = 'pending';

alter table public.supplier_document_jobs enable row level security;

-- Force catalog uploads to stay pending. The night worker is the only
-- path that may later move them to processing.
create or replace function public.force_supplier_catalog_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.doc_type = 'catalog' and new.parent_document_id is null then
    new.processing_status := 'pending';
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_supplier_catalog_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.doc_type = 'catalog' and new.parent_document_id is null then
    insert into public.supplier_document_jobs (document_id, status)
    values (new.id, 'pending');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_supplier_catalog_pending on public.supplier_documents;
create trigger trg_supplier_catalog_pending
  before insert on public.supplier_documents
  for each row
  execute function public.force_supplier_catalog_pending();

drop trigger if exists trg_supplier_catalog_enqueue on public.supplier_documents;
create trigger trg_supplier_catalog_enqueue
  after insert on public.supplier_documents
  for each row
  execute function public.enqueue_supplier_catalog_job();

revoke all on function public.force_supplier_catalog_pending() from public, anon, authenticated;
revoke all on function public.enqueue_supplier_catalog_job() from public, anon, authenticated;

grant select, insert on public.supplier_documents to authenticated;
grant select on public.supplier_document_jobs to authenticated;
revoke all on public.supplier_documents from anon;
revoke all on public.supplier_document_jobs from anon;

drop policy if exists supplier_documents_select_staff on public.supplier_documents;
create policy supplier_documents_select_staff
  on public.supplier_documents
  for select
  to authenticated
  using (
    public.bwf_has_role(array['admin', 'uploader', 'designer', 'pm'])
  );

drop policy if exists supplier_documents_insert_catalog on public.supplier_documents;
create policy supplier_documents_insert_catalog
  on public.supplier_documents
  for insert
  to authenticated
  with check (
    public.bwf_has_role(array['admin', 'uploader'])
    and doc_type = 'catalog'
    and parent_document_id is null
    and processing_status = 'pending'
  );

drop policy if exists supplier_document_jobs_select_staff on public.supplier_document_jobs;
create policy supplier_document_jobs_select_staff
  on public.supplier_document_jobs
  for select
  to authenticated
  using (
    public.bwf_has_role(array['admin', 'uploader', 'designer', 'pm'])
  );

-- Designers and PMs can download catalog files. Upload stays admin/uploader
-- via the existing supplier_documents_objects_insert policy.
drop policy if exists supplier_documents_objects_select_staff on storage.objects;
create policy supplier_documents_objects_select_staff
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'supplier-documents'
    and public.bwf_has_role(array['admin', 'uploader', 'designer', 'pm'])
  );

-- Hourly tick. The function itself refuses to parse outside 23:00–09:00 Asia/Shanghai.
do $$
begin
  perform cron.unschedule('supplier-catalog-parse-hourly');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'supplier-catalog-parse-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://riaubhtruisbwdlwjzur.supabase.co/functions/v1/supabase-functions-process-supplier-catalogs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'service_role_key'
        limit 1
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

notify pgrst, 'reload schema';
