-- 這個版本已記錄在現有資料庫，不會再跑一次。
-- 以前這裡會 unschedule 再重排 pg_cron「fds-process-jobs」，
-- 而且卡在 running 的任務沒有 attempts < max_attempts 上限。
-- 全新套用時必須保留 20261019040749 建立的原始排程，所以這裡不再改 cron。

notify pgrst, 'reload schema';
