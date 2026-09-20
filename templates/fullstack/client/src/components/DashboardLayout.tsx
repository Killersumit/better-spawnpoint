import {
  LayoutDashboard,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  ShieldCheck as ShieldIcon,
  X,
} from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ROUTES } from "@shared/const";
import { compliance } from "@shared/compliance";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

export type DashboardNavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
};

/**
 * Authenticated app shell: sidebar + content.
 *
 * The menu is a prop, not a hard-coded array, so pages choose their own
 * navigation. `useAuth({ redirectOnUnauthenticated: true })` is the guard — one
 * implementation for every protected page.
 *
 * Accessibility: the toggle has `aria-expanded`/`aria-controls`, the nav is a
 * labelled landmark, the current page is marked with `aria-current="page"`, and
 * there is a skip link before the nav.
 */
export function DashboardLayout({
  children,
  navItems: navOverride,
}: {
  children: ReactNode;
  /** Escape hatch for pages that want their own navigation. */
  navItems?: DashboardNavItem[];
}) {
  const { user, loading, logout } = useAuth({ redirectOnUnauthenticated: true });
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The Admin entry appears only for admins. This is presentation, not access
  // control — the server's adminProcedure is what actually enforces it.
  const navItems = navOverride ?? [
    { label: "Dashboard", href: ROUTES.dashboard, icon: LayoutDashboard },
    { label: "Settings", href: ROUTES.settings, icon: SettingsIcon },
    ...(user?.role === "admin"
      ? [{ label: "Admin", href: ROUTES.admin, icon: ShieldIcon }]
      : []),
  ];

  if (loading || !user) return <DashboardLayoutSkeleton />;

  const initials = (user.name ?? user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const nav = (
    <nav aria-label="Dashboard" className="flex flex-1 flex-col gap-1 p-2">
      {navItems.map((item) => {
        const active = location === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-expanded={mobileOpen}
          aria-controls="dashboard-nav"
          aria-label="Toggle navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? (
            <X className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Menu className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>

        <Link href={ROUTES.home} className="font-semibold">
          {compliance.organization.productName}
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {!user.emailVerified && (
            <Link
              href={ROUTES.settings}
              className="hidden text-xs text-amber-600 underline underline-offset-2 sm:inline dark:text-amber-400"
            >
              Confirm your email
            </Link>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Account menu">
                <Avatar className="h-7 w-7">
                  {user.image && <AvatarImage src={user.image} alt="" />}
                  <AvatarFallback>{initials || "?"}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                {user.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={ROUTES.settings}>Account settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={ROUTES.privacy}>Privacy policy</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1">
        <aside
          id="dashboard-nav"
          className={cn(
            "w-64 shrink-0 border-r border-border bg-muted/20",
            mobileOpen ? "absolute inset-y-14 left-0 z-30 bg-background" : "hidden lg:block"
          )}
        >
          {nav}
        </aside>

        <main id="main" className="flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export default DashboardLayout;
