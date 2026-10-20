import type {
  MembershipStatus,
  PrismaClient,
} from '../src/generated/prisma/client';
import type {
  PermissionKey,
  SystemRoleKey,
} from '../src/modules/authorization/domain/permission-catalog';
import { passwordPolicyViolations } from '../src/modules/auth/domain/password-policy';

/**
 * Development-only demo data: a "super user" that owns several workspaces and
 * a few users with other roles. Never runs in production (see seed.ts).
 */
export const DEMO_WORKSPACES = [
  { slug: 'acme', name: 'Acme Corp' },
  { slug: 'globex', name: 'Globex Industries' },
  { slug: 'initech', name: 'Initech' },
] as const;

type DemoSlug = (typeof DEMO_WORKSPACES)[number]['slug'];

/**
 * Custom roles (roles.workspace_id set). Only Acme: its plan (Empresa)
 * includes custom roles, Globex's (Equipo) does not.
 */
export const DEMO_CUSTOM_ROLES = [
  {
    workspace: 'acme',
    key: 'viewer',
    name: 'Solo lectura',
    description:
      'Puede ver el espacio de trabajo, el equipo, contactos y conversaciones.',
    permissions: [
      'workspace.read',
      'members.read',
      'contacts.read',
      'messages.read',
    ],
  },
  {
    workspace: 'acme',
    key: 'supervisor',
    name: 'Supervisor',
    description: 'Atiende conversaciones y supervisa al equipo y sus roles.',
    permissions: [
      'workspace.read',
      'members.read',
      'roles.read',
      'contacts.read',
      'contacts.write',
      'messages.read',
      'messages.send',
    ],
  },
] as const satisfies readonly {
  workspace: DemoSlug;
  key: string;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}[];

type DemoCustomRoleKey = (typeof DEMO_CUSTOM_ROLES)[number]['key'];

interface DemoMembership {
  workspace: DemoSlug;
  role: SystemRoleKey | DemoCustomRoleKey;
  status?: MembershipStatus;
}

export const DEMO_USERS: readonly {
  email: string;
  displayName: string;
  memberships: readonly DemoMembership[];
}[] = [
  {
    email: 'superadmin@example.com',
    displayName: 'Super Admin',
    memberships: [
      { workspace: 'acme', role: 'OWNER' },
      { workspace: 'globex', role: 'OWNER' },
      { workspace: 'initech', role: 'OWNER' },
    ],
  },
  {
    email: 'admin@example.com',
    displayName: 'Ada Admin',
    memberships: [{ workspace: 'acme', role: 'ADMIN' }],
  },
  {
    email: 'agent@example.com',
    displayName: 'Andrés Agente',
    memberships: [
      { workspace: 'acme', role: 'AGENT' },
      { workspace: 'globex', role: 'AGENT' },
    ],
  },
  {
    email: 'viewer@example.com',
    displayName: 'Vera Viewer',
    memberships: [
      { workspace: 'acme', role: 'viewer' },
      { workspace: 'globex', role: 'AGENT', status: 'DEACTIVATED' },
    ],
  },
];

export interface SeedDemoOptions {
  password: string;
  hashPassword: (password: string) => Promise<string>;
  now?: Date;
}

export interface SeedDemoResult {
  usersCreated: number;
  workspacesCreated: number;
  customRolesCreated: number;
  membershipsCreated: number;
  subscriptionsCreated: number;
}

/**
 * Idempotent: users are matched by email, workspaces by slug and memberships
 * by (workspace, user). Existing passwords are never overwritten, so a demo
 * user who changed their password keeps it.
 */
