-- Fix customize column: live DB has it as date, but it should be text (lead-time label)
-- Drop the incorrect date column and recreate as text with enum constraint
alter table public.products
  drop column if exists customize;

alter table public.products
  add column customize text default null;

alter table public.products
  add constraint products_customize_check
  check (
    customize is null or customize in (
      '3-7天', '8-15天', '16-25天', '26-40天', '41天以上'
    )
  );
