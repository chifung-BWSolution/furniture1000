-- FDS Supplier RFQ（第一期乙 §7.8）RPC。
-- 角色、封標、修訂、冪等在 SQL 分支；前端不會先收到價格再隱藏。

-- ── 小工具 ───────────────────────────────────────────────────────────
create or replace function public.fds_rfq_try_numeric(p_text text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  return btrim(p_text)::numeric;
exception
  when others then
    raise exception 'invalid_items' using errcode = 'P0001';
end;
$$;

create or replace function public.fds_rfq_try_int(p_text text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  return round(btrim(p_text)::numeric)::integer;
exception
  when others then
    raise exception 'invalid_items' using errcode = 'P0001';
end;
$$;

-- 截止前仍可提交，即使所有行都已定標（新版本不會自動改判）。
create or replace function public.fds_rfq_accepts_submission(
  p_status text,
  p_close_at timestamptz
) returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('open', 'review', 'awarded', 'not_awarded')
    and p_close_at is not null
    and p_close_at > now();
$$;

create or replace function public.fds_rfq_event(  p_rfq_id uuid,
  p_item_id uuid,
  p_invitation_id uuid,
  p_type text,
  p_actor_kind text,
  p_detail jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fds_rfq_events (
    rfq_id, rfq_item_id, invitation_id, event_type, actor_kind,
    actor_email, actor_user_id, detail
  ) values (
    p_rfq_id, p_item_id, p_invitation_id, p_type, p_actor_kind,
    coalesce(auth.jwt() ->> 'email', ''), auth.uid(), coalesce(p_detail, '{}'::jsonb)
  );
$$;

-- 發布／修訂時整批換行。舊行保留，供舊回價與舊定標追溯。
create or replace function public.fds_rfq_insert_items(
  p_rfq_id uuid,
  p_revision integer,
  p_items jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_idx integer := 0;
  v_qty numeric;
  v_product_id text;
  v_source_quote uuid;
  v_source_item uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_line) <> 'object'
      or btrim(coalesce(v_line ->> 'name', '')) = '' then
      raise exception 'invalid_items' using errcode = 'P0001';
    end if;

    v_qty := public.fds_rfq_try_numeric(v_line ->> 'quantity');
    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_items' using errcode = 'P0001';
    end if;

    v_product_id := nullif(btrim(coalesce(v_line ->> 'product_id', '')), '');
    if v_product_id is not null
      and not exists (select 1 from public.products p where p.id = v_product_id) then
      raise exception 'invalid_items' using errcode = 'P0001';
    end if;

    begin
      v_source_quote := nullif(btrim(coalesce(v_line ->> 'source_quote_id', '')), '')::uuid;
      v_source_item := nullif(btrim(coalesce(v_line ->> 'source_quote_item_id', '')), '')::uuid;
    exception
      when others then
        raise exception 'invalid_items' using errcode = 'P0001';
    end;

    insert into public.fds_rfq_items (
      rfq_id, revision, sort_order, name, model, quantity, unit,
      specifications, dimensions, image_url, product_id,
      source_quote_id, source_quote_item_id
    ) values (
      p_rfq_id, p_revision, v_idx,
      btrim(v_line ->> 'name'),
      nullif(btrim(coalesce(v_line ->> 'model', '')), ''),
      v_qty,
      nullif(btrim(coalesce(v_line ->> 'unit', '')), ''),
      nullif(btrim(coalesce(v_line ->> 'specifications', '')), ''),
      nullif(btrim(coalesce(v_line ->> 'dimensions', '')), ''),
      nullif(btrim(coalesce(v_line ->> 'image_url', '')), ''),
      v_product_id,
      v_source_quote,
      v_source_item
    );
  end loop;
end;
$$;

create or replace function public.fds_rfq_insert_invitations(
  p_rfq_id uuid,
  p_revision integer,
  p_invitations jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_factory_id text;
  v_seen text[] := array[]::text[];
begin
  if p_invitations is null or jsonb_typeof(p_invitations) <> 'array' then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  for v_line in select value from jsonb_array_elements(p_invitations) loop
    v_factory_id := btrim(coalesce(v_line ->> 'factory_id', ''));
    if v_factory_id = '' then
      raise exception 'invitation_required' using errcode = 'P0001';
    end if;
    if v_factory_id = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_factory_id);

    insert into public.fds_rfq_invitations (
      rfq_id, revision, factory_id, factory_name, contact_email
    ) values (
      p_rfq_id,
      p_revision,
      v_factory_id,
      btrim(coalesce(v_line ->> 'factory_name', '')),
      nullif(lower(btrim(coalesce(v_line ->> 'contact_email', ''))), '')
    )
    on conflict (rfq_id, revision, factory_id) do update
      set factory_name = excluded.factory_name,
          contact_email = excluded.contact_email,
          updated_at = now();
  end loop;
end;
$$;

-- 全部行都已結束（定標或不定標）時才改表頭。
create or replace function public.fds_rfq_refresh_header(p_rfq_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision integer;
  v_total integer;
  v_open integer;
  v_awarded integer;
begin
  select revision into v_revision from public.fds_rfqs where id = p_rfq_id;
  select
    count(*),
    count(*) filter (where resolution = 'open'),
    count(*) filter (where resolution = 'awarded')
  into v_total, v_open, v_awarded
  from public.fds_rfq_items
  where rfq_id = p_rfq_id and revision = v_revision;

  if v_total > 0 and v_open = 0 then
    update public.fds_rfqs
    set status = case when v_awarded > 0 then 'awarded' else 'not_awarded' end,
        updated_at = now()
    where id = p_rfq_id
      and status not in ('cancelled', 'draft');
  end if;
end;
$$;

-- ── 列表 ─────────────────────────────────────────────────────────────
create or replace function public.fds_rfq_list(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select
        r.id,
        r.rfq_no,
        r.title,
        r.currency,
        r.status as stored_status,
        public.fds_rfq_effective_status(r.status, r.close_at) as status,
        r.revision,
        r.close_at,
        r.sealed_bid,
        r.revealed_at,
        r.published_at,
        r.created_at,
        r.updated_at,
        r.created_by_email,
        (select count(*) from public.fds_rfq_items i
          where i.rfq_id = r.id and i.revision = r.revision) as item_count,
        (select count(*) from public.fds_rfq_invitations v
          where v.rfq_id = r.id and v.revision = r.revision) as invitation_count,
        (select count(distinct s.invitation_id) from public.fds_rfq_submissions s
          where s.rfq_id = r.id and s.revision = r.revision and s.status = 'submitted') as submitted_factory_count,
        (select count(*) from public.fds_rfq_items i
          where i.rfq_id = r.id and i.revision = r.revision and i.resolution <> 'open') as resolved_item_count
      from public.fds_rfqs r
      where v_status is null
        or public.fds_rfq_effective_status(r.status, r.close_at) = v_status
      order by r.created_at desc
      limit 300
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ── 建立／改草稿 ─────────────────────────────────────────────────────
create or replace function public.fds_rfq_save_draft(
  p_rfq_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_payload ->> 'title', ''));
  v_currency text := upper(btrim(coalesce(p_payload ->> 'currency', '')));
  v_close_at timestamptz;
  v_notes text := nullif(btrim(coalesce(p_payload ->> 'notes', '')), '');
  v_source_quote uuid;
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_invitations jsonb := coalesce(p_payload -> 'invitations', '[]'::jsonb);
  v_id uuid;
  v_revision integer;
  v_rfq_no text;
  v_year integer := extract(year from (now() at time zone 'Asia/Hong_Kong'))::integer;
  v_no integer;
  v_row public.fds_rfqs%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  if v_title = '' then
    raise exception 'title_required' using errcode = 'P0001';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_invitations) <> 'array' then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  begin
    v_close_at := nullif(btrim(coalesce(p_payload ->> 'close_at', '')), '')::timestamptz;
    v_source_quote := nullif(btrim(coalesce(p_payload ->> 'source_quote_id', '')), '')::uuid;
  exception
    when others then
      raise exception 'invalid_items' using errcode = 'P0001';
  end;

  if p_rfq_id is null then
    insert into public.fds_rfq_number_seq (year, last_no)
    values (v_year, 1)
    on conflict (year) do update
      set last_no = public.fds_rfq_number_seq.last_no + 1
    returning last_no into v_no;

    v_rfq_no := 'RFQ-' || v_year::text || '-' || lpad(v_no::text, 4, '0');

    insert into public.fds_rfqs (
      rfq_no, title, currency, close_at, notes, source_quote_id,
      created_by, created_by_email
    ) values (
      v_rfq_no, v_title, v_currency, v_close_at, v_notes, v_source_quote,
      auth.uid(), coalesce(auth.jwt() ->> 'email', '')
    )
    returning id, revision into v_id, v_revision;

    perform public.fds_rfq_event(v_id, null, null, 'draft_created', 'staff',
      jsonb_build_object('rfq_no', v_rfq_no));
  else
    select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
    if not found then
      raise exception 'rfq_not_found' using errcode = 'P0001';
    end if;
    if v_row.status <> 'draft' then
      raise exception 'rfq_not_draft' using errcode = 'P0001';
    end if;

    update public.fds_rfqs
    set title = v_title,
        currency = v_currency,
        close_at = v_close_at,
        notes = v_notes,
        source_quote_id = coalesce(v_source_quote, source_quote_id),
        updated_at = now()
    where id = p_rfq_id;

    delete from public.fds_rfq_items where rfq_id = p_rfq_id and revision = v_row.revision;
    delete from public.fds_rfq_invitations where rfq_id = p_rfq_id and revision = v_row.revision;

    v_id := p_rfq_id;
    v_revision := v_row.revision;
    v_rfq_no := v_row.rfq_no;
  end if;

  perform public.fds_rfq_insert_items(v_id, v_revision, v_items);
  perform public.fds_rfq_insert_invitations(v_id, v_revision, v_invitations);

  return jsonb_build_object(
    'id', v_id,
    'rfq_no', v_rfq_no,
    'revision', v_revision,
    'status', 'draft'
  );
end;
$$;

-- ── 發布 ─────────────────────────────────────────────────────────────
create or replace function public.fds_rfq_publish(p_rfq_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_rfqs%rowtype;
  v_items integer;
  v_invitations integer;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'rfq_not_draft' using errcode = 'P0001';
  end if;
  if v_row.close_at is null or v_row.close_at <= now() then
    raise exception 'close_required' using errcode = 'P0001';
  end if;

  select count(*) into v_items
  from public.fds_rfq_items
  where rfq_id = p_rfq_id and revision = v_row.revision;
  if v_items = 0 then
    raise exception 'items_required' using errcode = 'P0001';
  end if;

  select count(*) into v_invitations
  from public.fds_rfq_invitations
  where rfq_id = p_rfq_id and revision = v_row.revision;
  if v_invitations = 0 then
    raise exception 'invitation_required' using errcode = 'P0001';
  end if;

  -- 草稿行與受邀廠搬到 revision 1；同一批 id 沿用，不影響任何回價。
  update public.fds_rfq_items
  set revision = 1, updated_at = now()
  where rfq_id = p_rfq_id and revision = v_row.revision;

  insert into public.fds_rfq_invitations (
    rfq_id, revision, factory_id, factory_name, contact_email, status
  )
  select rfq_id, 1, factory_id, factory_name, contact_email, 'invited'
  from public.fds_rfq_invitations
  where rfq_id = p_rfq_id and revision = v_row.revision
  on conflict (rfq_id, revision, factory_id) do nothing;

  update public.fds_rfqs
  set status = 'open',
      revision = 1,
      published_at = now(),
      updated_at = now()
  where id = p_rfq_id;

  perform public.fds_rfq_event(p_rfq_id, null, null, 'published', 'staff',
    jsonb_build_object('revision', 1, 'item_count', v_items, 'invitation_count', v_invitations));

  return jsonb_build_object('id', p_rfq_id, 'revision', 1, 'status', 'open');
end;
$$;

-- ── 修訂 ─────────────────────────────────────────────────────────────
create or replace function public.fds_rfq_revise(
  p_rfq_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_rfqs%rowtype;
  v_new_revision integer;
  v_title text;
  v_notes text;
  v_close_at timestamptz;
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_currency text := upper(btrim(coalesce(p_payload ->> 'currency', '')));
  v_item_count integer;
  v_invitation_count integer;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_row.status not in ('open', 'review') then
    raise exception 'rfq_not_draft' using errcode = 'P0001';
  end if;
  if v_currency <> '' and v_currency <> v_row.currency then
    raise exception 'currency_locked' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.fds_rfq_awards
    where rfq_id = p_rfq_id and status = 'active'
  ) then
    raise exception 'award_exists' using errcode = 'P0001';
  end if;

  begin
    v_close_at := nullif(btrim(coalesce(p_payload ->> 'close_at', '')), '')::timestamptz;
  exception
    when others then
      raise exception 'invalid_items' using errcode = 'P0001';
  end;
  if v_close_at is null or v_close_at <= now() then
    raise exception 'close_required' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;
  select jsonb_array_length(v_items) into v_item_count;
  if v_item_count = 0 then
    raise exception 'items_required' using errcode = 'P0001';
  end if;

  v_new_revision := v_row.revision + 1;
  v_title := coalesce(nullif(btrim(coalesce(p_payload ->> 'title', '')), ''), v_row.title);
  v_notes := case
    when p_payload ? 'notes' then nullif(btrim(coalesce(p_payload ->> 'notes', '')), '')
    else v_row.notes
  end;

  perform public.fds_rfq_insert_items(p_rfq_id, v_new_revision, v_items);

  insert into public.fds_rfq_invitations (
    rfq_id, revision, factory_id, factory_name, contact_email, status
  )
  select rfq_id, v_new_revision, factory_id, factory_name, contact_email, 'invited'
  from public.fds_rfq_invitations
  where rfq_id = p_rfq_id and revision = v_row.revision
  on conflict (rfq_id, revision, factory_id) do nothing;

  select count(*) into v_invitation_count
  from public.fds_rfq_invitations
  where rfq_id = p_rfq_id and revision = v_new_revision;

  -- 舊連結一律作廢；職員要為新修訂重新複製連結。
  update public.fds_rfq_invitation_tokens t
  set revoked_at = now()
  where t.revoked_at is null
    and t.invitation_id in (
      select id from public.fds_rfq_invitations where rfq_id = p_rfq_id
    );

  update public.fds_rfqs
  set revision = v_new_revision,
      title = v_title,
      notes = v_notes,
      close_at = v_close_at,
      status = 'open',
      updated_at = now()
  where id = p_rfq_id;

  perform public.fds_rfq_event(p_rfq_id, null, null, 'revised', 'staff',
    jsonb_build_object('revision', v_new_revision, 'item_count', v_item_count, 'invitation_count', v_invitation_count));

  return jsonb_build_object(
    'id', p_rfq_id,
    'revision', v_new_revision,
    'status', 'open',
    'invitation_count', v_invitation_count
  );
end;
$$;

-- ── 加一家受邀廠（不升修訂） ─────────────────────────────────────────
create or replace function public.fds_rfq_invite_factory(
  p_rfq_id uuid,
  p_factory_id text,
  p_factory_name text,
  p_contact_email text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_rfqs%rowtype;
  v_effective text;
  v_id uuid;
  v_factory text := btrim(coalesce(p_factory_id, ''));
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  if v_factory = '' then
    raise exception 'invitation_required' using errcode = 'P0001';
  end if;

  select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_row.status = 'draft' then
    raise exception 'rfq_not_draft' using errcode = 'P0001';
  end if;

  v_effective := public.fds_rfq_effective_status(v_row.status, v_row.close_at);
  if v_effective <> 'open' then
    raise exception 'deadline_passed' using errcode = 'P0001';
  end if;

  insert into public.fds_rfq_invitations (
    rfq_id, revision, factory_id, factory_name, contact_email
  ) values (
    p_rfq_id, v_row.revision, v_factory,
    btrim(coalesce(p_factory_name, '')),
    nullif(lower(btrim(coalesce(p_contact_email, ''))), '')
  )
  on conflict (rfq_id, revision, factory_id) do update
    set factory_name = excluded.factory_name,
        contact_email = excluded.contact_email,
        updated_at = now()
  returning id into v_id;

  perform public.fds_rfq_event(p_rfq_id, null, v_id, 'factory_invited', 'staff',
    jsonb_build_object('factory_id', v_factory, 'factory_name', p_factory_name));

  return jsonb_build_object('invitation_id', v_id, 'revision', v_row.revision);
end;
$$;

-- ── 產生邀請連結（明文只回一次） ─────────────────────────────────────
create or replace function public.fds_rfq_issue_link(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv record;
  v_token text;
  v_expires timestamptz;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  select i.id, i.rfq_id, i.revision, i.factory_id, i.factory_name,
         r.revision as rfq_revision, r.status as rfq_status, r.close_at
  into v_inv
  from public.fds_rfq_invitations i
  join public.fds_rfqs r on r.id = i.rfq_id
  where i.id = p_invitation_id;

  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_inv.rfq_status in ('draft', 'cancelled') then
    raise exception 'rfq_not_draft' using errcode = 'P0001';
  end if;
  if v_inv.revision <> v_inv.rfq_revision then
    raise exception 'revision_mismatch' using errcode = 'P0001';
  end if;

  -- 一個邀請同時只有一條有效連結。
  update public.fds_rfq_invitation_tokens
  set revoked_at = now()
  where invitation_id = p_invitation_id and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := greatest(coalesce(v_inv.close_at, now()), now()) + interval '30 days';

  insert into public.fds_rfq_invitation_tokens (
    invitation_id, token_hash, expires_at, created_by, created_by_email
  ) values (
    p_invitation_id,
    public.fds_rfq_hash_token(v_token),
    v_expires,
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', '')
  );

  perform public.fds_rfq_event(v_inv.rfq_id, null, p_invitation_id, 'link_issued', 'staff',
    jsonb_build_object('factory_id', v_inv.factory_id));

  return jsonb_build_object(
    'token', v_token,
    'expires_at', v_expires,
    'invitation_id', p_invitation_id,
    'factory_id', v_inv.factory_id,
    'factory_name', v_inv.factory_name
  );
end;
$$;

-- ── 內部詳情（未揭標剝單價） ─────────────────────────────────────────
create or replace function public.fds_rfq_detail(p_rfq_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rfq public.fds_rfqs%rowtype;
  v_effective text;
  v_revealed boolean;
  v_items jsonb;
  v_invitations jsonb;
  v_submissions jsonb;
  v_history jsonb;
  v_awards jsonb;
  v_events jsonb;
  v_catalog jsonb;
  v_counts jsonb;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  select * into v_rfq from public.fds_rfqs where id = p_rfq_id;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;

  v_effective := public.fds_rfq_effective_status(v_rfq.status, v_rfq.close_at);
  v_revealed := public.fds_rfq_is_revealed(v_rfq.sealed_bid, v_rfq.revealed_at, v_rfq.close_at);

  select coalesce(jsonb_agg(x.row_json order by x.sort_order), '[]'::jsonb)
  into v_items
  from (
    select
      i.sort_order,
      jsonb_build_object(
        'id', i.id,
        'sort_order', i.sort_order,
        'name', i.name,
        'model', i.model,
        'quantity', i.quantity,
        'unit', i.unit,
        'specifications', i.specifications,
        'dimensions', i.dimensions,
        'image_url', i.image_url,
        'product_id', i.product_id,
        'source_quote_id', i.source_quote_id,
        'source_quote_item_id', i.source_quote_item_id,
        'resolution', i.resolution,
        'resolution_reason', i.resolution_reason,
        'resolved_at', i.resolved_at,
        'award', (
          select jsonb_build_object(
            'id', a.id,
            'factory_id', a.factory_id,
            'factory_name', a.factory_name,
            'version', a.version,
            'unit_price', a.unit_price,
            'currency', a.currency,
            'quantity', a.quantity,
            'reason', a.reason,
            'status', a.status,
            'awarded_at', a.awarded_at
          )
          from public.fds_rfq_awards a
          where a.rfq_item_id = i.id and a.status = 'active'
          limit 1
        )
      ) as row_json
    from public.fds_rfq_items i
    where i.rfq_id = p_rfq_id and i.revision = v_rfq.revision
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', inv.id,
      'factory_id', inv.factory_id,
      'factory_name', inv.factory_name,
      'contact_email', inv.contact_email,
      'status', inv.status,
      'revision', inv.revision,
      'latest_version', (
        select s.version from public.fds_rfq_submissions s
        where s.invitation_id = inv.id and s.status = 'submitted'
        order by s.version desc limit 1
      ),
      'latest_submitted_at', (
        select s.submitted_at from public.fds_rfq_submissions s
        where s.invitation_id = inv.id and s.status = 'submitted'
        order by s.version desc limit 1
      ),
      'latest_status', (
        select s.status from public.fds_rfq_submissions s
        where s.invitation_id = inv.id
        order by s.version desc limit 1
      ),
      'quoted_item_count', (
        select count(*)
        from public.fds_rfq_submission_items si
        join public.fds_rfq_submissions s on s.id = si.submission_id
        join public.fds_rfq_items it on it.id = si.rfq_item_id
        where s.invitation_id = inv.id
          and s.revision = inv.revision
          and s.status = 'submitted'
          and it.revision = inv.revision
          and si.unit_price is not null
          and si.no_quote = false
      ),
      'has_active_token', exists (
        select 1 from public.fds_rfq_invitation_tokens t
        where t.invitation_id = inv.id
          and t.revoked_at is null
          and (t.expires_at is null or t.expires_at > now())
      )
    ) order by inv.factory_name, inv.factory_id), '[]'::jsonb)
  into v_invitations
  from public.fds_rfq_invitations inv
  where inv.rfq_id = p_rfq_id and inv.revision = v_rfq.revision;

  if v_revealed then
    with latest as (
      select distinct on (s.invitation_id) s.*
      from public.fds_rfq_submissions s
      where s.rfq_id = p_rfq_id
        and s.revision = v_rfq.revision
        and s.status = 'submitted'
      order by s.invitation_id, s.version desc
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'invitation_id', l.invitation_id,
        'factory_id', l.factory_id,
        'version', l.version,
        'submitted_at', l.submitted_at,
        'submitter_email', l.submitter_email,
        'receipt_code', l.receipt_code,
        'total_amount', (
          select coalesce(sum(si.unit_price * it.quantity), 0)
          from public.fds_rfq_submission_items si
          join public.fds_rfq_items it on it.id = si.rfq_item_id
          where si.submission_id = l.id
            and it.revision = v_rfq.revision
            and si.no_quote = false
            and si.unit_price is not null
        ),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'submission_item_id', si.id,
            'rfq_item_id', si.rfq_item_id,
            'unit_price', si.unit_price,
            'no_quote', si.no_quote,
            'lead_time_days', si.lead_time_days,
            'validity_days', si.validity_days,
            'moq', si.moq,
            'package_qty', si.package_qty,
            'volume', si.volume,
            'alternate_product_id', si.alternate_product_id,
            'alternate_text', si.alternate_text,
            'note', si.note
          ))
          from public.fds_rfq_submission_items si
          join public.fds_rfq_items it on it.id = si.rfq_item_id
          where si.submission_id = l.id and it.revision = v_rfq.revision
        ), '[]'::jsonb)
      ) order by l.factory_id), '[]'::jsonb)
    into v_submissions
    from latest l;
  else
    with latest as (
      select distinct on (s.invitation_id) s.*
      from public.fds_rfq_submissions s
      where s.rfq_id = p_rfq_id
        and s.revision = v_rfq.revision
        and s.status = 'submitted'
      order by s.invitation_id, s.version desc
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'invitation_id', l.invitation_id,
        'factory_id', l.factory_id,
        'version', l.version,
        'submitted_at', l.submitted_at,
        'submitter_email', l.submitter_email,
        -- 未揭標：沒有單價、沒有小計、沒有總額，只有「已報行數」。
        'quoted_item_count', (
          select count(*)
          from public.fds_rfq_submission_items si
          join public.fds_rfq_items it on it.id = si.rfq_item_id
          where si.submission_id = l.id
            and it.revision = v_rfq.revision
            and si.unit_price is not null
            and si.no_quote = false
        )
      ) order by l.factory_id), '[]'::jsonb)
    into v_submissions
    from latest l;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'revision', s.revision,
      'version', s.version,
      'status', s.status,
      'factory_id', s.factory_id,
      'submitter_email', s.submitter_email,
      'submitted_at', s.submitted_at,
      'withdrawn_at', s.withdrawn_at
    ) order by s.submitted_at desc), '[]'::jsonb)
  into v_history
  from public.fds_rfq_submissions s
  where s.rfq_id = p_rfq_id and s.revision < v_rfq.revision;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'rfq_item_id', a.rfq_item_id,
      'invitation_id', a.invitation_id,
      'submission_id', a.submission_id,
      'factory_id', a.factory_id,
      'factory_name', a.factory_name,
      'version', a.version,
      'unit_price', a.unit_price,
      'currency', a.currency,
      'quantity', a.quantity,
      'reason', a.reason,
      'status', a.status,
      'awarded_at', a.awarded_at
    ) order by a.awarded_at desc), '[]'::jsonb)
  into v_awards
  from public.fds_rfq_awards a
  where a.rfq_id = p_rfq_id and a.status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'rfq_item_id', e.rfq_item_id,
      'invitation_id', e.invitation_id,
      'event_type', e.event_type,
      'actor_kind', e.actor_kind,
      'actor_email', e.actor_email,
      'detail', e.detail,
      'created_at', e.created_at
    ) order by e.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select * from public.fds_rfq_events
    where rfq_id = p_rfq_id
    order by created_at desc
    limit 60
  ) e;

  -- 歷史目錄價：只限這張單的受邀廠與相關 product_id。
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', sp.product_id,
      'factory_id', sp.factory_id,
      'factory_name', sp.factory_name,
      'catalog_price', sp.cost_price,
      'currency', sp.currency,
      'unit', sp.unit,
      'variant_label', sp.variant_label,
      'quote_year', sp.quote_year,
      'valid_from', sp.valid_from,
      'valid_to', sp.valid_to,
      'created_at', sp.created_at
    ) order by sp.quote_year desc nulls last, sp.created_at desc), '[]'::jsonb)
  into v_catalog
  from (
    select sp.*
    from public.supplier_prices sp
    where sp.product_id in (
        select distinct i.product_id
        from public.fds_rfq_items i
        where i.rfq_id = p_rfq_id
          and i.revision = v_rfq.revision
          and i.product_id is not null
      )
      and sp.factory_id in (
        select distinct inv.factory_id
        from public.fds_rfq_invitations inv
        where inv.rfq_id = p_rfq_id and inv.revision = v_rfq.revision
      )
      and sp.cost_price is not null
    order by sp.quote_year desc nulls last, sp.created_at desc
    limit 500
  ) sp;

  select jsonb_build_object(
    'item_count', (select count(*) from public.fds_rfq_items i where i.rfq_id = p_rfq_id and i.revision = v_rfq.revision),
    'invitation_count', (select count(*) from public.fds_rfq_invitations v where v.rfq_id = p_rfq_id and v.revision = v_rfq.revision),
    'submitted_factory_count', (
      select count(distinct s.invitation_id) from public.fds_rfq_submissions s
      where s.rfq_id = p_rfq_id and s.revision = v_rfq.revision and s.status = 'submitted'
    ),
    'resolved_item_count', (
      select count(*) from public.fds_rfq_items i
      where i.rfq_id = p_rfq_id and i.revision = v_rfq.revision and i.resolution <> 'open'
    )
  ) into v_counts;

  return jsonb_build_object(
    'rfq', jsonb_build_object(
      'id', v_rfq.id,
      'rfq_no', v_rfq.rfq_no,
      'title', v_rfq.title,
      'currency', v_rfq.currency,
      'status', v_effective,
      'stored_status', v_rfq.status,
      'revision', v_rfq.revision,
      'close_at', v_rfq.close_at,
      'sealed', not v_revealed,
      'revealed', v_revealed,
      'revealed_at', v_rfq.revealed_at,
      'reveal_reason', v_rfq.reveal_reason,
      'close_revealed', v_rfq.close_at is not null and v_rfq.close_at <= now(),
      'published_at', v_rfq.published_at,
      'notes', v_rfq.notes,
      'cancel_reason', v_rfq.cancel_reason,
      'source_quote_id', v_rfq.source_quote_id,
      'created_at', v_rfq.created_at,
      'created_by_email', v_rfq.created_by_email,
      'server_now', now()
    ),
    'counts', v_counts,
    'items', v_items,
    'invitations', v_invitations,
    'submissions', v_submissions,
    'history', v_history,
    'awards', v_awards,
    'catalog_prices', v_catalog,
    'events', v_events
  );
