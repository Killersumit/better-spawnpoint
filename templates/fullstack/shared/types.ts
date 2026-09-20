/**
 * Shared type surface.
 *
 * Import from here in both server and client code:
 *   import type { PublicUser, NoteDTO } from "@shared/types";
 *
 * Rule: a type that crosses the network lives here or in `drizzle/schema.ts`.
 * Never hand-write a duplicate interface next to a component — that is how the
 * client and server drift until a field is silently `undefined` in production.
 */
export type {
  ConsentRow,
  DataRequestRow,
  FileRow,
  InvitationRow,
  JobRow,
  NewNote,
  NewUser,
  Note,
  PublicUser,
  Session,
  User,
} from "../drizzle/schema";

export { AppError } from "./errors";
export type { HttpStatus } from "./errors";
export type { ConsentCategory, ConsentState } from "./consent";
export type { ComplianceConfig } from "./compliance";
export type { PolicySlug } from "./policies";

/**
 * Standard envelope for a paginated list. Every list endpoint returns this
 * shape so the UI has exactly one pattern to render.
 *
 * Cursor-based (not offset): rows inserted while a user pages through a list
 * would otherwise shift and show duplicates.
 */
export type Paginated<T> = {
  items: T[];
  /** Pass back as `cursor` to fetch the next page. null = end of list. */
  nextCursor: number | null;
};

/** Result of a mutation that only reports success or failure. */
export type ActionResult = {
  success: boolean;
  message?: string;
};

/** The shape `system.health` returns, mirrored for client-side typing. */
export type HealthReport = {
  ok: boolean;
  uptimeSeconds: number;
  bootedAt: string;
  checks: Record<string, string>;
};
