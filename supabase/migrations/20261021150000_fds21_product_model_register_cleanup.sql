-- Follow-up to 20261021140000: drop the old 3-arg overload and lock down grants on the 4-arg version.

drop function if exists public.fds_product_model_register(text, text, text);

revoke execute on function public.fds_product_model_register(text, text, text, text) from public, anon;
grant execute on function public.fds_product_model_register(text, text, text, text) to authenticated;
