/**
 * Opaque token minting/hashing.
 *
 * Rule: the plaintext token is returned to the caller exactly once (it goes in
 * a cookie or an email link). Only `sha256(token)` is ever persisted, so a
 * database leak does not hand an attacker usable sessions or reset links.
 * Plain SHA-256 (not scrypt) is correct here: the input is 256 bits of entropy,
 * so there is nothing to brute-force — unlike a human password.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, storedHash: string): boolean {
  const computed = Buffer.from(hashToken(token), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/** Short, human-typeable code (invites, 2FA fallback). Ambiguous chars removed. */
export function generateNumericCode(digits = 6): string {
  const alphabet = "23456789";
  let out = "";
  const bytes = randomBytes(digits);
  for (let i = 0; i < digits; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Constant-time string compare for non-token secrets (webhook signatures). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
