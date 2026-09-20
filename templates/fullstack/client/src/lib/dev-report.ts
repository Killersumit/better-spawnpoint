/**
 * Development-only error reporter.
 *
 * Forwards uncaught errors and failed requests to the dev-server middleware in
 * `vite.config.ts`, which appends them to `.dev/logs/browser.log`. That gives an
 * agent (or a human without devtools open) a real runtime error instead of a
 * guess about what the browser said.
 *
 * The auth token and cookie values are stripped before sending: a log file that
 * contains a session token is a credential leak waiting to be committed.
 */
const ENDPOINT = "/__dev__/logs";
const MAX_BODY = 2000;

let installed = false;

function scrub(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value
    .slice(0, MAX_BODY)
    .replace(/Bearer\s+[\w.~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/(app_session_id=)[^;,\s]+/gi, "$1[redacted]")
    .replace(/("?(?:password|token|secret|apiKey)"?\s*[:=]\s*")[^"]*/gi, "$1[redacted]");
}

function send(entry: Record<string, unknown>): void {
  const payload = JSON.stringify({
    href: window.location.href,
    ...Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, scrub(v)])),
  });
  // sendBeacon survives page unload, which is exactly when errors matter.
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
      return;
    }
  } catch {
    /* fall through */
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

export function installDevReporter(): void {
  if (installed || typeof window === "undefined") return;
  if (!import.meta.env.DEV) return;
  installed = true;

  window.addEventListener("error", (event) => {
    send({
      kind: "error",
      message: event.message,
      source: event.filename,
      line: event.lineno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    send({
      kind: "unhandledrejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
    try {
      const response = await originalFetch(input, init);
      if (!response.ok && !url.includes(ENDPOINT)) {
        send({
          kind: "http",
          url,
          status: response.status,
          method: init?.method ?? "GET",
        });
      }
      return response;
    } catch (error) {
      send({
        kind: "network",
        url,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
