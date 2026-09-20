import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/routers";

/**
 * Typed tRPC client. The `AppRouter` type import is what makes every procedure
 * call type-checked end to end: if the server renames a field, `tsc` fails in
 * the component that reads it. Never cast around this.
 */
export const trpc = createTRPCReact<AppRouter>();
