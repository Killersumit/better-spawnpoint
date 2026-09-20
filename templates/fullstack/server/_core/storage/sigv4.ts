/**
 * AWS Signature Version 4 — implemented here rather than pulled from
 * `@aws-sdk/client-s3`, which is ~10 MB of dependency (and its own transitive
 * tree) for the four functions this template actually needs: sign a request,
 * presign a GET, presign a PUT, and hash a payload.
 *
 * Correctness is not taken on faith. Every primitive in this file is asserted
 * against the official AWS signing test suite (`awslabs/aws-c-auth`,
 * `tests/aws-signing-test-suite/v4/*`) in `sigv4.test.ts` — canonical request,
 * string-to-sign, and final signature for header signing as well as presigned
 * (query) signing, including the awkward cases: pre-encoded characters, literal
 * spaces, multi-byte UTF-8, unreserved characters, and query parameters that
 * arrive unsorted.
 *
 * The rules, in the order the algorithm applies them:
 *  1. Canonical URI — each path segment URI-encoded ONCE (S3 keys are literal;
 *     they are not normalized or double-encoded).
 *  2. Canonical query — each name and value URI-encoded, sorted by name then
 *     value, joined with `&`. A parameter with no value keeps its `=`.
 *  3. Canonical headers — lower-cased names, trimmed and space-collapsed values,
 *     sorted by name, each followed by `\n`, then a blank line.
 *  4. Signed headers — the names from step 3, lower-cased, `;`-joined.
 *  5. Payload hash — hex SHA-256 of the body, or the literal string
 *     `UNSIGNED-PAYLOAD` for presigned URLs where the signer never sees the body.
 *  6. String to sign — algorithm, timestamp, credential scope, hash of step 1-5.
 *  7. Signing key — HMAC chain: kDate → kRegion → kService → kSigning.
 */
import { createHash, createHmac } from "node:crypto";

export type SigV4Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type SignedRequest = {
  signature: string;
  canonicalRequest: string;
  stringToSign: string;
  credentialScope: string;
  amzDate: string;
  signedHeaders: string;
  /** Ready-to-send `Authorization` header value. */
  authorization: string;
};

export const ALGORITHM = "AWS4-HMAC-SHA256";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * RFC 3986 encoding as AWS defines it: unreserved characters (A-Z a-z 0-9 - . _
 * ~) are left alone, everything else becomes upper-case %XX of its UTF-8 bytes.
 * `encodeURIComponent` is close but leaves `!*'()` untouched, which AWS expects
 * encoded — hence the explicit table.
 */
export function awsUriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
      continue;
    }
    if (char === "/" && !encodeSlash) {
      out += char;
      continue;
    }
    for (const byte of Buffer.from(char, "utf8")) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * Canonical URI. S3 keys are literal, so segments are encoded exactly once and
 * never normalized by default. `normalize` (RFC 3986 dot-segment removal and
 * redundant-slash collapsing) exists for the generic SigV4 case and is what the
 * test suite's `*-normalized` cases exercise.
 */
