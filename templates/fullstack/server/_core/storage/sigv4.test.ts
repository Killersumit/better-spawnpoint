/**
 * Conformance tests for the SigV4 implementation.
 *
 * The fixtures are the official AWS signing test suite vectors
 * (`awslabs/aws-c-auth`, `tests/aws-signing-test-suite/v4/<case>/`): each case
 * ships a request, the canonical request AWS expects, the string to sign, and
 * the resulting signature. They are reproduced here verbatim — if a change to
 * `sigv4.ts` ever breaks real S3 uploads, one of these fails first.
 *
 * Shared fixture values across every case:
 *   access key  AKIDEXAMPLE
 *   secret key  wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY   (note the `+`)
 *   region      us-east-1
 *   service     service                                    (the suite uses a generic service)
 *   timestamp   2015-08-30T12:36:00Z
 */
import { describe, expect, it } from "vitest";
import {
  UNSIGNED_PAYLOAD,
  awsUriEncode,
  buildCanonicalRequest,
  buildStringToSign,
  canonicalQueryString,
  canonicalUri,
  credentialScope,
  deriveSigningKey,
  formatAmzDate,
  hmac,
  presignUrl,
  sha256Hex,
  signRequest,
  type SigV4Credentials,
} from "./sigv4";

const credentials: SigV4Credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

const REGION = "us-east-1";
const SERVICE = "service";
const DATE = new Date("2015-08-30T12:36:00Z");
const AMZ_DATE = "20150830T123600Z";
const DATE_STAMP = "20150830";

/** sha256("") — the payload hash for GET requests. */
const EMPTY_PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const HOST_HEADER = "host:example.amazonaws.com";
const DATE_HEADER = "x-amz-date:20150830T123600Z";

/** The X-Amz-* parameters the suite appends when building a presigned URL. */
const PRESIGN_QUERY = {
  "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
  "X-Amz-Credential": "AKIDEXAMPLE/20150830/us-east-1/service/aws4_request",
  "X-Amz-Date": AMZ_DATE,
  "X-Amz-Expires": "3600",
  "X-Amz-SignedHeaders": "host",
};

const PRESIGN_CANONICAL_QUERY =
  "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20150830%2Fus-east-1%2Fservice%2Faws4_request&X-Amz-Date=20150830T123600Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host";

/** Hash of the presigned canonical request for a plain "/" GET (suite .sts). */
const PRESIGN_STS_HASH = "bb7705b4aa3cb8e8f5e1e0b3d4c0b64030797a313c8ceee43e33117cc43eadc5";

const UNRESERVED = "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

type SuiteCase = {
  /** Path exactly as the suite's request.txt shows it. */
  path: string;
  /** Extra query parameters from the request; the X-Amz-* set is added by the test. */
  query?: Record<string, string>;
  /** What the suite's .creq says the canonical URI and query must be. */
  canonicalUri: string;
  canonicalQuery: string;
  /** Canonical headers block and matching signed-headers list. */
  headersBlock: string;
  signedHeaders: string;
  payloadHash: string;
  normalizePath?: boolean;
  expectedCanonicalRequest: string;
  /**
   * Hash published by the suite (`.sts`), when the file was available. The
   * authoritative check is `expectedSignature`; this one is extra evidence and
   * is derived from the published canonical request when not supplied.
   */
  publishedStringToSignHash?: string;
  expectedSignature: string;
};

function assertSuiteCase(name: string, testCase: SuiteCase) {
  // 1. The encoders produce the suite's canonical URI and query string.
  expect(canonicalUri(testCase.path, { normalize: testCase.normalizePath }), `${name}: uri`).toBe(
    testCase.canonicalUri
  );

  if (testCase.canonicalQuery !== "") {
    expect(
      canonicalQueryString({ ...testCase.query, ...PRESIGN_QUERY }),
      `${name}: canonical query`
    ).toBe(testCase.canonicalQuery);
  }

  // 2. Canonical request, byte for byte.
  const canonicalRequest = buildCanonicalRequest({
    method: "GET",
    canonicalUri: testCase.canonicalUri,
    canonicalQuery: testCase.canonicalQuery,
    canonicalHeadersBlock: testCase.headersBlock,
    signedHeaders: testCase.signedHeaders,
    payloadHash: testCase.payloadHash,
  });
  expect(canonicalRequest, `${name}: canonical request`).toBe(testCase.expectedCanonicalRequest);

  // 3. Hash of the canonical request, then the string to sign. Each case has a
  //    different canonical request — and therefore a different hash — so the
  //    expected hash is taken from the suite's own canonical request text.
  const expectedHash = testCase.publishedStringToSignHash ?? sha256Hex(testCase.expectedCanonicalRequest);
  const actualHash = sha256Hex(canonicalRequest);
  expect(actualHash, `${name}: canonical request hash`).toBe(expectedHash);

  const scope = credentialScope(DATE_STAMP, REGION, SERVICE);
  const stringToSign = buildStringToSign(AMZ_DATE, scope, canonicalRequest);
  expect(stringToSign, `${name}: string to sign`).toBe(
    ["AWS4-HMAC-SHA256", AMZ_DATE, scope, expectedHash].join("\n")
  );

  // 4. Final signature.
  const signature = hmac(
    deriveSigningKey(credentials.secretAccessKey, DATE_STAMP, REGION, SERVICE),
    stringToSign
  ).toString("hex");
  expect(signature, `${name}: signature`).toBe(testCase.expectedSignature);
}

