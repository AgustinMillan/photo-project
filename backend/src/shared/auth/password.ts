import { Algorithm, hash, hashSync, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

// Used when an email does not exist so login takes a similar amount of time
// whether the account exists or not. The value is not a real credential.
export const DUMMY_PASSWORD_HASH = hashSync("not-a-real-password", ARGON2_OPTIONS);
