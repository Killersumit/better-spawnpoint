/**
 * Storage driver tests.
 *
 * These run against the local driver in a temporary directory: no S3 account, no
 * network, no credentials. The S3 driver is exercised through its signing layer
 * (`sigv4.test.ts` proves the URLs are correct); what is worth testing here is
 * the part that protects the filesystem — key generation and key validation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let storageModule: typeof import("./index");
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "spawnpoint-storage-"));
  process.env.STORAGE_LOCAL_DIR = tempDir;
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_MAX_UPLOAD_BYTES = "2048";
  storageModule = await import("./index");
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("assertSafeKey", () => {
  it("accepts ordinary keys", () => {
    for (const key of [
      "uploads/2026/09/abc.png",
      "uploads/file-with-dashes_and.dots.jpg",
      "a/b/c/deep/path.bin",
    ]) {
      expect(() => storageModule.assertSafeKey(key)).not.toThrow();
    }
  });

  it("rejects traversal, absolute paths, and control characters", () => {
    const rejected = [
      "../etc/passwd",
      "uploads/../../etc/passwd",
      "/etc/passwd",
      "uploads/",
      "",
      "uploads\\windows\\path",
      "uploads/\u0000evil",
      "uploads/file with space.png",
      "uploads/file;rm -rf.png",
      "a".repeat(600),
    ];

    for (const key of rejected) {
      expect(() => storageModule.assertSafeKey(key), `should reject ${JSON.stringify(key)}`).toThrow();
    }
  });
});

describe("buildObjectKey", () => {
  it("produces a dated, random, extension-preserving key", () => {
    const key = storageModule.buildObjectKey("avatars", "My Photo.JPG");

    expect(key).toMatch(/^avatars\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(() => storageModule.assertSafeKey(key)).not.toThrow();
  });

  it("never lets the original name influence the directory", () => {
    const key = storageModule.buildObjectKey("uploads", "../../../etc/passwd");
    expect(key).not.toContain("..");
    expect(key.startsWith("uploads/")).toBe(true);
  });

  it("generates a different key every time", () => {
    const keys = new Set(Array.from({ length: 50 }, () => storageModule.buildObjectKey("uploads", "a.png")));
    expect(keys.size).toBe(50);
  });

  it("strips unsafe prefix characters", () => {
    const key = storageModule.buildObjectKey("../../etc", "x.png");
    expect(() => storageModule.assertSafeKey(key)).not.toThrow();
    expect(key).not.toContain("..");
  });
});

describe("assertUploadAllowed", () => {
  it("accepts a normal image", () => {
    expect(() => storageModule.assertUploadAllowed("image/png", 1024)).not.toThrow();
    expect(() => storageModule.assertUploadAllowed("text/csv; charset=utf-8", 10)).not.toThrow();
  });

  it("enforces the configured size limit", () => {
    expect(() => storageModule.assertUploadAllowed("image/png", 4096)).toThrow(/smaller|large/i);
    expect(() => storageModule.assertUploadAllowed("image/png", 0)).toThrow(/empty/i);
  });

  it("refuses types that can execute script in the app's origin", () => {
    expect(() => storageModule.assertUploadAllowed("text/html", 10)).toThrow();
    expect(() => storageModule.assertUploadAllowed("image/svg+xml", 10)).toThrow();
    expect(() => storageModule.assertUploadAllowed("application/javascript", 10)).toThrow();
  });
});

describe("local driver round trip", () => {
  it("stores, reads back, and deletes an object", async () => {
    const driver = storageModule.storage();
    expect(driver.name).toBe("local");

    const body = Buffer.from("hello, policy pages");
    const stored = await driver.putObject(body, {
      contentType: "text/plain",
      prefix: "docs",
      originalName: "note.txt",
    });

    expect(stored.size).toBe(body.byteLength);
    expect(stored.key.endsWith(".txt")).toBe(true);

    const read = await driver.getObject(stored.key);
    expect(read).not.toBeNull();
    expect(read!.data.toString("utf8")).toBe("hello, policy pages");

    await driver.deleteObject(stored.key);
    expect(await driver.getObject(stored.key)).toBeNull();
  });

  it("returns null rather than throwing for a key that does not exist", async () => {
    const driver = storageModule.storage();
    expect(await driver.getObject("uploads/2026/09/does-not-exist.png")).toBeNull();
  });

  it("infers a content type from the extension", async () => {
    const driver = storageModule.storage();
    const stored = await driver.putObject(Buffer.from([0x89, 0x50]), {
      contentType: "image/png",
      prefix: "images",
      originalName: "logo.png",
    });

    const read = await driver.getObject(stored.key);
    expect(read!.contentType).toBe("image/png");
  });

  it("has no presigned URLs — the app's own route serves the bytes", async () => {
    const driver = storageModule.storage();
    expect(driver.presignGet("uploads/a.png", 60)).toBeNull();
    expect(driver.presignPut("uploads/a.png", "image/png", 60)).toBeNull();
  });
});
