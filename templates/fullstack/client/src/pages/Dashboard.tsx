import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DB_UNAVAILABLE_ERR_MSG } from "@shared/const";
import { AiAssistantCard } from "@/components/AiAssistantCard";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";

/**
 * Authenticated landing page, wired to the `notes` feature-template router.
 *
 * This page demonstrates the full loop you will copy for your own feature:
 *   • loading, empty, error, and populated states, each handled explicitly;
 *   • optimistic-free mutations (we invalidate instead), so a failed write is
 *     never shown as a success;
 *   • every failure surfaced with `toast` AND an inline alert, because a toast
 *     disappears and a screen reader may miss it.
 *
 * Delete this page (and the router, table, and test) once your own feature
 * exists — it is scaffolding, not product.
 */
export default function Dashboard() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const notes = trpc.notes.list.useQuery({ limit: 25, includeArchived: false });
  // Optional features are discovered, not assumed: the panel only appears when
  // the environment actually has a model endpoint configured.
  const capabilities = trpc.system.capabilities.useQuery(undefined, { staleTime: 5 * 60_000 });

  const create = trpc.notes.create.useMutation({
    onSuccess: async () => {
      setTitle("");
      setBody("");
      await utils.notes.list.invalidate();
      toast.success("Note created");
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = trpc.notes.delete.useMutation({
    onSuccess: async () => {
      await utils.notes.list.invalidate();
      toast.success("Note deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const dbUnavailable =
    notes.error && notes.error.message.includes(DB_UNAVAILABLE_ERR_MSG.slice(0, 30));

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back{user?.name ? `, ${user.name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This dashboard is a working example: create, list, and delete rows that belong
            to you and to nobody else.
          </p>
        </header>

        {dbUnavailable && (
          <Alert>
            <AlertTitle>No database is configured</AlertTitle>
            <AlertDescription>
              Pages render, but data-backed features are offline. Copy{" "}
              <code>.env.example</code> to <code>.env</code>, set <code>DATABASE_URL</code>,
              then run <code>npm run db:push</code>.
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>New note</CardTitle>
            <CardDescription>Stored against your account only.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim()) {
                  toast.error("Give the note a title first.");
                  return;
                }
                create.mutate({ title: title.trim(), body: body.trim() || null });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="note-title">Title</Label>
                <Input
                  id="note-title"
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="What is this about?"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="note-body">Details (optional)</Label>
                <Textarea
                  id="note-body"
                  value={body}
                  rows={3}
                  maxLength={20_000}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>

              <Button type="submit" disabled={create.isPending}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                {create.isPending ? "Saving…" : "Add note"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {capabilities.data?.features.ai && <AiAssistantCard />}

        <section aria-labelledby="notes-heading" className="space-y-3">
          <h2 id="notes-heading" className="text-lg font-medium">
            Your notes
          </h2>

          {notes.isLoading && (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          )}

          {notes.error && (
            <Alert variant="destructive">
              <AlertTitle>Could not load your notes</AlertTitle>
              <AlertDescription>
                {notes.error.message}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => void notes.refetch()}
                >
                  Try again
                </button>
              </AlertDescription>
            </Alert>
          )}

          {notes.data && notes.data.items.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nothing here yet. Add your first note above.
            </p>
          )}

          <ul className="space-y-3">
            {notes.data?.items.map((note) => (
              <li key={note.id}>
                <Card>
                  <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{note.title}</CardTitle>
                      <CardDescription>
                        Created{" "}
                        <time dateTime={note.createdAt}>
                          {new Date(note.createdAt).toLocaleString()}
                        </time>
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete note “${note.title}”`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: note.id })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </CardHeader>
                  {note.body && (
                    <CardContent>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {note.body}
                      </p>
                    </CardContent>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </DashboardLayout>
  );
}
