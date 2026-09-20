import { LogOut, Menu, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ROUTES } from "@shared/const";
import { compliance } from "@shared/compliance";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/hooks/useAuth";

/**
 * Public site header. Deliberately minimal: one nav, theme toggle, auth actions.
 *
 * Accessibility: the mobile menu is a button with `aria-expanded` and
 * `aria-controls`; the nav landmark is labelled so screen-reader users can jump
 * between the header nav and the footer legal nav.
 */
export function AppHeader() {
  const { user, loading, logout } = useAuth();
  const { resolved, toggle, switchable } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();

  const links = [
    { href: ROUTES.home, label: "Home" },
    ...(user ? [{ href: ROUTES.dashboard, label: "Dashboard" }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href={ROUTES.home} className="font-semibold">
            {compliance.organization.productName}
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-4 sm:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={location === link.href ? "page" : undefined}
                className="text-sm text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {switchable && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
            >
              {resolved === "dark" ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}

          {loading ? (
            // Reserve the space so the header does not jump when auth resolves.
            <div className="h-9 w-20 animate-pulse rounded-md bg-muted" aria-hidden="true" />
          ) : user ? (
            <>
              <Link href={ROUTES.settings} className="hidden text-sm sm:inline">
                <span className="text-muted-foreground hover:text-foreground">
                  {user.name ?? user.email}
                </span>
              </Link>
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href={ROUTES.login}>
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href={ROUTES.signup} className="hidden sm:inline">
                <Button size="sm">Create account</Button>
              </Link>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="Toggle navigation menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-border sm:hidden">
          <ul className="container flex flex-col py-2">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block py-2 text-sm"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {!user && (
              <li>
                <Link
                  href={ROUTES.signup}
                  onClick={() => setMenuOpen(false)}
                  className="block py-2 text-sm"
                >
                  Create account
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}
