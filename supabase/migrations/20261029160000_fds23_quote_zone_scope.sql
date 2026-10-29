-- FDS-13 伺服器端範圍檢查：分區示範圖（透視圖）只適用於「報價一覽」的 BWF 正式報價。
-- 排除：快速報價、客戶方案、回收桶、DP- 單號、以及掛了設計專案殼（designProjectId）的報價。
-- 角色沿用既有參考圖生成：admin、uploader、PM（designer 不開放）。

create or replace function public.fds_quote_zone_scope(p_quote_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_quote_id text;
  v_project_data jsonb;
  v_design_project text;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    return jsonb_build_object('allowed', false, 'reason', 'role');
  end if;

  if p_quote_uuid is null then
    return jsonb_build_object('allowed', false, 'reason', 'quote_missing');
  end if;

  select q.status, q.quote_id, q.project_data
    into v_status, v_quote_id, v_project_data
    from public.bwf_quote q
   where q.id = p_quote_uuid;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'quote_missing');
  end if;

  if coalesce(v_status, '') in ('快速報價', '客戶方案', '回收桶') then
    return jsonb_build_object('allowed', false, 'reason', 'not_formal_quote', 'status', v_status);
  end if;

  if coalesce(v_quote_id, '') ilike 'DP-%' then
    return jsonb_build_object('allowed', false, 'reason', 'design_project', 'quote_id', v_quote_id);
  end if;

  if v_project_data is not null and jsonb_typeof(v_project_data) = 'object' then
    v_design_project := nullif(btrim(coalesce(v_project_data ->> 'designProjectId', '')), '');
    if v_design_project is not null then
      return jsonb_build_object('allowed', false, 'reason', 'design_project', 'quote_id', v_quote_id);
    end if;
  end if;

  return jsonb_build_object('allowed', true, 'reason', null, 'quote_id', v_quote_id);
end;
$$;

revoke all on function public.fds_quote_zone_scope(uuid) from public, anon;
grant execute on function public.fds_quote_zone_scope(uuid) to authenticated;

notify pgrst, 'reload schema';
