import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const PROJECT_ROOT = import.meta.dirname;

/**
 * Dev-only request tracer.
 *
 * Replaces the vendor-specific debug collector from the upstream scaffold. It
 * appends browser-side errors reported by `client/src/lib/dev-report.ts` to
 * `.dev/logs/browser.log` so an agent (or a human) can read real runtime errors
 * without a browser devtools session.
 *
 * Never enabled in production builds: `transformIndexHtml` returns the HTML
 * untouched when NODE_ENV is not "development".
 */
function devLogCollector(): Plugin {
  return {
    name: "spawnpoint-dev-log-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV !== "development") return html;
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: { src: "/__dev__/report.js", defer: true },
            injectTo: "head" as const,
          },
        ],
      };
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__dev__/logs", (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const fsp = await import("node:fs/promises");
            const dir = path.join(PROJECT_ROOT, ".dev", "logs");
            await fsp.mkdir(dir, { recursive: true });
            await fsp.appendFile(
              path.join(dir, "browser.log"),
              `${new Date().toISOString()} ${body}\n`,
              "utf-8"
            );
            res.writeHead(204).end();
          } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

/**
 * Dev-server host allowlist.
 *
 * Vite rejects requests whose Host header is not allowlisted, which is what
 * stops DNS-rebinding attacks against the dev server. Remote/preview hosts are
 * unpredictable (tunnels, cloud sandboxes, team proxies), so we accept a
 * comma-separated DEV_ALLOWED_HOSTS env var and otherwise fall back to
 * "permissive in development, localhost-only in production" instead of pinning
 * a vendor domain list that breaks as soon as the deployment target changes.
 */
function allowedHosts(): true | string[] {
  const fromEnv = (process.env.DEV_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === "development") return true;
  return ["localhost", "127.0.0.1", "[::1]"];
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devLogCollector()],
  resolve: {
    alias: {
      "@": path.resolve(PROJECT_ROOT, "client", "src"),
      "@shared": path.resolve(PROJECT_ROOT, "shared"),
      "@legal": path.resolve(PROJECT_ROOT, "legal"),
    },
  },
  envDir: PROJECT_ROOT,
  // Only VITE_* vars that are not secrets may live in .env; see CONVENTIONS.md.
  envPrefix: ["VITE_"],
  root: path.resolve(PROJECT_ROOT, "client"),
  publicDir: path.resolve(PROJECT_ROOT, "client", "public"),
  build: {
    outDir: path.resolve(PROJECT_ROOT, "dist", "public"),
    emptyOutDir: true,
    sourcemap: process.env.BUILD_SOURCEMAP === "true",
  },
  server: {
    // Bind on all interfaces so containers/sandboxes can proxy to the dev server.
    host: true,
    allowedHosts: allowedHosts(),
    fs: {
      strict: true,
      // Never serve dotfiles (.env, .git, ...) over the dev server.
      deny: ["**/.*", "**/.*/**"],
    },
  },
});
