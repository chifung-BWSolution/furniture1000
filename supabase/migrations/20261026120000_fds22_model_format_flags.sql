-- FDS-06：模型檔旗標改到「格式」層級，設計師要看到 SKP／FBX 是否已有。
--
-- 舊的 fds_product_model_flags 回 {"su": bool, "3d": bool}，那是 model_type，
-- 不能回答「FBX 有了沒」（model_type='3d' 同時涵蓋 glb 與 fbx）。
-- 新版多回 'skp' / 'fbx' / 'glb'，舊欄位保留，避免其他呼叫端壞掉。

create or replace function public.fds_product_model_flags(p_product_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  return coalesce((
    select jsonb_object_agg(
             f.product_id,
             jsonb_build_object(
               'su', f.su,
               '3d', f.three_d,
               'skp', f.skp,
               'fbx', f.fbx,
               'glb', f.glb
             )
           )
    from (
      select m.product_id,
             bool_or(m.model_type = 'su') as su,
             bool_or(m.model_type = '3d') as three_d,
             bool_or(m.format = 'skp') as skp,
             bool_or(m.format = 'fbx') as fbx,
             bool_or(m.format = 'glb') as glb
      from public.product_models m
      where m.product_id = any ((coalesce(p_product_ids, array[]::text[]))[1:200])
      group by m.product_id
    ) f
  ), '{}'::jsonb);
end;
$$;

notify pgrst, 'reload schema';
