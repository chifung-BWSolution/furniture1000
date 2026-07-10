-- Remove placeholder rows; report now resolves real users via products.editor_staff_id + PMS staff lookup.
DELETE FROM public.upload_log WHERE user_name = '歷史紀錄';
