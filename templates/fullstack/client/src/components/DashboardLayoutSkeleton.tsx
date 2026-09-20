import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading shell for authenticated pages.
 *
 * Rendering the real layout shape (rather than a centred spinner) keeps the
 * page from jumping when the session resolves — layout shift is an
 * accessibility problem, not just a polish one. Marked `aria-busy` with a
 * status message so screen readers know to wait.
 */
export function DashboardLayoutSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-background" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your account
      </span>

      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-4 w-28" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-full" />
        </div>
      </div>

      <div className="flex flex-1">
        <div className="hidden w-64 shrink-0 space-y-2 border-r border-border p-3 lg:block">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>

        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-48 rounded-md" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
