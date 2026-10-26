-- Aggregate signals for 廠家目錄: this year's quote usage, catalog upload year,
-- and quote-PDF upload year. Invoked by the fetch-manufacturer-directory edge
-- function with the service role. Not exposed to anon or authenticated clients.

CREATE OR REPLACE FUNCTION public.manufacturer_directory_signals(p_year integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'quote_names', COALESCE((
      SELECT jsonb_agg(DISTINCT btrim(i.factory_name))
      FROM public.bwf_quote_item i
      JOIN public.bwf_quote q ON q.id = i.quote_uuid
      WHERE p_year IS NOT NULL
        AND EXTRACT(YEAR FROM timezone('Asia/Shanghai', q.created_at)) = p_year
        AND COALESCE(q.status, '') NOT IN ('回收桶', 'deleted', '廢棄')
        AND COALESCE(i.is_section_title, false) = false
        AND btrim(COALESCE(i.factory_name, '')) <> ''
    ), '[]'::jsonb),
    'catalogs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'factory_code', NULLIF(btrim(p.factory_id), ''),
        'factory_name', NULLIF(btrim(p.factories_display_name), ''),
        'year', p.yr
      ))
      FROM (
        SELECT
          factory_id,
          factories_display_name,
          EXTRACT(YEAR FROM timezone(
            'Asia/Shanghai',
            MAX(COALESCE(created_date, created_at))
          ))::int AS yr
        FROM public.products
        WHERE NULLIF(btrim(COALESCE(factory_id, '')), '') IS NOT NULL
           OR NULLIF(btrim(COALESCE(factories_display_name, '')), '') IS NOT NULL
        GROUP BY factory_id, factories_display_name
      ) p
    ), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'factory_id', NULLIF(btrim(d.factory_id), ''),
        'factory_name', NULLIF(btrim(d.factory_name), ''),
        'doc_type', d.doc_type,
        'year', d.yr
      ))
      FROM (
        SELECT
          factory_id,
          factory_name,
          doc_type,
          EXTRACT(YEAR FROM timezone(
            'Asia/Shanghai',
            MAX(COALESCE(created_at, created_date))
          ))::int AS yr
        FROM public.supplier_documents
        WHERE doc_type IN ('catalog', 'quote', 'price_list')
        GROUP BY factory_id, factory_name, doc_type
      ) d
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.manufacturer_directory_signals(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manufacturer_directory_signals(integer) FROM anon;
REVOKE ALL ON FUNCTION public.manufacturer_directory_signals(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.manufacturer_directory_signals(integer) TO service_role;

COMMENT ON FUNCTION public.manufacturer_directory_signals(integer) IS
  '廠家目錄 signals: quote factory names for p_year (Asia/Shanghai), catalog upload years from products, quote/catalog PDF years from supplier_documents.';
