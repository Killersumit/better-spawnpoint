import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * "Continue with …" buttons.
 *
 * The provider list is fetched from the server (`auth.providers`), so a button
 * only appears when the corresponding client id/secret is configured. A button
 * that leads to a 400 is worse than no button.
 *
 * The click handler navigates to the server's start endpoint rather than
 * building a URL here: the state cookie and PKCE verifier must be created
 * server-side, and duplicating that logic in the client is how the two halves
 * drift apart.
 */
export function OAuthButtons({
  returnTo,
  className,
}: {
  returnTo?: string | undefined;
  className?: string;
}) {
  const providers = trpc.auth.providers.useQuery(undefined, { staleTime: 5 * 60_000 });

  if (providers.isLoading || !providers.data || providers.data.providers.length === 0) {
    return null;
  }

  const start = (id: string) => {
    const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
    window.location.assign(`/api/auth/oauth/${id}/start${query}`);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

      {providers.data.providers.map((provider) => (
        <Button
          key={provider.id}
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => start(provider.id)}
        >
          Continue with {provider.label}
        </Button>
      ))}

      {providers.data.signupMode !== "open" && (
        <p className="text-center text-xs text-muted-foreground">
          {providers.data.signupMode === "invite"
            ? "This instance is invite-only. Use the link in your invitation."
            : "Signups are currently closed."}
        </p>
      )}
    </div>
  );
}
