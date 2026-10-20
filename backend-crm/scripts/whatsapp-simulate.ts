/**
 * Sends a signed "incoming WhatsApp message" to the local webhook, exactly as
 * Meta would. Lets you try the inbox without a real number or a tunnel.
 *
 *   npm run whatsapp:simulate -- --from +59171234567 --name "Lucía" --text "Hola"
 *   npm run whatsapp:simulate -- --line <lineId> --text "¿Tienen stock?"
 *
 * Without --line it uses the oldest enabled line. Reads .env (DATABASE_URL,
 * CHANNEL_SECRETS_KEY, APP_URL) and only talks to your local API.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '../src/generated/prisma/client';
import { signBody } from '../src/modules/channels/domain/webhook-signature';
import { textMessagePayload } from '../src/modules/channels/domain/whatsapp-payload';
import { SecretBox } from '../src/shared/security/secret-box';

config({ path: resolve(__dirname, '../.env'), quiet: true });

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      line: { type: 'string' },
      from: { type: 'string', default: '+59170000000' },
      name: { type: 'string', default: 'Cliente de prueba' },
      text: { type: 'string', default: 'Hola, quisiera más información 👋' },
      url: { type: 'string' },
    },
  });

  const databaseUrl = process.env.DATABASE_URL;
  const key = process.env.CHANNEL_SECRETS_KEY;
  if (!databaseUrl || !key) {
    throw new Error('DATABASE_URL and CHANNEL_SECRETS_KEY must be set in .env');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const line = await prisma.channelLine.findFirst({
      where: values.line
        ? { id: values.line }
        : { status: { not: 'DISABLED' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, phoneNumberId: true, appSecretEnc: true },
    });
    if (!line) {
      throw new Error('No line found: create one in Canales → Líneas first');
    }

    const appSecret = SecretBox.withKey(Buffer.from(key, 'base64')).decrypt(
      line.appSecretEnc,
    );
    const body = JSON.stringify(
      textMessagePayload({
        phoneNumberId: line.phoneNumberId,
        from: (values.from ?? '').replace(/\D/g, ''),
        profileName: values.name,
        text: values.text ?? '',
      }),
    );
    const base = (
      values.url ??
      process.env.APP_URL ??
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    const response = await fetch(
      `${base}/api/v1/webhooks/whatsapp/${line.id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signBody(body, appSecret),
        },
        body,
      },
    );
    console.log(
      `Line "${line.name}": webhook answered ${response.status} ${response.statusText}`,
    );
    if (!response.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
