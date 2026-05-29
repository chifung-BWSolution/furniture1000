UPDATE delivery_terms SET name = '16-23天', min_days = 16, max_days = 23, sort_order = 1
WHERE name = '7天內';

UPDATE delivery_terms SET name = '24-31天', min_days = 24, max_days = 31, sort_order = 2
WHERE name = '8-15天';

UPDATE delivery_terms SET name = '31天以上', min_days = 32, max_days = 999, sort_order = 3
WHERE name = '16-30天';

DELETE FROM delivery_terms WHERE name = '30天以上' AND parent_id IS NOT NULL;
