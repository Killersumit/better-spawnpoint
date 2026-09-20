/**
 * Cron matcher tests.
 *
 * The matcher decides when retention jobs run — sessions get pruned, deleted
 * accounts get purged, consent records expire. A matcher that is off by a field
 * does not crash: it silently stops running a job for months, which is exactly
 * the kind of failure that only shows up in an audit. Hence the cases below,
 * including the awkward ones (day-of-week OR day-of-month, step values, ranges,
 * and 0/7 both meaning Sunday).
 */
import { describe, expect, it } from "vitest";
import { CronParseError, cronMatches, describeCron, nextRunAt } from "./cron";

const at = (iso: string) => new Date(iso);

describe("cronMatches", () => {
  it("matches every minute for * * * * *", () => {
    expect(cronMatches("* * * * *", at("2026-09-20T07:31:00Z"))).toBe(true);
    expect(cronMatches("* * * * *", at("2026-09-20T23:59:00Z"))).toBe(true);
  });

  it("matches an exact minute and hour", () => {
    // 03:41 UTC daily — the account-purge schedule.
    const expression = "41 3 * * *";
    expect(cronMatches(expression, at("2026-09-20T03:41:00Z"))).toBe(true);
    expect(cronMatches(expression, at("2026-09-20T03:42:00Z"))).toBe(false);
    expect(cronMatches(expression, at("2026-09-20T04:41:00Z"))).toBe(false);
  });

  it("handles step values", () => {
    // Every 5 minutes.
    const expression = "*/5 * * * *";
    for (const minute of [0, 5, 10, 55]) {
      expect(cronMatches(expression, at(`2026-09-20T09:${String(minute).padStart(2, "0")}:00Z`))).toBe(true);
    }
    for (const minute of [1, 4, 59]) {
      expect(cronMatches(expression, at(`2026-09-20T09:${String(minute).padStart(2, "0")}:00Z`))).toBe(false);
    }
  });

  it("handles ranges and lists", () => {
    // Weekdays at 09:00 (Mon–Fri).
    const weekdays = "0 9 * * 1-5";
    expect(cronMatches(weekdays, at("2026-09-21T09:00:00Z"))).toBe(true); // Monday
    expect(cronMatches(weekdays, at("2026-09-26T09:00:00Z"))).toBe(false); // Saturday

    const listed = "0 0,12 * * *";
    expect(cronMatches(listed, at("2026-09-20T00:00:00Z"))).toBe(true);
    expect(cronMatches(listed, at("2026-09-20T12:00:00Z"))).toBe(true);
    expect(cronMatches(listed, at("2026-09-20T06:00:00Z"))).toBe(false);
  });

  it("treats both 0 and 7 as Sunday", () => {
    const sunday = at("2026-09-20T10:00:00Z");
    expect(cronMatches("0 10 * * 0", sunday)).toBe(true);
    expect(cronMatches("0 10 * * 7", sunday)).toBe(true);
  });

  it("uses OR semantics when day-of-month AND day-of-week are both restricted", () => {
    // Standard cron: "on the 1st, and also every Monday".
    const expression = "0 0 1 * 1";
    expect(cronMatches(expression, at("2026-09-01T00:00:00Z"))).toBe(true); // 1st (Tuesday)
    expect(cronMatches(expression, at("2026-09-07T00:00:00Z"))).toBe(true); // Monday
    expect(cronMatches(expression, at("2026-09-08T00:00:00Z"))).toBe(false);
  });

  it("uses AND semantics when one of them is a wildcard", () => {
    // 1st of the month, any weekday.
    expect(cronMatches("0 0 1 * *", at("2026-10-01T00:00:00Z"))).toBe(true);
    expect(cronMatches("0 0 1 * *", at("2026-10-02T00:00:00Z"))).toBe(false);
  });

  it("respects month and day-of-month boundaries", () => {
    expect(cronMatches("0 0 29 2 *", at("2028-02-29T00:00:00Z"))).toBe(true); // leap day
    expect(cronMatches("0 0 29 2 *", at("2027-03-01T00:00:00Z"))).toBe(false);
    expect(cronMatches("0 0 31 12 *", at("2026-12-31T00:00:00Z"))).toBe(true);
  });

  it("only fires at second zero, so a job runs once per minute", () => {
    expect(cronMatches("* * * * *", at("2026-09-20T07:31:00Z"))).toBe(true);
    expect(cronMatches("* * * * *", at("2026-09-20T07:31:30Z"))).toBe(false);
  });

  it("rejects malformed expressions loudly rather than never matching", () => {
    for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "a * * * *", "* * 0 * *"]) {
      expect(() => cronMatches(bad, new Date()), `should reject ${JSON.stringify(bad)}`).toThrow(
        CronParseError
      );
    }
  });
});

describe("describeCron", () => {
  it("explains the schedules the template ships with", () => {
    expect(describeCron("41 3 * * *")).toMatch(/03:41/);
    expect(describeCron("17 * * * *")).toMatch(/hourly at minute 17/);
    expect(describeCron("*/5 * * * *")).toMatch(/minute/);
  });

  it("falls back to the raw expression instead of guessing", () => {
    expect(describeCron("7 3 1,15 * 2-4")).toContain("7 3 1,15 * 2-4");
  });
});

describe("nextRunAt", () => {
  it("finds the next matching minute", () => {
    const next = nextRunAt("41 3 * * *", at("2026-09-20T07:00:00Z"));
    expect(next?.toISOString()).toBe("2026-09-21T03:41:00.000Z");
  });

  it("returns the same minute when it already matches", () => {
    const next = nextRunAt("*/5 * * * *", at("2026-09-20T07:05:00Z"));
    expect(next?.toISOString()).toBe("2026-09-20T07:05:00.000Z");
  });

  it("is bounded — it gives up rather than looping forever", () => {
    // 30 February never arrives.
    expect(nextRunAt("0 0 30 2 *", at("2026-09-20T07:00:00Z"), 5_000)).toBeNull();
  });
});
