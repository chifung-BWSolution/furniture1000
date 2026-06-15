-- Add pg_cron extension
create extension if not exists pg_cron;

-- Check if we can create the job, using the appropriate role.
-- Note: Requires superuser or the role that owns the db. In Supabase, postgres role has enough permissions.

-- Schedule the edge function to run every 60 minutes
-- We use net.http_post to call the edge function directly from the database
-- The 'net' extension is built into Supabase by default for HTTP requests.

select cron.schedule(
    'refresh-shopify-tokens-hourly',
    '0 * * * *', -- Every hour on the hour
    $$
    select net.http_post(
        url:='https://kqwktnplkqucsbasyfjl.supabase.co/functions/v1/supabase-functions-refresh-shopify-tokens',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('request.jwt.claim.sub', true) || '"}'::jsonb
    );
    $$
);

-- Note: In a real Supabase environment, you would use the exact Project ID URL 
-- and a service role key. The above uses a simplified net.http_post wrapper. 
-- You might also prefer the standard Supabase pg_net syntax:

/*
select cron.schedule(
  'refresh-shopify-tokens', 
  '0 * * * *',
  $$
  select net.http_post(
      url:='https://[PROJECT_REF].supabase.co/functions/v1/supabase-functions-refresh-shopify-tokens',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer [SERVICE_ROLE_KEY]"}'::jsonb
  )
  $$
);
*/