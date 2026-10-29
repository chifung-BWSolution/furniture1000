-- 本地待推送留言未有 Asana gid，原表 asana_gid 是 NOT NULL；放寬為可空。
alter table public.fds_asana_factory_comment
  alter column asana_gid drop not null;

notify pgrst, 'reload schema';
