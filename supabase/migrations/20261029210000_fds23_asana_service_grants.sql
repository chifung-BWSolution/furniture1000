-- FDS-12：service_role 需要讀寫 Asana link／comment 表（worker 用 service client）。
-- 建表時 revoke 了 anon／authenticated，但沒有把 service_role 的權限補回；
-- 只有 RPC 有 execute 權限是不夠的，worker 會直接 select link 表。

grant select, insert, update, delete on public.fds_asana_factory_link to service_role;
grant select, insert, update, delete on public.fds_asana_factory_comment to service_role;

grant execute on function public.fds_asana_factory_link_set(uuid, text, text, text) to service_role;
grant execute on function public.fds_asana_factory_link_list() to service_role;
grant execute on function public.fds_asana_factory_link_remove(uuid) to service_role;

notify pgrst, 'reload schema';
