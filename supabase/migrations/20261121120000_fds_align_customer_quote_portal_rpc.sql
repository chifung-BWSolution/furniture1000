-- Reapply the customer-facing quote projection from 20261106120000.
-- Keep the existing RPC signature and grants.

create or replace function public.bwf_customer_quote_json(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.bwf_quote%rowtype;
  pd jsonb;
  form jsonb;
  info jsonb;
  scheme jsonb;
  confirm jsonb;
begin
  select *
    into q
  from public.bwf_quote
  where id = p_quote_id;

  if not found or q.status = '回收桶' then
    return null;
  end if;

  pd := case when jsonb_typeof(q.project_data) = 'object' then q.project_data else '{}'::jsonb end;
  form := case when jsonb_typeof(pd->'formData') = 'object' then pd->'formData' else '{}'::jsonb end;
  info := case when jsonb_typeof(pd->'clientInfo') = 'object' then pd->'clientInfo' else '{}'::jsonb end;
  scheme := case when jsonb_typeof(pd->'clientQuoteScheme') = 'object' then pd->'clientQuoteScheme' else '{}'::jsonb end;
  confirm := case when jsonb_typeof(pd->'customerConfirmation') = 'object' then pd->'customerConfirmation' else '{}'::jsonb end;

  return jsonb_build_object(
    'id', q.id,
    'quote_id', q.quote_id,
    'version', q.version,
    'status', q.status,
    'total_amount', q.total_amount,
    'created_at', q.created_at,
    'modified_date', q.modified_date,
    'project_data', jsonb_strip_nulls(jsonb_build_object(
      'formData', jsonb_strip_nulls(jsonb_build_object(
        'clientName', left(form->>'clientName', 200),
        'clientContactName', left(form->>'clientContactName', 200),
        'clientPhone', left(form->>'clientPhone', 80),
        'clientEmail', left(form->>'clientEmail', 200),
        'clientIndustry', case
          when jsonb_typeof(form->'clientIndustry') = 'array' then form->'clientIndustry'
          else '[]'::jsonb
        end
      )),
      'clientInfo', jsonb_strip_nulls(jsonb_build_object(
        'name', left(info->>'name', 200),
        'contactName', left(info->>'contactName', 200),
        'phone', left(info->>'phone', 80),
        'email', left(info->>'email', 200)
      )),
      'deliveryDetails', left(pd->>'deliveryDetails', 8000),
      'deliveryDetailsEn', left(pd->>'deliveryDetailsEn', 8000),
      'termsContent', public.bwf_customer_terms(coalesce(pd->'termsContent', q.terms_content)),
      'termsContentEn', public.bwf_customer_terms(pd->'termsContentEn'),
      'designProjectId', left(pd->>'designProjectId', 80),
      'customerConfirmation', jsonb_strip_nulls(jsonb_build_object(
        'status', left(confirm->>'status', 20),
        'version', left(confirm->>'version', 40),
        'quoteId', left(confirm->>'quoteId', 120),
        'confirmedAt', left(confirm->>'confirmedAt', 40),
        'note', left(confirm->>'note', 1000)
      )),
      'clientQuoteScheme', jsonb_build_object(
        'savedAt', scheme->>'savedAt',
        'selections', case
          when jsonb_typeof(scheme->'selections') = 'object' then scheme->'selections'
          else '{}'::jsonb
        end,
        'quantities', case
          when jsonb_typeof(scheme->'quantities') = 'object' then scheme->'quantities'
          else '{}'::jsonb
        end
      )
    )),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', coalesce(it.client_item_id, it.id::text),
        'name', it.name,
        'spec', it.remarks,
        'remarks', it.remarks,
        'image', it.image,
        'reference_image', it.reference_image,
        'remarks_image', it.remarks_image,
        'quantity', it.quantity,
        'unit', it.unit,
        'unit_price', it.unit_price,
        'category', it.category,
        'material', it.material,
        'color', it.color,
        'dimension_l_mm', it.dimension_l_mm,
        'dimension_w_mm', it.dimension_w_mm,
        'dimension_h_mm', it.dimension_h_mm,
        'delivery_term_name', it.delivery_term_name,
        'is_custom_term', it.is_custom_term,
        'is_optional', it.is_optional,
        'hide_in_pdf', it.hide_in_pdf,
        'is_section_title', it.is_section_title,
        'sort_order', it.sort_order,
        'quote_uuid', it.quote_uuid,
        'product_id', it.product_id
      ) order by it.sort_order, it.created_at)
      from public.bwf_quote_item it
      where it.quote_uuid = q.id
    ), '[]'::jsonb)
  );
end;
$$;
