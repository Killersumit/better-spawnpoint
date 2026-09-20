/**
 * Minimal, well-tested cron matcher.
 *
 * Five fields: `minute hour day-of-month month day-of-week`, evaluated in UTC.
 * Supported syntax per field: `*`, `n`, `a-b`, `a-b/n`, `*\/n`, `a,b,c`.
 *
 * Why not a dependency: cron libraries differ in day-of-week semantics and
 * timezone handling, and a scheduler that silently runs an hourly job 24 times
 * at boot is a classic production incident. This is 80 auditable lines with
 * tests covering the edge cases that matter.
 *
 * Day-of-week accepts 0-7 where both 0 and 7 mean Sunday. The POSIX rule
 * applies: if day-of-month AND day-of-week are both restricted (neither is
 * `*`), the job runs when EITHER matches.
 */

export type CronFields = {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** True when the field was `*` — needed for the POSIX DOM/DOW rule. */
  domRestricted: boolean;
  dowRestricted: boolean;
};

const RANGES: Record<keyof Omit<CronFields, "domRestricted" | "dowRestricted">, [number, number]> = {
  minutes: [0, 59],
  hours: [0, 23],
  daysOfMonth: [1, 31],
  months: [1, 12],
  daysOfWeek: [0, 7],
};

export class CronParseError extends Error {
  constructor(expression: string, detail: string) {
    super(`Invalid cron expression "${expression}": ${detail}`);
    this.name = "CronParseError";
  }
}

function parseField(
  raw: string,
  field: keyof typeof RANGES,
  expression: string
): { values: Set<number>; restricted: boolean } {
  const [min, max] = RANGES[field];
  const values = new Set<number>();
  const restricted = raw.trim() !== "*";

  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (piece === "") throw new CronParseError(expression, `empty value in "${field}"`);

    const [rangePart, stepPart] = piece.split("/");
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step < 1) {
      throw new CronParseError(expression, `invalid step "${stepPart}" in "${field}"`);
    }

    let from: number;
    let to: number;

    if (rangePart === "*") {
      from = min;
      to = max;
    } else if (rangePart?.includes("-")) {
      const [a, b] = rangePart.split("-");
      from = Number.parseInt(a ?? "", 10);
      to = Number.parseInt(b ?? "", 10);
    } else {
      from = Number.parseInt(rangePart ?? "", 10);
      // "5/10" means "from 5 to max, every 10".
      to = stepPart === undefined ? from : max;
    }

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      throw new CronParseError(expression, `invalid number in "${field}": "${piece}"`);
    }
    if (from < min || to > max || from > to) {
      throw new CronParseError(
        expression,
        `"${piece}" is out of range for ${field} (${min}-${max})`
      );
    }

    for (let v = from; v <= to; v += step) values.add(v);
  }

  if (values.size === 0) throw new CronParseError(expression, `"${field}" matched nothing`);
  return { values, restricted };
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronParseError(
      expression,
      `expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`
    );
  }

  const minutes = parseField(parts[0]!, "minutes", expression);
  const hours = parseField(parts[1]!, "hours", expression);
  const dom = parseField(parts[2]!, "daysOfMonth", expression);
  const months = parseField(parts[3]!, "months", expression);
  const dow = parseField(parts[4]!, "daysOfWeek", expression);

  // Normalise 7 → 0 so Sunday has one representation.
  const daysOfWeek = new Set([...dow.values].map((d) => (d === 7 ? 0 : d)));

  return {
    minutes: minutes.values,
    hours: hours.values,
    daysOfMonth: dom.values,
    months: months.values,
    daysOfWeek,
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  };
}

/**
 * Does `date` satisfy `expression`?
 *
 * Evaluated in UTC and only true in the first second of a minute. That last rule
 * matters: the scheduler ticks every 30 seconds, so a matcher that ignored
 * seconds would run every job twice per matching minute.
 */
export function cronMatches(expression: string, date: Date): boolean {
  const fields = parseCron(expression);

  if (date.getUTCSeconds() !== 0) return false;
  if (!fields.minutes.has(date.getUTCMinutes())) return false;
  if (!fields.hours.has(date.getUTCHours())) return false;
  if (!fields.months.has(date.getUTCMonth() + 1)) return false;

  const domMatch = fields.daysOfMonth.has(date.getUTCDate());
  const dowMatch = fields.daysOfWeek.has(date.getUTCDay());

  if (fields.domRestricted && fields.dowRestricted) return domMatch || dowMatch;
  if (fields.domRestricted) return domMatch;
  if (fields.dowRestricted) return dowMatch;
  return true;
}

/** Validates an expression without scheduling it. Throws CronParseError. */
export function assertValidCron(expression: string): void {
  parseCron(expression);
}

/**
 * Human summary for logs and the admin UI.
 *
 * Accuracy over brevity: a schedule restricted to certain days or months must
 * say so, because "daily at 03:07 UTC" for a job that only runs on the 1st is
 * worse than no description at all. When the calendar part is complex, the raw
 * expression is appended rather than paraphrased.
 */
export function describeCron(expression: string): string {
  const cached = describeCron.cache.get(expression);
  if (cached) return cached;

  const f = parseCron(expression);
  const pad = (value: number) => String(value).padStart(2, "0");
  const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

  let text: string;
  if (f.minutes.size === 1 && f.hours.size === 1) {
    text = `daily at ${pad(sorted(f.hours)[0]!)}:${pad(sorted(f.minutes)[0]!)} UTC`;
  } else if (f.minutes.size === 1) {
    text = `hourly at minute ${sorted(f.minutes)[0]} (UTC)`;
  } else if (f.minutes.size === 60) {
    text = "every minute";
  } else {
    text = `every ${f.minutes.size} minute(s) of the hour`;
  }

  const calendar: string[] = [];
  if (f.months.size !== 12) calendar.push(`in month(s) ${sorted(f.months).join(", ")}`);

  if (f.domRestricted && f.dowRestricted) {
    calendar.push(`on day(s) ${sorted(f.daysOfMonth).join(", ")} or weekday(s) ${sorted(f.daysOfWeek).join(", ")}`);
  } else if (f.domRestricted) {
    calendar.push(`on day(s) ${sorted(f.daysOfMonth).join(", ")}`);
  } else if (f.dowRestricted) {
    calendar.push(`on weekday(s) ${sorted(f.daysOfWeek).join(", ")} (0 = Sunday)`);
  }

  if (calendar.length > 0) {
    text = `${text}, ${calendar.join(", ")} (${expression})`;
  }

  describeCron.cache.set(expression, text);
  return text;
}
describeCron.cache = new Map<string, string>();

/**
 * The next time `expression` fires at or after `from`.
 *
 * Walks forward one minute at a time and gives up after `maxIterations`, which
 * makes it safe to call with a date that will never match (30 February) — the
 * caller gets `null` instead of an infinite loop. Used to show "next run" in the
 * admin console; it is NOT the scheduler's own clock, which simply tests the
 * current minute.
 */
export function nextRunAt(
  expression: string,
  from: Date = new Date(),
  maxIterations = 366 * 24 * 60
): Date | null {
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);

  for (let i = 0; i < maxIterations; i++) {
    if (cronMatches(expression, cursor)) return new Date(cursor);
    // Always step to the next minute boundary; a cursor that kept a non-zero
    // second count would never match again.
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
  }
  return null;
}
