-- Auto-convert base64 images in ready_to_shopify to Supabase Storage URLs.
--
-- WHY: base64 image_url / images entries bloat the table (~1MB each) and must
-- never reach Shopify. The migrate-rts-images edge function scans rows that
-- still hold base64 and uploads them to Storage, persisting only the public URL.
-- This cron fires it every 10 minutes so any base64 newly written by the app
-- (e.g. pasted images that slipped through) is converted automatically, in
-- small batches that never overload the connection pool.
--
-- NOTE: the Authorization/apikey below use the project ANON key (the edge
-- function authorises itself with the service-role key from its own env). This
-- job was created live via the Management API on 2026-06-23; this migration
-- records it so it is reproducible in other environments. Replace the ANON_KEY
-- placeholder before applying elsewhere.

select cron.schedule(
  'migrate-rts-images-every-10min',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://riaubhtruisbwdlwjzur.supabase.co/functions/v1/migrate-rts-images',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ANON_KEY_PLACEHOLDER',
      'apikey', 'ANON_KEY_PLACEHOLDER'
    ),
    body := '{"batch_size":10}'::jsonb
  );
  $job$
);

-- To inspect / unschedule:
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--   SELECT cron.unschedule('migrate-rts-images-every-10min');
