-- FDS Supplier RFQ：invite-supplier edge function 用 service_role 寫 supplier_logins，
-- 但 20261022170000 只 grant 了 authenticated（select/update）。
-- 分支因此回「permission denied for table supplier_logins」。Production 已有權限；
-- 這裡只補分支需要的 service_role grants，不改 RLS，也不放寬 anon。

grant select, insert, update on table public.supplier_logins to service_role;

notify pgrst, 'reload schema';
