\set ON_ERROR_STOP on

BEGIN;

INSERT INTO gl_code (
    id,
    tenant_id,
    account_code,
    account_name,
    description
)
VALUES
    (gen_random_uuid(), :'tenant_id'::uuid, '6000', 'Travel Expense', 'Synthetic local travel expense account'),
    (gen_random_uuid(), :'tenant_id'::uuid, '6100', 'Meals Expense', 'Synthetic local meals expense account'),
    (gen_random_uuid(), :'tenant_id'::uuid, '6200', 'Lodging Expense', 'Synthetic local lodging expense account'),
    (gen_random_uuid(), :'tenant_id'::uuid, '6300', 'Mileage Expense', 'Synthetic local mileage expense account'),
    (gen_random_uuid(), :'tenant_id'::uuid, '6400', 'Office Supplies Expense', 'Synthetic local office supplies expense account'),
    (gen_random_uuid(), :'tenant_id'::uuid, '6500', 'Software Expense', 'Synthetic local software expense account'),
    (gen_random_uuid(), :'tenant_id'::uuid, '6999', 'Other Expense', 'Synthetic local uncategorized expense account')
ON CONFLICT (tenant_id, account_code) DO UPDATE
SET
    account_name = EXCLUDED.account_name,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO gl_mapping (
    id,
    tenant_id,
    category,
    gl_code_id
)
SELECT
    gen_random_uuid(),
    :'tenant_id'::uuid,
    baseline.category,
    code.id
FROM (
    VALUES
        ('Travel', '6000'),
        ('Meals', '6100'),
        ('Lodging', '6200'),
        ('Mileage', '6300'),
        ('Office Supplies', '6400'),
        ('Software', '6500'),
        ('Other', '6999')
) AS baseline(category, account_code)
INNER JOIN gl_code code
    ON code.tenant_id = :'tenant_id'::uuid
    AND code.account_code = baseline.account_code
ON CONFLICT (tenant_id, category) DO UPDATE
SET
    gl_code_id = EXCLUDED.gl_code_id,
    updated_at = now();

COMMIT;
