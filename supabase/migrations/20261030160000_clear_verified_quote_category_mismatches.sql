-- Remove verified cabinet labels from desk/table quote lines only.
-- Preserve legitimate historical category labels used as product names.
UPDATE public.bwf_quote_item i
SET category = NULL
FROM public.bwf_quote q
WHERE q.id = i.quote_uuid
  AND q.quote_id = 'BWF-NGO26-073'
  AND i.id IN (
    '61a1158d-9ec9-44f4-8166-9277479ef9ff'::uuid,
    '1cf17325-3ce0-43b2-808a-dd32b4be132f'::uuid,
    'f2e79f27-7745-49f3-8c16-6c99438651d9'::uuid,
    'a2007eda-2ded-4819-b575-2051299f8f91'::uuid,
    '4780f49a-0e4b-4bb2-ab52-e09c6913200b'::uuid,
    'ca2f5036-ceb1-449f-84a5-a4c1445a4840'::uuid,
    '53d4b328-3d95-4b24-85bb-1eb7f41e5f6f'::uuid,
    '05584ad5-662f-47a3-b702-be454ec453a8'::uuid,
    '4a50a08b-4c21-4e6a-b570-c8ee4a1993d8'::uuid,
    '6e591d26-8db3-4bb1-8857-ad7924319d9f'::uuid,
    '2cb42842-0394-4881-9f4a-6af5b4ca6e0d'::uuid,
    '791788a2-f99f-4b6e-bc4f-922d7e48d711'::uuid,
    '17630948-af2e-4d06-b03c-f937e875fc55'::uuid,
    'cbd13bea-116b-436a-a6f0-65c4f83b967b'::uuid,
    '4a5ddda9-8279-42ec-bdac-a0c213de4e5e'::uuid,
    'c6d7d905-ae78-48a6-b891-55919e993c84'::uuid,
    '577df8d7-f5d2-4cfa-af92-1959cbdfb81b'::uuid,
    '4be24dfb-8684-4326-acce-d559e11b96b0'::uuid,
    'eff6e00f-50d3-4551-bc67-69029c7664a6'::uuid,
    '7ed7d50b-2344-44b6-9b43-3aba11e8d5ac'::uuid,
    'f0d41c46-740a-408d-987c-e7a77cb9d45e'::uuid,
    '501bcc71-dee6-440f-a9ed-857b7be1c367'::uuid,
    '3bd7fffb-3174-4af5-a131-bdf6a89b3669'::uuid,
    '2cae835b-909f-4116-a9bc-0cf8e4b51366'::uuid
  )
  AND i.category = '吊櫃（掩門）'
  AND i.product_id IS NULL
  AND i.product_category_id IS NULL
  AND (i.name LIKE '%升降枱%' OR i.name = '摺枱');
