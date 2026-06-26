// Argon2id password hashing. @node-rs/argon2's default algorithm is Argon2id,
// and verify() is cross-compatible with any argon2id hash (e.g. the seed's).
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

export function hash(password: string): Promise<string> {
  return argonHash(password);
}

export async function verify(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(passwordHash, password);
  } catch {
    // Malformed/garbage hash -> treat as a failed verification, not a 500.
    return false;
  }
}
