INSERT INTO delivery_terms (name, type, min_days, max_days, parent_id, sort_order)
SELECT '7天內', 'custom'::delivery_term_type, 1, 7, dt.id, 1
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM delivery_terms WHERE name = '7天內');

INSERT INTO delivery_terms (name, type, min_days, max_days, parent_id, sort_order)
SELECT '8-15天', 'custom'::delivery_term_type, 8, 15, dt.id, 2
FROM delivery_terms dt WHERE dt.name = '定制' AND dt.parent_id IS NULL
AND NOT EXISTS (SELECT 1 FROM delivery_terms WHERE name = '8-15天');

UPDATE delivery_terms SET sort_order = 3 WHERE name = '16-23天';
UPDATE delivery_terms SET sort_order = 4 WHERE name = '24-31天';
UPDATE delivery_terms SET sort_order = 5 WHERE name = '31天以上';
