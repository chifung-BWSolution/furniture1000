-- BYPASSRLS does not grant table privileges. The catalog worker uses
-- service_role for its pending-job HEAD query and queue operations.
grant select, insert, update, delete
  on table public.supplier_document_jobs
  to service_role;
