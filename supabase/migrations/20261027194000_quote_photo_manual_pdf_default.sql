-- New photos are inserted into PDFs only after a user enables them.
alter table public.quote_photo_assets alter column is_active set default false;