end;
$$;

-- ── 提前揭標 / 取消 / 重開 / 定標 / 不定標 ───────────────────────────
create or replace function public.fds_rfq_reveal(
  p_rfq_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_rfqs%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.bwf_assert_role(array['admin']);

  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_row.status in ('draft', 'cancelled') then
    raise exception 'rfq_not_draft' using errcode = 'P0001';
  end if;

  if v_row.revealed_at is null then
    update public.fds_rfqs
    set sealed_bid = false,
        revealed_at = now(),
        reveal_reason = v_reason,
        updated_at = now()
    where id = p_rfq_id;

    perform public.fds_rfq_event(p_rfq_id, null, null, 'revealed', 'staff',
      jsonb_build_object('reason', v_reason));
  end if;

  return jsonb_build_object('id', p_rfq_id, 'revealed', true);
end;
$$;

create or replace function public.fds_rfq_cancel(
  p_rfq_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_rfqs%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.bwf_assert_role(array['admin']);

  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_row.status = 'draft' then
    raise exception 'rfq_not_draft' using errcode = 'P0001';
  end if;
  if v_row.status = 'cancelled' then
    return jsonb_build_object('id', p_rfq_id, 'status', 'cancelled');
  end if;

  update public.fds_rfqs
  set status = 'cancelled', cancel_reason = v_reason, updated_at = now()
  where id = p_rfq_id;

  update public.fds_rfq_awards
  set status = 'cancelled', cancelled_at = now()
  where rfq_id = p_rfq_id and status = 'active';

  perform public.fds_rfq_event(p_rfq_id, null, null, 'cancelled', 'staff',
    jsonb_build_object('reason', v_reason));

  return jsonb_build_object('id', p_rfq_id, 'status', 'cancelled');
end;
$$;

create or replace function public.fds_rfq_reopen_line(
  p_rfq_id uuid,
  p_rfq_item_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_rfqs%rowtype;
  v_item public.fds_rfq_items%rowtype;
  v_award public.fds_rfq_awards%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.bwf_assert_role(array['admin']);

  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'rfq_cancelled' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.fds_rfq_items
  where id = p_rfq_item_id and rfq_id = p_rfq_id and revision = v_row.revision
  for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_item.resolution = 'open' then
    raise exception 'line_not_resolved' using errcode = 'P0001';
  end if;

  select * into v_award
  from public.fds_rfq_awards
  where rfq_item_id = p_rfq_item_id and status = 'active'
  limit 1;

  if found then
    update public.fds_rfq_awards
    set status = 'reopened',
        reopened_by = auth.uid(),
        reopened_by_email = coalesce(auth.jwt() ->> 'email', ''),
        reopened_at = now(),
        reopen_reason = v_reason
    where id = v_award.id;
  end if;

  update public.fds_rfq_items
  set resolution = 'open',
      resolution_reason = null,
      resolved_at = null,
      resolved_by = null,
      updated_at = now()
  where id = p_rfq_item_id;

  update public.fds_rfqs
  set status = case
        when close_at is not null and close_at <= now() then 'review'
        else 'open'
      end,
      updated_at = now()
  where id = p_rfq_id and status in ('awarded', 'not_awarded');

  perform public.fds_rfq_event(p_rfq_id, p_rfq_item_id, null, 'line_reopened', 'staff',
    jsonb_build_object('reason', v_reason, 'previous_award_id', v_award.id));

  return jsonb_build_object('rfq_item_id', p_rfq_item_id, 'resolution', 'open');
end;
$$;

create or replace function public.fds_rfq_award_line(
  p_rfq_id uuid,
  p_rfq_item_id uuid,
  p_submission_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_rfqs%rowtype;
  v_item public.fds_rfq_items%rowtype;
  v_sub public.fds_rfq_submissions%rowtype;
  v_sub_item public.fds_rfq_submission_items%rowtype;
  v_inv public.fds_rfq_invitations%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_award_id uuid;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'rfq_cancelled' using errcode = 'P0001';
  end if;
  if not public.fds_rfq_is_revealed(v_row.sealed_bid, v_row.revealed_at, v_row.close_at) then
    raise exception 'sealed' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.fds_rfq_items
  where id = p_rfq_item_id and rfq_id = p_rfq_id and revision = v_row.revision
  for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_item.resolution <> 'open' then
    raise exception 'line_already_resolved' using errcode = 'P0001';
  end if;

  select s.* into v_sub
  from public.fds_rfq_submissions s
  where s.id = p_submission_id
    and s.rfq_id = p_rfq_id
    and s.revision = v_row.revision
    and s.status = 'submitted';
  if not found then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  select * into v_inv
  from public.fds_rfq_invitations
  where id = v_sub.invitation_id and revision = v_row.revision;
  if not found then
    raise exception 'award_version_stale' using errcode = 'P0001';
  end if;

  -- 只認該廠最新一次「已提交」版本。
  if exists (
    select 1 from public.fds_rfq_submissions s2
    where s2.invitation_id = v_sub.invitation_id
      and s2.status = 'submitted'
      and s2.version > v_sub.version
  ) then
    raise exception 'award_version_stale' using errcode = 'P0001';
  end if;

  select * into v_sub_item
  from public.fds_rfq_submission_items
  where submission_id = v_sub.id and rfq_item_id = p_rfq_item_id;
  if not found then
    raise exception 'empty_submission' using errcode = 'P0001';
  end if;
  if coalesce(v_sub_item.no_quote, false) or v_sub_item.unit_price is null then
    raise exception 'empty_submission' using errcode = 'P0001';
  end if;

  insert into public.fds_rfq_awards (
    rfq_id, rfq_item_id, invitation_id, submission_id, submission_item_id,
    factory_id, factory_name, version, unit_price, currency, quantity,
    reason, awarded_by, awarded_by_email
  ) values (
    p_rfq_id, p_rfq_item_id, v_sub.invitation_id, v_sub.id, v_sub_item.id,
    v_sub.factory_id, v_inv.factory_name, v_sub.version, v_sub_item.unit_price,
    v_row.currency, v_item.quantity, v_reason,
    auth.uid(), coalesce(auth.jwt() ->> 'email', '')
  )
  returning id into v_award_id;

  update public.fds_rfq_items
  set resolution = 'awarded',
      resolution_reason = v_reason,
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
  where id = p_rfq_item_id;

  perform public.fds_rfq_event(p_rfq_id, p_rfq_item_id, v_sub.invitation_id, 'line_awarded', 'staff',
    jsonb_build_object(
      'award_id', v_award_id,
      'factory_id', v_sub.factory_id,
      'factory_name', v_inv.factory_name,
      'version', v_sub.version,
      'unit_price', v_sub_item.unit_price,
      'reason', v_reason
    ));

  perform public.fds_rfq_refresh_header(p_rfq_id);

  return jsonb_build_object('award_id', v_award_id, 'rfq_item_id', p_rfq_item_id, 'resolution', 'awarded');
end;
$$;

create or replace function public.fds_rfq_no_award_line(
  p_rfq_id uuid,
  p_rfq_item_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fds_rfqs%rowtype;
  v_item public.fds_rfq_items%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm']);

  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into v_row from public.fds_rfqs where id = p_rfq_id for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'rfq_cancelled' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.fds_rfq_items
  where id = p_rfq_item_id and rfq_id = p_rfq_id and revision = v_row.revision
  for update;
  if not found then
    raise exception 'rfq_not_found' using errcode = 'P0001';
  end if;
  if v_item.resolution <> 'open' then
    raise exception 'line_already_resolved' using errcode = 'P0001';
  end if;

  update public.fds_rfq_items
  set resolution = 'no_award',
      resolution_reason = v_reason,
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
  where id = p_rfq_item_id;

  perform public.fds_rfq_event(p_rfq_id, p_rfq_item_id, null, 'line_not_awarded', 'staff',
    jsonb_build_object('reason', v_reason));

  perform public.fds_rfq_refresh_header(p_rfq_id);

  return jsonb_build_object('rfq_item_id', p_rfq_item_id, 'resolution', 'no_award');
end;
$$;

-- ── 連結頁：讀取 ─────────────────────────────────────────────────────
create or replace function public.fds_rfq_open_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_effective text;
  v_items jsonb;
  v_submission jsonb;
  v_latest public.fds_rfq_submissions%rowtype;
  v_can_submit boolean;
begin
  select * into v_ctx from public.fds_rfq_token_context(p_token);
  v_effective := public.fds_rfq_effective_status(v_ctx.rfq_status, v_ctx.close_at);
  v_can_submit := public.fds_rfq_accepts_submission(v_ctx.rfq_status, v_ctx.close_at);

  select * into v_latest
  from public.fds_rfq_submissions s
  where s.invitation_id = v_ctx.invitation_id
  order by s.version desc
  limit 1;

  select coalesce(jsonb_agg(row_json order by sort_order), '[]'::jsonb)
  into v_items
  from (
    select
      i.sort_order,
      jsonb_build_object(
        'id', i.id,
        'sort_order', i.sort_order,
        'name', i.name,
        'model', i.model,
        'quantity', i.quantity,
        'unit', i.unit,
        'specifications', i.specifications,
        'dimensions', i.dimensions,
        'image_url', i.image_url,
        'product_id', i.product_id,
        'my', (
          select jsonb_build_object(
            'submission_item_id', si.id,
            'unit_price', si.unit_price,
            'no_quote', si.no_quote,
            'lead_time_days', si.lead_time_days,
            'validity_days', si.validity_days,
            'moq', si.moq,
            'package_qty', si.package_qty,
            'volume', si.volume,
            'alternate_product_id', si.alternate_product_id,
            'alternate_text', si.alternate_text,
            'note', si.note
          )
          from public.fds_rfq_submission_items si
          where si.submission_id = v_latest.id and si.rfq_item_id = i.id
          limit 1
        ),
        'decision', case
          when exists (
            select 1 from public.fds_rfq_awards a
            where a.rfq_item_id = i.id and a.status = 'active'
              and a.factory_id = v_ctx.factory_id
          ) then 'awarded'
          when exists (
            select 1 from public.fds_rfq_awards a
            where a.rfq_item_id = i.id and a.status = 'active'
          ) then 'not_selected'
          when i.resolution = 'no_award' then 'not_awarded'
          else 'pending'
        end
      ) as row_json
    from public.fds_rfq_items i
    where i.rfq_id = v_ctx.rfq_id and i.revision = v_ctx.invitation_revision
  ) x;

  if v_latest.id is not null then
    v_submission := jsonb_build_object(
      'id', v_latest.id,
      'version', v_latest.version,
      'status', v_latest.status,
      'receipt_code', v_latest.receipt_code,
      'submitted_at', v_latest.submitted_at,
      'withdrawn_at', v_latest.withdrawn_at,
      'submitter_email', v_latest.submitter_email
    );
  end if;

  return jsonb_build_object(
    'rfq', jsonb_build_object(
      'rfq_no', v_ctx.rfq_no,
      'title', v_ctx.title,
      'currency', v_ctx.currency,
      'status', v_effective,
      'revision', v_ctx.invitation_revision,
      'close_at', v_ctx.close_at,
      'notes', (
        select notes from public.fds_rfqs where id = v_ctx.rfq_id
      ),
      'server_now', now()
    ),
    'invitation', jsonb_build_object(
      'factory_id', v_ctx.factory_id,
      'factory_name', v_ctx.factory_name,
      'revision', v_ctx.invitation_revision
    ),
    'items', v_items,
    'submission', v_submission,
    'can_submit', v_can_submit
  );
end;
$$;

-- ── 連結頁：提交 ─────────────────────────────────────────────────────
create or replace function public.fds_rfq_submit_by_token(
  p_token text,
  p_items jsonb,
  p_submitter_email text,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_effective text;
  v_email text := lower(btrim(coalesce(p_submitter_email, '')));
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing public.fds_rfq_submissions%rowtype;
  v_line jsonb;
  v_item_id uuid;
  v_price numeric;
  v_no_quote boolean;
  v_valid_count integer := 0;
  v_version integer;
  v_submission_id uuid;
  v_receipt text;
  v_hash text;
  v_canonical jsonb;
  v_count integer;
  v_distinct integer;
begin
  select * into v_ctx from public.fds_rfq_token_context(p_token);

  if not public.fds_rfq_accepts_submission(v_ctx.rfq_status, v_ctx.close_at) then
    raise exception 'deadline_passed' using errcode = 'P0001';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;
  select jsonb_array_length(p_items) into v_count;
  if v_count = 0 then
    raise exception 'empty_submission' using errcode = 'P0001';
  end if;

  select count(distinct x ->> 'rfq_item_id') into v_distinct
  from jsonb_array_elements(p_items) x;
  if v_distinct <> v_count then
    raise exception 'invalid_items' using errcode = 'P0001';
  end if;

  -- 先驗證全部行，任何一行不合格都不寫入。
  for v_line in select value from jsonb_array_elements(p_items) loop
    begin
      v_item_id := nullif(btrim(coalesce(v_line ->> 'rfq_item_id', '')), '')::uuid;
    exception
      when others then
        raise exception 'invalid_items' using errcode = 'P0001';
    end;

    if v_item_id is null or not exists (
      select 1 from public.fds_rfq_items i
      where i.id = v_item_id
        and i.rfq_id = v_ctx.rfq_id
        and i.revision = v_ctx.invitation_revision
    ) then
      raise exception 'invalid_items' using errcode = 'P0001';
    end if;

    v_price := public.fds_rfq_try_numeric(v_line ->> 'unit_price');
    if v_price is not null and v_price < 0 then
      raise exception 'negative_price' using errcode = 'P0001';
    end if;

    v_no_quote := lower(coalesce(v_line ->> 'no_quote', 'false')) in ('true', 't', '1', 'yes');
    if not v_no_quote and v_price is not null then
      v_valid_count := v_valid_count + 1;
    end if;
  end loop;

  if v_valid_count = 0 then
    raise exception 'empty_submission' using errcode = 'P0001';
  end if;

  -- 同一冪等鍵重試回同一回執，不再建版本。
  if v_key is not null then
    select * into v_existing
    from public.fds_rfq_submissions
    where invitation_id = v_ctx.invitation_id
      and idempotency_key = v_key
    limit 1;
    if found then
      return jsonb_build_object(
        'id', v_existing.id,
        'version', v_existing.version,
        'receipt_code', v_existing.receipt_code,
        'submitted_at', v_existing.submitted_at,
        'content_hash', v_existing.content_hash,
        'duplicate', true
      );
    end if;
  end if;

  select coalesce(max(s.version), 0) + 1 into v_version
  from public.fds_rfq_submissions s
  where s.invitation_id = v_ctx.invitation_id;

  select jsonb_agg(x order by x ->> 'rfq_item_id') into v_canonical
  from jsonb_array_elements(p_items) x;
  v_hash := encode(
    extensions.digest(convert_to(coalesce(v_canonical, '[]'::jsonb)::text, 'utf8'), 'sha256'::text),
    'hex'
  );
  v_receipt := 'R-' || v_ctx.rfq_no || '-V' || v_version::text || '-'
    || upper(substr(encode(extensions.gen_random_bytes(3), 'hex'), 1, 6));

  insert into public.fds_rfq_submissions (
    rfq_id, invitation_id, factory_id, revision, version, status,
    receipt_code, content_hash, idempotency_key, submitter_email
  ) values (
    v_ctx.rfq_id, v_ctx.invitation_id, v_ctx.factory_id,
    v_ctx.invitation_revision, v_version, 'submitted',
    v_receipt, v_hash, v_key, v_email
  )
  returning id into v_submission_id;

  for v_line in select value from jsonb_array_elements(p_items) loop
    v_item_id := (v_line ->> 'rfq_item_id')::uuid;
    v_no_quote := lower(coalesce(v_line ->> 'no_quote', 'false')) in ('true', 't', '1', 'yes');
    v_price := public.fds_rfq_try_numeric(v_line ->> 'unit_price');
    if v_no_quote then
      v_price := null;
    end if;

    insert into public.fds_rfq_submission_items (
      submission_id, rfq_item_id, unit_price, no_quote,
      lead_time_days, validity_days, moq, package_qty, volume,
      alternate_product_id, alternate_text, note
    ) values (
      v_submission_id,
      v_item_id,
      v_price,
      v_no_quote,
      public.fds_rfq_try_int(v_line ->> 'lead_time_days'),
      public.fds_rfq_try_int(v_line ->> 'validity_days'),
      public.fds_rfq_try_numeric(v_line ->> 'moq'),
      public.fds_rfq_try_numeric(v_line ->> 'package_qty'),
      public.fds_rfq_try_numeric(v_line ->> 'volume'),
      nullif(btrim(coalesce(v_line ->> 'alternate_product_id', '')), ''),
      nullif(btrim(coalesce(v_line ->> 'alternate_text', '')), ''),
      nullif(btrim(coalesce(v_line ->> 'note', '')), '')
    );
  end loop;

  update public.fds_rfq_invitations
  set status = 'submitted', updated_at = now()
  where id = v_ctx.invitation_id;

  perform public.fds_rfq_event(v_ctx.rfq_id, null, v_ctx.invitation_id, 'submitted', 'link',
    jsonb_build_object(
      'version', v_version,
      'receipt_code', v_receipt,
      'submitter_email', v_email,
      'quoted_item_count', v_valid_count
    ));

  return jsonb_build_object(
    'id', v_submission_id,
    'version', v_version,
    'receipt_code', v_receipt,
    'submitted_at', now(),
    'content_hash', v_hash,
    'duplicate', false
  );
end;
$$;

-- ── 連結頁：撤回（不刪版本） ─────────────────────────────────────────
create or replace function public.fds_rfq_withdraw_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx record;
  v_effective text;
  v_sub public.fds_rfq_submissions%rowtype;
begin
  select * into v_ctx from public.fds_rfq_token_context(p_token);

  if not public.fds_rfq_accepts_submission(v_ctx.rfq_status, v_ctx.close_at) then
    raise exception 'deadline_passed' using errcode = 'P0001';
  end if;

  select * into v_sub
  from public.fds_rfq_submissions
  where invitation_id = v_ctx.invitation_id and status = 'submitted'
  order by version desc
  limit 1;
  if not found then
    raise exception 'empty_submission' using errcode = 'P0001';
  end if;

  update public.fds_rfq_submissions
  set status = 'withdrawn', withdrawn_at = now()
  where id = v_sub.id;

  update public.fds_rfq_invitations
  set status = 'withdrawn', updated_at = now()
  where id = v_ctx.invitation_id;

  perform public.fds_rfq_event(v_ctx.rfq_id, null, v_ctx.invitation_id, 'withdrawn', 'link',
    jsonb_build_object('version', v_sub.version));

  return jsonb_build_object('version', v_sub.version, 'status', 'withdrawn');
end;
$$;

-- ── 權限 ─────────────────────────────────────────────────────────────
revoke all on function public.fds_rfq_try_numeric(text) from public, anon, authenticated;
revoke all on function public.fds_rfq_try_int(text) from public, anon, authenticated;
revoke all on function public.fds_rfq_accepts_submission(text, timestamptz) from public, anon, authenticated;
revoke all on function public.fds_rfq_event(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fds_rfq_insert_items(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fds_rfq_insert_invitations(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fds_rfq_refresh_header(uuid) from public, anon, authenticated;

revoke all on function public.fds_rfq_list(text) from public, anon;
revoke all on function public.fds_rfq_save_draft(uuid, jsonb) from public, anon;
revoke all on function public.fds_rfq_publish(uuid) from public, anon;
revoke all on function public.fds_rfq_revise(uuid, jsonb) from public, anon;
revoke all on function public.fds_rfq_invite_factory(uuid, text, text, text) from public, anon;
revoke all on function public.fds_rfq_issue_link(uuid) from public, anon;
revoke all on function public.fds_rfq_detail(uuid) from public, anon;
revoke all on function public.fds_rfq_reveal(uuid, text) from public, anon;
revoke all on function public.fds_rfq_cancel(uuid, text) from public, anon;
revoke all on function public.fds_rfq_reopen_line(uuid, uuid, text) from public, anon;
revoke all on function public.fds_rfq_award_line(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.fds_rfq_no_award_line(uuid, uuid, text) from public, anon;

grant execute on function public.fds_rfq_list(text) to authenticated;
grant execute on function public.fds_rfq_save_draft(uuid, jsonb) to authenticated;
grant execute on function public.fds_rfq_publish(uuid) to authenticated;
grant execute on function public.fds_rfq_revise(uuid, jsonb) to authenticated;
grant execute on function public.fds_rfq_invite_factory(uuid, text, text, text) to authenticated;
grant execute on function public.fds_rfq_issue_link(uuid) to authenticated;
grant execute on function public.fds_rfq_detail(uuid) to authenticated;
grant execute on function public.fds_rfq_reveal(uuid, text) to authenticated;
grant execute on function public.fds_rfq_cancel(uuid, text) to authenticated;
grant execute on function public.fds_rfq_reopen_line(uuid, uuid, text) to authenticated;
grant execute on function public.fds_rfq_award_line(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.fds_rfq_no_award_line(uuid, uuid, text) to authenticated;

-- 公開連結頁不需要登入；token 本身就是憑證，並且只回自己廠的內容。
revoke all on function public.fds_rfq_open_by_token(text) from public;
revoke all on function public.fds_rfq_submit_by_token(text, jsonb, text, text) from public;
revoke all on function public.fds_rfq_withdraw_by_token(text) from public;
grant execute on function public.fds_rfq_open_by_token(text) to anon, authenticated;
grant execute on function public.fds_rfq_submit_by_token(text, jsonb, text, text) to anon, authenticated;
grant execute on function public.fds_rfq_withdraw_by_token(text) to anon, authenticated;

notify pgrst, 'reload schema';
