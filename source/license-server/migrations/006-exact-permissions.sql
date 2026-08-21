CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Existing installations used six broad write permissions. Expand those rows
-- once, then let the application enforce every permission independently.
WITH permission_map(legacy, expanded) AS (
  VALUES
    ('orders.update','orders.create'), ('orders.update','orders.status'),
    ('orders.update','orders.payment'), ('orders.update','orders.pricing'), ('orders.update','orders.delete'),
    ('routes.update','routes.plan'), ('routes.update','routes.approve'), ('routes.update','routes.pick'),
    ('routes.update','routes.start'), ('routes.update','routes.return'), ('routes.update','routes.close'),
    ('routes.update','routes.cancel'), ('routes.update','routes.settings'),
    ('inventory.update','inventory.catalog'), ('inventory.update','inventory.stock'),
    ('inventory.update','inventory.pricing'), ('inventory.update','inventory.pick'), ('inventory.update','inventory.delete'),
    ('drivers.update','drivers.assign'), ('drivers.update','drivers.delete'),
    ('reports.update','reports.settings'), ('reports.update','reports.expenses'),
    ('company.update','warehouses.manage'), ('company.update','integrations.manage')
), expanded_rows AS (
  SELECT id, json_group_array(permission) AS permissions_json
  FROM (
    SELECT users.id, CAST(current_permission.value AS TEXT) AS permission
    FROM users, json_each(CASE WHEN json_valid(users.permissions_json) THEN users.permissions_json ELSE '[]' END) AS current_permission
    UNION
    SELECT users.id, permission_map.expanded AS permission
    FROM users, json_each(CASE WHEN json_valid(users.permissions_json) THEN users.permissions_json ELSE '[]' END) AS current_permission
    JOIN permission_map ON permission_map.legacy = CAST(current_permission.value AS TEXT)
  )
  GROUP BY id
)
UPDATE users
SET permissions_json = COALESCE((SELECT expanded_rows.permissions_json FROM expanded_rows WHERE expanded_rows.id = users.id), '[]');

WITH permission_map(legacy, expanded) AS (
  VALUES
    ('orders.update','orders.create'), ('orders.update','orders.status'),
    ('orders.update','orders.payment'), ('orders.update','orders.pricing'), ('orders.update','orders.delete'),
    ('routes.update','routes.plan'), ('routes.update','routes.approve'), ('routes.update','routes.pick'),
    ('routes.update','routes.start'), ('routes.update','routes.return'), ('routes.update','routes.close'),
    ('routes.update','routes.cancel'), ('routes.update','routes.settings'),
    ('inventory.update','inventory.catalog'), ('inventory.update','inventory.stock'),
    ('inventory.update','inventory.pricing'), ('inventory.update','inventory.pick'), ('inventory.update','inventory.delete'),
    ('drivers.update','drivers.assign'), ('drivers.update','drivers.delete'),
    ('reports.update','reports.settings'), ('reports.update','reports.expenses'),
    ('company.update','warehouses.manage'), ('company.update','integrations.manage')
), expanded_rows AS (
  SELECT id, json_group_array(permission) AS permissions_json
  FROM (
    SELECT invitations.id, CAST(current_permission.value AS TEXT) AS permission
    FROM invitations, json_each(CASE WHEN json_valid(invitations.permissions_json) THEN invitations.permissions_json ELSE '[]' END) AS current_permission
    UNION
    SELECT invitations.id, permission_map.expanded AS permission
    FROM invitations, json_each(CASE WHEN json_valid(invitations.permissions_json) THEN invitations.permissions_json ELSE '[]' END) AS current_permission
    JOIN permission_map ON permission_map.legacy = CAST(current_permission.value AS TEXT)
  )
  GROUP BY id
)
UPDATE invitations
SET permissions_json = COALESCE((SELECT expanded_rows.permissions_json FROM expanded_rows WHERE expanded_rows.id = invitations.id), '[]');

INSERT OR REPLACE INTO schema_migrations(version, applied_at)
VALUES ('006-exact-permissions', datetime('now'));
