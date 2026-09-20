import { Link } from "wouter";
import { ROUTES } from "@shared/const";
import { AppFooter } from "@/components/AppFooter";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";

/**
 * 404.
 *
 * Nothing clever here: a real page, a real status code (the server sends 404 for
 * unknown API paths; for SPA routes the client renders this), and a way back.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="container flex flex-1 flex-col items-center justify-center py-24 text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          The page you were looking for does not exist or has moved. If you followed a
          link from an email, it may have expired.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href={ROUTES.home}>
            <Button>Back to the home page</Button>
          </Link>
          <Link href={ROUTES.login}>
            <Button variant="outline">Sign in</Button>
          </Link>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
