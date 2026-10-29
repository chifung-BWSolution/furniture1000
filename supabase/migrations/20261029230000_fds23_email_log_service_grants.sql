-- FDS-15 / FDS-14：發信 worker 以 service_role 直接寫 email_notification_logs，
-- 但該表只 grant select 給 authenticated，service_role 沒有 insert，
-- 導致寄送成功卻沒有中央發信紀錄（message 表有，但 audit log 缺）。
-- 補回 service_role 的最小權限。

grant select, insert on public.email_notification_logs to service_role;

notify pgrst, 'reload schema';
