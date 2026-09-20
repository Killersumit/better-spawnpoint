import { Suspense, lazy } from "react";
import { Route, Switch } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConsentBanner } from "@/components/ConsentBanner";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ROUTES } from "@shared/const";
import { POLICY_ROUTE_KEYS, POLICY_SLUGS } from "@shared/policies";
import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import Dashboard from "@/pages/Dashboard";

// Split the heavier, less-visited routes so the landing page stays small.
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const VerifyEmail = lazy(() => import("@/pages/VerifyEmail"));
const Settings = lazy(() => import("@/pages/Settings"));
const PolicyPage = lazy(() => import("@/pages/legal/PolicyPage"));
const Admin = lazy(() => import("@/pages/Admin"));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <span className="sr-only">Loading</span>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

/**
 * Router.
 *
 * Every path comes from `ROUTES` in shared/const.ts. Do not write a path string
 * here: `npm run verify` fails on a literal path in a <Route>, because a route
 * that exists in the router but not in ROUTES is invisible to the generated
 * AI context manifest, sitemap, and link checker.
 *
 * Pages that need a session call `useAuth({ redirectOnUnauthenticated: true })`
 * themselves — keeping the guard next to the data it protects.
 */
function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path={ROUTES.home} component={Home} />
        <Route path={ROUTES.login} component={Login} />
        <Route path={ROUTES.signup} component={Signup} />
        <Route path={ROUTES.forgotPassword} component={ForgotPassword} />
        <Route path={ROUTES.resetPassword} component={ResetPassword} />
        <Route path={ROUTES.verifyEmail} component={VerifyEmail} />
        <Route path={ROUTES.dashboard} component={Dashboard} />
        <Route path={ROUTES.settings} component={Settings} />
        <Route path={ROUTES.admin} component={Admin} />

        {POLICY_SLUGS.map((slug) => {
          const routeKey = POLICY_ROUTE_KEYS[slug];
          const path = (ROUTES as Record<string, string | undefined>)[routeKey];
          if (!path) return null;
          return <Route key={slug} path={path} component={() => <PolicyPage slug={slug} />} />;
        })}

        <Route path={ROUTES.notFound} component={NotFound} />
        {/* Fallback must stay last. */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
          <ConsentBanner />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
