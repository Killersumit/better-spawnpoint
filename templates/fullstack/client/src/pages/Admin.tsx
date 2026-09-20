import { useState } from "react";
import { Activity, PlayCircle, ShieldAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@shared/const";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Admin console.
 *
 * The whole page is behind `adminProcedure` on the server; this component only
 * decides what to render. That is the important split: hiding a button is not
 * access control, and a UI-only guard would let anyone call the endpoint.
 *
 * Every destructive action here writes an audit-log entry server-side, and the
 * "recent activity" table is the same `auditLogs` table the compliance pages
 * refer to — so an operator can answer "who deleted that account?" without
 * opening a database shell.
 */
export default function Admin() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");

  const stats = trpc.admin.stats.useQuery(undefined, { enabled: user?.role === "admin" });
  const users = trpc.admin.listUsers.useQuery(
    { search: search || undefined, limit: 25 },
    { enabled: user?.role === "admin" }
  );
  const audit = trpc.admin.auditLog.useQuery({ limit: 25 }, { enabled: user?.role === "admin" });
  const jobs = trpc.admin.jobs.useQuery(undefined, { enabled: user?.role === "admin" });

  const setRole = trpc.admin.setRole.useMutation({
    onSuccess: async () => {
      await utils.admin.listUsers.invalidate();
      toast.success("Role updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const suspend = trpc.admin.suspendUser.useMutation({
    onSuccess: async () => {
      await utils.admin.listUsers.invalidate();
      toast.success("Account updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const runJob = trpc.admin.runJob.useMutation({
    onSuccess: async () => {
      await utils.admin.jobs.invalidate();
      toast.success("Job finished");
    },
    onError: (error) => toast.error(error.message),
  });

  if (user && user.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-2xl">
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Not available</AlertTitle>
            <AlertDescription>
              This area is for administrators. You are signed in as {user.email}.
            </AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Accounts, background jobs, and the audit trail. Every action here is recorded.
          </p>
        </header>

        {/* ── Overview ────────────────────────────────────────────────────── */}
        <section aria-labelledby="stats-heading" className="space-y-3">
          <h2 id="stats-heading" className="sr-only">
            Overview
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.isLoading &&
              Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 rounded-xl" />
              ))}
            {stats.data && (
              <>
                <StatCard label="Users" value={stats.data.userCount} icon={<Users className="h-4 w-4" aria-hidden="true" />} />
                <StatCard label="Active sessions" value={stats.data.sessionCount} />
                <StatCard label="Files" value={stats.data.fileCount} />
                <StatCard label="Pending deletions" value={stats.data.pendingDeletions} />
              </>
            )}
          </div>
        </section>

        {/* ── Users ───────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>
              Suspending an account signs the user out everywhere and blocks new sign-ins.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-sm">
              <label htmlFor="user-search" className="sr-only">
                Search accounts by email
              </label>
              <Input
                id="user-search"
                type="search"
                placeholder="Search by email…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Email</TableHead>
                    <TableHead scope="col">Role</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Joined</TableHead>
                    <TableHead scope="col" className="text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.data?.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.email}</TableCell>
                      <TableCell>
                        <Badge variant={row.role === "admin" ? "default" : "secondary"}>
                          {row.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === "active" ? "secondary" : "destructive"}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={row.createdAt}>
                          {new Date(row.createdAt).toLocaleDateString()}
                        </time>
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={row.id === user?.id || setRole.isPending}
                          onClick={() =>
                            setRole.mutate({
                              userId: row.id,
                              role: row.role === "admin" ? "user" : "admin",
                            })
                          }
                        >
                          {row.role === "admin" ? "Revoke admin" : "Make admin"}
                        </Button>
                        <Button
                          size="sm"
                          variant={row.status === "active" ? "ghost" : "outline"}
                          disabled={row.id === user?.id || suspend.isPending}
                          onClick={() =>
                            suspend.mutate({ userId: row.id, suspended: row.status === "active" })
                          }
                        >
                          {row.status === "active" ? "Suspend" : "Restore"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.data?.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        No accounts match that search.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ── Jobs ───────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Background jobs</CardTitle>
            <CardDescription>
              Scheduled work: session pruning, token cleanup, account purges, and retention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Job</TableHead>
                  <TableHead scope="col">Schedule (UTC)</TableHead>
                  <TableHead scope="col">Last run</TableHead>
                  <TableHead scope="col">Result</TableHead>
                  <TableHead scope="col" className="text-right">
                    Run now
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.data?.map((job) => (
                  <TableRow key={job.name}>
                    <TableCell className="font-mono text-xs">{job.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {job.cron}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "never"}
                    </TableCell>
                    <TableCell>
                      {job.lastStatus ? (
                        <Badge variant={job.lastStatus === "ok" ? "secondary" : "destructive"}>
                          {job.lastStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={runJob.isPending}
                        onClick={() => runJob.mutate({ name: job.name })}
                      >
                        <PlayCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                        Run
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {jobs.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      No jobs are registered.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── Audit log ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" aria-hidden="true" />
              Recent activity
            </CardTitle>
            <CardDescription>
              Security-relevant events, newest first. Retained for the period stated in the{" "}
              <a href={ROUTES.security} className="underline underline-offset-2">
                security page
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {audit.data?.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0"
                >
                  <span className="font-mono text-xs">{entry.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.actorUserId ? `user #${entry.actorUserId}` : "system"} ·{" "}
                    <time dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                  </span>
                </li>
              ))}
              {audit.data?.length === 0 && (
                <li className="text-sm text-muted-foreground">Nothing recorded yet.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value.toLocaleString()}</CardTitle>
      </CardHeader>
    </Card>
  );
}
