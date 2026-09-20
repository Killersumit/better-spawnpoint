/**
 * The application router.
 *
 * Mount every feature router here at a stable namespace. The client sees the
 * resulting type as `AppRouter`, so a rename here is a compile error in every
 * component that used the old path — which is the point.
 *
 * Adding a feature:
 *   1. create `server/routers/<feature>.ts` exporting `<feature>Router`,
 *   2. import and mount it below,
 *   3. add a matching test in `server/routers/<feature>.test.ts` (verify checks
 *      that every router file has one),
 *   4. run `npm run ai:context` so the manifest lists the new procedures.
 */
import { adminRouter } from "./routers/admin";
import { accountRouter } from "./routers/account";
import { authRouter } from "./routers/auth";
import { complianceRouter } from "./routers/compliance";
import { notesRouter } from "./routers/notes";
import { systemRouter } from "./routers/system";
import { router } from "./_core/trpc";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  account: accountRouter,
  compliance: complianceRouter,
  /** Feature template — delete once you have your own first feature. */
  notes: notesRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;

/** Procedure namespaces, exported for the AI-context generator and tests. */
export const ROUTER_NAMESPACES = [
  "system",
  "auth",
  "account",
  "compliance",
  "notes",
  "admin",
] as const;
