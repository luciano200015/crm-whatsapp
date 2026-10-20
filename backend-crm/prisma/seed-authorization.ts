import type { PrismaClient } from '../src/generated/prisma/client';
import {
  PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLES,
} from '../src/modules/authorization/domain/permission-catalog';

export interface SeedAuthorizationResult {
  permissions: number;
  roles: number;
  grantsAdded: number;
  grantsRemoved: number;
  unknownPermissions: string[];
  /** System roles in the database that the catalog no longer defines. */
  retiredSystemRoles: string[];
}

/**
 * Idempotent: syncs permissions, system roles and their grants with the
 * catalog. Running it any number of times yields the same rows.
 */
export async function seedAuthorization(
  prisma: PrismaClient,
): Promise<SeedAuthorizationResult> {
  return prisma.$transaction(async (tx) => {
    const permissionIdByKey = new Map<string, string>();
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      const permission = await tx.permission.upsert({
        where: { key },
        create: { key, description },
        update: { description },
      });
      permissionIdByKey.set(key, permission.id);
    }

    // Permissions removed from the catalog are reported, not deleted:
    // custom roles may still reference them and removal needs a reviewed migration.
    const unknownPermissions = (
      await tx.permission.findMany({
        where: { key: { notIn: [...permissionIdByKey.keys()] } },
        select: { key: true },
      })
    ).map((permission) => permission.key);

    let grantsAdded = 0;
    let grantsRemoved = 0;

    for (const roleKey of SYSTEM_ROLE_KEYS) {
      const definition = SYSTEM_ROLES[roleKey];

      // System roles have workspaceId = null; a partial unique index on key
      // guarantees a single row per key, so upsert-by-lookup is safe.
      const existing = await tx.role.findFirst({
        where: { key: roleKey, workspaceId: null },
        select: { id: true },
      });
      const role = existing
        ? await tx.role.update({
            where: { id: existing.id },
            data: {
              name: definition.name,
              description: definition.description,
              isSystem: true,
            },
          })
        : await tx.role.create({
            data: {
              key: roleKey,
              name: definition.name,
              description: definition.description,
              isSystem: true,
            },
          });

      const wanted = new Set(
        definition.permissions.map((key) => {
          const id = permissionIdByKey.get(key);
          if (id === undefined) {
            throw new Error(`Role ${roleKey} grants unknown permission ${key}`);
          }
          return id;
        }),
      );

      const current = await tx.rolePermission.findMany({
        where: { roleId: role.id },
        select: { permissionId: true },
      });
      const currentIds = new Set(current.map((grant) => grant.permissionId));

      const toAdd = [...wanted].filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !wanted.has(id));

      if (toAdd.length > 0) {
        const { count } = await tx.rolePermission.createMany({
          data: toAdd.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
          skipDuplicates: true,
        });
        grantsAdded += count;
      }
      if (toRemove.length > 0) {
        const { count } = await tx.rolePermission.deleteMany({
          where: { roleId: role.id, permissionId: { in: toRemove } },
        });
        grantsRemoved += count;
      }
    }

    // Retiring a system role means moving its members first (see the
    // team_members_roles migration), so the seed only reports leftovers.
    const retiredSystemRoles = (
      await tx.role.findMany({
        where: { workspaceId: null, key: { notIn: [...SYSTEM_ROLE_KEYS] } },
        select: { key: true },
      })
    ).map((role) => role.key);

    return {
      permissions: permissionIdByKey.size,
      roles: SYSTEM_ROLE_KEYS.length,
      grantsAdded,
      grantsRemoved,
      unknownPermissions,
      retiredSystemRoles,
    };
  });
}
