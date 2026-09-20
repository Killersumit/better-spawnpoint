import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { ConsentProvider } from "./contexts/ConsentContext";
import { trpc } from "./lib/trpc";
import { installDevReporter } from "./lib/dev-report";
import "./index.css";

// Development only: forwards window.onerror / unhandled rejections to the dev
// server's log file (`.dev/logs/browser.log`) so an agent reading logs can see
// client-side failures without a browser open. Vite dead-code-eliminates this
// in production builds; there is no analytics or third-party request involved.
installDevReporter();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30s is enough to debounce navigation without showing stale data.
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Never retry an auth/permission failure — it will not fix itself.
        const code = (error as { data?: { code?: string } })?.data?.code;
        if (code && ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(code)) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        // `credentials: include` sends the session cookie. There is no
        // sessionStorage/localStorage token fallback by design: a bearer token
        // reachable from JavaScript is readable by any XSS payload.
        return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <ConsentProvider>
        <App />
      </ConsentProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
