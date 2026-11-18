import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 8;

// @node-rs/argon2 defaults to argon2id with OWASP-recommended cost settings.
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    // A malformed stored hash is treated as a failed match, never as a crash.
    return false;
  }
}