export async function seedDemoData(
  prisma: PrismaClient,
  options: SeedDemoOptions,
): Promise<SeedDemoResult> {
  const violations = passwordPolicyViolations(options.password);
  if (violations.length > 0) {
    throw new Error(`SEED_DEMO_PASSWORD is invalid: ${violations.join('; ')}`);
  }
  const now = options.now ?? new Date();
  // Hash once outside the transaction: Argon2 is deliberately slow.
  const passwordHash = await options.hashPassword(options.password);

  return prisma.$transaction(
    async (tx) => {
      const result: SeedDemoResult = {
        usersCreated: 0,
        workspacesCreated: 0,
        customRolesCreated: 0,
        membershipsCreated: 0,
        subscriptionsCreated: 0,
      };

      const roles = await tx.role.findMany({
        where: { workspaceId: null, isSystem: true },
        select: { id: true, key: true },
      });
      const systemRoleId = (key: string): string | undefined =>
        roles.find((r) => r.key === key)?.id;

      const userIds = new Map<string, string>();
      for (const demo of DEMO_USERS) {
        const existing = await tx.user.findUnique({
          where: { email: demo.email },
          select: { id: true },
        });
        if (existing) {
          userIds.set(demo.email, existing.id);
          continue;
        }
        const user = await tx.user.create({
          data: {
            email: demo.email,
            displayName: demo.displayName,
            status: 'ACTIVE',
            emailVerifiedAt: now,
            credential: { create: { passwordHash } },
          },
          select: { id: true },
        });
        userIds.set(demo.email, user.id);
        result.usersCreated++;
      }

      const owner = userIds.get(DEMO_USERS[0]?.email ?? '');
      const workspaceIds = new Map<DemoSlug, string>();
      for (const workspace of DEMO_WORKSPACES) {
        const existing = await tx.workspace.findUnique({
          where: { slug: workspace.slug },
          select: { id: true },
        });
        if (existing) {
          workspaceIds.set(workspace.slug, existing.id);
          continue;
        }
        const created = await tx.workspace.create({
          data: { ...workspace, createdById: owner ?? null },
          select: { id: true },
        });
        workspaceIds.set(workspace.slug, created.id);
        result.workspacesCreated++;
      }

      // Custom roles: created with their permissions once; later edits made
      // from the app are kept.
      const customRoleIds = new Map<string, string>();
      for (const custom of DEMO_CUSTOM_ROLES) {
        const workspaceId = workspaceIds.get(custom.workspace);
        if (!workspaceId) continue;
        const existing = await tx.role.findFirst({
          where: { workspaceId, key: custom.key },
          select: { id: true },
        });
        if (existing) {
          customRoleIds.set(`${custom.workspace}:${custom.key}`, existing.id);
          continue;
        }
        const permissions = await tx.permission.findMany({
          where: { key: { in: [...custom.permissions] } },
          select: { id: true },
        });
        const created = await tx.role.create({
          data: {
            workspaceId,
            key: custom.key,
            name: custom.name,
            description: custom.description,
            isSystem: false,
            permissions: {
              create: permissions.map(({ id }) => ({ permissionId: id })),
            },
          },
          select: { id: true },
        });
        customRoleIds.set(`${custom.workspace}:${custom.key}`, created.id);
        result.customRolesCreated++;
      }
      const roleId = (workspace: DemoSlug, key: string): string => {
        const id =
          systemRoleId(key) ?? customRoleIds.get(`${workspace}:${key}`);
        if (!id) throw new Error(`Role ${key} missing: seed roles first`);
        return id;
      };

      for (const demo of DEMO_USERS) {
        const userId = userIds.get(demo.email);
        if (!userId) continue;
        for (const membership of demo.memberships) {
          const workspaceId = workspaceIds.get(membership.workspace);
          if (!workspaceId) continue;

          const existing = await tx.workspaceMembership.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } },
            select: { id: true },
          });
          if (existing) continue;

          const status = membership.status ?? 'ACTIVE';
          await tx.workspaceMembership.create({
            data: {
              workspaceId,
              userId,
              status,
              deactivatedAt: status === 'DEACTIVATED' ? now : null,
              invitedById: userId === owner ? null : (owner ?? null),
              roles: {
                create: {
                  roleId: roleId(membership.workspace, membership.role),
                },
              },
            },
          });
          result.membershipsCreated++;
        }
      }
      result.subscriptionsCreated = await seedDemoSubscriptions(tx, now);
      return result;
    },
    { timeout: 30_000 },
  );
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const DAY = 86_400_000;

/**
 * One workspace per subscription state, so every screen can be tried:
 * - acme: Empresa, yearly, paid and active.
 * - globex: Equipo, monthly, in a 7-day trial.
 * - initech: Corporativo, monthly, trial already expired (needs a payment).
 * Any other workspace without a plan (e.g. created before plans existed)
 * gets the default trial. Existing subscriptions are never touched.
 */
export const DEMO_SUBSCRIPTIONS: Record<
  DemoSlug,
  {
    plan: string;
    interval: 'MONTH' | 'YEAR';
    state: 'active' | 'trial' | 'expired';
  }
> = {
  acme: { plan: 'business', interval: 'YEAR', state: 'active' },
  globex: { plan: 'team', interval: 'MONTH', state: 'trial' },
  initech: { plan: 'corporate', interval: 'MONTH', state: 'expired' },
};

async function seedDemoSubscriptions(tx: Tx, now: Date): Promise<number> {
  const workspaces = await tx.workspace.findMany({
    where: { subscription: null },
    select: { id: true, slug: true },
  });
  let created = 0;
  for (const workspace of workspaces) {
    const spec =
      DEMO_SUBSCRIPTIONS[workspace.slug as DemoSlug] ??
      ({ plan: 'team', interval: 'MONTH', state: 'trial' } as const);
    const price = await tx.planPrice.findFirst({
      where: {
        plan: { code: spec.plan },
        interval: spec.interval,
        currency: 'USD',
      },
      select: { id: true, planId: true, amountCents: true, currency: true },
    });
    if (!price) {
      throw new Error(`Plan ${spec.plan} missing: run the billing seed first`);
    }

    const base = {
      workspaceId: workspace.id,
      planId: price.planId,
      priceId: price.id,
      interval: spec.interval,
      amountCents: price.amountCents,
      currency: price.currency,
    };
    if (spec.state === 'active') {
      const end = new Date(now);
      end.setUTCFullYear(
        end.getUTCFullYear() + (spec.interval === 'YEAR' ? 1 : 0),
      );
      if (spec.interval === 'MONTH') end.setUTCMonth(end.getUTCMonth() + 1);
      await tx.subscription.create({
        data: {
          ...base,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: end,
          provider: 'simulated',
          providerReference: 'demo-seed',
        },
      });
    } else if (spec.state === 'trial') {
      await tx.subscription.create({
        data: {
          ...base,
          status: 'TRIALING',
          trialStartedAt: now,
          trialEndsAt: new Date(now.getTime() + 7 * DAY),
        },
      });
    } else {
      await tx.subscription.create({
        data: {
          ...base,
          status: 'EXPIRED',
          trialStartedAt: new Date(now.getTime() - 10 * DAY),
          trialEndsAt: new Date(now.getTime() - 3 * DAY),
        },
      });
    }
    created++;
  }
  return created;
}
