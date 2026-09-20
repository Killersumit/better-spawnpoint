import { useCallback, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import type { PublicUser } from "@shared/types";
import { ROUTES } from "@shared/const";
import { trpc } from "@/lib/trpc";

export type UseAuthOptions = {
  /** Redirect to /login when there is no session. Default: false. */
  redirectOnUnauthenticated?: boolean;
  /** Where to send the user after a successful sign-in. */
  returnTo?: string;
};

export type UseAuthResult = {
  user: PublicUser | null;
  loading: boolean;
  error: unknown;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

/**
 * Session state for components.
 *
 * Calls `auth.me`, which returns the PUBLIC user shape — never the raw row.
 * Set `redirectOnUnauthenticated` on pages that require a session instead of
 * writing your own redirect: one implementation means one place to get the
 * "loading vs signed-out" flicker right.
 */
export function useAuth(options: UseAuthOptions = {}): UseAuthResult {
  const { redirectOnUnauthenticated = false, returnTo } = options;
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
      void utils.invalidate();
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const loading = meQuery.isLoading || logoutMutation.isPending;

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (loading) return;
    if (meQuery.data) return;
    const target = returnTo
      ? `${ROUTES.login}?returnTo=${encodeURIComponent(returnTo)}`
      : ROUTES.login;
    navigate(target);
  }, [loading, meQuery.data, navigate, redirectOnUnauthenticated, returnTo]);

  return useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
      logout,
      refresh: async () => {
        await meQuery.refetch();
      },
    }),
    [loading, logout, meQuery]
  );
}