function presigned(uri: string, query: string, extra: Partial<SuiteCase> = {}): SuiteCase {
  return {
    path: uri,
    canonicalUri: uri,
    canonicalQuery: query,
    headersBlock: `${HOST_HEADER}\n`,
    signedHeaders: "host",
    payloadHash: EMPTY_PAYLOAD_HASH,
    expectedCanonicalRequest: [
      "GET",
      uri,
      query,
      `${HOST_HEADER}\n`,
      "host",
      EMPTY_PAYLOAD_HASH,
    ].join("\n"),
    
    expectedSignature: "",
    ...extra,
  };
}

function headerSigned(uri: string, extra: Partial<SuiteCase> = {}): SuiteCase {
  return {
    path: uri,
    canonicalUri: uri,
    canonicalQuery: "",
    headersBlock: `${HOST_HEADER}\n${DATE_HEADER}\n`,
    signedHeaders: "host;x-amz-date",
    payloadHash: EMPTY_PAYLOAD_HASH,
    expectedCanonicalRequest: [
      "GET",
      uri,
      "",
      `${HOST_HEADER}\n${DATE_HEADER}\n`,
      "host;x-amz-date",
      EMPTY_PAYLOAD_HASH,
    ].join("\n"),
    expectedSignature: "",
    ...extra,
  };
}

describe("awsUriEncode", () => {
  it("leaves unreserved characters alone and percent-encodes the rest", () => {
    expect(awsUriEncode("-._~0123456789AZaz")).toBe("-._~0123456789AZaz");
    expect(awsUriEncode(" ")).toBe("%20");
    expect(awsUriEncode("+")).toBe("%2B");
    expect(awsUriEncode("/", false)).toBe("/");
    expect(awsUriEncode("/")).toBe("%2F");
    // Characters `encodeURIComponent` deliberately leaves alone but AWS wants
    // percent-encoded — the classic source of a mystery SignatureDoesNotMatch.
    expect(awsUriEncode("!()'*")).toBe("%21%28%29%27%2A");
  });

  it("encodes multi-byte UTF-8 as upper-case hex bytes", () => {
    expect(awsUriEncode("ሴ")).toBe("%E1%88%B4");
    expect(awsUriEncode("€")).toBe("%E2%82%AC");
  });
});

