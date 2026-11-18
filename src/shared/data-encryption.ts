import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for sensitive fields such as bank account numbers.
// Stored as "v1:<iv>:<auth tag>:<ciphertext>", all base64.
const FORMAT_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

function encryptionKey(): Buffer {
  const encoded = process.env.DATA_ENCRYPTION_KEY;
  if (!encoded) throw new Error('DATA_ENCRYPTION_KEY is missing. Add a random 32-byte base64 key to .env.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES) throw new Error('DATA_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return key;
}

export function encryptText(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [FORMAT_VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptText(sealed: string): string {
  const [version, iv, tag, ciphertext] = sealed.split(':');
  if (version !== FORMAT_VERSION || !iv || !tag || !ciphertext) throw new Error('Encrypted value has an unknown format.');
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
