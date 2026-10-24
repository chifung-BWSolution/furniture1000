-- Orthographic generation reuses quote_photo_assets with inactive assets.
-- The existing table grants only authenticated; the authenticated product read
-- and role check still happen before this service-role-only internal write.
grant select, insert on table public.quote_photo_assets to service_role;