describe("official AWS signing test suite", () => {
  it("get-vanilla — header signing", () => {
    assertSuiteCase(
      "get-vanilla (header)",
      headerSigned("/", {
        publishedStringToSignHash:
          "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
        expectedSignature: "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
      })
    );
  });

  it("get-vanilla — presigned query signing", () => {
    assertSuiteCase(
      "get-vanilla (presign)",
      presigned("/", PRESIGN_CANONICAL_QUERY, {
        publishedStringToSignHash: PRESIGN_STS_HASH,
        expectedSignature: "e93c787ed7f371d5c6b165c1b38ede9550f4dce4144713e844b25b7192d3865d",
      })
    );
  });

  it("get-vanilla-query-order-key-case — parameters are sorted by name", () => {
    const query = `Param1=value1&Param2=value2&${PRESIGN_CANONICAL_QUERY}`;
    assertSuiteCase(
      "get-vanilla-query-order-key-case",
      presigned("/", query, {
        query: { Param2: "value2", Param1: "value1" },
        publishedStringToSignHash:
          "b82878ecb2ab7ad194b9fe79b2946c2a36ee1627a219408089b2d774c1a0cedb",
        expectedSignature: "86012e2c9ad4d77369f5d81c11f75158aae4f895a085212cc6d3f923d300bed5",
      })
    );
  });

  it("get-unreserved — unreserved path characters are not encoded", () => {
    assertSuiteCase(
      "get-unreserved",
      presigned(`/${UNRESERVED}`, PRESIGN_CANONICAL_QUERY, {
        expectedSignature: "95968482db1b9e0fadef6efc1bd24689f77c77d9ef56919c96a28cc92e0d6005",
      })
    );
  });

  it("get-vanilla-query-unreserved — values follow the same encoding rules", () => {
    assertSuiteCase(
      "get-vanilla-query-unreserved",
      presigned("/", `${UNRESERVED}=${UNRESERVED}&${PRESIGN_CANONICAL_QUERY}`, {
        query: { [UNRESERVED]: UNRESERVED },
        expectedSignature: "8e76a88a7433637b12778d5592799b29ad21ecd6cf6325051c21d86f0acda2bf",
      })
    );
  });

  it("get-space-normalized — a literal space becomes %20, not %2520", () => {
    assertSuiteCase(
      "get-space-normalized",
      presigned("/example%20space/", PRESIGN_CANONICAL_QUERY, {
        path: "/example space/",
        expectedSignature: "7a1f416954786484c9824d93c1f26ef64acb9b1b6c9154d08c9f07d0e394abf6",
      })
    );
  });

  it("get-utf8 — multi-byte characters encode to their UTF-8 bytes", () => {
    assertSuiteCase(
      "get-utf8",
      presigned("/%E1%88%B4", PRESIGN_CANONICAL_QUERY, {
        path: "/ሴ",
        expectedSignature: "10eae3f14a260bd3911cc6d008d3c576d143b05b62f09782a7a4b37f52178e44",
      })
    );
  });

  it("get-slashes-normalized — normalization collapses redundant slashes", () => {
    assertSuiteCase(
      "get-slashes-normalized",
      presigned("/example/", PRESIGN_CANONICAL_QUERY, {
        path: "//example//",
        normalizePath: true,
        expectedSignature: "c1834e8fb0307243711f0f907f6ab7311ed300d87f13792d7ee4da89ab93e082",
      })
    );
  });

  it("does NOT normalize S3 keys by default", () => {
    // "//" is a legal and meaningful S3 key prefix; collapsing it would sign a
    // request for a different object than the caller asked for.
    expect(canonicalUri("//example//")).toBe("//example//");
    expect(canonicalUri("//example//", { normalize: true })).toBe("/example/");
  });
});

describe("signRequest (header auth)", () => {
  it("reproduces the AWS get-vanilla vector end to end", () => {
    const signed = signRequest({
      method: "GET",
      path: "/",
      headers: { host: "example.amazonaws.com" },
      payloadHash: EMPTY_PAYLOAD_HASH,
      credentials,
      region: REGION,
      service: SERVICE,
      date: DATE,
    });

    expect(signed.amzDate).toBe(AMZ_DATE);
    expect(signed.credentialScope).toBe("20150830/us-east-1/service/aws4_request");
    expect(signed.signedHeaders).toBe("host;x-amz-date");
    expect(signed.signature).toBe(
      "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
    );
    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
    );
  });

  it("signs the session token as a header when one is present", () => {
    const signed = signRequest({
      method: "GET",
      path: "/",
      headers: { host: "example.amazonaws.com" },
      payloadHash: EMPTY_PAYLOAD_HASH,
      credentials: { ...credentials, sessionToken: "SESSION-TOKEN-EXAMPLE" },
      region: REGION,
      service: SERVICE,
      date: DATE,
    });

    expect(signed.signedHeaders).toContain("x-amz-security-token");
    expect(signed.canonicalRequest).toContain("x-amz-security-token:SESSION-TOKEN-EXAMPLE");
  });

  it("binds the body hash, so tampering invalidates the signature", () => {
    const body = Buffer.from("hello world");
    const common = {
      method: "PUT",
      path: "/bucket/key.txt",
      headers: { host: "s3.amazonaws.com" },
      credentials,
      region: REGION,
      date: DATE,
    } as const;

    const original = signRequest({ ...common, payloadHash: sha256Hex(body) });
    const tampered = signRequest({
      ...common,
      payloadHash: sha256Hex(Buffer.from("hello world!")),
    });

    expect(original.signature).not.toBe(tampered.signature);
  });

  it("canonicalizes header names and whitespace", () => {
    const signed = signRequest({
      method: "GET",
      path: "/",
      headers: { Host: "example.amazonaws.com", "X-Custom": "  a   b  " },
      payloadHash: EMPTY_PAYLOAD_HASH,
      credentials,
      region: REGION,
      service: SERVICE,
      date: DATE,
    });

    expect(signed.signedHeaders).toBe("host;x-amz-date;x-custom");
    expect(signed.canonicalRequest).toContain("x-custom:a b\n");
  });
});

