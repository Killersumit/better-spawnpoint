/**
 * ── Feature template ────────────────────────────────────────────────────────
 * The canonical owned-resource CRUD: list (paginated), create, update, archive,
 * delete. Copy this file when you add your first real feature, then delete it
 * once your own table exists.
 *
 * It exists because the four rules that are easy to get wrong are already
 * right here:
 *   1. Every query is scoped to `ctx.user.id` — a client never supplies an
 *      owner id, and a missing `where` clause cannot leak another user's rows.
 *   2. Every mutation validates input with Zod at the boundary.
 *   3. Ownership is re-checked on write, not just on read (update/delete take
 *      the user id in the WHERE clause, so a guessed id is a no-op).
 *   4. Pagination is cursor-friendly and bounded, so it cannot be used to dump
 *      the table.
 */
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError } from "@shared/errors";
import { notes } from "../../drizzle/schema";
import { requireDb } from "../_core/db";
import { router, authedProcedure } from "../_core/trpc";

const noteId = z.number().int().positive();
const title = z.string().trim().min(1, "Give the note a title").max(200);
const body = z.string().max(20_000).nullish();

export const notesRouter = router({
  list: authedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(25),
          cursor: z.number().int().positive().optional(),
          includeArchived: z.boolean().default(false),
        })
        .default({ limit: 25, includeArchived: false })
    )
    .query(async ({ ctx, input }) => {
      const db = requireDb();

      // The ownership filter is unconditional and always first: however the
      // rest of the query is built, scope cannot be lost.
      const filters = [eq(notes.userId, ctx.user.id)];
      if (!input.includeArchived) filters.push(isNull(notes.archivedAt));
      if (input.cursor) filters.push(lt(notes.id, input.cursor));

      const rows = await db
        .select()
        .from(notes)
        .where(and(...filters))
        .orderBy(desc(notes.id))
        .limit(input.limit);

      return {
        items: rows.map(serializeNote),
        nextCursor: rows.length === input.limit ? (rows[rows.length - 1]?.id ?? null) : null,
      };
    }),

  byId: authedProcedure.input(z.object({ id: noteId })).query(async ({ ctx, input }) => {
    const db = requireDb();
    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.user.id)))
      .limit(1);

    const note = rows[0];
    if (!note) throw NotFoundError("Note not found");
    return serializeNote(note);
  }),

  create: authedProcedure
    .input(z.object({ title, body }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb();
      const [inserted] = await db
        .insert(notes)
        .values({
          userId: ctx.user.id,
          title: input.title,
          body: input.body ?? null,
        })
        .$returningId();

      const id = inserted?.id;
      if (!id) throw new Error("Insert did not return an id");

      const rows = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
      const note = rows[0];
      if (!note) throw new Error("Inserted row not found");
      return serializeNote(note);
    }),

  update: authedProcedure
    .input(z.object({ id: noteId, title: title.optional(), body }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb();
      const set: Record<string, unknown> = {};
      if (input.title !== undefined) set.title = input.title;
      if (input.body !== undefined) set.body = input.body ?? null;
      if (Object.keys(set).length === 0) throw NotFoundError("Nothing to update");

      const result = await db
        .update(notes)
        .set(set)
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.user.id)));

      // affectedRows === 0 means "not yours or does not exist" — deliberately
      // the same answer for both.
      if (Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) === 0) {
        throw NotFoundError("Note not found");
      }

      const rows = await db.select().from(notes).where(eq(notes.id, input.id)).limit(1);
      const note = rows[0];
      if (!note) throw NotFoundError("Note not found");
      return serializeNote(note);
    }),

  archive: authedProcedure
    .input(z.object({ id: noteId, archived: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb();
      const result = await db
        .update(notes)
        .set({ archivedAt: input.archived ? new Date() : null })
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.user.id)));

      if (Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) === 0) {
        throw NotFoundError("Note not found");
      }
      return { success: true } as const;
    }),

  delete: authedProcedure
    .input(z.object({ id: noteId }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb();
      await db
        .delete(notes)
        .where(and(eq(notes.id, input.id), eq(notes.userId, ctx.user.id)));
      // Deletes are idempotent: deleting an already-deleted note is a success,
      // so a retry after a flaky network does not surface a scary error.
      return { success: true } as const;
    }),

  count: authedProcedure.query(async ({ ctx }) => {
    const db = requireDb();
    const rows = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(notes)
      .where(eq(notes.userId, ctx.user.id));
    return { total: Number(rows[0]?.total ?? 0) };
  }),
});

/** Serialize dates to ISO strings — superjson handles Date, but keeping the
 *  wire format explicit means the client types do not depend on the transformer. */
function serializeNote(note: typeof notes.$inferSelect) {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    archivedAt: note.archivedAt ? note.archivedAt.toISOString() : null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export type NoteDTO = ReturnType<typeof serializeNote>;
