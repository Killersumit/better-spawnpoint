/**
 * Password hashing with scrypt (Node built-in, no native dependency).
 *
 * Why scrypt and not bcrypt/argon2:
 *  • bcrypt truncates at 72 bytes and is not memory-hard.
 *  • argon2id is the OWASP first choice, but every JS implementation needs a
 *    native toolchain, which breaks `npm install` on minimal hosts.
 *  • scrypt is memory-hard, in Node's standard library, and OWASP-approved.
 *
 * Parameters: N=2^15 (32 MiB), r=8, p=1 — a deliberate middle ground for
 * containers with <=512 MiB RAM. Fields are stored in the hash string, so
 * raising PASSWORD_HASH_N later transparently upgrades hashes on next sign-in
 * (`verifyPassword` reports `needsRehash`). OWASP's table for reference:
 * N=2^17/r=8/p=1 (~128 MiB, strongest), N=2^16/r=8/p=2, N=2^15/r=8/p=3.
 *
 * Stored format:  scrypt$N$r$p$<salt-b64>$<derived-key-b64>
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const DEFAULT_N = 2 ** 15;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

/** `maxmem` must exceed ~128 * N * r bytes; add headroom for the salt copies. */
function maxmemFor(N: number, r: number): number {
  return Math.max(64 * 1024 * 1024, 256 * N * r);
}

function resolveN(): number {
  const raw = process.env.PASSWORD_HASH_N;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isInteger(parsed) && parsed >= 2 ** 14 && parsed <= 2 ** 20) {
    return parsed;
  }
  return DEFAULT_N;
}

export type PasswordHash = {
  /** Full encoded hash, safe to store in the database. */
  encoded: string;
};

export async function hashPassword(password: string): Promise<PasswordHash> {
  const N = resolveN();
  const r = DEFAULT_R;
  const p = DEFAULT_P;
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });
  return {
    encoded: ["scrypt", N, r, p, salt.toString("base64"), derived.toString("base64")].join(
      "$"
    ),
  };
}

export type VerifyResult =
  | { ok: true; needsRehash: boolean }
  | { ok: false };

/**
 * Constant-time verification.
 *
 * Returns `{ ok: false }` — never throws — for malformed hashes, so a corrupt
 * row cannot be distinguished from a wrong password by timing or by error type.
 */
export async function verifyPassword(
  password: string,
  encoded: string | null | undefined
): Promise<VerifyResult> {
  if (!encoded) return { ok: false };

  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return { ok: false };

  const N = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return { ok: false };
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64");
    expected = Buffer.from(parts[5] ?? "", "base64");
  } catch {
    return { ok: false };
  }
  if (salt.length === 0 || expected.length === 0) return { ok: false };

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });
  } catch {
    return { ok: false };
  }

  if (derived.length !== expected.length) return { ok: false };
  const ok = timingSafeEqual(derived, expected);
  if (!ok) return { ok: false };

  return { ok: true, needsRehash: N < resolveN() || r < DEFAULT_R || p < DEFAULT_P };
}

/**
 * Password policy. Length beats character classes (NIST SP 800-63B §5.1.1.2):
 * we require >= 12 characters, reject the obvious offenders, and never force
 * symbol rotation.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

const WEAK_PATTERNS = [
  /^password/i,
  /^letmein/i,
  /^qwerty/i,
  /^123456/,
  /^admin/i,
  /^welcome/i,
];

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  if (WEAK_PATTERNS.some((re) => re.test(password))) {
    return "That password is too common. Please choose another.";
  }
  return null;
}
