-- Clear stale Shopify auth/publish errors after credentials are refreshed.
-- Keeps genuine in-flight failures; only resets known stale patterns.

update public.products
set
  error_message = null,
  status = 'draft'
where
  status = 'error'
  and (
    error_message ilike '%Invalid API key or access token%'
    or error_message ilike '%No Shopify credentials found%'
    or error_message ilike '%rate of change to s/files%'
  );
