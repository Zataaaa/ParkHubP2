export function validateReservationPeriod(startTime: unknown, endTime: unknown) {
  if (typeof startTime !== 'string' || typeof endTime !== 'string') {
    return null;
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return null;
  }

  return { start, end };
}

export function hasTimeConflict(
  newStart: Date,
  newEnd: Date,
  existingStart: Date,
  existingEnd: Date
) {
  return newStart < existingEnd && newEnd > existingStart;
}

export function canReserveSpot(active: boolean, hasConflict: boolean) {
  return active && !hasConflict;
}

/**
 * Pure rule: is `newEndTime` a valid extension of a reservation that currently
 * ends at `currentEnd`? Returns the parsed date, or null when it is not valid.
 *
 * Valid means: it is a string, it parses to a real date, and it is strictly
 * after both the current end time and the current moment.
 */
export function validateExtensionEndTime(
  currentEnd: Date,
  newEndTime: unknown,
  now: Date
): Date | null {
  if (typeof newEndTime !== 'string') {
    return null;
  }

  const newEnd = new Date(newEndTime);

  if (Number.isNaN(newEnd.getTime()) || newEnd <= currentEnd || newEnd <= now) {
    return null;
  }

  return newEnd;
}

/**
 * Pure rule: only an ACTIVE reservation that has not ended yet can be extended.
 * A reservation ending exactly at `now` has already finished.
 */
export function isReservationExtendable(status: string, endTime: Date, now: Date): boolean {
  return status === 'ACTIVE' && endTime > now;
}
