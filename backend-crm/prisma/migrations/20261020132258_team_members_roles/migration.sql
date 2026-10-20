-- AlterTable
ALTER TABLE "user_credentials" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- Role scope: workspace_id decides (NULL = system role, set = custom role of
-- that workspace) and is_system can never contradict it.
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_system_scope_check" CHECK ("is_system" = ("workspace_id" IS NULL));

-- Retire the VIEWER system role without removing anyone's access: every
-- workspace that uses it gets an equivalent custom role "viewer" (same
-- permissions), its memberships and invitations move to it, and only then is
-- the system role deleted.
INSERT INTO "roles" ("id", "key", "name", "description", "workspace_id", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), 'viewer', 'Solo lectura', 'Read-only access to workspace data', used."workspace_id", false, now(), now()
FROM (
  SELECT m."workspace_id"
  FROM "membership_roles" mr
  JOIN "workspace_memberships" m ON m."id" = mr."membership_id"
  JOIN "roles" v ON v."id" = mr."role_id" AND v."key" = 'VIEWER' AND v."workspace_id" IS NULL
  UNION
  SELECT i."workspace_id"
  FROM "workspace_invitations" i
  JOIN "roles" v ON v."id" = i."role_id" AND v."key" = 'VIEWER' AND v."workspace_id" IS NULL
) AS used
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", rp."permission_id", now()
FROM "roles" r
JOIN "roles" v ON v."key" = 'VIEWER' AND v."workspace_id" IS NULL
JOIN "role_permissions" rp ON rp."role_id" = v."id"
WHERE r."key" = 'viewer' AND r."workspace_id" IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE "membership_roles" mr
SET "role_id" = r."id"
FROM "workspace_memberships" m, "roles" r, "roles" v
WHERE mr."membership_id" = m."id"
  AND mr."role_id" = v."id" AND v."key" = 'VIEWER' AND v."workspace_id" IS NULL
  AND r."workspace_id" = m."workspace_id" AND r."key" = 'viewer';

UPDATE "workspace_invitations" i
SET "role_id" = r."id"
FROM "roles" r, "roles" v
WHERE i."role_id" = v."id" AND v."key" = 'VIEWER' AND v."workspace_id" IS NULL
  AND r."workspace_id" = i."workspace_id" AND r."key" = 'viewer';

-- Fails (ON DELETE RESTRICT) if anything still references it, so no access is lost silently.
DELETE FROM "roles" WHERE "key" = 'VIEWER' AND "workspace_id" IS NULL;
