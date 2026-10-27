-- Refresh normalized image metadata through the existing worker-only RPC.
-- Preserve image IDs, review links and idempotent page occurrence counts.

create or replace function public.fds_supplier_document_image_record(
  p_document_id uuid,
  p_content_hash text,
  p_pages int[],
  p_page_no int,
  p_storage_path text,
  p_public_url text,
  p_width int default null,
  p_height int default null,
  p_byte_size int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.supplier_document_images%rowtype;
  v_pages int[];
begin
  select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
    into v_pages
  from unnest(coalesce(p_pages, '{}'::int[])) as t(v)
  where t.v is not null;

  if cardinality(v_pages) = 0 then
    raise exception 'pages_required' using errcode = '22023';
  end if;

  insert into public.supplier_document_images as sdi (
    document_id, page_no, storage_path, public_url, width, height, byte_size,
    content_hash, page_occurrences, seen_pages, image_type
  )
  values (
    p_document_id, p_page_no, p_storage_path, p_public_url, p_width, p_height, p_byte_size,
    p_content_hash, cardinality(v_pages), v_pages,
    case when cardinality(v_pages) >= 3 then 'logo' else 'other' end
  )
  on conflict (document_id, content_hash) do update
    set storage_path = excluded.storage_path,
        public_url = excluded.public_url,
        byte_size = coalesce(excluded.byte_size, sdi.byte_size),
        width = coalesce(excluded.width, sdi.width),
        height = coalesce(excluded.height, sdi.height),
        seen_pages = (
          select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
          from unnest(coalesce(sdi.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
        ),
        page_occurrences = cardinality((
          select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
          from unnest(coalesce(sdi.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
        )),
        image_type = case
          when cardinality((
            select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
            from unnest(coalesce(sdi.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
          )) >= 3 then 'logo'
          else sdi.image_type
        end
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'content_hash', v_row.content_hash,
    'page_no', v_row.page_no,
    'page_occurrences', v_row.page_occurrences,
    'image_type', v_row.image_type
  );
end;
$$;

revoke all on function public.fds_supplier_document_image_record(uuid, text, int[], int, text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.fds_supplier_document_image_record(uuid, text, int[], int, text, text, int, int, int) to service_role;


notify pgrst, 'reload schema';
