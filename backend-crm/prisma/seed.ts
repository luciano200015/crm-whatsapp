import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { Argon2PasswordHasher } from '../src/modules/auth/infrastructure/argon2-password-hasher';
import { seedAuthorization } from './seed-authorization';
import { seedBilling } from './seed-billing';
import { DEMO_USERS, seedDemoData } from './seed-demo';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const result = await seedAuthorization(prisma);
    console.log(
      `Seed complete: ${result.permissions} permissions, ${result.roles} system roles, ` +
        `${result.grantsAdded} grants added, ${result.grantsRemoved} grants removed.`,
    );
    if (result.unknownPermissions.length > 0) {
      console.warn(
        `Permissions in the database but not in the catalog (left untouched): ` +
          result.unknownPermissions.join(', '),
      );
    }
    const billing = await seedBilling(prisma);
    console.log(
      `Billing: ${billing.features} features, ${billing.plans} plans, ${billing.prices} prices, ` +
        `${billing.planFeatures} plan entitlements synced.`,
    );
    if (billing.retiredPlans.length > 0) {
      console.warn(
        `Retired plans (no longer in the catalog): ${billing.retiredPlans.join(', ')}`,
      );
    }
    await seedDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function seedDemo(prisma: PrismaClient): Promise<void> {
  if (process.env.SEED_DEMO_DATA !== 'true') {
    console.log('Demo data skipped (set SEED_DEMO_DATA=true to create it).');
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to create demo users with NODE_ENV=production');
  }
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) {
    throw new Error('SEED_DEMO_PASSWORD is required when SEED_DEMO_DATA=true');
  }

  const hasher = new Argon2PasswordHasher();
  const demo = await seedDemoData(prisma, {
    password,
    hashPassword: (value) => hasher.hash(value),
  });
  console.log(
    `Demo data: ${demo.usersCreated} users, ${demo.workspacesCreated} workspaces, ` +
      `${demo.membershipsCreated} memberships, ${demo.subscriptionsCreated} subscriptions created. ` +
      `Users: ${DEMO_USERS.map((user) => user.email).join(', ')} ` +
      '(password: SEED_DEMO_PASSWORD in your .env).',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
