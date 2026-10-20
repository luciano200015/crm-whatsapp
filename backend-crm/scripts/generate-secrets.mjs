// Prints fresh token secrets as .env lines. Usage: npm run secrets:generate
// Paste the output into .env (and a different run into .env.test).
// Never reuse development secrets in production.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256', // ES256
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const b64 = (pem) => Buffer.from(pem, 'utf8').toString('base64');

process.stdout.write(
  [
    `JWT_PRIVATE_KEY=${b64(privateKey)}`,
    `JWT_PUBLIC_KEY=${b64(publicKey)}`,
    `TOKEN_HASH_SECRET=${randomBytes(48).toString('base64url')}`,
    '',
  ].join('\n'),
);
