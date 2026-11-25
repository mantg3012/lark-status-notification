export function dateIn(input: Date | string | number, timeZone: string): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${String(input)}`);
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayIn(timeZone: string, now?: Date): string {
  return dateIn(now ?? new Date(), timeZone);
}

function getTimeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  const asIfUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );
  return asIfUtc - utcMs;
}

export function endOfDayUnix(date: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${date}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }

  const targetUtcGuess = Date.UTC(year, month - 1, day, 23, 59, 59);
  const offset1 = getTimeZoneOffsetMs(targetUtcGuess, timeZone);
  const utc1 = targetUtcGuess - offset1;
  // Re-evaluate offset at the estimated UTC instant to account for DST transitions.
  const offset2 = getTimeZoneOffsetMs(utc1, timeZone);
  const utc2 = targetUtcGuess - offset2;

  return Math.floor(utc2 / 1000);
}
