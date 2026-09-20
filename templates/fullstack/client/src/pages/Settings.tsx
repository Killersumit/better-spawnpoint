import { useState } from "react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@shared/const";
import { CONSENT_LABELS, CONSENT_CATEGORIES } from "@shared/consent";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useConsent } from "@/contexts/ConsentContext";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Account settings: profile, password, sessions, consent, and the data-rights
 * controls (export, delete).
 *
 * The data-rights section is not optional polish. Under GDPR Art. 15/17 and
 * CCPA you must provide these capabilities; giving users a button that works is
 * both cheaper and more honest than an inbox someone has to monitor.
 */
export default function Settings() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const consent = useConsent();
  const utils = trpc.useUtils();

  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      toast.success("Profile updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed. Other devices were signed out.");
    },
    onError: (error) => toast.error(error.message),
  });

  const sessions = trpc.auth.sessions.useQuery();
  const revokeOthers = trpc.auth.revokeOtherSessions.useMutation({
    onSuccess: async ({ revoked }) => {
      await utils.auth.sessions.invalidate();
      toast.success(`Signed out ${revoked} other device${revoked === 1 ? "" : "s"}`);
    },
  });

  const exportData = trpc.account.exportData.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `account-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Your export has been downloaded");
    },
    onError: (error) => toast.error(error.message),
  });

  const deletionStatus = trpc.account.deletionStatus.useQuery();
  const requestDeletion = trpc.account.requestDeletion.useMutation({
    onSuccess: async (result) => {
      await utils.account.deletionStatus.invalidate();
      toast.success(`Deletion scheduled for ${result.scheduledFor.slice(0, 10)}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const cancelDeletion = trpc.account.cancelDeletion.useMutation({
    onSuccess: async () => {
      await utils.account.deletionStatus.invalidate();
      toast.success("Deletion cancelled");
    },
  });

  const resendVerification = trpc.auth.resendVerification.useMutation({
    onSuccess: ({ message }) => toast.success(message),
    onError: (error) => toast.error(error.message),
  });

  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your profile, security, privacy choices, and data.
          </p>
        </header>

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              {user?.email} ·{" "}
              {user?.emailVerified ? "email confirmed" : "email not confirmed yet"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!user?.emailVerified && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => resendVerification.mutate()}
                disabled={resendVerification.isPending}
              >
                {resendVerification.isPending
                  ? "Sending…"
                  : "Resend confirmation email"}
              </Button>
            )}

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                updateProfile.mutate({ name: name.trim() || null });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={updateProfile.isPending}>
                Save profile
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Password ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              Changing your password signs out every other device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                changePassword.mutate({ currentPassword, newPassword });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  At least 12 characters, including a letter and a number.
                </p>
              </div>
              <Button type="submit" disabled={changePassword.isPending}>
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Sessions ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Devices currently signed in to your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm">
              {sessions.data?.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate">
                      {session.userAgent ?? "Unknown device"}
                      {session.current && (
                        <span className="ml-2 text-xs text-muted-foreground">(this device)</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Last used{" "}
                      <time dateTime={session.lastUsedAt}>
                        {new Date(session.lastUsedAt).toLocaleString()}
                      </time>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              onClick={() => revokeOthers.mutate()}
              disabled={revokeOthers.isPending}
            >
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign out everywhere else
            </Button>
          </CardContent>
        </Card>

        {/* ── Privacy choices ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Privacy choices</CardTitle>
            <CardDescription>
              Change these at any time. Withdrawing consent stops the processing from that
              point on.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {CONSENT_CATEGORIES.filter((category) => category !== "strictly_necessary").map(
              (category) => (
                <div key={category} className="flex items-start gap-3">
                  <Checkbox
                    id={`setting-consent-${category}`}
                    checked={consent.state[category]}
                    onCheckedChange={(checked) =>
                      consent.save({ ...consent.state, [category]: checked === true })
                    }
                  />
                  <div>
                    <Label
                      htmlFor={`setting-consent-${category}`}
                      className="text-sm font-medium"
                    >
                      {CONSENT_LABELS[category].title}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {CONSENT_LABELS[category].description}
                    </p>
                  </div>
                </div>
              )
            )}
          </CardContent>
        </Card>

        {/* ── Your data ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
            <CardDescription>
              Export or delete everything we hold about you. Both are self-service and take
              effect immediately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => exportData.mutate()}
                disabled={exportData.isPending}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {exportData.isPending ? "Preparing…" : "Download my data (JSON)"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Includes your profile, notes, files, consent history, sessions, and activity.
              </p>
            </div>

            <Separator />

            {deletionStatus.data?.pending ? (
              <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
                <p className="text-sm">
                  Your account is scheduled for deletion on{" "}
                  <strong>
                    {new Date(deletionStatus.data.scheduledFor ?? "").toLocaleDateString()}
                  </strong>
                  . Until then you can cancel.
                </p>
                <Button variant="outline" onClick={() => cancelDeletion.mutate()}>
                  Cancel deletion
                </Button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  requestDeletion.mutate({ confirmEmail });
                }}
              >
                <div>
                  <h3 className="text-sm font-medium">Delete my account</h3>
                  <p className="text-xs text-muted-foreground">
                    You are signed out immediately, and everything is permanently erased
                    after a short grace period. Type your email address to confirm.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-email">Type {user?.email} to confirm</Label>
                  <Input
                    id="confirm-email"
                    type="email"
                    autoComplete="off"
                    value={confirmEmail}
                    onChange={(event) => setConfirmEmail(event.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={requestDeletion.isPending || confirmEmail.trim() === ""}
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Delete my account
                </Button>
              </form>
            )}

            <p className="text-xs text-muted-foreground">
              See the{" "}
              <a href={ROUTES.privacy} className="underline underline-offset-2">
                privacy policy
              </a>{" "}
              for exactly what is deleted and what we are required to keep.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
