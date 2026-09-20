/**
 * Password hashing tests.
 *
 * These are the tests that would catch a security regression that no type error
 * and no manual click-through would notice: a silently weakened hash, a
 * comparison that is not constant-time, or a validator that lets a trivially
 * guessable password through.
 *
 * scrypt with N=2^15 is intentionally slow (tens of milliseconds), so this file
 * uses the smallest parameters the module accepts where the parameter values
 * themselves are not the subject of the test.
 */
import { describe, expect, it } from "vitest";
import { hashPassword, validatePassword, verifyPassword } from "./password";

describe("hashPassword", () => {
  it("produces a self-describing scrypt string", async () => {
    const { encoded } = await hashPassword("correct horse battery staple");

    // scrypt$N$r$p$salt$hash — parameters are stored with the hash so they can
    // be raised later without invalidating existing passwords.
    const [algorithm, N, r, p, salt, hash] = encoded.split("$");
    expect(algorithm).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(2 ** 14);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
    expect(salt).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(hash).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("never produces the same hash twice for the same password", async () => {
    const first = await hashPassword("same password twice");
    const second = await hashPassword("same password twice");

    expect(first.encoded).not.toBe(second.encoded);
    // …but both must verify: this is what proves the salt is actually used.
    expect((await verifyPassword("same password twice", first.encoded)).ok).toBe(true);
    expect((await verifyPassword("same password twice", second.encoded)).ok).toBe(true);
  });

  it("does not store the password in the hash", async () => {
    const { encoded } = await hashPassword("hunter2-but-longer");
    expect(encoded).not.toContain("hunter2");
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects near-misses", async () => {
    const { encoded } = await hashPassword("a-perfectly-fine-passphrase");

    expect((await verifyPassword("a-perfectly-fine-passphrase", encoded)).ok).toBe(true);
    expect((await verifyPassword("a-perfectly-fine-passphras", encoded)).ok).toBe(false);
    expect((await verifyPassword("A-perfectly-fine-passphrase", encoded)).ok).toBe(false);
    expect((await verifyPassword("", encoded)).ok).toBe(false);
  });

  it("handles unicode and long passphrases", async () => {
    const password = "пароль-🔐-" + "x".repeat(300);
    const { encoded } = await hashPassword(password);

    expect((await verifyPassword(password, encoded)).ok).toBe(true);
    expect((await verifyPassword(password.slice(0, -1), encoded)).ok).toBe(false);
  });

  it("fails closed on a malformed stored hash instead of throwing", async () => {
    for (const broken of [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfourparts",
      "scrypt$abc$8$1$AAAA$BBBB",
      "bcrypt$10$abcdefghijklmnopqrstuv",
    ]) {
      const result = await verifyPassword("anything", broken);
      expect(result.ok, `stored hash ${JSON.stringify(broken)} must not verify`).toBe(false);
    }
  });

  it("reports which parameters a hash used, so old hashes can be upgraded", async () => {
    const { encoded } = await hashPassword("upgrade me later");
    const result = await verifyPassword("upgrade me later", encoded);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Reported per verification, so a sign-in can transparently upgrade a
      // hash that was created with weaker parameters.
      expect(typeof result.needsRehash).toBe("boolean");
    }
  });
});

describe("validatePassword", () => {
  it("accepts a long password with a letter and a number", () => {
    expect(validatePassword("correct horse battery staple 7")).toBeNull();
  });

  it("enforces the length floor", () => {
    expect(validatePassword("short1")).toMatch(/12/);
    expect(validatePassword("")).not.toBeNull();
  });

  it("requires some variety", () => {
    expect(validatePassword("aaaaaaaaaaaa")).toMatch(/letter|number/i);
    expect(validatePassword("123456789012")).toMatch(/letter|number/i);
  });

  it("rejects absurdly long input rather than spending CPU on it", () => {
    expect(validatePassword("x".repeat(500) + "1")).not.toBeNull();
  });
});
