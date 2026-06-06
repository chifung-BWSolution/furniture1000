-- Add in_stock (boolean) and customize (text enum) columns to products table
alter table public.products
  add column if not exists in_stock boolean default null,
  add column if not exists customize text default null;

-- customize column only allows the 5 fixed lead-time values (or null)
alter table public.products
  add constraint products_customize_check
  check (
    customize is null or customize in (
      '3-7天', '8-15天', '16-25天', '26-40天', '41天以上'
    )
  );
