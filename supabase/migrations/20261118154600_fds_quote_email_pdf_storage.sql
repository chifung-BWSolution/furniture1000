insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quote-email-pdfs', 'quote-email-pdfs', false, 20971520, array['application/pdf']);

create policy "Quote email senders can store attachments"
on storage.objects for all to authenticated
using (
  bucket_id = 'quote-email-pdfs'
  and public.bwf_has_role(array['admin', 'uploader', 'pm'])
)
with check (
  bucket_id = 'quote-email-pdfs'
  and public.bwf_has_role(array['admin', 'uploader', 'pm'])
);
