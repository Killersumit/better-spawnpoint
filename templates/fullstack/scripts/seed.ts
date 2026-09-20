/**
 * `npm run db:seed` — put a usable dataset in a development database.
 *
 * Idempotent: run it as often as you like. It is the difference between an
 * agent that can log in and click through the app, and an agent that has to
 * guess what the UI looks like with data.
 *
 * Safety: refuses to run when NODE_ENV=production unless FORCE_SEED=true, so a
 * stray command in a deploy shell cannot create an admin account for you.
 *
 * Usage:
 *   npm run db:seed
 *   SEED_ADMIN_EMAIL=me@example.com SEED_ADMIN_PASSWORD=… npm run db:seed
 */
import { eq } from "drizzle-orm";
import { hashPassword, validatePassword } from "../server/_core/auth/password";
import { getDb, closeDb } from "../server/_core/db";
import { notes, users } from "../drizzle/schema";

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "";
const DEMO_EMAIL = (process.env.SEED_DEMO_EMAIL ?? "demo@example.com").trim().toLowerCase();

if (process.env.NODE_ENV === "production" && process.env.FORCE_SEED !== "true") {
  console.error(
    "Refusing to seed a production database.\n" +
      "Seeding creates a known admin account. If you really mean it, re-run with FORCE_SEED=true."
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set.\n\n" +
      "This template talks to MySQL (or any compatible server: MariaDB, TiDB,\n" +
      "PlanetScale, Amazon Aurora). The quickest local database:\n\n" +
      "  docker run --name spawnpoint-db -e MYSQL_ROOT_PASSWORD=dev \\\n" +
      "    -e MYSQL_DATABASE=spawnpoint -p 3306:3306 -d mysql:8\n\n" +
      "then in .env:\n\n" +
      "  DATABASE_URL=mysql://root:dev@127.0.0.1:3306/spawnpoint\n\n" +
      "Apply the schema once the database is reachable:  npm run db:migrate"
  );
  process.exit(1);
}

const db = getDb();
if (!db) {
  console.error("Could not open a database connection. Check DATABASE_URL and that the server is running.");
  process.exit(1);
}

/** Creates the user if absent, otherwise leaves the existing row alone. */
async function ensureUser(options: {
  email: string;
  password: string;
  name: string;
  role: "user" | "admin";
}): Promise<number> {
  const existing = await db!
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, options.email))
    .limit(1);

  const alreadyThere = existing[0];
  if (alreadyThere) {
    console.log(`  · ${options.email} already exists (id ${alreadyThere.id}) — left untouched`);
    return alreadyThere.id;
  }

  const problem = validatePassword(options.password);
  if (problem) {
    console.error(`\nCannot seed ${options.email}: ${problem}`);
    console.error("Set SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD to something that passes the policy.");
    process.exit(1);
  }

  const { encoded } = await hashPassword(options.password);
  const inserted = await db!
    .insert(users)
    .values({
      email: options.email,
      passwordHash: encoded,
      name: options.name,
      role: options.role,
      // Seeded accounts are pre-verified: nobody can read the console mail in a
      // fresh environment, and an unverified seed account is a dead end.
      emailVerifiedAt: new Date(),
    })
    .$returningId();

  const id = inserted[0]?.id;
  if (typeof id !== "number") throw new Error(`could not create ${options.email}`);
  console.log(`  ✓ created ${options.role} ${options.email} (id ${id})`);
  return id;
}

const adminPassword = ADMIN_PASSWORD || "admin-password-123";
const demoPassword = process.env.SEED_DEMO_PASSWORD || "demo-password-123";

console.log(`seeding ${new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "") || "database"}`);

const adminId = await ensureUser({
  email: ADMIN_EMAIL,
  password: adminPassword,
  name: "Admin",
  role: "admin",
});

const demoId = await ensureUser({
  email: DEMO_EMAIL,
  password: demoPassword,
  name: "Demo User",
  role: "user",
});

const existingNotes = await db.select({ id: notes.id }).from(notes).where(eq(notes.userId, demoId)).limit(1);
if (existingNotes.length === 0) {
  await db.insert(notes).values([
    {
      userId: demoId,
      title: "Welcome to your new app",
      body: "This note is seed data.\n\nIt exists so the first screen you see has something in it.",
    },
    {
      userId: demoId,
      title: "Delete me",
      body: "Every list in the UI needs an empty state AND a populated state. Seed data gives you the second one.",
    },
  ]);
  console.log("  ✓ created 2 demo notes");
} else {
  console.log("  · demo notes already exist — left untouched");
}

await closeDb();

console.log("\nDone. Sign in with:");
console.log(`  admin  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD ? "(SEED_ADMIN_PASSWORD)" : adminPassword}`);
console.log(`  user   ${DEMO_EMAIL} / ${process.env.SEED_DEMO_PASSWORD ? "(SEED_DEMO_PASSWORD)" : demoPassword}`);
if (!ADMIN_PASSWORD) {
  console.log("\nThese are development defaults. Never seed a database that anyone else can reach.");
}
