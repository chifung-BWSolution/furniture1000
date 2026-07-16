-- Remove seeded HSBC mock emails from 用戶管理 sources.
DELETE FROM public.platform_user_profiles
WHERE lower(email) IN ('project@hsbc.com', 'chan@hsbc.com');

DELETE FROM public.project_invitations
WHERE lower(email) IN ('project@hsbc.com', 'chan@hsbc.com');

UPDATE public.client_companies
SET contact_email = NULL
WHERE lower(contact_email) IN ('project@hsbc.com', 'chan@hsbc.com');
