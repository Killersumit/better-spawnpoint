/**
 * OAuth 2.0 / OIDC provider registry.
 *
 * Adding a provider = one object in `PROVIDERS`. Endpoints here are the
 * canonical documented ones; do not guess URLs (that is exactly the kind of
 * hallucination that breaks sign-in in production).
 *
 * Supported today: Google (OIDC) and GitHub (OAuth2, no OIDC).
 * Both use PKCE (S256), which GitHub also supports and Google requires for
 * public clients.
 */
import { ENV } from "../env";
import { AppError, BadRequestError } from "@shared/errors";

export type ProviderId = "google" | "github";

export type NormalizedProfile = {
  provider: ProviderId;
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
};

type ProviderConfig = {
  id: ProviderId;
  label: string;
  scope: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Uses PKCE. GitHub ignores code_challenge but accepts the parameters. */
  usePkce: boolean;
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Fetches the profile with the access token. */
  fetchProfile: (accessToken: string) => Promise<NormalizedProfile>;
  /** Extra body params for the token exchange. */
  tokenBody?: Record<string, string>;
};

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw AppErrorFactory(`provider request failed (${res.status})`, body);
  }
  return (await res.json()) as T;
}

function AppErrorFactory(message: string, detail: string) {
  return new AppError(502, `Sign-in provider error: ${message}`, detail, "OAUTH_UPSTREAM");
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  google: {
    id: "google",
    label: "Google",
    scope: "openid email profile",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    usePkce: true,
    clientId: ENV.OAUTH_GOOGLE_CLIENT_ID,
    clientSecret: ENV.OAUTH_GOOGLE_CLIENT_SECRET,
    fetchProfile: async (accessToken) => {
      const profile = await getJson<{
        sub: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      }>("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return {
        provider: "google",
        providerAccountId: profile.sub,
        email: profile.email ? profile.email.toLowerCase() : null,
        emailVerified: profile.email_verified === true,
        name: profile.name ?? null,
        image: profile.picture ?? null,
      };
    },
  },

  github: {
    id: "github",
    label: "GitHub",
    scope: "read:user user:email",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    usePkce: false,
    clientId: ENV.OAUTH_GITHUB_CLIENT_ID,
    clientSecret: ENV.OAUTH_GITHUB_CLIENT_SECRET,
    fetchProfile: async (accessToken) => {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      const user = await getJson<{
        id: number;
        login: string;
        name?: string;
        email?: string;
        avatar_url?: string;
      }>("https://api.github.com/user", { headers });

      let email = user.email?.toLowerCase() ?? null;
      let emailVerified = false;

      // A GitHub profile email is optional; the emails endpoint is authoritative.
      if (!email) {
        try {
          const emails = await getJson<
            { email: string; primary: boolean; verified: boolean }[]
          >("https://api.github.com/user/emails", { headers });
          const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
          if (primary) {
            email = primary.email.toLowerCase();
            emailVerified = true;
          }
        } catch {
          // Leave email null; the caller decides how to handle it.
        }
      } else {
        emailVerified = true;
      }

      return {
        provider: "github",
        providerAccountId: String(user.id),
        email,
        emailVerified,
        name: user.name ?? user.login,
        image: user.avatar_url ?? null,
      };
    },
  },
};

export function isProviderEnabled(id: ProviderId): boolean {
  const p = PROVIDERS[id];
  return Boolean(p.clientId && p.clientSecret);
}

export function enabledProviders(): { id: ProviderId; label: string }[] {
  return (Object.keys(PROVIDERS) as ProviderId[])
    .filter(isProviderEnabled)
    .map((id) => ({ id, label: PROVIDERS[id].label }));
}

export function getProvider(id: string): ProviderConfig {
  const provider = PROVIDERS[id as ProviderId];
  if (!provider) throw BadRequestError(`Unknown sign-in provider "${id}".`);
  if (!isProviderEnabled(provider.id)) {
    throw BadRequestError(`Sign-in with ${provider.label} is not configured.`);
  }
  return provider;
}

/** The redirect URI must be identical at authorize and token time, byte for byte. */
export function redirectUriFor(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/oauth/callback`;
}

export function buildAuthorizeUrl(
  provider: ProviderConfig,
  params: {
    redirectUri: string;
    state: string;
    codeChallenge?: string;
  }
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", provider.clientId ?? "");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scope);
  url.searchParams.set("state", params.state);
  if (provider.usePkce && params.codeChallenge) {
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export async function exchangeCode(
  provider: ProviderConfig,
  params: { code: string; redirectUri: string; codeVerifier?: string }
): Promise<string> {
  const body = new URLSearchParams({
    client_id: provider.clientId ?? "",
    client_secret: provider.clientSecret ?? "",
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    ...(provider.tokenBody ?? {}),
  });
  if (provider.usePkce && params.codeVerifier) {
    body.set("code_verifier", params.codeVerifier);
  }

  const token = await getJson<{ access_token?: string; error?: string; error_description?: string }>(
    provider.tokenUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    }
  );

  if (!token.access_token) {
    throw AppErrorFactory(
      token.error ?? "no access_token returned",
      token.error_description ?? ""
    );
  }
  return token.access_token;
}
