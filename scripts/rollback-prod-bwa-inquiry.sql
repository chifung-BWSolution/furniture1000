-- Manual rollback ONLY for riaubhtruisbwdlwjzur, authorized 2026-10-24.
-- Not a forward migration; never apply to FDS 2.0.
-- Restore the pre-inquiry policies defined by the original quote migrations.
begin;
set local lock_timeout = '5s';
lock table public.bwa_furniture_inquiry, public.bwa_furniture_inquiry_item in access exclusive mode;
do $$
begin
  if exists (select 1 from public.bwa_furniture_inquiry)
     or exists (select 1 from public.bwa_furniture_inquiry_item) then
    raise exception 'Rollback stopped: inquiry data now exists';
  end if;
end;
$$;

drop trigger if exists bwf_quote_reject_bwa_pm on public.bwf_quote;
drop trigger if exists bwf_quote_item_reject_bwa_pm on public.bwf_quote_item;
drop trigger if exists bwf_quote_share_reject_bwa_pm on public.bwf_quote_share_links;
drop function public.bwf_reject_bwa_pm_quote_write();

drop policy bwf_quote_block_bwa_pm on public.bwf_quote;
drop policy bwf_quote_block_bwa_pm_anon on public.bwf_quote;
create policy "Allow all access to bwf_quote" on public.bwf_quote
  for all using (true) with check (true);
drop policy bwf_quote_item_block_bwa_pm on public.bwf_quote_item;
drop policy bwf_quote_item_block_bwa_pm_anon on public.bwf_quote_item;
create policy "Allow all access to bwf_quote_item" on public.bwf_quote_item
  for all using (true) with check (true);
drop policy bwf_quote_share_block_bwa_pm on public.bwf_quote_share_links;
drop policy bwf_quote_share_block_bwa_pm_anon on public.bwf_quote_share_links;
create policy "Allow all access to bwf_quote_share_links" on public.bwf_quote_share_links
  for all using (true) with check (true);

drop function public.bwa_list_furniture_inquiries();
drop function public.bwa_get_furniture_inquiry(uuid);
drop function public.bwa_save_furniture_inquiry(uuid, text, text, text, jsonb, uuid, uuid);
drop function public.bwa_send_furniture_inquiry(uuid);
drop function public.bwf_reply_furniture_inquiry(uuid, jsonb);
drop table public.bwa_furniture_inquiry_item;
drop table public.bwa_furniture_inquiry;
drop function public.bwa_inquiry_guard();
drop function public.bwa_inquiry_item_guard();
drop function public.bwa_reject_quote_keys(jsonb);

delete from supabase_migrations.schema_migrations
where name in ('fds21_bwa_furniture_inquiry', 'fds21_bwa_inquiry_pms_refs');
notify pgrst, 'reload schema';
commit;
