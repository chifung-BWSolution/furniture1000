-- Link Michael Lee (cfb.f05@chifung.net) to Furniture auth user for staff name resolution.
UPDATE users
SET
  auth_user_id = '93b4b209-bb1c-4bb1-bf24-dc7406e73f3e',
  modified_date = now()
WHERE member_id = '75234b8c-650b-4e19-8d68-d60c4cf5f727'
  AND email = 'cfb.f05@chifung.net'
  AND auth_user_id IS NULL;