export function canonicalUri(path: string, options: { normalize?: boolean } = {}): string {
  let input = path.startsWith("/") ? path : `/${path}`;

  if (options.normalize) {
    input = input.replace(/\/{2,}/g, "/");
    const segments: string[] = [];
    for (const segment of input.split("/")) {
      if (segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    input = segments.join("/");
    if (!input.startsWith("/")) input = `/${input}`;
  }

  // Encode per segment so the separators survive untouched.
  return input.split("/").map((segment) => awsUriEncode(segment, false)).join("/");
}

/** Canonical query string: encoded, then sorted by name then value. */
export function canonicalQueryString(
  params: Record<string, string | number | undefined> | URLSearchParams
): string {
  const pairs: Array<[string, string]> = [];

  if (params instanceof URLSearchParams) {
    for (const [name, value] of params.entries()) pairs.push([name, value]);
  } else {
    for (const [name, value] of Object.entries(params)) {
      if (value === undefined) continue;
      pairs.push([name, String(value)]);
    }
  }

  return pairs
    .map(([name, value]) => [awsUriEncode(name), awsUriEncode(value)] as [string, string])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

/** Lower-case, trim, collapse internal whitespace runs, sort — AWS's rules. */
export function canonicalHeaders(headers: Record<string, string>): {
  block: string;
  signedHeaders: string;
} {
  const normalized = Object.entries(headers)
    .map(([name, value]) => [
      name.trim().toLowerCase(),
      value.trim().replace(/\s+/g, " "),
    ] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return {
    block: normalized.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders: normalized.map(([name]) => name).join(";"),
  };
}

export function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function credentialScope(dateStamp: string, region: string, service: string): string {
  return `${dateStamp}/${region}/${service}/aws4_request`;
}

/** kDate → kRegion → kService → kSigning. */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export function buildCanonicalRequest(params: {
  method: string;
  canonicalUri: string;
  canonicalQuery: string;
  canonicalHeadersBlock: string;
  signedHeaders: string;
  payloadHash: string;
}): string {
  return [
    params.method.toUpperCase(),
    params.canonicalUri,
    params.canonicalQuery,
    params.canonicalHeadersBlock,
    params.signedHeaders,
    params.payloadHash,
  ].join("\n");
}

export function buildStringToSign(
  amzDate: string,
  scope: string,
  canonicalRequest: string
): string {
  return [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
}

/**
 * Sign a request with header authentication.
 *
 * `headers` must include `host`; `x-amz-date` is added here. The body is hashed
 * unless you pass `UNSIGNED_PAYLOAD`.
 */
export function signRequest(params: {
  method: string;
  path: string;
  query?: Record<string, string | number | undefined> | URLSearchParams;
  headers: Record<string, string>;
  payloadHash: string;
  credentials: SigV4Credentials;
  region: string;
  service?: string;
  date?: Date;
  normalizePath?: boolean;
}): SignedRequest {
  const service = params.service ?? "s3";
  const date = params.date ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(date);
  const scope = credentialScope(dateStamp, params.region, service);

  const headers: Record<string, string> = { ...params.headers, "x-amz-date": amzDate };
  if (params.credentials.sessionToken) {
    headers["x-amz-security-token"] = params.credentials.sessionToken;
  }

  const { block, signedHeaders } = canonicalHeaders(headers);
  const canonical = buildCanonicalRequest({
    method: params.method,
    canonicalUri: canonicalUri(params.path, { normalize: params.normalizePath }),
    canonicalQuery: canonicalQueryString(params.query ?? {}),
    canonicalHeadersBlock: block,
    signedHeaders,
    payloadHash: params.payloadHash,
  });

  const stringToSign = buildStringToSign(amzDate, scope, canonical);
  const signature = hmac(
    deriveSigningKey(params.credentials.secretAccessKey, dateStamp, params.region, service),
    stringToSign
  ).toString("hex");

  return {
    signature,
    canonicalRequest: canonical,
    stringToSign,
    credentialScope: scope,
    amzDate,
    signedHeaders,
    authorization:
      `${ALGORITHM} Credential=${params.credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * Presigned URL (query authentication).
 *
 * Payload is `UNSIGNED-PAYLOAD`: the signer never sees the body, and S3 accepts
 * this for presigned URLs. Consequence worth knowing: within the URL's lifetime,
 * whoever holds it can write *any* bytes to that exact key — which is why the
 * default TTL is 15 minutes and why the server uploads on behalf of the user
 * instead of handing out presigned PUTs unless you ask for it.
 *
 * For a virtual-hosted bucket the bucket becomes a subdomain; with
 * `forcePathStyle` (MinIO, some R2/LocalStack setups) it stays in the path.
 */
export function presignUrl(params: {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  credentials: SigV4Credentials;
  expiresInSeconds: number;
  forcePathStyle?: boolean;
  date?: Date;
  extraQuery?: Record<string, string>;
}): string {
  const endpointUrl = new URL(params.endpoint);
  const date = params.date ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(date);
  const scope = credentialScope(dateStamp, params.region, "s3");

  const encodedKey = canonicalUri(params.key).replace(/^\//, "");
  const host = params.forcePathStyle
    ? endpointUrl.host
    : `${params.bucket}.${endpointUrl.host}`;
  const path = params.forcePathStyle
    ? `/${params.bucket}/${encodedKey}`
    : `/${encodedKey}`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${params.credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(params.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
    ...(params.credentials.sessionToken
      ? { "X-Amz-Security-Token": params.credentials.sessionToken }
      : {}),
    ...params.extraQuery,
  };

  const canonicalQuery = canonicalQueryString(query);
  const canonical = buildCanonicalRequest({
    method: params.method,
    canonicalUri: path,
    canonicalQuery,
    canonicalHeadersBlock: `host:${host}\n`,
    signedHeaders: "host",
    payloadHash: UNSIGNED_PAYLOAD,
  });

  const stringToSign = buildStringToSign(amzDate, scope, canonical);
  const signature = hmac(
    deriveSigningKey(params.credentials.secretAccessKey, dateStamp, params.region, "s3"),
    stringToSign
  ).toString("hex");

  const base = `${endpointUrl.protocol}//${host}${path}`;
  return `${base}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Convenience wrapper: the `Authorization` header for a JSON/bytes request. */
export function authorizationHeader(params: {
  method: string;
  url: string;
  body?: Buffer | string;
  credentials: SigV4Credentials;
  region: string;
  service?: string;
  date?: Date;
}): { authorization: string; payloadHash: string; amzDate: string } {
  const url = new URL(params.url);
  const payloadHash = params.body === undefined ? sha256Hex("") : sha256Hex(params.body);

  const signed = signRequest({
    method: params.method,
    path: url.pathname,
    query: url.searchParams,
    headers: { host: url.host },
    payloadHash,
    credentials: params.credentials,
    region: params.region,
    service: params.service,
    ...(params.date ? { date: params.date } : {}),
  });

  return { authorization: signed.authorization, payloadHash, amzDate: signed.amzDate };
}