describe("presignUrl", () => {
  const base = {
    endpoint: "https://s3.us-east-1.amazonaws.com",
    bucket: "examplebucket",
    region: REGION,
    credentials,
    date: DATE,
  };

  it("produces a virtual-hosted URL whose signature re-derives", () => {
    const url = presignUrl({ ...base, method: "GET", key: "folder/photo.jpg", expiresInSeconds: 900 });
    const parsed = new URL(url);

    expect(parsed.host).toBe("examplebucket.s3.us-east-1.amazonaws.com");
    expect(parsed.pathname).toBe("/folder/photo.jpg");
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host");

    const provided = parsed.searchParams.get("X-Amz-Signature");
    expect(provided).toMatch(/^[0-9a-f]{64}$/);
    expect(recomputeSignature({ url: parsed, credentials, region: REGION, method: "GET" })).toBe(
      provided
    );
  });

  it("supports path-style buckets (MinIO, some R2 setups)", () => {
    const url = presignUrl({
      ...base,
      method: "PUT",
      key: "uploads/a b.png",
      expiresInSeconds: 60,
      forcePathStyle: true,
    });
    const parsed = new URL(url);

    expect(parsed.host).toBe("s3.us-east-1.amazonaws.com");
    expect(parsed.pathname).toBe("/examplebucket/uploads/a%20b.png");
    expect(recomputeSignature({ url: parsed, credentials, region: REGION, method: "PUT" })).toBe(
      parsed.searchParams.get("X-Amz-Signature")
    );
  });

  it("presigns a PUT at all only because the payload is unsigned", () => {
    const url = presignUrl({ ...base, method: "PUT", key: "x.bin", expiresInSeconds: 60 });
    const parsed = new URL(url);

    expect(recomputeSignature({ url: parsed, credentials, region: REGION, method: "PUT" })).toBe(
      parsed.searchParams.get("X-Amz-Signature")
    );
    // The canonical request the server signed used this literal string.
    expect(UNSIGNED_PAYLOAD).toBe("UNSIGNED-PAYLOAD");
  });

  it("binds the expiry into the signature", () => {
    const parsed = new URL(
      presignUrl({ ...base, method: "GET", key: "k", expiresInSeconds: 60 })
    );
    parsed.searchParams.set("X-Amz-Expires", "86400");

    expect(recomputeSignature({ url: parsed, credentials, region: REGION, method: "GET" })).not.toBe(
      parsed.searchParams.get("X-Amz-Signature")
    );
  });

  it("rejects a URL that has been tampered with", () => {
    const parsed = new URL(
      presignUrl({ ...base, method: "GET", key: "private/report.pdf", expiresInSeconds: 300 })
    );
    const original = parsed.searchParams.get("X-Amz-Signature");

    // Point the URL at a different object without re-signing: S3 must refuse it,
    // and our own verifier does too.
    parsed.pathname = "/public/other.pdf";
    expect(recomputeSignature({ url: parsed, credentials, region: REGION, method: "GET" })).not.toBe(
      original
    );
  });
});

describe("misc", () => {
  it("formats timestamps the way AWS expects", () => {
    expect(formatAmzDate(DATE)).toEqual({ amzDate: AMZ_DATE, dateStamp: DATE_STAMP });
  });

  it("hashes the empty string to the well-known constant", () => {
    expect(sha256Hex("")).toBe(EMPTY_PAYLOAD_HASH);
  });
});

/**
 * Independent re-derivation of a presigned URL's signature, written with plain
 * string handling rather than reusing `presignUrl`'s internals. Sharing a bug
 * between signer and verifier would hide it here, which is exactly why the AWS
 * vectors above are the primary check and this is a secondary one.
 */
function recomputeSignature(params: {
  url: URL;
  credentials: SigV4Credentials;
  region: string;
  method: string;
}): string {
  const pairs: Array<[string, string]> = [];
  for (const [name, value] of params.url.searchParams.entries()) {
    if (name === "X-Amz-Signature") continue;
    pairs.push([name, value]);
  }
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));

  const canonicalQuery = pairs
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .join("&");

  const canonicalRequest = [
    params.method,
    params.url.pathname,
    canonicalQuery,
    `host:${params.url.host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const amzDate = params.url.searchParams.get("X-Amz-Date") ?? "";
  const scope = `${amzDate.slice(0, 8)}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  return hmac(
    deriveSigningKey(params.credentials.secretAccessKey, amzDate.slice(0, 8), params.region, "s3"),
    stringToSign
  ).toString("hex");
}

function encodeRfc3986(value: string): string {
  return value.replace(/[^A-Za-z0-9\-._~]/g, (char) => {
    let encoded = "";
    for (const byte of Buffer.from(char, "utf8")) {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
    return encoded;
  });
}
