import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";

/**
 * Shell for policy pages.
 *
 * The warning banner appears only when a placeholder could not be resolved from
 * `legal/compliance.json` (or in a non-production build, where an unfilled
 * `[[missing: ...]]` marker is a to-do rather than a compliance failure). In
 * production the build fails first — see `npm run verify`.
 */
export function LegalLayout({
  title,
  description,
  lastUpdated,
  unresolved = [],
  children,
}: {
  title: string;
  description?: string;
  lastUpdated?: string;
  unresolved?: string[];
  children: ReactNode;
}) {
  const showDevWarning = unresolved.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      {/* Bypass block for keyboard and screen-reader users. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <main id="main" className="container flex-1 py-10">
        <article className="prose prose-neutral mx-auto max-w-3xl dark:prose-invert">
          <header className="not-prose mb-8 border-b border-border pb-6">
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            )}
            {lastUpdated && (
              <p className="mt-2 text-xs text-muted-foreground">
                Last updated <time dateTime={lastUpdated}>{lastUpdated}</time>
              </p>
            )}
          </header>

          {showDevWarning && (
            <div
              role="alert"
              className="not-prose mb-6 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  This policy references values that are not set yet
                </p>
                <p className="mt-1 text-muted-foreground">
                  Fill them in <code>legal/compliance.json</code>, then run{" "}
                  <code>npm run verify</code>.
                </p>
                <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                  {unresolved.map((path) => (
                    <li key={path}>
                      <code>{path}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {children}
        </article>
      </main>

      <AppFooter />
    </div>
  );
}
